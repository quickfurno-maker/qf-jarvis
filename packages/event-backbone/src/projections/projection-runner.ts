/**
 * The INTERNAL one-event projection runner (Stage 3.4.4, ADR-0037).
 *
 * A single invocation processes AT MOST one event for one projection, under a non-blocking,
 * transaction-scoped advisory lock, and returns exactly one frozen {@link ProjectionRunResult} — or
 * throws a fresh {@link ProjectionRunnerError}. It composes the already-merged primitives (registry,
 * checkpoint store, attempt store, position reader) and adds NO migration, NO worker loop, NO
 * scheduler, and NO real handler. It is not exported from the package root.
 *
 * It deliberately does NOT use the shared `withTransaction`/`withClient` helpers: `withTransaction`
 * rolls back on ANY throw (which would discard the durable failed-attempt bookkeeping on a handler
 * failure), and `withClient` releases the client in a `finally` without protecting the primary error
 * or destroying a client left in an uncertain transaction state. The runner therefore drives BEGIN /
 * SAVEPOINT / ROLLBACK TO SAVEPOINT / COMMIT itself and manages its own client lifecycle.
 *
 * Transaction protocol (ADR-0034 §3, position cursor per ADR-0036):
 *   BEGIN; SET TRANSACTION ISOLATION LEVEL READ COMMITTED; pg_try_advisory_xact_lock(key) ->
 *   busy | lazily create + FOR UPDATE the checkpoint | reconcile attempts | blocked-existing |
 *   retry-pending | read position = last_position + 1 via the map/event join | caught-up |
 *   SAVEPOINT projection_handler | handler | success or classified failure bookkeeping | COMMIT.
 *
 * Atomic retry exhaustion (QFJ-P03.07D, ADR-0040): the FIFTH deterministic failure blocks the
 * checkpoint AND, in the SAME transaction, establishes exactly one durable failure aggregate at the
 * blocked position plus its append-only `created` action (via the internal retry-exhaustion seam over
 * the QFJ-P03.07C persistence primitives). The final attempt, the blocked checkpoint/position, the
 * single active failure, and the creation action therefore commit or roll back together. A later
 * invocation that finds the checkpoint already blocked proves that biconditional (exactly one active
 * failure, at the blocked position) before returning blocked-existing, and fails closed on a
 * divergence — it never repairs, replays, or authorizes anything (QFJ-P03.07E/F).
 *
 * Client lifecycle is PROVEN, not assumed: the outer transaction's state (not-started/open/closed/
 * unknown) is tracked, a NORMAL release happens only after a confirmed COMMIT or a confirmed outer
 * ROLLBACK, and a final safety boundary handles any UNEXPECTED value that escapes with the transaction
 * still open by attempting an outer ROLLBACK — if that ROLLBACK succeeds the state becomes `closed` and
 * the client receives a NORMAL release and stays reusable; if it fails the state becomes `unknown` and
 * the client is DESTROYED via `release(true)`. Either way the unexpected value and any cleanup error are
 * never preserved or leaked, and an intentional {@link ProjectionRunnerError} passes through with its
 * code intact. SQLSTATE classification is a
 * guarded, closed tri-state (absent/valid/invalid) that never invokes a caller getter, `valueOf`, or
 * `toString`. Invalid INVOCATION input (a non-canonical `now`) fails with the existing
 * {@link ProjectionInputError} before a client is acquired; the runner-error codes describe operational
 * runner failures once a run is under way.
 */
import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import type {
  ProjectionDivergenceKind,
  ProjectionInfrastructurePhase,
  ProjectionLogSafeCode,
} from '../observability/projection-log-events.js';
import {
  NOOP_PROJECTION_LOGGER,
  type ProjectionLogger,
} from '../observability/projection-logger.js';
import {
  NOOP_PROJECTION_METRICS,
  type ProjectionMetricsRegistry,
} from '../observability/projection-metrics.js';

