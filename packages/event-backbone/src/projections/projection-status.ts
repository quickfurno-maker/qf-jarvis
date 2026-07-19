/**
 * The closed, repository-owned projection processing vocabulary (Stage 3.4, ADR-0034).
 *
 * `ProjectionStatus` is the durable checkpoint status; `ProjectionAttemptOutcome` is the durable
 * attempt outcome. Both are CHECK-constrained TEXT in `0004_projection_foundation.sql` — never a
 * PostgreSQL enum — so extending the vocabulary later is a one-line forward migration.
 *
 * Not exported from the package root in Stage 3.4.1.
 */

/**
 * The bounded number of processing attempts a projection makes on a single event before it halts
 * (ADR-0034 §6; ADR-0021 §2). The fifth failure blocks the projection. Mirrored by the SQL bounds
 * `failed_attempt_count BETWEEN 0 AND 5` and `attempt_number BETWEEN 1 AND 5`.
 */
export const MAX_PROJECTION_ATTEMPTS = 5;

/** A checkpoint is `active` (processing, possibly retry-pending) or `blocked` (halted on a poison event). */
export const PROJECTION_STATUSES = ['active', 'blocked'] as const;
export type ProjectionStatus = (typeof PROJECTION_STATUSES)[number];

/** True iff `value` is a known projection status. */
export function isProjectionStatus(value: unknown): value is ProjectionStatus {
  return typeof value === 'string' && (PROJECTION_STATUSES as readonly string[]).includes(value);
}

/** A processing attempt either `succeeded` or `failed`. There is no dead-letter outcome here (Stage 3.5). */
export const PROJECTION_ATTEMPT_OUTCOMES = ['succeeded', 'failed'] as const;
export type ProjectionAttemptOutcome = (typeof PROJECTION_ATTEMPT_OUTCOMES)[number];

/** True iff `value` is a known attempt outcome. */
export function isProjectionAttemptOutcome(value: unknown): value is ProjectionAttemptOutcome {
  return (
    typeof value === 'string' && (PROJECTION_ATTEMPT_OUTCOMES as readonly string[]).includes(value)
  );
}
