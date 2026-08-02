/**
 * Integration-test plumbing, and the guards that stop it ever running anywhere real.
 *
 * Not a test file. This is the ONLY module in the package that reads `DATABASE_URL`, and it is
 * excluded from the emitting build — production source contains no environment read at all.
 *
 * ### It fails loudly. It never skips.
 *
 * Without `DATABASE_URL` every database test FAILS. Durability, the non-overlap invariant and
 * idempotency under contention are the entire point of this slice, and a suite that quietly reported
 * success without a database would be worse than having no suite.
 *
 * ### It refuses anything that might not be a test database
 *
 * Loopback host, test-shaped database name, and a refusal of anything Supabase-, QuickFurno- or
 * production-shaped. Supabase is a DEPLOYMENT target, never a test target (ADR-0023 §8). The managed
 * database still carries migration 0001 only, and nothing here may change that.
 *
 * No credential is ever printed: a failure names the rule that was broken, not the value.
 */
import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  defaultMigrationsDirectory,
  migrateWithPreflight,
  withClient,
  type DatabaseConfig,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import type {
  RecommendationRuntimeIdentityPort,
  RecommendationRuntimeResult,
} from '@qf-jarvis/recommendation-runtime';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';

/** Loopback only. Not a provider denylist to keep up with — an allowlist of three. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
/** The database name must say it is a test database. */
const TEST_DATABASE_PATTERN = /(^|[_-])test($|[_-])|test$/i;
/** Substrings that mean "this is not a test database, stop". */
const FORBIDDEN_SUBSTRINGS = ['supabase', 'quickfurno', 'prod', 'production', 'live'];

/** The validated test connection string. Throws — never skips — and never includes the URL. */
export function requireTestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'DATABASE_URL is required for the QFJ-P08 durable approval queue tests. They prove ' +
        'durability, the non-overlap invariant and idempotency under contention; they fail rather ' +
        'than skip.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      'DATABASE_URL must point at a loopback host. Managed databases are never a test target.',
    );
  }
  const database = parsed.pathname.replace(/^\//, '');
  if (!TEST_DATABASE_PATTERN.test(database)) {
    throw new Error('DATABASE_URL must name a database that identifies itself as a test database.');
  }
  const haystack = `${host} ${database}`.toLowerCase();
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(forbidden)) {
      throw new Error('DATABASE_URL resembles a managed or production target and is refused.');
    }
  }
  return url;
}

export function testDatabaseConfig(applicationName: string): DatabaseConfig {
  return createDatabaseConfig({ connectionString: requireTestDatabaseUrl(), applicationName });
}

/** A pool over the validated test database. The caller closes it. */
export function createTestPool(applicationName: string): DatabasePool {
  return createDatabasePool(testDatabaseConfig(applicationName));
}

/** The same validated database as a DIFFERENT login role, for the least-privilege proofs. */
export function testDatabaseConfigAs(
  role: string,
  password: string,
  applicationName: string,
): DatabaseConfig {
  const parsed = new URL(requireTestDatabaseUrl());
  parsed.username = encodeURIComponent(role);
  parsed.password = encodeURIComponent(password);
  return createDatabaseConfig({ connectionString: parsed.toString(), applicationName });
}

/** Ensure a LOGIN role exists with a known local-only password and may connect. */
export async function ensureLoginRole(
  pool: DatabasePool,
  role: string,
  password: string,
): Promise<void> {
  await withClient(pool, async (client) => {
    // A `DO` block accepts no bind parameters, so existence is checked with a parameterized SELECT
    // and each statement is rendered server-side through `format`, never string-concatenated.
    const existing = await client.query('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [
      role,
    ]);
    if (existing.rowCount === 0) {
      const create = await client.query<{ stmt: string }>(
        `SELECT format('CREATE ROLE %I LOGIN', $1::text) AS stmt`,
        [role],
      );
      await client.query(create.rows[0]?.stmt ?? '');
    }
    const alter = await client.query<{ stmt: string }>(
      `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
      [role, password],
    );
    await client.query(alter.rows[0]?.stmt ?? '');
    const grant = await client.query<{ stmt: string }>(
      `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS stmt`,
      [role],
    );
    await client.query(grant.rows[0]?.stmt ?? '');
  });
}

export { closeDatabasePool, withClient };
export type { DatabaseConfig, DatabasePool };

/** Drop and rebuild the schema, then apply every migration 0001–0009. */
export async function resetAndMigrate(pool: DatabasePool, config: DatabaseConfig): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });
  await migrateWithPreflight(pool, config, defaultMigrationsDirectory());
}

// ---------------------------------------------------------------------------
// Governed artifact fixtures, built through the REAL merged runtimes.
// ---------------------------------------------------------------------------
//
// A hand-assembled recommendation or request would prove only that this package agrees with a
// fixture. Building them through `@qf-jarvis/recommendation-runtime` and `@qf-jarvis/approval-runtime`
// means the queue is tested against exactly what production would hand it.

export const REC_CREATED_AT = '2026-08-02T09:00:00Z';
export const REC_EXPIRES_AT = '2026-08-04T09:00:00Z';
export const REQ_CREATED_AT = '2026-08-02T10:00:00Z';
export const REQ_EXPIRES_AT = '2026-08-03T10:00:00Z';
export const DECIDED_AT = '2026-08-02T12:00:00Z';

export const POLICY = Object.freeze({ policyId: 'approval.policy', policyVersion: 3 });

/** Distinct per call so two fixtures never collide on an identifier. */
let uniqueCounter = 0;
function uniqueSuffix(): string {
  uniqueCounter += 1;
  return String(uniqueCounter).padStart(12, '0');
}

function sequentialRecommendationIdentity(tag: string): RecommendationRuntimeIdentityPort {
  let n = 0;
  return {
    nextRecommendationId: (): string => {
      n += 1;
      return `${tag}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
    nextActionId: (): string => {
      n += 1;
      return `${tag}-1111-4000-8000-${String(n).padStart(12, '0')}`;
    },
  };
}

function actionDraft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    actionType: 'schedule.follow-up',
    actionContractVersion: 1,
    summary: 'Schedule a follow-up with the vendor.',
    parameters: { channel: 'whatsapp', delayHours: 48 },
    ...over,
  };
}