import {
  appendFailedAttempt,
  appendSucceededAttempt,
  readAttemptsForEvent,
  type ProjectionAttemptRow,
} from './attempt-store.js';
import {
  advanceCheckpointOnSuccess,
  createCheckpointIfAbsent,
  readCheckpointForUpdate,
  recordCheckpointBlocked,
  recordCheckpointRetryPending,
  type ProjectionCheckpointRow,
} from './checkpoint-store.js';
import { projectionRetryBackoff } from './projection-backoff.js';
import {
  isCanonicalInstant,
  toCanonicalInstant,
  type CanonicalInstant,
  type ProjectionDefinition,
} from './projection-definition.js';
import { ProjectionCheckpointInvalidError, ProjectionInputError } from './projection-errors.js';
import { readEventAtPosition } from './projection-event-reader.js';
import {
  classifyProjectionFailure,
  type ProjectionFailureCategory,
} from './projection-failure-taxonomy.js';
import {
  divergenceKindOf,
  establishRetryExhaustionFailure,
  reconcileBlockedExhaustion,
} from './projection-retry-exhaustion.js';
import { projectionAdvisoryLockKeyParameter } from './projection-lock-key.js';
import type { ProjectionName } from './projection-name.js';
import type { ProjectionRegistry } from './projection-registry.js';
import {
  busyResult,
  caughtUpResult,
  blockedExistingResult,
  blockedNowResult,
  retryPendingResult,
  retryScheduledResult,
  succeededResult,
  type ProjectionRunResult,
} from './projection-run-result.js';
import {
  ProjectionRunnerError,
  type ProjectionRunnerErrorCode,
} from './projection-runner-errors.js';
import type { ProjectionFailureId } from './projection-failure-persistence.js';
import type { ProjectionSafeErrorCode } from './projection-safe-error.js';
import { MAX_PROJECTION_ATTEMPTS } from './projection-status.js';

/** The single closed code stored for a deterministic handler rejection (uniform bounded retry). */
const HANDLER_FAILURE_CODE: ProjectionSafeErrorCode = 'projection-handler-failed';

export interface RunProjectionInput {
  readonly pool: DatabasePool;
  readonly registry: ProjectionRegistry;
  readonly name: string;
  readonly version: number;
  /** The injected canonical UTC instant (deterministic/testable). Never `Date.now()`. */
  readonly now: CanonicalInstant;
  /**
   * Optional structured logger (QFJ-P03.07G). Defaults to a discarding logger, so every existing
   * caller and test keeps working unchanged. Emission happens ONLY after the transaction resolves and
   * is fully guarded — telemetry can never alter a durable outcome or a returned result.
   */
  readonly logger?: ProjectionLogger;
  /** Optional metrics registry (QFJ-P03.07G). Defaults to a discarding registry. */
  readonly metrics?: ProjectionMetricsRegistry;
}

/**
 * Facts a run collects for POST-TRANSACTION observability (QFJ-P03.07G).
 *
 * This is a recording surface, not an emission surface. Nothing here writes a log line or touches a
 * counter; the run fills in what it learns, and {@link runProjectionOnce} emits once the transaction
 * has provably committed or rolled back. Keeping every emission at that single boundary is what makes
 * "telemetry is never inside a correctness transaction" a structural property rather than a convention
 * that each new call site has to remember.
 */
interface RunTelemetry {
  /** The failure aggregate created by the exhaustion transaction, carried out rather than re-queried. */
  failureId: ProjectionFailureId | null;
  /** That aggregate's generation at creation. */
  generation: number | null;
  /** The closed divergence discriminator, when the run failed closed on a broken invariant. */
  divergenceKind: ProjectionDivergenceKind | null;
  /** Where in the transaction protocol an infrastructure fault happened — never what the driver said. */
  phase: ProjectionInfrastructurePhase | null;
  /** The position the run acted on, when it reached one. */
  position: bigint | null;
  /** The attempt number recorded, when one was. */
  attemptNumber: number | null;
  /** The closed safe code recorded, when one was. */
  safeErrorCode: ProjectionLogSafeCode | null;
  /** The scheduled retry instant, on the bounded-retry path. */
  nextAttemptAt: CanonicalInstant | null;
}

/** A fresh, empty recording surface. */
function newRunTelemetry(): RunTelemetry {
  return {
    failureId: null,
    generation: null,
    divergenceKind: null,
    phase: null,
    position: null,
    attemptNumber: null,
    safeErrorCode: null,
    nextAttemptAt: null,
  };
}

interface ProjectionIdentity {
  readonly projectionName: ProjectionName;
  readonly projectionVersion: number;
}

/**
 * The outer transaction's lifecycle, tracked so that release-vs-destroy can be PROVEN rather than
 * assumed: `not-started` before BEGIN, `open` once BEGIN succeeds, `closed` after a confirmed COMMIT or
 * confirmed outer ROLLBACK, and `unknown` after any failed/ambiguous BEGIN/COMMIT/ROLLBACK. The client
 * is returned to the pool with a NORMAL release only when the transaction is `closed` (or never
 * started); an `open` or `unknown` transaction means the client is DESTROYED.
 */
type TransactionState = 'not-started' | 'open' | 'closed' | 'unknown';

