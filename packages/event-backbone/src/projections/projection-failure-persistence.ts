/**
 * The INTERNAL projection-failure PERSISTENCE contracts (QFJ-P03.07C, ADR-0040).
 *
 * Closed vocabularies (mirroring the CHECK constraints in `0006_projection_failure_operations.sql`),
 * branded identity types, bounded-text/UUID validators, and the safe row shapes the failure-persistence
 * repository reads and writes. This module owns NO SQL; it is the shared contract between the repository
 * and its tests, and it is the single place the closed vocabularies are declared in TypeScript.
 *
 * A `migration-failure-vocabulary-conformance` test proves these sets are set-equal to the SQL CHECK
 * literals in migration 0006, so the database and the code can never silently drift.
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import { ProjectionInputError } from './projection-errors.js';
import {
  PROJECTION_FAILURE_CATEGORIES,
  PROJECTION_FAILURE_DIAGNOSTIC_CODES,
  type ProjectionFailureCategory,
} from './projection-failure-taxonomy.js';

// --- Closed vocabularies -------------------------------------------------------------------------

/** The closed failure lifecycle statuses (non-terminal = "active/unresolved"). */
export const PROJECTION_FAILURE_STATUSES = [
  'open',
  'acknowledged',
  'quarantined',
  'replay-authorized',
  'replaying',
  'resolved',
  'superseded',
  'retired',
] as const;
export type ProjectionFailureStatus = (typeof PROJECTION_FAILURE_STATUSES)[number];

/** The terminal statuses — a failure in one of these is no longer active. */
export const PROJECTION_FAILURE_TERMINAL_STATUSES = ['resolved', 'superseded', 'retired'] as const;
export type ProjectionFailureTerminalStatus = (typeof PROJECTION_FAILURE_TERMINAL_STATUSES)[number];

export function isProjectionFailureStatus(value: unknown): value is ProjectionFailureStatus {
  return (
    typeof value === 'string' && (PROJECTION_FAILURE_STATUSES as readonly string[]).includes(value)
  );
}
export function isTerminalProjectionFailureStatus(value: string): boolean {
  return (PROJECTION_FAILURE_TERMINAL_STATUSES as readonly string[]).includes(value);
}

/** The closed action-ledger action types (ADR-0040). */
export const PROJECTION_FAILURE_ACTION_TYPES = [
  'created',
  'acknowledged',
  'quarantined',
  'replay-authorized',
  'replay-started',
  'lease-taken-over',
  'replay-succeeded',
  'replay-failed',
  'authorization-consumed',
  'reconciled',
  'resolved',
  'superseded',
] as const;
export type ProjectionFailureActionType = (typeof PROJECTION_FAILURE_ACTION_TYPES)[number];
export function isProjectionFailureActionType(
  value: unknown,
): value is ProjectionFailureActionType {
  return (
    typeof value === 'string' &&
    (PROJECTION_FAILURE_ACTION_TYPES as readonly string[]).includes(value)
  );
}

/** The closed actor types. */
export const PROJECTION_FAILURE_ACTOR_TYPES = [
  'system',
  'read-only-operator',
  'failure-operator',
  'replay-approver',
  'administrator',
] as const;
export type ProjectionFailureActorType = (typeof PROJECTION_FAILURE_ACTOR_TYPES)[number];
export function isProjectionFailureActorType(value: unknown): value is ProjectionFailureActorType {
  return (
    typeof value === 'string' &&
    (PROJECTION_FAILURE_ACTOR_TYPES as readonly string[]).includes(value)
  );
}

/** The closed replay-authorization states. */
export const PROJECTION_REPLAY_AUTHORIZATION_STATES = [
  'active',
  'consumed',
  'expired',
  'revoked',
] as const;
export type ProjectionReplayAuthorizationState =
  (typeof PROJECTION_REPLAY_AUTHORIZATION_STATES)[number];
export function isProjectionReplayAuthorizationState(
  value: unknown,
): value is ProjectionReplayAuthorizationState {
  return (
    typeof value === 'string' &&
    (PROJECTION_REPLAY_AUTHORIZATION_STATES as readonly string[]).includes(value)
  );
}

/** The closed replay-attempt states. */
export const PROJECTION_REPLAY_ATTEMPT_STATES = [
  'started',
  'succeeded',
  'failed',
  'abandoned',
] as const;
export type ProjectionReplayAttemptState = (typeof PROJECTION_REPLAY_ATTEMPT_STATES)[number];
export function isProjectionReplayAttemptState(
  value: unknown,
): value is ProjectionReplayAttemptState {
  return (
    typeof value === 'string' &&
    (PROJECTION_REPLAY_ATTEMPT_STATES as readonly string[]).includes(value)
  );
}

/** The closed failure categories eligible for persistence (the taxonomy's five). */
export const PROJECTION_PERSISTED_FAILURE_CATEGORIES = PROJECTION_FAILURE_CATEGORIES;
/** The closed safe diagnostic codes eligible for persistence (the taxonomy's five). */
export const PROJECTION_PERSISTED_FAILURE_CODES = Object.freeze([
  PROJECTION_FAILURE_DIAGNOSTIC_CODES.DETERMINISTIC_HANDLER_FAILURE,
  PROJECTION_FAILURE_DIAGNOSTIC_CODES.TRANSIENT_INFRASTRUCTURE_FAILURE,
  PROJECTION_FAILURE_DIAGNOSTIC_CODES.REPOSITORY_INVARIANT_FAILURE,
  PROJECTION_FAILURE_DIAGNOSTIC_CODES.CANCELLATION_OR_SHUTDOWN,
  PROJECTION_FAILURE_DIAGNOSTIC_CODES.UNKNOWN_UNCLASSIFIED_FAILURE,
] as const);
export type ProjectionPersistedFailureCode = (typeof PROJECTION_PERSISTED_FAILURE_CODES)[number];
export function isProjectionPersistedFailureCode(
  value: unknown,
): value is ProjectionPersistedFailureCode {
  return (
    typeof value === 'string' &&
    (PROJECTION_PERSISTED_FAILURE_CODES as readonly string[]).includes(value)
  );
}

