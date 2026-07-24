/**
 * The INTERNAL closed structured-log vocabulary for projection failure operations (QFJ-P03.07G,
 * ADR-0040).
 *
 * This module is **pure data and types**: it declares WHAT may be logged and nothing about HOW. It
 * opens no connection, reads no clock, writes to no sink, and holds no state. The writer lives in
 * {@link file://./projection-logger.ts}.
 *
 * ### Why the vocabulary is closed rather than a field bag
 *
 * The whole projection subsystem is built so that a hostile or careless value cannot reach a durable
 * column: the runner uses bindingless `catch` blocks precisely so a thrown value is never read,
 * stringified, or retained, and the failure aggregate persists only closed categories and codes. A
 * logger that accepted `Record<string, unknown>` would hand back exactly the leak those measures
 * remove — one `logger.info('failed', { error })` is all it takes to put a stack trace, a SQL
 * fragment, or a payload into an operator's log aggregator.
 *
 * So there is no field bag. Every event is a variant of a discriminated union with an exact field
 * shape, every field type is either a closed vocabulary, a repository-generated identifier, or a
 * bounded number, and severity is not a caller argument at all — it is looked up from
 * {@link PROJECTION_LOG_SEVERITY_BY_EVENT}, so the same event can never be logged at two severities
 * by two call sites.
 *
 * ### Scope split
 *
 * Most events describe ONE projection and carry {@link ProjectionLogIdentity}. Two events —
 * `projection.worker.started` and `projection.worker.stopped` — describe a worker run that spans the
 * whole registry, so they have no single projection to name and deliberately carry no identity. That
 * is the only deviation from "every record carries name+version", and it is forced by the worker's
 * actual shape (`runProjectionWorker` iterates the registry).
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import type { CanonicalInstant } from '../projections/projection-definition.js';
import type {
  ProjectionFailureActorType,
  ProjectionFailureId,
  ProjectionFailureStatus,
  ProjectionReplayAttemptId,
  ProjectionReplayAuthorizationId,
} from '../projections/projection-failure-persistence.js';
import type { ProjectionFailureCategory } from '../projections/projection-failure-taxonomy.js';
import type { ProjectionName } from '../projections/projection-name.js';
import type { ProjectionRunResult } from '../projections/projection-run-result.js';
import type { ProjectionRunnerErrorCode } from '../projections/projection-runner-errors.js';
import type { ProjectionWorkerStoppedBy } from '../projections/projection-worker.js';

// --- Severity ------------------------------------------------------------------------------------

/**
 * The closed severity ladder. `critical` is reserved for the two conditions that persist NOTHING and
 * therefore have no durable trace at all — divergence and an unknown commit outcome — plus nothing
 * else, so that "critical" keeps meaning "a human must look now".
 */
export const PROJECTION_LOG_SEVERITIES = ['debug', 'info', 'warn', 'error', 'critical'] as const;
export type ProjectionLogSeverity = (typeof PROJECTION_LOG_SEVERITIES)[number];

/** Ascending order, used for threshold filtering. Index === rank. */
export const PROJECTION_LOG_SEVERITY_ORDER: readonly ProjectionLogSeverity[] =
  PROJECTION_LOG_SEVERITIES;

/** True iff `value` is one of the five closed severities. */
export function isProjectionLogSeverity(value: unknown): value is ProjectionLogSeverity {
  return (
    typeof value === 'string' && (PROJECTION_LOG_SEVERITIES as readonly string[]).includes(value)
  );
}

/** Rank a severity for threshold comparison (`debug` = 0 … `critical` = 4). */
export function projectionLogSeverityRank(severity: ProjectionLogSeverity): number {
  return PROJECTION_LOG_SEVERITY_ORDER.indexOf(severity);
}

// --- Closed discriminators -----------------------------------------------------------------------

/**
 * The closed divergence kinds. Each names one way the checkpoint↔failure biconditional can be broken,
 * and each corresponds to a fail-closed throw that already exists in the merged QFJ-P03.07D code —
 * these are named observations of existing behaviour, not new states.
 */
export const PROJECTION_DIVERGENCE_KINDS = [
  'blocked-checkpoint-without-active-failure',
  'blocked-checkpoint-with-multiple-active-failures',
  'active-failure-position-mismatch',
  'attempt-count-mismatch',
  'missing-event-at-position',
] as const;
export type ProjectionDivergenceKind = (typeof PROJECTION_DIVERGENCE_KINDS)[number];