/** Mutable per-run state: the tracked lifecycle of the borrowed client's outer transaction. */
interface RunState {
  tx: TransactionState;
}

// --- Post-transaction observability (QFJ-P03.07G) -------------------------------------------------

/**
 * The category the exhaustion path persists. A constant, not a lookup: `establishRetryExhaustionFailure`
 * creates the aggregate with exactly this category, so reporting anything else would be a lie, and
 * re-reading it after the commit would race a concurrent operator action.
 */
const EXHAUSTION_LOG_CATEGORY = 'DETERMINISTIC_HANDLER_FAILURE' as const;

/**
 * Emit observability for a COMMITTED (or cleanly rolled-back) run.
 *
 * Called only after {@link executeRun} has returned, which happens only after a confirmed COMMIT or a
 * confirmed clean ROLLBACK — so nothing here can run inside an open transaction. Wholly guarded: a
 * throwing logger or registry is swallowed, because the result has already been decided and telemetry
 * must not be able to convert a successful run into a thrown error.
 */
function emitRunResultTelemetry(
  logger: ProjectionLogger,
  metrics: ProjectionMetricsRegistry,
  identity: ProjectionIdentity,
  telemetry: RunTelemetry,
  result: ProjectionRunResult,
): void {
  try {
    const labels = {
      projection_name: identity.projectionName,
      projection_version: identity.projectionVersion,
    } as const;
    const logIdentity = {
      projectionName: identity.projectionName,
      projectionVersion: identity.projectionVersion,
    };

    metrics.increment('projection_attempts_total', { ...labels, outcome: result.outcome });

    if (result.outcome === 'retry-scheduled') {
      metrics.increment('projection_deterministic_failures_total', {
        ...labels,
        safe_error_code: result.safeErrorCode,
      });
      logger.projectionEvent(logIdentity, {
        event: 'projection.retry.scheduled',
        position: result.position,
        attemptNumber: result.attemptNumber,
        safeErrorCode: result.safeErrorCode,
        nextAttemptAt: result.nextAttemptAt,
      });
      return;
    }

    if (result.outcome === 'blocked-now') {
      // The TRANSITION into `blocked`. `blocked-existing` deliberately emits none of this: it recurs on
      // every invocation until an operator acts, so counting it would make the exhaustion counter grow
      // without bound on an unattended blocked projection.
      metrics.increment('projection_deterministic_failures_total', {
        ...labels,
        safe_error_code: result.safeErrorCode,
      });
      metrics.increment('projection_retry_exhaustion_total', labels);
      metrics.increment('projection_failures_created_total', {
        ...labels,
        category: EXHAUSTION_LOG_CATEGORY,
      });

      // The three failure-bearing events all name the aggregate this transaction created. It is always
      // recorded before the COMMIT on this path, but the log contract requires a real id rather than a
      // placeholder — so if it is somehow absent the events are skipped and the counters still stand,
      // instead of emitting a line with a fabricated identifier.
      const failureId = telemetry.failureId;
      if (failureId === null) {
        return;
      }
      logger.projectionEvent(logIdentity, {
        event: 'projection.retry.exhausted',
        position: result.blockedPosition,
        attemptNumber: result.attemptNumber,
        safeErrorCode: result.safeErrorCode,
        failureId,
      });
      logger.projectionEvent(logIdentity, {
        event: 'projection.blocked',
        blockedPosition: result.blockedPosition,
        safeErrorCode: result.safeErrorCode,
        failureId,
      });
      logger.projectionEvent(logIdentity, {
        event: 'projection.failure.created',
        failureId,
        position: result.blockedPosition,
        category: EXHAUSTION_LOG_CATEGORY,
        safeErrorCode: result.safeErrorCode,
        automaticAttemptCount: MAX_PROJECTION_ATTEMPTS,
        generation: telemetry.generation ?? 0,
      });
    }
  } catch {
    // Swallowed without inspection: observability must never change a decided outcome.
  }
}

/**
 * Emit observability for a run that FAILED CLOSED.
 *
 * Called after the transaction has been resolved (rolled back, or recorded as unknown), so this too
 * runs outside any open transaction. The three cases are kept distinct because they demand different
 * operator responses: a divergence and an unknown commit outcome each persist NOTHING, which makes
 * these lines and counters their only trace.
 */
