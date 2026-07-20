/**
 * The frozen, internal result of a single projection run (Stage 3.4.4, ADR-0037).
 *
 * A discriminated union tagged by `outcome`, with EXACTLY seven variants. Every variant carries the
 * validated projection identity (`projectionName`, `projectionVersion`) so an internal observer can
 * attribute it unambiguously. Only repository-owned primitives appear: `bigint` positions, canonical
 * instant STRINGS, validated attempt counts/numbers, and closed `safe_error_code` values. No `Date`,
 * `Error`, `cause`, caught stack, SQLSTATE, driver message, array, `Map`, payload, or caller text may
 * appear. Every result is `Object.freeze`d (there are no nested owned mutable objects to deep-freeze).
 *
 * The two blocked outcomes are DISTINCT on purpose: `blocked-now` is an invocation whose fifth failure
 * just committed a failed attempt and blocked; `blocked-existing` is a later invocation that found an
 * already-blocked checkpoint and wrote NOTHING.
 *
 * Not exported from the package root.
 */
import type { CanonicalInstant } from './projection-definition.js';
import type { ProjectionName } from './projection-name.js';
import type { ProjectionSafeErrorCode } from './projection-safe-error.js';

interface Identity {
  readonly projectionName: ProjectionName;
  readonly projectionVersion: number;
}

/** The lock was not acquired; no checkpoint or attempt was read or written. */
export interface ProjectionRunBusy extends Identity {
  readonly outcome: 'busy';
}
/** No projection position `last_position + 1` exists yet; nothing was written. */
export interface ProjectionRunCaughtUp extends Identity {
  readonly outcome: 'caught-up';
  readonly lastPosition: bigint;
}
/** The handler applied the event; the state, a succeeded attempt, and the advance committed atomically. */
export interface ProjectionRunSucceeded extends Identity {
  readonly outcome: 'succeeded';
  readonly position: bigint;
  readonly attemptNumber: number; // 1..5
}
/** This invocation committed failure n (1..4) and scheduled a retry. */
export interface ProjectionRunRetryScheduled extends Identity {
  readonly outcome: 'retry-scheduled';
  readonly position: bigint;
  readonly attemptNumber: number; // 1..4
  readonly safeErrorCode: ProjectionSafeErrorCode;
  readonly nextAttemptAt: CanonicalInstant;
}
/** THIS invocation's fifth failure committed and blocked the projection. */
export interface ProjectionRunBlockedNow extends Identity {
  readonly outcome: 'blocked-now';
  readonly blockedPosition: bigint;
  readonly attemptNumber: 5;
  readonly safeErrorCode: ProjectionSafeErrorCode;
}
/** A later invocation found an already-blocked checkpoint; NO attempt was recorded this invocation. */
export interface ProjectionRunBlockedExisting extends Identity {
  readonly outcome: 'blocked-existing';
  readonly blockedPosition: bigint;
  readonly failedAttemptCount: 5;
  readonly safeErrorCode: ProjectionSafeErrorCode;
}
/** The injected `now` is before `next_attempt_at`; NO attempt was appended. */
export interface ProjectionRunRetryPending extends Identity {
  readonly outcome: 'retry-pending';
  readonly pendingPosition: bigint;
  readonly failedAttemptCount: number; // 1..4
  readonly nextAttemptAt: CanonicalInstant;
}

export type ProjectionRunResult =
  | ProjectionRunBusy
  | ProjectionRunCaughtUp
  | ProjectionRunSucceeded
  | ProjectionRunRetryScheduled
  | ProjectionRunBlockedNow
  | ProjectionRunBlockedExisting
  | ProjectionRunRetryPending;

// --- Frozen builders (the ONLY way the runner constructs a result) ------------------------------

export function busyResult(id: Identity): ProjectionRunBusy {
  return Object.freeze({ outcome: 'busy', ...id });
}
export function caughtUpResult(id: Identity, lastPosition: bigint): ProjectionRunCaughtUp {
  return Object.freeze({ outcome: 'caught-up', ...id, lastPosition });
}
export function succeededResult(
  id: Identity,
  position: bigint,
  attemptNumber: number,
): ProjectionRunSucceeded {
  return Object.freeze({ outcome: 'succeeded', ...id, position, attemptNumber });
}
export function retryScheduledResult(
  id: Identity,
  position: bigint,
  attemptNumber: number,
  safeErrorCode: ProjectionSafeErrorCode,
  nextAttemptAt: CanonicalInstant,
): ProjectionRunRetryScheduled {
  return Object.freeze({
    outcome: 'retry-scheduled',
    ...id,
    position,
    attemptNumber,
    safeErrorCode,
    nextAttemptAt,
  });
}
export function blockedNowResult(
  id: Identity,
  blockedPosition: bigint,
  safeErrorCode: ProjectionSafeErrorCode,
): ProjectionRunBlockedNow {
  return Object.freeze({
    outcome: 'blocked-now',
    ...id,
    blockedPosition,
    attemptNumber: 5,
    safeErrorCode,
  });
}
export function blockedExistingResult(
  id: Identity,
  blockedPosition: bigint,
  safeErrorCode: ProjectionSafeErrorCode,
): ProjectionRunBlockedExisting {
  return Object.freeze({
    outcome: 'blocked-existing',
    ...id,
    blockedPosition,
    failedAttemptCount: 5,
    safeErrorCode,
  });
}
export function retryPendingResult(
  id: Identity,
  pendingPosition: bigint,
  failedAttemptCount: number,
  nextAttemptAt: CanonicalInstant,
): ProjectionRunRetryPending {
  return Object.freeze({
    outcome: 'retry-pending',
    ...id,
    pendingPosition,
    failedAttemptCount,
    nextAttemptAt,
  });
}
