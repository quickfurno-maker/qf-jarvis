/**
 * The INTERNAL read-only projection-failure inspection CLI (QFJ-P03.07G, ADR-0040).
 *
 * QFJ-P03.07E and QFJ-P03.07F delivered a complete operator surface — list, inspect, history,
 * divergence, acknowledge, quarantine, authorize, execute — but delivered it as internal TypeScript
 * API. An operator holding a production incident had no way to invoke any of it without writing a
 * program. This edge closes exactly the READ half of that gap.
 *
 * ### Why the write half is deliberately absent
 *
 * There is no `acknowledge`, `quarantine`, `authorize`, or `replay` subcommand, and adding one would be
 * a mistake for three reasons that have nothing to do with effort:
 *
 *  1. The E/F operations require an authorizer context with closed capabilities and an ATTRIBUTED actor
 *     identity. A shell has no authenticated principal, so wiring one would mean inventing an
 *     authentication model inside an observability slice.
 *  2. Replay is designed around four-eyes approval (ADR-0040). A local shell command trivially defeats
 *     that.
 *  3. ADR-0040 places operator authority behind an application/command boundary. A CLI is not that
 *     boundary.
 *
 * So this CLI reads. Mutating operator tooling is legitimate future work with its own authorization
 * design, and it is not QFJ-P03.07G.
 *
 * ### Authorization here is a restriction, not a model
 *
 * The injected authorizer grants EXACTLY ONE capability — `projection-failure:inspect` — and denies
 * everything else, acting as the closed `read-only-operator` actor type that ADR-0040 already defines.
 * Nothing is invented; the strongest thing this process can ask for is a read.
 *
 * ### What it will never print
 *
 * No event payload, subject, metadata, message, stack, SQL, SQLSTATE, connection string, host,
 * username, password, certificate path or contents — and, specifically, **no operator free-text
 * reason**. The action ledger persists reasons for audit; an inspection surface that echoed them to a
 * terminal (and thence to a paste buffer or a ticket) would turn the one unbounded operator-supplied
 * string in the lifecycle into an output. `ProjectionFailureActionView.reason` is therefore read by the
 * repository and dropped here, on purpose.
 *
 * This module is a pure library edge with NO auto-run; the executable is
 * {@link file://./projection-inspection-cli-bin.ts}. It is not exported from the package root, so the
 * barrel's 39-symbol runtime surface is unchanged.
 */

import {
  probeProjectionFailureSchema,
  readProjectionHealthSnapshot,
  evaluateProjectionHealth,
} from '../observability/projection-health.js';
import { resolveCliDatabaseConfig } from '../persistence/cli-config.js';
import type { DatabaseConfig } from '../persistence/database-config.js';
import { closeDatabasePool, createDatabasePool, type DatabasePool } from '../persistence/pool.js';

import { toCanonicalInstant, type CanonicalInstant } from './projection-definition.js';
import {
  inspectProjectionFailure,
  inspectProjectionFailureDivergence,
  inspectProjectionFailureHistory,
  listProjectionFailuresForInspection,
  type ProjectionFailureAuthorizationRequest,
  type ProjectionFailureAuthorizer,
  type ProjectionFailureOperationContext,
} from './projection-failure-operations.js';
import type { ProjectionFailureId } from './projection-failure-persistence.js';

/** The application name reported to PostgreSQL (never a secret). */
export const INSPECTION_APPLICATION_NAME = 'qf-jarvis-projection-inspection';

/**
 * Bounded, deterministic exit codes. They are the machine-readable half of this CLI: because
 * QFJ-P03.07G ships no metrics exporter, `inspect-failures list` used as a probe is the supported way
 * for external tooling to learn that something is blocked.
 */
export const INSPECTION_EXIT_OK = 0;
/** Blocked checkpoints or non-terminal failures exist. Not an error — a finding. */
export const INSPECTION_EXIT_FINDINGS = 10;
/** At least one ADR-0040 divergence was detected. Fail closed: escalate, never repair. */
export const INSPECTION_EXIT_DIVERGENCE = 20;
/** Configuration, startup, or schema mismatch (migrations behind the repository). */
export const INSPECTION_EXIT_CONFIGURATION = 30;
/** Any other operational failure (repository unavailable, unexpected error). */
export const INSPECTION_EXIT_OPERATIONAL = 40;