function emitRunFailureTelemetry(
  logger: ProjectionLogger,
  metrics: ProjectionMetricsRegistry,
  identity: ProjectionIdentity,
  telemetry: RunTelemetry,
  code: ProjectionRunnerErrorCode,
): void {
  try {
    const labels = {
      projection_name: identity.projectionName,
      projection_version: identity.projectionVersion,
    } as const;
    const logIdentity = {
      projectionName: identity.projectionName,
      projectionVersion: identity.projectionVersion,
    };
    const position = telemetry.position ?? 0n;
    const phase = telemetry.phase ?? 'bookkeeping';

    if (code === 'projection-attempt-checkpoint-divergent') {
      const divergenceKind = telemetry.divergenceKind ?? 'attempt-count-mismatch';
      metrics.increment('projection_divergence_total', {
        ...labels,
        divergence_kind: divergenceKind,
      });
      logger.projectionEvent(logIdentity, {
        event: 'projection.divergence.detected',
        runnerErrorCode: code,
        position,
        divergenceKind,
      });
      return;
    }

    if (code === 'projection-commit-outcome-unknown') {
      metrics.increment('projection_commit_outcome_unknown_total', labels);
      logger.projectionEvent(logIdentity, {
        event: 'projection.commit.outcomeUnknown',
        runnerErrorCode: code,
        position,
        phase,
      });
      return;
    }

    // Everything else that fails closed: infrastructure, an unclassified handler failure, an unknown
    // definition, or an unavailable runner. None of them recorded an attempt.
    metrics.increment('projection_infrastructure_failures_total', {
      ...labels,
      runner_error_code: code,
      phase,
    });
    logger.projectionEvent(logIdentity, {
      event: 'projection.infrastructure.failed',
      runnerErrorCode: code,
      phase,
    });
  } catch {
    // Swallowed without inspection.
  }
}

// --- Fail-closed runner code for a non-deterministic handler failure -----------------------------

/**
 * Map a non-deterministic failure category to the runner error code the runner throws. Only
 * `UNKNOWN_UNCLASSIFIED_FAILURE` gets its own distinct code (the QFJ-P03.07B correction, so an
 * unclassified/ordinary error is visibly NOT an infrastructure failure and NOT a deterministic one);
 * infrastructure, repository-invariant, and cancellation all fail closed through the existing
 * infrastructure code. Deterministic failures never reach here — they take the bounded-retry path.
 */
function failClosedRunnerCode(category: ProjectionFailureCategory): ProjectionRunnerErrorCode {
  return category === 'UNKNOWN_UNCLASSIFIED_FAILURE'
    ? 'projection-unknown-failure'
    : 'projection-infrastructure-failed';
}

/**
 * Recognise an authentic internal {@link ProjectionRunnerError} WITHOUT letting a hostile value throw.
 * A bare `value instanceof ProjectionRunnerError` performs `[[GetPrototypeOf]]` on the left operand,
 * which THROWS for a revoked `Proxy` (object or function) — so the check is wrapped: anything that
 * cannot be safely identified is reported as "not one of ours" and is then normalised by the caller
 * into a fresh repository-owned error. This inspects ONLY the prototype relationship — never the
 * caught value's `message`, `stack`, `cause`, `code`, or any enumerable field. Exported for focused
 * unit tests; NOT re-exported from the package root.
 */
export function isProjectionRunnerErrorSafely(value: unknown): value is ProjectionRunnerError {
  try {
    return value instanceof ProjectionRunnerError;
  } catch {
    return false;
  }
}

// --- Transaction helpers -------------------------------------------------------------------------

/** COMMIT; on success the transaction is CLOSED. On failure the outcome is UNKNOWN — throw a fresh code. */
async function outerCommit(client: DatabaseClient, state: RunState): Promise<void> {
  try {
    await client.query('COMMIT');
    state.tx = 'closed';
  } catch {
    state.tx = 'unknown';
    throw new ProjectionRunnerError('projection-commit-outcome-unknown');
  }
}

/** Clean early-return ROLLBACK (releases the advisory lock). A ROLLBACK failure => unknown + infra. */
async function outerRollbackClean(client: DatabaseClient, state: RunState): Promise<void> {
  try {
    await client.query('ROLLBACK');
    state.tx = 'closed';
  } catch {
    state.tx = 'unknown';
    throw new ProjectionRunnerError('projection-infrastructure-failed');
  }
}

/**
 * Best-effort abort with a fixed code: ROLLBACK (mark the transaction unknown if it fails), then throw.
 *
 * `detail` records — but never emits — the bounded observability discriminators for this abort. The
 * ROLLBACK still happens first and the thrown code is unchanged; recording is a pure assignment that
 * cannot fail, so the fail-closed behaviour is byte-for-byte what it was before QFJ-P03.07G.
 */