/** True iff `value` is one of the five closed divergence kinds. */
export function isProjectionDivergenceKind(value: unknown): value is ProjectionDivergenceKind {
  return (
    typeof value === 'string' && (PROJECTION_DIVERGENCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The closed phase discriminator for an infrastructure failure. It names WHERE in the runner's
 * transaction protocol the failure happened — never WHAT the driver said. A SQLSTATE or driver message
 * would answer "what" and is forbidden everywhere (see the redaction rules in the alerting document).
 */
export const PROJECTION_INFRASTRUCTURE_PHASES = [
  'connect',
  'begin',
  'lock',
  'checkpoint',
  'read',
  'savepoint',
  'bookkeeping',
  'establish',
  'rollback',
] as const;
export type ProjectionInfrastructurePhase = (typeof PROJECTION_INFRASTRUCTURE_PHASES)[number];

/** True iff `value` is one of the nine closed infrastructure phases. */
export function isProjectionInfrastructurePhase(
  value: unknown,
): value is ProjectionInfrastructurePhase {
  return (
    typeof value === 'string' &&
    (PROJECTION_INFRASTRUCTURE_PHASES as readonly string[]).includes(value)
  );
}

/**
 * The closed safe-code vocabulary usable in a log field or metric label.
 *
 * Deliberately the UNION of the two closed code sets the repository already owns: the Stage 3.4
 * attempt codes (`0004` CHECK) and the QFJ-P03.07B taxonomy diagnostic codes (`0006` CHECK). Both are
 * closed, so their union is closed and bounded. Using one set alone would silently drop codes emitted
 * by the other path.
 */
export const PROJECTION_LOG_SAFE_CODES = [
  'projection-handler-failed',
  'projection-checkpoint-invalid',
  'projection-state-write-failed',
  'projection-attempt-write-failed',
  'projection-infrastructure-failed',
  'projection-repository-invariant-failed',
  'projection-cancelled',
  'projection-unknown-failure',
] as const;
export type ProjectionLogSafeCode = (typeof PROJECTION_LOG_SAFE_CODES)[number];

/** True iff `value` is one of the closed safe codes. */
export function isProjectionLogSafeCode(value: unknown): value is ProjectionLogSafeCode {
  return (
    typeof value === 'string' && (PROJECTION_LOG_SAFE_CODES as readonly string[]).includes(value)
  );
}

/** The runner's seven closed result outcomes, reused verbatim as a log/label value. */
export type ProjectionRunOutcome = ProjectionRunResult['outcome'];

// --- Event names ---------------------------------------------------------------------------------

/** The closed event-name vocabulary. Adding a name here without a variant below is a type error. */
export const PROJECTION_LOG_EVENT_NAMES = [
  'projection.retry.scheduled',
  'projection.retry.exhausted',
  'projection.blocked',
  'projection.failure.created',
  'projection.failure.acknowledged',
  'projection.failure.quarantined',
  'projection.replay.authorized',
  'projection.replay.lease.acquired',
  'projection.replay.lease.takenOver',
  'projection.replay.started',
  'projection.replay.succeeded',
  'projection.replay.failed',
  'projection.divergence.detected',
  'projection.infrastructure.failed',
  'projection.commit.outcomeUnknown',
  'projection.worker.cycle',
  'projection.worker.started',
  'projection.worker.stopped',
] as const;
export type ProjectionLogEventName = (typeof PROJECTION_LOG_EVENT_NAMES)[number];

/** True iff `value` is one of the closed event names. */
export function isProjectionLogEventName(value: unknown): value is ProjectionLogEventName {
  return (
    typeof value === 'string' && (PROJECTION_LOG_EVENT_NAMES as readonly string[]).includes(value)
  );
}

/**
 * Severity per event — frozen, exhaustive, and the ONLY source of an emitted severity.
 *
 * Severity is a property of the EVENT, not of the call site. Deriving it here means a divergence can
 * never be logged at `warn` by one caller and `critical` by another, and it makes the severity policy
 * reviewable in one place instead of scattered across the runner, the worker, and two services.
 */
export const PROJECTION_LOG_SEVERITY_BY_EVENT: Readonly<
  Record<ProjectionLogEventName, ProjectionLogSeverity>
> = Object.freeze({
  'projection.retry.scheduled': 'info',
  'projection.retry.exhausted': 'error',
  'projection.blocked': 'error',
  'projection.failure.created': 'error',
  'projection.failure.acknowledged': 'info',
  'projection.failure.quarantined': 'warn',
  'projection.replay.authorized': 'warn',
  'projection.replay.lease.acquired': 'info',
  'projection.replay.lease.takenOver': 'warn',
  'projection.replay.started': 'info',
  'projection.replay.succeeded': 'info',
  'projection.replay.failed': 'error',
  'projection.divergence.detected': 'critical',
  'projection.infrastructure.failed': 'error',
  'projection.commit.outcomeUnknown': 'critical',
  'projection.worker.cycle': 'debug',
  'projection.worker.started': 'info',
  'projection.worker.stopped': 'info',
} as const);

// --- Identity ------------------------------------------------------------------------------------

/**
 * The projection a record describes. Both fields are repository-owned and bounded: the name is
 * validated against the canonical pattern (≤ 64 chars) and the version is a small positive integer.
 * Neither is sender-controlled.
 */
export interface ProjectionLogIdentity {
  readonly projectionName: ProjectionName;
  readonly projectionVersion: number;
}

// --- Projection-scoped events --------------------------------------------------------------------

/**
 * A deterministic failure below the retry bound scheduled another attempt. Emitted ONLY after the
 * retry transaction has committed.
 */
export interface ProjectionRetryScheduledEvent {
  readonly event: 'projection.retry.scheduled';
  /** The projection position of the failing event (gap-free, ADR-0036 — never a storage sequence). */
  readonly position: bigint;
  /** 1..4. The fifth failure is an exhaustion, not a scheduled retry. */
  readonly attemptNumber: number;
  readonly safeErrorCode: ProjectionLogSafeCode;
  readonly nextAttemptAt: CanonicalInstant;
}

/** The retry budget is spent. Emitted ONLY after the exhaustion transaction has committed. */
export interface ProjectionRetryExhaustedEvent {
  readonly event: 'projection.retry.exhausted';
  readonly position: bigint;
  /** Always {@link MAX_PROJECTION_ATTEMPTS} (5) — carried explicitly so the log is self-describing. */
  readonly attemptNumber: number;
  readonly safeErrorCode: ProjectionLogSafeCode;
  readonly failureId: ProjectionFailureId;
}

/**
 * The checkpoint transitioned to `blocked`. Emitted ONLY on the transition (`blocked-now`) — NEVER on
 * the steady state (`blocked-existing`), which recurs on every subsequent invocation and would
 * otherwise flood.
 */
export interface ProjectionBlockedEvent {
  readonly event: 'projection.blocked';
  readonly blockedPosition: bigint;
  readonly safeErrorCode: ProjectionLogSafeCode;
  readonly failureId: ProjectionFailureId;
}

/** The durable failure aggregate was created. Same transaction as the block; emitted after commit. */
export interface ProjectionFailureCreatedEvent {
  readonly event: 'projection.failure.created';
  readonly failureId: ProjectionFailureId;
  readonly position: bigint;
  readonly category: ProjectionFailureCategory;
  readonly safeErrorCode: ProjectionLogSafeCode;
  readonly automaticAttemptCount: number;
  readonly generation: number;
}

/**
 * An operator acknowledged a failure.
 *
 * `actorId` is bounded and already persisted in the action ledger, so logging it adds no exposure. The
 * operator's free-text REASON is deliberately absent: it is persisted for audit and must never reach a
 * log line, because it is the one operator-supplied unbounded string in the whole lifecycle.
 */
export interface ProjectionFailureAcknowledgedEvent {
  readonly event: 'projection.failure.acknowledged';
  readonly failureId: ProjectionFailureId;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly resultingGeneration: number;
}

/** An operator quarantined a failure (the precondition for authorized replay). */
export interface ProjectionFailureQuarantinedEvent {
  readonly event: 'projection.failure.quarantined';
  readonly failureId: ProjectionFailureId;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly resultingGeneration: number;
}

/** A replay was authorized (four-eyes). `warn`, not `info`: an authorization is a governance event. */
export interface ProjectionReplayAuthorizedEvent {
  readonly event: 'projection.replay.authorized';
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly expiresAt: CanonicalInstant | null;
  readonly resultingGeneration: number;
}

/** A replay attempt claimed its lease. */
export interface ProjectionReplayLeaseAcquiredEvent {
  readonly event: 'projection.replay.lease.acquired';
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly attemptId: ProjectionReplayAttemptId;
  readonly attemptNumber: number;
  readonly leaseExpiresAt: CanonicalInstant | null;
}

/** An expired lease was taken over; the abandoned attempt is named so the two can be correlated. */
export interface ProjectionReplayLeaseTakenOverEvent {
  readonly event: 'projection.replay.lease.takenOver';
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly attemptId: ProjectionReplayAttemptId;
  readonly attemptNumber: number;
  readonly leaseExpiresAt: CanonicalInstant | null;
  readonly abandonedAttemptId: ProjectionReplayAttemptId;
}

/** The registered handler is about to be applied to the exact blocked event. */
export interface ProjectionReplayStartedEvent {
  readonly event: 'projection.replay.started';
  readonly failureId: ProjectionFailureId;
  readonly attemptId: ProjectionReplayAttemptId;
  readonly position: bigint;
}

/**
 * The replay succeeded and the checkpoint advanced by exactly one position — the only transition out
 * of `blocked`. `resumedToPosition` is carried so the log alone proves no skip occurred.
 */
export interface ProjectionReplaySucceededEvent {
  readonly event: 'projection.replay.succeeded';
  readonly failureId: ProjectionFailureId;
  readonly attemptId: ProjectionReplayAttemptId;
  readonly position: bigint;
  readonly resumedToPosition: bigint;
}

/** The replay failed deterministically. The checkpoint STAYS blocked; the authorization is consumed. */
export interface ProjectionReplayFailedEvent {
  readonly event: 'projection.replay.failed';
  readonly failureId: ProjectionFailureId;
  readonly attemptId: ProjectionReplayAttemptId;
  readonly position: bigint;
  readonly safeErrorCode: ProjectionLogSafeCode;
}

/**
 * The checkpoint↔failure biconditional is broken. This transaction ROLLED BACK and persisted nothing,
 * so this log line and its counter are the ONLY record that it ever happened — which is why it is
 * `critical` and why the writer rate-limits repeats rather than dropping the first observation.
 */
export interface ProjectionDivergenceDetectedEvent {
  readonly event: 'projection.divergence.detected';
  readonly runnerErrorCode: ProjectionRunnerErrorCode;
  readonly position: bigint;
  readonly divergenceKind: ProjectionDivergenceKind;
}

/** An infrastructure fault aborted the run. Nothing was recorded; the phase says where, never what. */
export interface ProjectionInfrastructureFailedEvent {
  readonly event: 'projection.infrastructure.failed';
  readonly runnerErrorCode: ProjectionRunnerErrorCode;
  readonly phase: ProjectionInfrastructurePhase;
}

/**
 * The COMMIT outcome is unknown: the write may or may not have landed. Never suppressed, never
 * downgraded, and never accompanied by a success or block event — the durable truth is established by
 * re-invocation, which will emit the correct terminal event.
 */
export interface ProjectionCommitOutcomeUnknownEvent {
  readonly event: 'projection.commit.outcomeUnknown';
  readonly runnerErrorCode: ProjectionRunnerErrorCode;
  readonly position: bigint;
  readonly phase: ProjectionInfrastructurePhase;
}

/**
 * One projection's outcome for one worker cycle.
 *
 * `debug` and OFF by default. This fires on every cycle of every projection including every
 * `caught-up` poll, so it is by far the highest-volume event in the contract; at `info` on an idle
 * caught-up projection it would produce continuous noise carrying no operational information.
 */
export interface ProjectionWorkerCycleEvent {
  readonly event: 'projection.worker.cycle';
  readonly outcome: ProjectionRunOutcome;
  /** The position acted on, or `null` for outcomes that name no position (`busy`, `caught-up`). */
  readonly position: bigint | null;
}

/** Every projection-scoped event. Each carries a {@link ProjectionLogIdentity} at emission. */
export type ProjectionScopedLogEvent =
  | ProjectionRetryScheduledEvent
  | ProjectionRetryExhaustedEvent
  | ProjectionBlockedEvent
  | ProjectionFailureCreatedEvent
  | ProjectionFailureAcknowledgedEvent
  | ProjectionFailureQuarantinedEvent
  | ProjectionReplayAuthorizedEvent
  | ProjectionReplayLeaseAcquiredEvent
  | ProjectionReplayLeaseTakenOverEvent
  | ProjectionReplayStartedEvent
  | ProjectionReplaySucceededEvent
  | ProjectionReplayFailedEvent
  | ProjectionDivergenceDetectedEvent
  | ProjectionInfrastructureFailedEvent
  | ProjectionCommitOutcomeUnknownEvent
  | ProjectionWorkerCycleEvent;

// --- Worker-scoped events ------------------------------------------------------------------------

/** A worker run began. Worker-scoped: it spans the registry, so it names no single projection. */
export interface ProjectionWorkerStartedEvent {
  readonly event: 'projection.worker.started';
}

/** A worker run ended cleanly, carrying the existing {@link ProjectionWorkerSummary} fields. */
export interface ProjectionWorkerStoppedEvent {
  readonly event: 'projection.worker.stopped';
  readonly cycles: number;
  readonly succeeded: number;
  readonly stoppedBy: ProjectionWorkerStoppedBy;
}

/** Every worker-scoped event. These carry NO projection identity, by design. */
export type ProjectionWorkerScopedLogEvent =
  ProjectionWorkerStartedEvent | ProjectionWorkerStoppedEvent;

/** Every event in the contract. */
export type ProjectionLogEvent = ProjectionScopedLogEvent | ProjectionWorkerScopedLogEvent;

/** Look up the frozen severity for an event. Total over the closed union. */
export function projectionLogSeverityFor(event: ProjectionLogEvent): ProjectionLogSeverity {
  return PROJECTION_LOG_SEVERITY_BY_EVENT[event.event];
}

/**
 * The failure statuses an operator surface may report. Re-exported as a type alias only so the CLI and
 * health modules share one spelling; the vocabulary itself remains owned by the persistence layer.
 */
export type ProjectionLogFailureStatus = ProjectionFailureStatus;
