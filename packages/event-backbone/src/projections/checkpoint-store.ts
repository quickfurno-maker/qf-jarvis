/**
 * The INTERNAL projection-checkpoint repository (Stage 3.4.1, ADR-0034).
 *
 * Every function here operates on an **already-borrowed** {@link DatabaseClient}. It does NOT connect
 * to a pool, open a transaction, `COMMIT`, `ROLLBACK`, acquire the advisory lock, or invoke a
 * projection handler — those belong to the runner (Stage 3.4.3). The runner owns the transaction and
 * calls these functions inside it; a projection handler must never call them.
 *
 * All SQL is parameterized and fully qualified (`qf_jarvis.projection_checkpoint`). Timestamps are
 * passed EXPLICITLY (an injected clock), never read from `now()` in application code, so processing
 * is deterministic and testable. Mutating operations assert an exact affected-row count and fail
 * closed with a typed {@link ProjectionCheckpointInvalidError} rather than guessing — a blocked
 * checkpoint cannot advance, a sequence cannot decrease, and failure metadata cannot reference an
 * event at or below the checkpoint.
 *
 * Not exported from the package root in Stage 3.4.1.
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionCheckpointInvalidError, ProjectionInputError } from './projection-errors.js';
import { toProjectionName, type ProjectionName } from './projection-name.js';
import {
  assertProjectionSafeErrorCode,
  type ProjectionSafeErrorCode,
} from './projection-safe-error.js';
import {
  isProjectionStatus,
  MAX_PROJECTION_ATTEMPTS,
  type ProjectionStatus,
} from './projection-status.js';

/** A parsed checkpoint row (BIGINT columns as `bigint`, timestamps as `Date`). */
export interface ProjectionCheckpointRow {
  readonly projectionName: ProjectionName;
  readonly projectionVersion: number;
  readonly lastSequence: bigint;
  readonly status: ProjectionStatus;
  readonly blockedSequence: bigint | null;
  readonly failedAttemptCount: number;
  readonly lastSafeErrorCode: ProjectionSafeErrorCode | null;
  readonly nextAttemptAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface RawCheckpointRow {
  readonly projection_name: string;
  readonly projection_version: number;
  readonly last_sequence: string;
  readonly status: string;
  readonly blocked_sequence: string | null;
  readonly failed_attempt_count: number;
  readonly last_safe_error_code: string | null;
  readonly next_attempt_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

const SELECT_COLUMNS = `
  projection_name, projection_version, last_sequence, status, blocked_sequence,
  failed_attempt_count, last_safe_error_code, next_attempt_at, created_at, updated_at
`;

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProjectionInputError(`${label} must be a positive integer.`);
  }
  return value;
}

function requirePositiveBigint(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new ProjectionInputError(`${label} must be a positive integer sequence.`);
  }
  return value;
}

function requireValidDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ProjectionInputError(`${label} must be a valid Date.`);
  }
  return value;
}