/** Fixed, repository-owned failure lines. They name the RULE, never a value. */
export const USAGE_LINE =
  'Usage: inspect-failures <list|inspect|history|divergence> [--failure-id <uuid>] [--limit <n>] [--json]';
export const CONFIG_FAILURE_LINE =
  'Refusing to connect: the database configuration is missing or invalid (environment, TLS/CA, or ' +
  'connection mode). Nothing was read.';
export const SCHEMA_FAILURE_LINE =
  'The projection-failure schema is incomplete (migrations are behind the repository). Nothing was read.';
export const OPERATIONAL_FAILURE_LINE =
  'The inspection command failed against the database. Nothing was changed (read-only).';

/** Hard bound on rows a single invocation will print. */
export const MAX_INSPECTION_LIMIT = 200;
const DEFAULT_INSPECTION_LIMIT = 50;

/** The four read-only subcommands. There is deliberately no mutating entry in this table. */
export const INSPECTION_COMMANDS = ['list', 'inspect', 'history', 'divergence'] as const;
export type InspectionCommand = (typeof INSPECTION_COMMANDS)[number];

/** True iff `value` names one of the four read-only subcommands. */
export function isInspectionCommand(value: unknown): value is InspectionCommand {
  return typeof value === 'string' && (INSPECTION_COMMANDS as readonly string[]).includes(value);
}

/** A canonical UUID, matched rather than trusted. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Argument parsing ----------------------------------------------------------------------------

/** The parsed invocation. */
export interface InspectionInvocation {
  readonly command: InspectionCommand;
  readonly failureId: string | null;
  readonly limit: number;
  readonly json: boolean;
}

/** Thrown for an unusable invocation. Carries a fixed line, never the offending token. */
export class InspectionUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InspectionUsageError';
  }
}

/**
 * Parse arguments.
 *
 * A mistyped invocation can put anything in argv — including a connection string — so an unrecognised
 * token is NEVER echoed back. The same rule the migration CLI already applies.
 */
export function parseInspectionArgs(argv: readonly string[]): InspectionInvocation {
  let command: InspectionCommand | null = null;
  let failureId: string | null = null;
  let limit = DEFAULT_INSPECTION_LIMIT;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === '--') continue;

    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--failure-id' || token.startsWith('--failure-id=')) {
      const raw = token.startsWith('--failure-id=')
        ? token.slice('--failure-id='.length)
        : ((): string | undefined => {
            index += 1;
            return argv[index];
          })();
      if (raw === undefined || !UUID_PATTERN.test(raw)) {
        throw new InspectionUsageError('"--failure-id" requires a canonical UUID.');
      }
      failureId = raw;
      continue;
    }
    if (token === '--limit' || token.startsWith('--limit=')) {
      const raw = token.startsWith('--limit=')
        ? token.slice('--limit='.length)
        : ((): string | undefined => {
            index += 1;
            return argv[index];
          })();
      if (raw === undefined || !/^\d{1,4}$/.test(raw)) {
        throw new InspectionUsageError('"--limit" requires a small positive integer.');
      }
      const parsed = Number.parseInt(raw, 10);
      if (parsed <= 0 || parsed > MAX_INSPECTION_LIMIT) {
        throw new InspectionUsageError(
          `"--limit" must be between 1 and ${String(MAX_INSPECTION_LIMIT)}.`,
        );
      }
      limit = parsed;
      continue;
    }
    if (token.startsWith('-')) {
      throw new InspectionUsageError('an unrecognised option was supplied.');
    }
    if (command !== null) {
      throw new InspectionUsageError('more than one command was supplied.');
    }
    if (!isInspectionCommand(token)) {
      // Named explicitly so an operator reaching for a mutating verb learns why it is absent.
      throw new InspectionUsageError('unknown command; this CLI is read-only.');
    }
    command = token;
  }

  if (command === null) {
    throw new InspectionUsageError('a command is required.');
  }
  if ((command === 'inspect' || command === 'history') && failureId === null) {
    throw new InspectionUsageError(`"${command}" requires "--failure-id <uuid>".`);
  }
  return { command, failureId, limit, json };
}