async function abortAndThrow(
  client: DatabaseClient,
  state: RunState,
  code: ProjectionRunnerErrorCode,
  telemetry: RunTelemetry,
  detail?: {
    readonly divergenceKind?: ProjectionDivergenceKind;
    readonly phase?: ProjectionInfrastructurePhase;
  },
): Promise<never> {
  if (detail?.divergenceKind !== undefined) {
    telemetry.divergenceKind = detail.divergenceKind;
  }
  if (detail?.phase !== undefined) {
    telemetry.phase = detail.phase;
  }
  try {
    await client.query('ROLLBACK');
    state.tx = 'closed';
  } catch {
    state.tx = 'unknown';
  }
  throw new ProjectionRunnerError(code);
}

// --- Attempt/checkpoint reconciliation -----------------------------------------------------------

/** Exactly `expected` rows, numbered 1..expected, all `failed`; anything else is divergence. */
export function assertFailedAttempts(
  rows: readonly ProjectionAttemptRow[],
  expected: number,
): void {
  if (rows.length !== expected) {
    throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
  }
  for (let index = 0; index < expected; index += 1) {
    const row = rows[index];
    if (row === undefined) {
      throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
    }
    if (row.attemptNumber !== index + 1 || row.outcome !== 'failed') {
      throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
    }
  }
}

/**
 * Verify the stored attempts correspond to the checkpoint BEFORE any early return or write. Throws
 * `projection-attempt-checkpoint-divergent` on any inconsistency (including a malformed stored row).
 */
async function reconcileAttempts(
  client: DatabaseClient,
  definition: ProjectionDefinition,
  checkpoint: ProjectionCheckpointRow,
): Promise<void> {
  const pending = checkpoint.lastPosition + 1n;
  let attempts: readonly ProjectionAttemptRow[];
  try {
    attempts = await readAttemptsForEvent(client, {
      name: definition.name,
      version: definition.version,
      eventPosition: pending,
    });
  } catch {
    throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
  }

  if (checkpoint.status === 'blocked') {
    if (checkpoint.blockedPosition === null || checkpoint.blockedPosition !== pending) {
      throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
    }
    assertFailedAttempts(attempts, MAX_PROJECTION_ATTEMPTS);
    let event;
    try {
      event = await readEventAtPosition(client, pending);
    } catch {
      throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
    }
    if (event === null) {
      throw new ProjectionRunnerError('projection-attempt-checkpoint-divergent');
    }
    return;
  }

  // Active: exactly `failed_attempt_count` failed attempts numbered 1..k for the pending position.
  assertFailedAttempts(attempts, checkpoint.failedAttemptCount);
}

// --- The runner ----------------------------------------------------------------------------------

/**
 * Run one projection invocation. Returns a frozen result ONLY after a confirmed COMMIT (or a clean
 * early-return ROLLBACK); otherwise throws a fresh {@link ProjectionRunnerError}.
 */
