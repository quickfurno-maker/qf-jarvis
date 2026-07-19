/**
 * The closed, repository-owned SAFE error vocabulary for projection processing (Stage 3.4, ADR-0034).
 *
 * A projection failure records a bounded CODE and nothing else. It NEVER records a raw exception, a
 * database message, a stack trace, a payload fragment, SQL, a connection detail, or any arbitrary
 * caller-provided string. This module is the only source of the codes that may reach the durable
 * `projection_attempt.safe_error_code` / `projection_checkpoint.last_safe_error_code` columns, and the
 * same closed set is asserted by a CHECK constraint in `0004_projection_foundation.sql`.
 *
 * Stage 3.4.1 defines only the codes the schema and repositories need. There is deliberately NO
 * dead-letter or replay code — those are Stage 3.5 concepts.
 *
 * Not exported from the package root in Stage 3.4.1.
 */

/** The closed set of safe projection error codes. */
export const PROJECTION_SAFE_ERROR_CODES = [
  'projection-handler-failed', // an expected handler rejection (the reducer refused the event)
  'projection-checkpoint-invalid', // a checkpoint invariant was violated
  'projection-state-write-failed', // the read-model write failed
  'projection-attempt-write-failed', // recording the attempt itself failed
] as const;

/** One safe, repository-owned projection error code. */
export type ProjectionSafeErrorCode = (typeof PROJECTION_SAFE_ERROR_CODES)[number];

/** The maximum stored length of a safe error code (matches the `varchar(64)` column bound). */
export const MAX_PROJECTION_SAFE_ERROR_CODE_LENGTH = 64;

/** True iff `value` is one of the closed safe error codes. */
export function isProjectionSafeErrorCode(value: unknown): value is ProjectionSafeErrorCode {
  return (
    typeof value === 'string' && (PROJECTION_SAFE_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** Thrown when a value offered as a safe error code is not in the closed vocabulary. */
export class ProjectionSafeErrorCodeError extends Error {
  public readonly code = 'projection-safe-error-code-invalid';

  public constructor() {
    super('The provided value is not a repository-owned safe projection error code.');
    this.name = 'ProjectionSafeErrorCodeError';
  }
}

/**
 * Validate a safe error code. Throws {@link ProjectionSafeErrorCodeError} for anything outside the
 * closed set — including a raw database message, an exception string, or an arbitrary caller code.
 * This is the gate that keeps unbounded error text out of the durable store.
 */
export function assertProjectionSafeErrorCode(value: unknown): ProjectionSafeErrorCode {
  if (!isProjectionSafeErrorCode(value)) {
    throw new ProjectionSafeErrorCodeError();
  }
  return value;
}