/** A real governed recommendation. `tag` must be 8 lowercase hex characters. */
export function recommendationSource(
  tag: string,
  over: Record<string, unknown> = {},
): RecommendationRuntimeResult {
  return createRecommendationRuntime({
    identity: sequentialRecommendationIdentity(tag),
  }).create({
    recommendationType: 'vendor.follow-up',
    createdAt: REC_CREATED_AT,
    expiresAt: REC_EXPIRES_AT,
    producingAgent: 'anisha',
    producingAgentVersion: 'anisha.v1',
    subject: { entityType: 'vendor', entityId: 'vendor.42' },
    priority: 'medium',
    confidence: 0.8,
    risk: 'client-or-vendor-facing-communication',
    requiredApproval: 'authorized-team-human',
    summary: 'The vendor has not responded about the delayed sample.',
    rationale: 'Two follow-ups have gone unanswered for six days, past the agreed sample window.',
    evidence: [
      {
        evidenceType: 'derived-signal',
        signalCode: 'vendor.unresponsive',
        description: 'No vendor reply for six days.',
      },
    ],
    proposedActions: [actionDraft()],
    composite: false,
    correlationId: `${tag}-2222-4333-8444-555555555555`,
    ...over,
  });
}

/** Two actions, for the multi-action / one-decision proofs. */
export function twoActionSource(tag: string): RecommendationRuntimeResult {
  return recommendationSource(tag, {
    proposedActions: [
      actionDraft(),
      actionDraft({ actionType: 'notify.owner', summary: 'Tell the account owner.' }),
    ],
  });
}

/** A real approval request for one action of a real recommendation. */
export function approvalRequest(
  source: RecommendationRuntimeResult,
  over: {
    readonly actionIndex?: number;
    readonly createdAt?: string;
    readonly expiresAt?: string;
  } = {},
): ApprovalRequestV1 {
  const action = source.recommendation.proposedActions[over.actionIndex ?? 0];
  if (action === undefined) {
    throw new Error('fixture: no such action');
  }
  const id = `dddddddd-0000-4000-8000-${uniqueSuffix()}`;
  return createApprovalRuntime({
    identity: { nextApprovalRequestId: (): string => id },
  }).createRequest({
    source,
    proposedActionId: action.actionId,
    createdAt: over.createdAt ?? REQ_CREATED_AT,
    expiresAt: over.expiresAt ?? REQ_EXPIRES_AT,
    policy: POLICY,
  });
}

/**
 * A well-formed Core decision over the given action verdicts.
 *
 * Typed as `ApprovalDecisionV1` for the call sites' convenience, and cast rather than constructed:
 * several specs deliberately hand it a shape Core could not have issued (a wrong `issuer`, an agent
 * decider, a contradictory outcome) precisely to prove the contract refuses it.
 */
export function coreDecision(
  source: RecommendationRuntimeResult,
  actionDecisions: readonly {
    readonly actionId: string;
    readonly decision: 'approved' | 'rejected';
  }[],
  over: Record<string, unknown> = {},
): ApprovalDecisionV1 {
  const approved = actionDecisions.some((entry) => entry.decision === 'approved');
  return {
    decisionId: `eeeeeeee-0000-4000-8000-${uniqueSuffix()}`,
    recommendationId: source.recommendation.recommendationId,
    contractVersion: 1,
    issuer: 'quickfurno-core',
    decidedBy: {
      actorType: 'human',
      actor: { entityType: 'operator', entityId: 'human.approver.1' },
    },
    decidedAt: DECIDED_AT,
    outcome: approved ? 'approved' : 'rejected',
    actionDecisions: [...actionDecisions],
    reasonCode: 'core.decided',
    correlationId: source.recommendation.correlationId,
    ...over,
  } as unknown as ApprovalDecisionV1;
}