// --- Authorization -------------------------------------------------------------------------------

/**
 * An authorizer that grants read-only inspection and nothing else. It is not an authentication model:
 * it is the smallest possible restriction, expressed with the vocabulary ADR-0040 already defines.
 */
export const READ_ONLY_INSPECTION_AUTHORIZER: ProjectionFailureAuthorizer = Object.freeze({
  authorize(request: ProjectionFailureAuthorizationRequest): boolean {
    return request.capability === 'projection-failure:inspect';
  },
});

/** The fixed read-only operator context this process acts as. */
function inspectionContext(correlationId: string): ProjectionFailureOperationContext {
  return {
    actorType: 'read-only-operator',
    actorId: INSPECTION_APPLICATION_NAME,
    correlationId,
  };
}

// --- Rendering -----------------------------------------------------------------------------------

/** Render a Date as a canonical instant, or `null`. Never throws. */
function instant(value: Date | null): CanonicalInstant | null {
  if (value === null) return null;
  try {
    return toCanonicalInstant(value);
  } catch {
    return null;
  }
}

/** JSON with bigints rendered as decimal strings (`JSON.stringify` throws on a bigint). */
function toJsonLine(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) =>
    typeof raw === 'bigint' ? raw.toString() : raw,
  );
}

// --- Dependencies --------------------------------------------------------------------------------

/** Injected seams, so tests drive every path with no real environment, pool, or process. */
export interface ProjectionInspectionCliDeps {
  readonly argv: readonly string[];
  readonly resolveConfig: (applicationName: string) => Promise<DatabaseConfig>;
  readonly createPool: (config: DatabaseConfig) => DatabasePool;
  readonly closePool: (pool: DatabasePool) => Promise<void>;
  readonly now: () => CanonicalInstant;
  readonly writeOut: (line: string) => void;
  readonly writeErr: (line: string) => void;
  /** A stable correlation id for this invocation (repository-generated; never sender-supplied). */
  readonly correlationId: string;
}

// --- The CLI -------------------------------------------------------------------------------------

/**
 * Run one read-only inspection command and return a bounded exit code.
 *
 * Order matters: configuration, then the schema probe, then the command. Probing the schema first means
 * an operator running this against a database whose migrations are behind gets exit 30 and a clear
 * line, rather than a confusing empty result set that looks like "nothing is wrong".
 */
export async function runProjectionInspectionCli(
  deps: ProjectionInspectionCliDeps,
): Promise<number> {
  let invocation: InspectionInvocation;
  try {
    invocation = parseInspectionArgs(deps.argv);
  } catch (error: unknown) {
    deps.writeErr(error instanceof InspectionUsageError ? error.message : 'invalid invocation.');
    deps.writeErr(USAGE_LINE);
    return INSPECTION_EXIT_CONFIGURATION;
  }

  let config: DatabaseConfig;
  try {
    config = await deps.resolveConfig(INSPECTION_APPLICATION_NAME);
  } catch {
    // Covers a missing DATABASE_URL, a missing/unreadable CA, a transaction-mode pooler, and a URL
    // carrying sslmode. The thrown value is never inspected; the fixed line names the rule.
    deps.writeErr(CONFIG_FAILURE_LINE);
    return INSPECTION_EXIT_CONFIGURATION;
  }

  let pool: DatabasePool;
  try {
    pool = deps.createPool(config);
  } catch {
    deps.writeErr(CONFIG_FAILURE_LINE);
    return INSPECTION_EXIT_CONFIGURATION;
  }

  try {
    const client = await pool.connect();
    try {
      const probe = await probeProjectionFailureSchema(client);
      if (!probe.present) {
        deps.writeErr(SCHEMA_FAILURE_LINE);
        return INSPECTION_EXIT_CONFIGURATION;
      }
    } finally {
      client.release();
    }

    return await runCommand(deps, pool, invocation);
  } catch {
    deps.writeErr(OPERATIONAL_FAILURE_LINE);
    return INSPECTION_EXIT_OPERATIONAL;
  } finally {
    try {
      await deps.closePool(pool);
    } catch {
      // A close failure must not mask the command's outcome; nothing was written either way.
    }
  }
}

