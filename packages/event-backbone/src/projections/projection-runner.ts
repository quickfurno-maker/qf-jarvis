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
import { ProjectionInputError } from './projection-errors.js';
import { readEventAtPosition } from './projection-event-reader.js';
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

// --- SQLSTATE classification (closed tri-state; never invokes a caller getter or method) ----------

/**
 * A closed, tri-state inspection of a caught value's SQLSTATE. It is deliberately NOT `string | null`:
 * an ABSENT code (no own `code` at all) is materially different from an UNREADABLE one (an accessor, a
 * non-string, a malformed string, or a value that could not even be inspected). The former is an
 * ordinary deterministic handler rejection; the latter is conservatively treated as infrastructure.
 */
export type SqlstateInspection =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly code: string }
  | { readonly kind: 'invalid' };

/** A well-formed SQLSTATE is EXACTLY five characters from `[0-9A-Z]` (digits and UPPERCASE letters). */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * Inspect a caught value's own `code` WITHOUT ever invoking a getter, `valueOf`, `toString`, or any
 * other caller method. `Object.getOwnPropertyDescriptor` is itself guarded, because a revoked Proxy or
 * a hostile `getOwnPropertyDescriptor` trap can throw — that throw must never escape, and is treated as
 * `invalid` (conservative infrastructure). Reading `descriptor.value` on a DATA descriptor returns the
 * already-captured value and runs no user code; an ACCESSOR descriptor has no `value` key and is
 * `invalid` (its getter is never called). Exported for focused unit tests; NOT re-exported from root.
 *
 * Eligibility is **property-bearing** — a non-null OBJECT or a FUNCTION — not merely `typeof === 'object'`.
 * A thrown function is a JavaScript value that can carry an own data/accessor `code` (and can be a
 * revoked Proxy or a hostile descriptor trap), so it is inspected exactly like an object; only a true
 * primitive is `absent`. The function is never invoked.
 */
export function inspectSqlstate(error: unknown): SqlstateInspection {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return { kind: 'absent' }; // a true primitive carries no own code
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  } catch {
    // A revoked Proxy or a hostile descriptor trap: unreadable => conservative infrastructure.
    return { kind: 'invalid' };
  }
  if (descriptor === undefined) {
    return { kind: 'absent' }; // no own `code` property at all
  }
  if (!('value' in descriptor)) {
    return { kind: 'invalid' }; // an accessor (getter/setter): present but never invoked, so unreadable
  }
  const value: unknown = descriptor.value;
  // Short-circuits BEFORE any coercion: if it is not already a primitive string, we never call
  // `.test` (which would ToString a hostile object). A real string has no caller-controlled toString.
  if (typeof value !== 'string' || !SQLSTATE_PATTERN.test(value)) {
    return { kind: 'invalid' }; // non-string, malformed, empty, or arbitrary caller text
  }
  return { kind: 'valid', code: value };
}

/** Recognised HANDLER-side deterministic SQLSTATEs (the handler's own write deterministically failed). */
function isDeterministicHandlerSqlstate(code: string): boolean {
  return (
    code === '23505' || // unique_violation
    code === '23514' || // check_violation
    code === '23503' || // foreign_key_violation
    code === '23502' || // not_null_violation
    code.startsWith('22') || // data exceptions
    code === '42501' || // insufficient_privilege
    code === '42P01' || // undefined_table
    code === '42703' || // undefined_column
    code === '42883' // undefined_function
  );
}

/**
 * Classify a handler rejection: `deterministic` (record a bounded failed attempt) vs `infrastructure`
 * (abort, record nothing).
 *   - ABSENT code (ordinary Error / primitive / no own `code`)  => deterministic.
 *   - VALID SQLSTATE => the deterministic/infrastructure tables: a recognised handler-side code is
 *     deterministic; every other well-formed code (recognised infrastructure OR unrecognised) is
 *     CONSERVATIVE infrastructure.
 *   - INVALID/UNREADABLE code (accessor, non-string, malformed, empty, or an inspection that threw)
 *     => conservative infrastructure. A hostile value can never force a deterministic classification.
 */
