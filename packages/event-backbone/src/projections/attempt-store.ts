/**
 * The INTERNAL projection-attempt repository (Stage 3.4.1, ADR-0034).
 *
 * Records one processing attempt of one event by one projection, as a bounded, append-only audit
 * fact. Like the checkpoint repository, every function operates on an **already-borrowed**
 * {@link DatabaseClient} and opens no transaction, takes no lock, and calls no handler.
 *
 * The row carries ONLY: the projection name/version, the event position, the attempt number, the
 * outcome, an OPTIONAL safe error code from the closed vocabulary, and injected timestamps. It can
 * NEVER carry a raw {@link Error}, an exception message, a stack trace, a payload fragment, a
 * correlation/subject id, SQL, or any free text — the API only accepts a {@link ProjectionSafeErrorCode},
 * which is validated. `projection_attempt` is append-only in the database (a `BEFORE UPDATE OR DELETE`
 * trigger refuses mutation for every role, including the owner).
 *
 * Not exported from the package root in Stage 3.4.1.
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';
import { toProjectionName, type ProjectionName } from './projection-name.js';
import {
  assertProjectionSafeErrorCode,
  isProjectionSafeErrorCode,
  type ProjectionSafeErrorCode,
} from './projection-safe-error.js';
import {
  isProjectionAttemptOutcome,
  MAX_PROJECTION_ATTEMPTS,
  type ProjectionAttemptOutcome,
} from './projection-status.js';

/** A parsed, operator-safe attempt row. Contains no free text and no sender-controlled data. */
export interface ProjectionAttemptRow {
  readonly sequence: bigint;
  readonly attemptNumber: number;
  readonly outcome: ProjectionAttemptOutcome;
  readonly safeErrorCode: ProjectionSafeErrorCode | null;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly recordedAt: Date;
}

interface RawAttemptRow {
  readonly sequence: string;
  readonly attempt_number: number;
  readonly outcome: string;
  readonly safe_error_code: string | null;
  readonly started_at: Date;
  readonly completed_at: Date;
  readonly recorded_at: Date;
}

/** The full attempt input. `safeErrorCode` is required for a failure and forbidden for a success. */
export interface ProjectionAttemptInput {
  readonly name: ProjectionName;
  readonly version: number;
  readonly eventPosition: bigint;
  readonly attemptNumber: number;
  readonly outcome: ProjectionAttemptOutcome;
  readonly safeErrorCode: ProjectionSafeErrorCode | null;
  readonly startedAt: Date;
  readonly completedAt: Date;
}

function requireValidDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ProjectionInputError(`${label} must be a valid Date.`);
  }
  return value;
}

/**
 * Append one attempt row and return its generated sequence. Validates every input and the
 * outcome/error-code correspondence: a `succeeded` attempt must carry NO error code; a `failed`
 * attempt must carry a valid safe error code. Throws {@link ProjectionInputError} (or
 * `ProjectionSafeErrorCodeError`) on any violation — the durable row is never written with a
 * mismatched or unbounded value.
 */
export async function appendAttempt(
  client: DatabaseClient,
  input: ProjectionAttemptInput,
): Promise<{ readonly sequence: bigint }> {
  toProjectionName(input.name);
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new ProjectionInputError('projection version must be a positive integer.');
  }
  if (typeof input.eventPosition !== 'bigint' || input.eventPosition <= 0n) {
    throw new ProjectionInputError('event position must be a positive integer position.');
  }
  if (
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    input.attemptNumber > MAX_PROJECTION_ATTEMPTS
  ) {
    throw new ProjectionInputError(
      `attempt number must be between 1 and ${String(MAX_PROJECTION_ATTEMPTS)}.`,
    );
  }
  if (!isProjectionAttemptOutcome(input.outcome)) {
    throw new ProjectionInputError('outcome must be a known attempt outcome.');
  }
  requireValidDate(input.startedAt, 'started at');
  requireValidDate(input.completedAt, 'completed at');
  if (input.completedAt.getTime() < input.startedAt.getTime()) {
    throw new ProjectionInputError('completed_at must not be earlier than started_at.');
  }
  if (input.outcome === 'succeeded') {
    if (input.safeErrorCode !== null) {
      throw new ProjectionInputError('a succeeded attempt must not carry an error code.');
    }
  } else {
    if (input.safeErrorCode === null) {
      throw new ProjectionInputError('a failed attempt must carry a safe error code.');
    }
    assertProjectionSafeErrorCode(input.safeErrorCode);
  }

  const result = await client.query<{ sequence: string }>(
    `INSERT INTO qf_jarvis.projection_attempt
       (projection_name, projection_version, event_position, attempt_number, outcome,
        safe_error_code, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING sequence`,
    [
      input.name,
      input.version,
      input.eventPosition.toString(),
      input.attemptNumber,
      input.outcome,
      input.safeErrorCode,
      input.startedAt,
      input.completedAt,
    ],
  );
  const sequence = result.rows[0]?.sequence;
  if (sequence === undefined) {
    throw new ProjectionInputError('the attempt insert returned no sequence.');
  }
  return { sequence: BigInt(sequence) };
}