/** Dispatch one already-parsed command. */
async function runCommand(
  deps: ProjectionInspectionCliDeps,
  pool: DatabasePool,
  invocation: InspectionInvocation,
): Promise<number> {
  const context = inspectionContext(deps.correlationId);
  const authorizer = READ_ONLY_INSPECTION_AUTHORIZER;

  if (invocation.command === 'list') {
    const page = await listProjectionFailuresForInspection(pool, authorizer, context, {
      activeOnly: true,
      pageSize: invocation.limit,
    });
    const client = await pool.connect();
    let health;
    try {
      health = evaluateProjectionHealth(
        await readProjectionHealthSnapshot(client, deps.now(), invocation.limit),
      );
    } finally {
      client.release();
    }

    if (invocation.json) {
      deps.writeOut(
        toJsonLine({
          command: 'list',
          status: health.status,
          blockedCount: health.blockedCount,
          activeFailureCount: health.activeFailureCount,
          items: page.items.map((item) => ({
            failureId: item.failureId,
            projectionName: item.projectionName,
            projectionVersion: item.projectionVersion,
            projectionPosition: item.projectionPosition,
            category: item.category,
            safeErrorCode: item.safeErrorCode,
            status: item.status,
            generation: item.generation,
            createdAt: instant(item.createdAt),
          })),
          nextCursor: page.nextCursor,
        }),
      );
    } else {
      deps.writeOut(`projection health   ${health.status}`);
      deps.writeOut(`blocked checkpoints ${String(health.blockedCount)}`);
      deps.writeOut(`active failures     ${String(health.activeFailureCount)}`);
      deps.writeOut('');
      if (page.items.length === 0) {
        deps.writeOut('  no active failures');
      }
      for (const item of page.items) {
        deps.writeOut(
          `  ${item.failureId}  ${item.projectionName} v${String(item.projectionVersion)}  ` +
            `pos ${item.projectionPosition.toString()}  ${item.status}  ${item.safeErrorCode}  ` +
            `gen ${String(item.generation)}`,
        );
      }
      if (page.nextCursor !== null) {
        deps.writeOut('');
        deps.writeOut('  (more rows exist; this page was bounded)');
      }
    }
    return health.blockedCount > 0 || health.activeFailureCount > 0
      ? INSPECTION_EXIT_FINDINGS
      : INSPECTION_EXIT_OK;
  }

  if (invocation.command === 'inspect') {
    const failureId = invocation.failureId as ProjectionFailureId;
    const detail = await inspectProjectionFailure(pool, authorizer, context, { failureId });

    if (invocation.json) {
      deps.writeOut(
        toJsonLine({
          command: 'inspect',
          failureId: detail.failureId,
          projectionName: detail.projectionName,
          projectionVersion: detail.projectionVersion,
          projectionPosition: detail.projectionPosition,
          eventStorageSequence: detail.eventStorageSequence,
          category: detail.category,
          safeErrorCode: detail.safeErrorCode,
          status: detail.status,
          generation: detail.generation,
          automaticAttemptCount: detail.automaticAttemptCount,
          replayAttemptCount: detail.replayAttemptCount,
          createdAt: instant(detail.createdAt),
          firstFailedAt: instant(detail.firstFailedAt),
          lastFailedAt: instant(detail.lastFailedAt),
          checkpoint: {
            status: detail.checkpoint.status,
            blockedPosition: detail.checkpoint.blockedPosition,
            lastPosition: detail.checkpoint.lastPosition,
            failedAttemptCount: detail.checkpoint.failedAttemptCount,
            lastSafeErrorCode: detail.checkpoint.lastSafeErrorCode,
          },
          divergences: detail.divergences,
          actionCount: detail.actionCount,
          hasActiveReplayAuthorization: detail.activeReplayAuthorization !== null,
          hasLiveReplayAttempt: detail.liveReplayAttempt !== null,
        }),
      );
    } else {
      deps.writeOut(`failure       ${detail.failureId}`);
      deps.writeOut(`projection    ${detail.projectionName} v${String(detail.projectionVersion)}`);
      deps.writeOut(`position      ${detail.projectionPosition.toString()}`);
      deps.writeOut(`status        ${detail.status}  (generation ${String(detail.generation)})`);
      deps.writeOut(`category      ${detail.category}`);
      deps.writeOut(`safe code     ${detail.safeErrorCode}`);
      deps.writeOut(
        `attempts      ${String(detail.automaticAttemptCount)} automatic, ` +
          `${String(detail.replayAttemptCount)} replay`,
      );
      deps.writeOut(
        `checkpoint    ${detail.checkpoint.status}  last ${detail.checkpoint.lastPosition.toString()}  ` +
          `blocked ${detail.checkpoint.blockedPosition?.toString() ?? '—'}`,
      );
      deps.writeOut(`actions       ${String(detail.actionCount)}`);
      deps.writeOut(
        `replay        authorization ${detail.activeReplayAuthorization === null ? 'none' : 'active'}, ` +
          `live attempt ${detail.liveReplayAttempt === null ? 'none' : 'yes'}`,
      );
      if (detail.divergences.length > 0) {
        deps.writeOut('');
        deps.writeOut('DIVERGENCE DETECTED — escalate to engineering. Do not repair or replay.');
        for (const code of detail.divergences) {
          deps.writeOut(`  ${code}`);
        }
      }
    }
    return detail.divergences.length > 0 ? INSPECTION_EXIT_DIVERGENCE : INSPECTION_EXIT_FINDINGS;
  }

  if (invocation.command === 'history') {
    const failureId = invocation.failureId as ProjectionFailureId;
    const actions = await inspectProjectionFailureHistory(pool, authorizer, context, { failureId });

    // `reason` is READ by the repository and DROPPED here. It is the one unbounded operator-supplied
    // string in the lifecycle; the ledger keeps it for audit, and this surface must not echo it.
    const view = actions.map((action) => ({
      actionType: action.actionType,
      actorType: action.actorType,
      actorId: action.actorId,
      occurredAt: instant(action.occurredAt),
    }));

    if (invocation.json) {
      deps.writeOut(toJsonLine({ command: 'history', failureId, actions: view }));
    } else {
      deps.writeOut(`history for ${failureId}`);
      if (view.length === 0) {
        deps.writeOut('  no actions recorded');
      }
      for (const action of view) {
        deps.writeOut(
          `  ${action.occurredAt ?? '—'}  ${action.actionType}  ` +
            `${action.actorType}:${action.actorId}`,
        );
      }
    }
    return INSPECTION_EXIT_OK;
  }

  // divergence
  const divergences = await inspectProjectionFailureDivergence(pool, authorizer, context);
  if (invocation.json) {
    deps.writeOut(
      toJsonLine({
        command: 'divergence',
        divergences: divergences.map((row) => ({
          code: row.code,
          projectionName: row.projectionName,
          projectionVersion: row.projectionVersion,
          failureId: row.failureId,
        })),
      }),
    );
  } else if (divergences.length === 0) {
    deps.writeOut('no divergences detected');
  } else {
    deps.writeOut('DIVERGENCE DETECTED — escalate to engineering. Do not repair or replay.');
    for (const row of divergences) {
      deps.writeOut(
        `  ${row.code}  ${row.projectionName ?? '—'} v${row.projectionVersion === null ? '—' : String(row.projectionVersion)}  ${row.failureId ?? '—'}`,
      );
    }
  }
  return divergences.length > 0 ? INSPECTION_EXIT_DIVERGENCE : INSPECTION_EXIT_OK;
}

/**
 * The real process seams. `resolveCliDatabaseConfig` is the single place that reads `process.env`,
 * shared with the migrate/preflight/worker CLIs — so this command trusts exactly the same connection
 * rules, and cannot be pointed somewhere they would refuse.
 */
export function defaultProjectionInspectionCliDeps(
  argv: readonly string[],
  correlationId: string,
): ProjectionInspectionCliDeps {
  return {
    argv,
    resolveConfig: resolveCliDatabaseConfig,
    createPool: createDatabasePool,
    closePool: closeDatabasePool,
    now: () => toCanonicalInstant(new Date()),
    writeOut: (line) => {
      process.stdout.write(`${line}\n`);
    },
    writeErr: (line) => {
      process.stderr.write(`${line}\n`);
    },
    correlationId,
  };
}