export function classifyHandlerError(error: unknown): 'deterministic' | 'infrastructure' {
  const inspection = inspectSqlstate(error);
  if (inspection.kind === 'absent') {
    return 'deterministic';
  }
  if (inspection.kind === 'invalid') {
    return 'infrastructure';
  }
  return isDeterministicHandlerSqlstate(inspection.code) ? 'deterministic' : 'infrastructure';
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

/** Best-effort abort with a fixed code: ROLLBACK (mark the transaction unknown if it fails), then throw. */
async function abortAndThrow(
  client: DatabaseClient,
  state: RunState,
  code: ProjectionRunnerErrorCode,
): Promise<never> {
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

  let client: DatabaseClient;
  try {
    client = await input.pool.connect();
  } catch {
    throw new ProjectionRunnerError('projection-runner-unavailable');
  }

  const state: RunState = { tx: 'not-started' };
  try {
    return await executeRun(client, input, definition, identity, nowDate, state);
  } catch (error: unknown) {
    // FINAL SAFETY BOUNDARY. An intentional runner error already carries a correct fixed code AND has
    // already driven the transaction to a known state (closed or unknown) — pass it through unchanged,
    // so `projection-commit-outcome-unknown` and `projection-attempt-checkpoint-divergent` are never
    // rewritten. Any OTHER escaping value is UNEXPECTED (e.g. a latent defect): it must NOT be
    // preserved, and it must never leave the outer transaction open behind a normally-released client.
    // Recognition is GUARDED — `instanceof` on a revoked Proxy would itself throw a raw TypeError.
    if (isProjectionRunnerErrorSafely(error)) {
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
): Promise<ProjectionRunResult> {
  try {
    await client.query('BEGIN');
    state.tx = 'open';
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  } catch {
    state.tx = 'unknown';
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
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
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
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
  }
  if (checkpoint === null) {
    return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent');
  }

  // Reconcile stored attempts BEFORE any early return or write.
  try {
    await reconcileAttempts(client, definition, checkpoint);
  } catch {
    return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent');
  }

  // Already blocked: write nothing.
  if (checkpoint.status === 'blocked') {
    const blockedPosition = checkpoint.blockedPosition;
    const code = checkpoint.lastSafeErrorCode;
    if (blockedPosition === null || code === null) {
      return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent');
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
      return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent');
    }
    await outerRollbackClean(client, state);
    return retryPendingResult(identity, pending, checkpoint.failedAttemptCount, pendingInstant);
  }

  // Read exactly the next position via the map/event join (never raw event.sequence).
  let event;
  try {
    event = await readEventAtPosition(client, pending);
  } catch {
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
  }
  if (event === null) {
    // A non-zero failure count with no event at the pending position is divergence, not caught-up.
    if (checkpoint.failedAttemptCount > 0) {
      return abortAndThrow(client, state, 'projection-attempt-checkpoint-divergent');
    }
    await outerRollbackClean(client, state);
    return caughtUpResult(identity, checkpoint.lastPosition);
  }

  // Apply the handler under a SAVEPOINT.
  try {
    await client.query('SAVEPOINT projection_handler');
  } catch {
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
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
      return abortAndThrow(client, state, 'projection-infrastructure-failed');
    }
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
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
  }

  // Infrastructure masquerading through the handler consumes NO attempt.
  if (classifyHandlerError(handlerError) === 'infrastructure') {
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
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
    await outerCommit(client, state);
    return blockedResult;
  } catch (error: unknown) {
    // A commit-outcome-unknown (or any already-classified runner error) must propagate unchanged; any
    // other bookkeeping failure aborts the transaction so NO durable attempt is claimed. Recognition is
    // GUARDED so a revoked-Proxy caught value cannot make `instanceof` throw a raw TypeError.
    if (isProjectionRunnerErrorSafely(error)) {
      throw error;
    }
    return abortAndThrow(client, state, 'projection-infrastructure-failed');
  }
}