/** Convenience: append a successful attempt (no error code). */
export function appendSucceededAttempt(
  client: DatabaseClient,
  input: Omit<ProjectionAttemptInput, 'outcome' | 'safeErrorCode'>,
): Promise<{ readonly sequence: bigint }> {
  return appendAttempt(client, { ...input, outcome: 'succeeded', safeErrorCode: null });
}

/** Convenience: append a failed attempt with a required safe error code. */
export function appendFailedAttempt(
  client: DatabaseClient,
  input: Omit<ProjectionAttemptInput, 'outcome' | 'safeErrorCode'> & {
    readonly safeErrorCode: ProjectionSafeErrorCode;
  },
): Promise<{ readonly sequence: bigint }> {
  return appendAttempt(client, {
    ...input,
    outcome: 'failed',
    safeErrorCode: input.safeErrorCode,
  });
}

/**
 * Read all attempts for one (projection, version, event), in attempt order. Operator-safe fields
 * only. Validates the identity BEFORE any SQL, and parses the stored `outcome` and `safe_error_code`
 * through the closed-vocabulary runtime validators — a stored value outside the vocabulary (which the
 * CHECK constraints should make impossible) fails closed with a typed {@link ProjectionStoredDataError}
 * rather than being passed up as an unchecked type assertion.
 */
export async function readAttemptsForEvent(
  client: DatabaseClient,
  identity: {
    readonly name: ProjectionName;
    readonly version: number;
    readonly eventPosition: bigint;
  },
): Promise<readonly ProjectionAttemptRow[]> {
  toProjectionName(identity.name);
  if (!Number.isInteger(identity.version) || identity.version <= 0) {
    throw new ProjectionInputError('projection version must be a positive integer.');
  }
  if (typeof identity.eventPosition !== 'bigint' || identity.eventPosition <= 0n) {
    throw new ProjectionInputError('event position must be a positive integer position.');
  }
  const result = await client.query<RawAttemptRow>(
    `SELECT sequence, attempt_number, outcome, safe_error_code, started_at, completed_at, recorded_at
       FROM qf_jarvis.projection_attempt
     WHERE projection_name = $1 AND projection_version = $2 AND event_position = $3
     ORDER BY attempt_number ASC`,
    [identity.name, identity.version, identity.eventPosition.toString()],
  );
  return result.rows.map((raw) => {
    if (!isProjectionAttemptOutcome(raw.outcome)) {
      throw new ProjectionStoredDataError('A stored attempt outcome is not a known outcome.');
    }
    let safeErrorCode: ProjectionSafeErrorCode | null = null;
    if (raw.safe_error_code !== null) {
      if (!isProjectionSafeErrorCode(raw.safe_error_code)) {
        throw new ProjectionStoredDataError('A stored safe error code is not in the vocabulary.');
      }
      safeErrorCode = raw.safe_error_code;
    }
    return {
      sequence: BigInt(raw.sequence),
      attemptNumber: raw.attempt_number,
      outcome: raw.outcome,
      safeErrorCode,
      startedAt: raw.started_at,
      completedAt: raw.completed_at,
      recordedAt: raw.recorded_at,
    };
  });
}