/** Parse a raw row into the typed shape, failing closed if a column is somehow malformed. */
function parseRow(raw: RawCheckpointRow): ProjectionCheckpointRow {
  if (!isProjectionStatus(raw.status)) {
    throw new ProjectionCheckpointInvalidError('The stored checkpoint status is not recognised.');
  }
  return {
    projectionName: toProjectionName(raw.projection_name),
    projectionVersion: raw.projection_version,
    lastSequence: BigInt(raw.last_sequence),
    status: raw.status,
    blockedSequence: raw.blocked_sequence === null ? null : BigInt(raw.blocked_sequence),
    failedAttemptCount: raw.failed_attempt_count,
    lastSafeErrorCode:
      raw.last_safe_error_code === null
        ? null
        : assertProjectionSafeErrorCode(raw.last_safe_error_code),
    nextAttemptAt: raw.next_attempt_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** Identity of a checkpoint. `name` is validated; `version` must be a positive integer. */
export interface CheckpointIdentity {
  readonly name: ProjectionName;
  readonly version: number;
}

function validateIdentity(identity: CheckpointIdentity): void {
  toProjectionName(identity.name);
  requirePositiveInteger(identity.version, 'projection version');
}

/**
 * Create the checkpoint for `(name, version)` if it does not already exist. Idempotent: a concurrent
 * or repeated create does not produce a second row (`ON CONFLICT DO NOTHING`). The new row starts at
 * `last_sequence = 0`, `status = 'active'`, `failed_attempt_count = 0`, with no error/next-attempt state.
 */
export async function createCheckpointIfAbsent(
  client: DatabaseClient,
  input: CheckpointIdentity & { readonly now: Date },
): Promise<void> {
  validateIdentity(input);
  requireValidDate(input.now, 'now');
  await client.query(
    `INSERT INTO qf_jarvis.projection_checkpoint
       (projection_name, projection_version, last_sequence, status, failed_attempt_count,
        created_at, updated_at)
     VALUES ($1, $2, 0, 'active', 0, $3, $3)
     ON CONFLICT (projection_name, projection_version) DO NOTHING`,
    [input.name, input.version, input.now],
  );
}

/** Read the checkpoint, or `null` if it does not exist. */
export async function readCheckpoint(
  client: DatabaseClient,
  identity: CheckpointIdentity,
): Promise<ProjectionCheckpointRow | null> {
  validateIdentity(identity);
  const result = await client.query<RawCheckpointRow>(
    `SELECT ${SELECT_COLUMNS} FROM qf_jarvis.projection_checkpoint
     WHERE projection_name = $1 AND projection_version = $2`,
    [identity.name, identity.version],
  );
  const row = result.rows[0];
  return row === undefined ? null : parseRow(row);
}

/** Read and row-lock the checkpoint FOR UPDATE (the runner does this before deciding to process). */
export async function readCheckpointForUpdate(
  client: DatabaseClient,
  identity: CheckpointIdentity,
): Promise<ProjectionCheckpointRow | null> {
  validateIdentity(identity);
  const result = await client.query<RawCheckpointRow>(
    `SELECT ${SELECT_COLUMNS} FROM qf_jarvis.projection_checkpoint
     WHERE projection_name = $1 AND projection_version = $2
     FOR UPDATE`,
    [identity.name, identity.version],
  );
  const row = result.rows[0];
  return row === undefined ? null : parseRow(row);
}

/** Assert an UPDATE affected exactly one row, or fail closed. */
function assertSingleRow(rowCount: number | null, context: string): void {
  if (rowCount !== 1) {
    throw new ProjectionCheckpointInvalidError(
      `Expected exactly one checkpoint row to change (${context}), but ${String(rowCount ?? 0)} did.`,
    );
  }
}

/**
 * Advance the checkpoint after a successfully processed event: set `last_sequence` to the processed
 * event's sequence and CLEAR all failure state (active, count 0, no error, no next-attempt, not
 * blocked). The processed event MUST be exactly `last_sequence + 1` — this is the persistence
 * boundary that prevents event SKIPPING: a projection can only advance one immutable sequence step
 * at a time, and cannot jump over an unprocessed event even if a buggy caller asks it to. Refuses
 * (0 rows -> throws) if the checkpoint is missing, blocked, a regression, a re-application, or a
 * skip (anything other than exactly the next sequence).
 */
export async function advanceCheckpointOnSuccess(
  client: DatabaseClient,
  input: CheckpointIdentity & { readonly processedEventSequence: bigint; readonly now: Date },
): Promise<void> {
  validateIdentity(input);
  requirePositiveBigint(input.processedEventSequence, 'processed event sequence');
  requireValidDate(input.now, 'now');
  const result = await client.query(
    `UPDATE qf_jarvis.projection_checkpoint
       SET last_sequence = $3, status = 'active', failed_attempt_count = 0,
           last_safe_error_code = NULL, next_attempt_at = NULL, blocked_sequence = NULL,
           updated_at = $4
     WHERE projection_name = $1 AND projection_version = $2
       AND status <> 'blocked'
       AND $3 = last_sequence + 1`,
    [input.name, input.version, input.processedEventSequence.toString(), input.now],
  );
  assertSingleRow(result.rowCount, 'advance-on-success');
}

/**
 * Record an active retry-pending state after a handler failure that has NOT yet exhausted the bound.
 * This enforces a STRICT one-step failure progression: the requested `failedAttemptCount` (1..MAX-1)
 * is applied only if the stored count is EXACTLY one less (0->1, 1->2, 2->3, 3->4). It keeps
 * `last_sequence` unchanged, sets the safe error code, and an optional `next_attempt_at`. Refuses
 * (0 rows -> throws) a jump (0->2, 0->4), a regression (3->1), a repeat (2->2), a transition from a
 * blocked checkpoint, or a failing event that is not exactly the next one after the checkpoint.
 */
export async function recordCheckpointRetryPending(
  client: DatabaseClient,
  input: CheckpointIdentity & {
    readonly failedEventSequence: bigint;
    readonly failedAttemptCount: number;
    readonly safeErrorCode: ProjectionSafeErrorCode;
    readonly nextAttemptAt: Date | null;
    readonly now: Date;
  },
): Promise<void> {
  validateIdentity(input);
  requirePositiveBigint(input.failedEventSequence, 'failed event sequence');
  if (
    !Number.isInteger(input.failedAttemptCount) ||
    input.failedAttemptCount < 1 ||
    input.failedAttemptCount > MAX_PROJECTION_ATTEMPTS - 1
  ) {
    throw new ProjectionInputError(
      `A retry-pending failed_attempt_count must be between 1 and ${String(MAX_PROJECTION_ATTEMPTS - 1)}.`,
    );
  }
  assertProjectionSafeErrorCode(input.safeErrorCode);
  if (input.nextAttemptAt !== null) {
    requireValidDate(input.nextAttemptAt, 'next attempt at');
  }
  requireValidDate(input.now, 'now');
  const result = await client.query(
    `UPDATE qf_jarvis.projection_checkpoint
       SET status = 'active', failed_attempt_count = $3, last_safe_error_code = $4,
           next_attempt_at = $5, blocked_sequence = NULL, updated_at = $6
     WHERE projection_name = $1 AND projection_version = $2
       AND status = 'active'
       AND failed_attempt_count = $3 - 1
       AND $7 = last_sequence + 1`,
    [
      input.name,
      input.version,
      input.failedAttemptCount,
      input.safeErrorCode,
      input.nextAttemptAt,
      input.now,
      input.failedEventSequence.toString(),
    ],
  );
  assertSingleRow(result.rowCount, 'retry-pending');
}

/**
 * Block the checkpoint after the FINAL failure. It is impossible to block a checkpoint directly: the
 * transition applies only if the stored status is `active`, the stored `failed_attempt_count` is
 * exactly MAX-1 (4), and the poison event is exactly `last_sequence + 1`. It then sets
 * `status = 'blocked'`, `failed_attempt_count = MAX` (5), `blocked_sequence` to the poison event,
 * clears `next_attempt_at`, and keeps `last_sequence` unchanged (the poison event is never applied).
 * Refuses (0 rows -> throws) a premature block (count 0), an already-blocked checkpoint, or a poison
 * event that is not exactly the next one.
 */
export async function recordCheckpointBlocked(
  client: DatabaseClient,
  input: CheckpointIdentity & {
    readonly blockedSequence: bigint;
    readonly safeErrorCode: ProjectionSafeErrorCode;
    readonly now: Date;
  },
): Promise<void> {
  validateIdentity(input);
  requirePositiveBigint(input.blockedSequence, 'blocked sequence');
  assertProjectionSafeErrorCode(input.safeErrorCode);
  requireValidDate(input.now, 'now');
  const result = await client.query(
    `UPDATE qf_jarvis.projection_checkpoint
       SET status = 'blocked', failed_attempt_count = $3, blocked_sequence = $4,
           last_safe_error_code = $5, next_attempt_at = NULL, updated_at = $6
     WHERE projection_name = $1 AND projection_version = $2
       AND status = 'active'
       AND failed_attempt_count = $3 - 1
       AND $7 = last_sequence + 1`,
    [
      input.name,
      input.version,
      MAX_PROJECTION_ATTEMPTS,
      input.blockedSequence.toString(),
      input.safeErrorCode,
      input.now,
      input.blockedSequence.toString(),
    ],
  );
  assertSingleRow(result.rowCount, 'blocked');
}