/** The closed divergence codes returned by the reconciliation query (fail-closed; no auto-repair). */
export const PROJECTION_FAILURE_DIVERGENCE_CODES = [
  'blocked-checkpoint-without-active-failure',
  'blocked-checkpoint-with-multiple-active-failures',
  'active-failure-without-blocked-checkpoint',
  'active-failure-position-mismatch',
  'authorization-for-resolved-or-missing-failure',
  'multiple-active-authorizations',
  'attempt-lease-inconsistent',
] as const;
export type ProjectionFailureDivergenceCode = (typeof PROJECTION_FAILURE_DIVERGENCE_CODES)[number];

// --- Branded identities --------------------------------------------------------------------------

export type ProjectionFailureId = string & { readonly __brand: 'ProjectionFailureId' };
export type ProjectionFailureActionId = string & { readonly __brand: 'ProjectionFailureActionId' };
export type ProjectionReplayAuthorizationId = string & {
  readonly __brand: 'ProjectionReplayAuthorizationId';
};
export type ProjectionReplayAttemptId = string & { readonly __brand: 'ProjectionReplayAttemptId' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate a lowercase-normalizable UUID, returning it. Throws {@link ProjectionInputError}. */
export function assertUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ProjectionInputError(`${label} must be a valid UUID.`);
  }
  return value.toLowerCase();
}

// --- Bounded-text and numeric validators ---------------------------------------------------------

/** The stored bounds (match the VARCHAR limits in migration 0006). */
export const PROJECTION_FAILURE_TEXT_BOUNDS = Object.freeze({
  safeErrorCode: 64,
  detailDigest: 128,
  actorId: 128,
  reason: 512,
  idempotencyKey: 128,
  leaseOwner: 128,
  authorizedBy: 128,
});

/**
 * Validate a bounded, single-line text value: a non-empty string, no control characters, within the
 * given max length. Returns it unchanged. Throws {@link ProjectionInputError} on any violation — the
 * durable row is never written with an oversized or control-bearing value.
 */
export function assertBoundedText(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ProjectionInputError(`${label} must be a non-empty string.`);
  }
  if (value.length > maxLength) {
    throw new ProjectionInputError(`${label} must be at most ${String(maxLength)} characters.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 0x20 || codePoint === 0x7f) {
      throw new ProjectionInputError(`${label} must not contain control characters.`);
    }
  }
  return value;
}

/** Validate an OPTIONAL bounded text value (null passes through as null). */
export function assertOptionalBoundedText(
  value: unknown,
  maxLength: number,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return assertBoundedText(value, maxLength, label);
}

/** Validate a positive integer (> 0). */
export function assertPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ProjectionInputError(`${label} must be a positive integer.`);
  }
  return value as number;
}

/** Validate a non-negative integer (>= 0). */
export function assertNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new ProjectionInputError(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

/** Validate a positive bigint position (> 0). */
export function assertPositiveBigint(value: unknown, label: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new ProjectionInputError(`${label} must be a positive integer position.`);
  }
  return value;
}

/** Validate a real Date. */
export function assertValidDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ProjectionInputError(`${label} must be a valid Date.`);
  }
  return value;
}

// --- Safe row shapes (operator-safe; no raw text) ------------------------------------------------

export interface ProjectionFailureRow {
  readonly failureId: ProjectionFailureId;
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly projectionPosition: bigint;
  readonly eventStorageSequence: bigint;
  readonly eventId: string | null;
  readonly category: ProjectionFailureCategory;
  readonly safeErrorCode: ProjectionPersistedFailureCode;
  readonly detailDigest: string | null;
  readonly status: ProjectionFailureStatus;
  readonly generation: number;
  readonly automaticAttemptCount: number;
  readonly replayAttemptCount: number;
  readonly resolvedAttemptId: ProjectionReplayAttemptId | null;
  readonly firstFailedAt: Date;
  readonly lastFailedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectionFailureActionRow {
  readonly sequence: bigint;
  readonly actionId: ProjectionFailureActionId;
  readonly failureId: ProjectionFailureId;
  readonly actionType: ProjectionFailureActionType;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly reason: string | null;
  readonly idempotencyKey: string | null;
  readonly expectedGeneration: number | null;
  readonly resultingGeneration: number | null;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
}

export interface ProjectionReplayAuthorizationRow {
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly failureId: ProjectionFailureId;
  readonly failureGeneration: number;
  readonly state: ProjectionReplayAuthorizationState;
  readonly authorizedBy: string;
  readonly reason: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly consumedAt: Date | null;
  readonly consumedAttemptId: ProjectionReplayAttemptId | null;
}

export interface ProjectionReplayAttemptRow {
  readonly attemptId: ProjectionReplayAttemptId;
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly attemptNumber: number;
  readonly state: ProjectionReplayAttemptState;
  readonly leaseOwner: string;
  readonly leaseAcquiredAt: Date;
  readonly leaseExpiresAt: Date;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly outcomeCode: ProjectionPersistedFailureCode | null;
  readonly resultingPosition: bigint | null;
  readonly commitObserved: boolean | null;
}