export async function runProjectionOnce(input: RunProjectionInput): Promise<ProjectionRunResult> {
  if (!isCanonicalInstant(input.now)) {
    throw new ProjectionInputError('the runner requires a canonical UTC instant for now.');
  }

  // Resolve the definition EXCLUSIVELY through the registry; require the exact requested version.
  // (`definition?.version !== input.version` is true for both an unknown name and a version mismatch.)
  const definition = input.registry.get(input.name);
  if (definition?.version !== input.version) {
    throw new ProjectionRunnerError('projection-unknown-definition');
  }
  const identity: ProjectionIdentity = {
    projectionName: definition.name,
    projectionVersion: definition.version,
  };
  const nowDate = new Date(input.now);

  // QFJ-P03.07G. Both default to discarding implementations, so every pre-existing caller and test is
  // unaffected and no call site is forced to supply telemetry it does not want.
  const logger = input.logger ?? NOOP_PROJECTION_LOGGER;
  const metrics = input.metrics ?? NOOP_PROJECTION_METRICS;
  const telemetry = newRunTelemetry();

  let client: DatabaseClient;
  try {
    client = await input.pool.connect();
  } catch {
    // No client, so no transaction was ever opened — emitting here is trivially post-transaction.
    telemetry.phase = 'connect';
    emitRunFailureTelemetry(logger, metrics, identity, telemetry, 'projection-runner-unavailable');
    throw new ProjectionRunnerError('projection-runner-unavailable');
  }

  const state: RunState = { tx: 'not-started' };
  try {
    const result = await executeRun(client, input, definition, identity, nowDate, state, telemetry);
    // Reached ONLY after a confirmed COMMIT or a confirmed clean ROLLBACK.
    emitRunResultTelemetry(logger, metrics, identity, telemetry, result);
    return result;
  } catch (error: unknown) {
    // FINAL SAFETY BOUNDARY. An intentional runner error already carries a correct fixed code AND has
    // already driven the transaction to a known state (closed or unknown) — pass it through unchanged,
    // so `projection-commit-outcome-unknown` and `projection-attempt-checkpoint-divergent` are never
    // rewritten. Any OTHER escaping value is UNEXPECTED (e.g. a latent defect): it must NOT be
    // preserved, and it must never leave the outer transaction open behind a normally-released client.
    // Recognition is GUARDED — `instanceof` on a revoked Proxy would itself throw a raw TypeError.
    if (isProjectionRunnerErrorSafely(error)) {
      // The transaction was already driven to a known state by whichever path threw.
      emitRunFailureTelemetry(logger, metrics, identity, telemetry, error.code);
      throw error;
    }
    if (state.tx === 'open') {
      try {
        await client.query('ROLLBACK');
        state.tx = 'closed';
      } catch {
        state.tx = 'unknown';
      }
    }
    // Emitted AFTER the rollback above, so this too is outside any open transaction.
    emitRunFailureTelemetry(
      logger,
      metrics,
      identity,
      telemetry,
      'projection-infrastructure-failed',
    );
    throw new ProjectionRunnerError('projection-infrastructure-failed');
  } finally {
    // Normal release ONLY after a confirmed close (or a transaction that never started). An `open` or
    // `unknown` transaction means the client is DESTROYED, never returned to the pool. The `finally`
    // runs exactly once (released/destroyed exactly once); a swallowed release failure can never
    // replace the primary result/error, and the caught value is never passed to release.
    const mustDestroy = state.tx !== 'closed' && state.tx !== 'not-started';
    try {
      client.release(mustDestroy ? true : undefined);
    } catch {
      // Swallowed: cleanup failure must not mask the primary outcome.
    }
  }
}

async function executeRun(
  client: DatabaseClient,
  input: RunProjectionInput,
  definition: ProjectionDefinition,
  identity: ProjectionIdentity,
  nowDate: Date,
  state: RunState,
  telemetry: RunTelemetry,
): Promise<ProjectionRunResult> {
  try {
    await client.query('BEGIN');
    state.tx = 'open';
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  } catch {
    state.tx = 'unknown';
    telemetry.phase = 'begin';
    throw new ProjectionRunnerError('projection-infrastructure-failed');
  }

  // Non-blocking, transaction-scoped advisory lock.
  let locked: boolean;
  try {
    const keyParameter = projectionAdvisoryLockKeyParameter(definition.name, definition.version);
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',
      [keyParameter],
    );
    locked = result.rows[0]?.locked === true;
  } catch {
    return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
      phase: 'lock',
    });
  }
  if (!locked) {
    await outerRollbackClean(client, state);
    return busyResult(identity);
  }

  // Lazily create, then FOR UPDATE lock, the checkpoint.
  let checkpoint: ProjectionCheckpointRow | null;
  try {
    await createCheckpointIfAbsent(client, {
      name: definition.name,
      version: definition.version,
      now: nowDate,
    });
    checkpoint = await readCheckpointForUpdate(client, {
      name: definition.name,
      version: definition.version,
    });
  } catch {
    return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
      phase: 'checkpoint',
    });
  }
  if (checkpoint === null) {
    return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent', telemetry, {
      divergenceKind: 'attempt-count-mismatch',
    });
  }

  // Reconcile stored attempts BEFORE any early return or write.
  try {
    await reconcileAttempts(client, definition, checkpoint);
  } catch {
    return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent', telemetry, {
      divergenceKind: 'attempt-count-mismatch',
    });
  }

  // Already blocked: write nothing. Before returning the stable result, PROVE the active-failure
  // biconditional (QFJ-P03.07D): a blocked checkpoint must correspond to EXACTLY one active failure at
  // the blocked position. This makes a restart after a committed exhaustion return the stable
  // blocked-existing result WITHOUT re-invoking the handler, adding an attempt, or fabricating a
  // failure; a divergence (missing, duplicated, or position-mismatched active failure) fails closed and
  // is never repaired here.
  if (checkpoint.status === 'blocked') {
    const blockedPosition = checkpoint.blockedPosition;
    const code = checkpoint.lastSafeErrorCode;
    if (blockedPosition === null || code === null) {
      return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent', telemetry, {
        divergenceKind: 'blocked-checkpoint-without-active-failure',
      });
    }
    try {
      await reconcileBlockedExhaustion(client, {
        name: definition.name,
        version: definition.version,
        blockedPosition,
      });
    } catch (reconcileError: unknown) {
      if (isProjectionRunnerErrorSafely(reconcileError)) throw reconcileError;
      const reconcileCode: ProjectionRunnerErrorCode =
        reconcileError instanceof ProjectionCheckpointInvalidError
          ? 'projection-attempt-checkpoint-divergent'
          : 'projection-infrastructure-failed';
      // The seam raises a ProjectionDivergenceError carrying a CLOSED kind, so the discriminator is
      // read from a typed field — never parsed out of a message.
      const reconcileKind = divergenceKindOf(reconcileError);
      telemetry.position = blockedPosition;
      return abortAndThrow(client, state, reconcileCode, telemetry, {
        ...(reconcileKind !== null ? { divergenceKind: reconcileKind } : {}),
        phase: 'checkpoint',
      });
    }
    await outerRollbackClean(client, state);
    return blockedExistingResult(identity, blockedPosition, code);
  }

  const pending = checkpoint.lastPosition + 1n;

  // Retry-pending: injected now is before next_attempt_at; append no attempt.
  if (
    checkpoint.failedAttemptCount >= 1 &&
    checkpoint.nextAttemptAt !== null &&
    nowDate.getTime() < checkpoint.nextAttemptAt.getTime()
  ) {
    let pendingInstant: CanonicalInstant;
    try {
      pendingInstant = toCanonicalInstant(checkpoint.nextAttemptAt);
    } catch {
      return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent', telemetry, {
        divergenceKind: 'attempt-count-mismatch',
      });
    }
    await outerRollbackClean(client, state);
    return retryPendingResult(identity, pending, checkpoint.failedAttemptCount, pendingInstant);
  }

  // Read exactly the next position via the map/event join (never raw event.sequence).
  let event;
  try {
    event = await readEventAtPosition(client, pending);
  } catch {
    return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
      phase: 'read',
    });
  }
  if (event === null) {
    // A non-zero failure count with no event at the pending position is divergence, not caught-up.
    if (checkpoint.failedAttemptCount > 0) {
      return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent', telemetry, {
        divergenceKind: 'missing-event-at-position',
      });
    }
    await outerRollbackClean(client, state);
    return caughtUpResult(identity, checkpoint.lastPosition);
  }

  // Apply the handler under a SAVEPOINT.
  try {
    await client.query('SAVEPOINT projection_handler');
  } catch {
    return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
      phase: 'savepoint',
    });
  }

  const attemptNumber = checkpoint.failedAttemptCount + 1;
  let handlerThrew = false;
  let handlerError: unknown;
  try {
    await definition.apply(client, event);
  } catch (error: unknown) {
    handlerThrew = true;
    handlerError = error;
  }

  if (!handlerThrew) {
    // Build the frozen result BEFORE any COMMIT, so once the COMMIT is confirmed the only remaining
    // operation is returning the already-built value.
    const result = succeededResult(identity, pending, attemptNumber);
    try {
      await appendSucceededAttempt(client, {
        name: definition.name,
        version: definition.version,
        eventPosition: pending,
        attemptNumber,
        startedAt: nowDate,
        completedAt: nowDate,
      });
      await advanceCheckpointOnSuccess(client, {
        name: definition.name,
        version: definition.version,
        processedEventPosition: pending,
        now: nowDate,
      });
    } catch {
      return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
        phase: 'bookkeeping',
      });
    }
    telemetry.position = pending;
    telemetry.attemptNumber = attemptNumber;
    await outerCommit(client, state);
    return result;
  }

  // Handler rejected: restore a usable transaction FIRST.
  let savepointRestored = true;
  try {
    await client.query('ROLLBACK TO SAVEPOINT projection_handler');
  } catch {
    savepointRestored = false;
  }
  if (!savepointRestored) {
    telemetry.position = pending;
    return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
      phase: 'savepoint',
    });
  }

  // Classify the handler failure into the closed taxonomy (ADR-0040, QFJ-P03.07B). ONLY a provable
  // deterministic failure — an explicit deterministic-handler-failure contract or a recognised
  // deterministic SQLSTATE — consumes a bounded attempt. Everything else fails closed and records NO
  // attempt: infrastructure and a masquerading-through-the-handler infra fault, a repository invariant,
  // a cancellation/shutdown, and — the correction — an UNKNOWN/ordinary error with no recognised code.
  const classification = classifyProjectionFailure(handlerError);
  if (classification.category !== 'DETERMINISTIC_HANDLER_FAILURE') {
    // Records NO attempt. The phase says the handler boundary was where it surfaced; the classified
    // category — never the raw error — decides the code.
    telemetry.position = pending;
    return abortAndThrow(client, state, failClosedRunnerCode(classification.category), telemetry, {
      phase: 'savepoint',
    });
  }

  // Deterministic handler failure: record ONE bounded failed attempt, then retry or block.
  try {
    await appendFailedAttempt(client, {
      name: definition.name,
      version: definition.version,
      eventPosition: pending,
      attemptNumber,
      startedAt: nowDate,
      completedAt: nowDate,
      safeErrorCode: HANDLER_FAILURE_CODE,
    });

    if (attemptNumber < MAX_PROJECTION_ATTEMPTS) {
      const backoff = projectionRetryBackoff({
        name: definition.name,
        version: definition.version,
        position: pending,
        failureNumber: attemptNumber,
        now: input.now,
      });
      // Build the frozen result BEFORE the COMMIT (see the success path).
      const result = retryScheduledResult(
        identity,
        pending,
        attemptNumber,
        HANDLER_FAILURE_CODE,
        backoff.nextAttemptAt,
      );
      await recordCheckpointRetryPending(client, {
        name: definition.name,
        version: definition.version,
        failedEventPosition: pending,
        failedAttemptCount: attemptNumber,
        safeErrorCode: HANDLER_FAILURE_CODE,
        nextAttemptAt: new Date(backoff.nextAttemptAt),
        now: nowDate,
      });
      telemetry.position = pending;
      telemetry.attemptNumber = attemptNumber;
      telemetry.safeErrorCode = HANDLER_FAILURE_CODE;
      telemetry.nextAttemptAt = backoff.nextAttemptAt;
      await outerCommit(client, state);
      return result;
    }

    const blockedResult = blockedNowResult(identity, pending, HANDLER_FAILURE_CODE);
    await recordCheckpointBlocked(client, {
      name: definition.name,
      version: definition.version,
      blockedPosition: pending,
      safeErrorCode: HANDLER_FAILURE_CODE,
      now: nowDate,
    });
    // QFJ-P03.07D: atomically establish the durable failure aggregate + its append-only `created`
    // action in the SAME transaction as the fifth attempt and the checkpoint block, so the five
    // effects (final attempt + blocked checkpoint + blocked position + exactly one active failure +
    // creation action) commit or roll back together. A duplicate/partial failure state fails closed as
    // divergence; any other establishment failure fails closed as infrastructure — either way the whole
    // transaction (including the fifth attempt and the block) is rolled back and NO durable state is
    // claimed.
    try {
      // QFJ-P03.07G: the created aggregate's identity is CAPTURED here and carried out to the
      // post-commit emission point. Re-reading it after the COMMIT would race a concurrent operator
      // action and could report a generation this transaction never saw.
      const established = await establishRetryExhaustionFailure(client, {
        name: definition.name,
        version: definition.version,
        blockedPosition: pending,
        failedAt: nowDate,
        now: nowDate,
      });
      telemetry.failureId = established.failureId;
      telemetry.generation = established.generation;
    } catch (establishError: unknown) {
      if (isProjectionRunnerErrorSafely(establishError)) throw establishError;
      const establishCode: ProjectionRunnerErrorCode =
        establishError instanceof ProjectionCheckpointInvalidError
          ? 'projection-attempt-checkpoint-divergent'
          : 'projection-infrastructure-failed';
      const establishKind = divergenceKindOf(establishError);
      telemetry.position = pending;
      return await abortAndThrow(client, state, establishCode, telemetry, {
        ...(establishKind !== null ? { divergenceKind: establishKind } : {}),
        phase: 'establish',
      });
    }
    telemetry.position = pending;
    telemetry.attemptNumber = MAX_PROJECTION_ATTEMPTS;
    telemetry.safeErrorCode = HANDLER_FAILURE_CODE;
    await outerCommit(client, state);
    return blockedResult;
  } catch (error: unknown) {
    // A commit-outcome-unknown (or any already-classified runner error) must propagate unchanged; any
    // other bookkeeping failure aborts the transaction so NO durable attempt is claimed. Recognition is
    // GUARDED so a revoked-Proxy caught value cannot make `instanceof` throw a raw TypeError.
    if (isProjectionRunnerErrorSafely(error)) {
      throw error;
    }
    return abortAndThrow(client, state, 'projection-infrastructure-failed', telemetry, {
      phase: 'bookkeeping',
    });
  }
}
