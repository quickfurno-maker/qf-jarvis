/**
 * The INTERNAL authorized-replay service (QFJ-P03.07F, ADR-0040).
 *
 * A safe, explicit, human-authorized, lease-protected, idempotent, crash-recoverable, ONE-SHOT replay
 * path for a quarantined projection failure. It composes the merged QFJ-P03.07C persistence repository,
 * the QFJ-P03.07D failure state, the canonical projection registry, and the QFJ-P03.07E quarantine
 * lifecycle. It contains NO scheduler, poller, timer, background loop, queue consumer, or bulk replay:
 * every operation is explicitly invoked with the exact authorized failure. A replay never happens merely
 * because a failure is quarantined.
 *
 * Flow: quarantined failure → explicit authorized replay approval (active authorization) → one executor
 * claims a replay attempt + lease and moves the failure to REPLAYING → the registered projection handler
 * is applied to the exact blocked event under the name+version advisory lock → success atomically resumes
 * the checkpoint, succeeds the attempt, resolves the failure, consumes the authorization, and appends
 * append-only evidence → normal processing may resume from the next position. A replay failure never
 * advances the checkpoint. An ambiguous COMMIT is reconciled before any retry.
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import { randomUUID } from 'node:crypto';

import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import { withTransaction } from '../persistence/transaction.js';
import { readCheckpointForUpdate, resumeCheckpointAfterReplay } from './checkpoint-store.js';
import type { ProjectionDefinition } from './projection-definition.js';
import { ProjectionCheckpointInvalidError } from './projection-errors.js';
import { readEventAtPosition } from './projection-event-reader.js';
import { classifyProjectionFailure } from './projection-failure-taxonomy.js';
import {
  ProjectionReplayError,
  type ProjectionReplayErrorCode,
} from './projection-failure-replay-errors.js';
import {
  assertBoundedText,
  assertUuid,
  isProjectionFailureActorType,
  PROJECTION_FAILURE_TEXT_BOUNDS,
  type ProjectionFailureActionId,
  type ProjectionFailureActorType,
  type ProjectionFailureId,
  type ProjectionFailureRow,
  type ProjectionReplayAttemptId,
  type ProjectionReplayAuthorizationId,
  type ProjectionReplayAuthorizationRow,
} from './projection-failure-persistence.js';
import {
  appendProjectionFailureAction,
  consumeReplayAuthorization,
  countReplayAttemptsForFailure,
  createReplayAuthorization,
  completeReplayAttempt,
  detectProjectionFailureDivergences,
  readActiveReplayAuthorization,
  readLiveReplayAttempt,
  readProjectionFailureActionByIdempotencyKey,
  readProjectionFailureByIdForUpdate,
  resolveProjectionFailure,
  startReplayAttempt,
  transitionFailureToQuarantinedAfterReplay,
  transitionFailureToReplayAuthorized,
  transitionFailureToReplaying,
  type ProjectionFailureDivergence,
} from './projection-failure-repository.js';
import { projectionAdvisoryLockKeyParameter } from './projection-lock-key.js';
import type { ProjectionName } from './projection-name.js';
import type { ProjectionRegistry } from './projection-registry.js';

const B = PROJECTION_FAILURE_TEXT_BOUNDS;

/** Lease and authorization-expiry bounds (milliseconds). */
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 60 * 60_000; // 1 hour
const MAX_AUTHORIZATION_MS = 24 * 60 * 60_000; // 24 hours

// --- Authorization ------------------------------------------------------------------------------

/** The closed replay capabilities. Each is strictly stronger than inspect/acknowledge/quarantine. */
export const PROJECTION_REPLAY_CAPABILITIES = [
  'projection-failure:authorize-replay',
  'projection-failure:execute-replay',
  'projection-failure:take-over-replay',
] as const;
export type ProjectionReplayCapability = (typeof PROJECTION_REPLAY_CAPABILITIES)[number];

/** The context every replay operation carries. */
export interface ProjectionReplayContext {
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly correlationId: string;
}

/** The decision input handed to the injected replay authorizer. Carries no secret and no token. */
export interface ProjectionReplayAuthorizationDecision {
  readonly capability: ProjectionReplayCapability;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly failureId: ProjectionFailureId;
  readonly currentStatus: string | null;
  readonly correlationId: string;
}

/** The injected replay authorizer contract. A denial must be a plain `false` (or a rejected promise). */
export interface ProjectionReplayAuthorizer {
  authorize(request: ProjectionReplayAuthorizationDecision): boolean | Promise<boolean>;
}

function validateContext(context: ProjectionReplayContext): void {
  if (!isProjectionFailureActorType(context.actorType)) {
    throw new ProjectionReplayError('invalid-actor');
  }
  try {
    assertBoundedText(context.actorId, B.actorId, 'actor id');
  } catch {
    throw new ProjectionReplayError('invalid-actor');
  }
  try {
    assertUuid(context.correlationId, 'correlation id');
  } catch {
    throw new ProjectionReplayError('invalid-correlation-id');
  }
}

async function authorizeOrThrow(
  authorizer: ProjectionReplayAuthorizer,
  request: ProjectionReplayAuthorizationDecision,
): Promise<void> {
  let granted: boolean;
  try {
    granted = await Promise.resolve(authorizer.authorize(request));
  } catch {
    granted = false;
  }
  if (!granted) throw new ProjectionReplayError('authorization-denied');
}

// --- Shared helpers -----------------------------------------------------------------------------

function assertReplayUuid(value: unknown): string {
  try {
    return assertUuid(value, 'identifier');
  } catch {
    throw new ProjectionReplayError('invalid-identifier');
  }
}

/** Acquire the name+version transaction advisory lock (non-blocking); false if held elsewhere. */
async function tryProjectionLock(
  client: DatabaseClient,
  name: ProjectionName,
  version: number,
): Promise<boolean> {
  const key = projectionAdvisoryLockKeyParameter(name, version);
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',
    [key],
  );
  return result.rows[0]?.locked === true;
}

/** Divergences that concern this exact failure or its projection (name+version). */
function relevantDivergences(
  divergences: readonly ProjectionFailureDivergence[],
  failure: ProjectionFailureRow,
): ProjectionFailureDivergence[] {
  return divergences.filter(
    (d) =>
      d.failureId === failure.failureId ||
      (d.projectionName === failure.projectionName &&
        d.projectionVersion === failure.projectionVersion),
  );
}

/** Resolve the exact registered projection definition, or fail closed. */
function resolveDefinition(
  registry: ProjectionRegistry,
  failure: ProjectionFailureRow,
): ProjectionDefinition {
  const definition = registry.get(failure.projectionName);
  if (definition?.version !== failure.projectionVersion) {
    throw new ProjectionReplayError('unknown-definition');
  }
  return definition;
}

/** The canonical poison event + its raw storage identity, validated against the failure. */
async function loadPoisonEvent(
  client: DatabaseClient,
  failure: ProjectionFailureRow,
): Promise<{ event: Awaited<ReturnType<typeof readEventAtPosition>>; storageSequence: bigint }> {
  const storageResult = await client.query<{ event_storage_sequence: string }>(
    `SELECT event_storage_sequence FROM qf_jarvis.projection_event_position WHERE position = $1`,
    [failure.projectionPosition.toString()],
  );
  const storageRow = storageResult.rows[0];
  if (storageRow === undefined) throw new ProjectionReplayError('event-not-found');
  const storageSequence = BigInt(storageRow.event_storage_sequence);
  if (storageSequence !== failure.eventStorageSequence) {
    throw new ProjectionReplayError('event-identity-mismatch');
  }
  let event: Awaited<ReturnType<typeof readEventAtPosition>>;
  try {
    event = await readEventAtPosition(client, failure.projectionPosition);
  } catch {
    throw new ProjectionReplayError('repository-invariant');
  }
  if (event === null) throw new ProjectionReplayError('event-not-found');
  return { event, storageSequence };
}

/** Assert the checkpoint is blocked at the failure's position (fail closed otherwise). */
async function assertBlockedCheckpoint(
  client: DatabaseClient,
  failure: ProjectionFailureRow,
): Promise<void> {
  const checkpoint = await readCheckpointForUpdate(client, {
    name: failure.projectionName as ProjectionName,
    version: failure.projectionVersion,
  });
  if (
    checkpoint?.status !== 'blocked' ||
    checkpoint.blockedPosition !== failure.projectionPosition
  ) {
    throw new ProjectionReplayError('divergence-detected');
  }
}

// --- Authorize replay ---------------------------------------------------------------------------

export interface AuthorizeReplayInput {
  readonly failureId: ProjectionFailureId;
  readonly expectedGeneration: number;
  readonly reason?: string | null;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface ProjectionReplayAuthorizationResult {
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly status: string;
  readonly generation: number;
  readonly idempotent: boolean;
}

/**
 * Authorize a replay of a QUARANTINED failure. Authorized, generation-guarded, divergence-gated,
 * idempotent, and atomic: creates exactly one ACTIVE authorization, transitions quarantined →
 * replay-authorized, and appends one replay-authorized action, all in one transaction. No replay
 * attempt is created, the checkpoint stays blocked, no handler runs, no read model is mutated.
 */
export async function authorizeProjectionFailureReplay(
  pool: DatabasePool,
  authorizer: ProjectionReplayAuthorizer,
  context: ProjectionReplayContext,
  input: AuthorizeReplayInput,
): Promise<ProjectionReplayAuthorizationResult> {
  validateContext(context);
  assertReplayUuid(input.failureId);
  const reason = validateReason(input.reason);
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
    throw new ProjectionReplayError('invalid-expiry');
  }
  if (
    input.expiresAt.getTime() <= input.now.getTime() ||
    input.expiresAt.getTime() - input.now.getTime() > MAX_AUTHORIZATION_MS
  ) {
    throw new ProjectionReplayError('invalid-expiry');
  }
  const idempotencyKey = `authorize-replay:${input.failureId}:g${String(input.expectedGeneration)}`;

  return runReplayTransaction(pool, async (client) => {
    const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
    await authorizeOrThrow(authorizer, {
      capability: 'projection-failure:authorize-replay',
      actorType: context.actorType,
      actorId: context.actorId,
      failureId: input.failureId,
      currentStatus: failure?.status ?? null,
      correlationId: context.correlationId,
    });
    if (failure === null) throw new ProjectionReplayError('failure-not-found');

    // Idempotency: this exact authorization already committed.
    const existing = await readProjectionFailureActionByIdempotencyKey(client, idempotencyKey);
    if (existing !== null) {
      const active = await readActiveReplayAuthorization(client, failure.failureId);
      return {
        failureId: failure.failureId,
        authorizationId: (active?.authorizationId ??
          existing.failureId) as ProjectionReplayAuthorizationId,
        status: failure.status,
        generation: failure.generation,
        idempotent: true,
      };
    }

    if (failure.generation !== input.expectedGeneration) {
      throw new ProjectionReplayError('stale-generation');
    }
    if (failure.status !== 'quarantined') {
      throw new ProjectionReplayError('invalid-source-status');
    }
    const divergences = relevantDivergences(
      await detectProjectionFailureDivergences(client),
      failure,
    );
    if (divergences.length > 0) throw new ProjectionReplayError('divergence-detected');
    await assertBlockedCheckpoint(client, failure);
    if ((await readActiveReplayAuthorization(client, failure.failureId)) !== null) {
      throw new ProjectionReplayError('authorization-already-active');
    }

    const authorized = await transitionFailureToReplayAuthorized(client, {
      failureId: failure.failureId,
      expectedGeneration: input.expectedGeneration,
      now: input.now,
    });

    const authorizationId = randomUUID() as ProjectionReplayAuthorizationId;
    await createReplayAuthorization(client, {
      authorizationId,
      failureId: failure.failureId,
      failureGeneration: authorized.generation,
      authorizedBy: context.actorId,
      reason,
      idempotencyKey,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'replay-authorized',
      actorType: context.actorType,
      actorId: context.actorId,
      reason,
      idempotencyKey,
      expectedGeneration: input.expectedGeneration,
      resultingGeneration: authorized.generation,
      occurredAt: input.now,
    });
    return {
      failureId: failure.failureId,
      authorizationId,
      status: authorized.status,
      generation: authorized.generation,
      idempotent: false,
    };
  });
}

/** Read the single active replay authorization for a failure (inspection). */
export async function inspectActiveReplayAuthorization(
  pool: DatabasePool,
  authorizer: ProjectionReplayAuthorizer,
  context: ProjectionReplayContext,
  input: { readonly failureId: ProjectionFailureId },
): Promise<ProjectionReplayAuthorizationRow | null> {
  validateContext(context);
  assertReplayUuid(input.failureId);
  return runReplayTransaction(pool, async (client) => {
    const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
    await authorizeOrThrow(authorizer, {
      capability: 'projection-failure:authorize-replay',
      actorType: context.actorType,
      actorId: context.actorId,
      failureId: input.failureId,
      currentStatus: failure?.status ?? null,
      correlationId: context.correlationId,
    });
    if (failure === null) throw new ProjectionReplayError('failure-not-found');
    return readActiveReplayAuthorization(client, failure.failureId);
  });
}

// --- Execute replay -----------------------------------------------------------------------------

export interface ExecuteReplayInput {
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly leaseOwner: string;
  readonly leaseDurationMs: number;
  readonly now: Date;
}

export type ProjectionReplayExecutionResult =
  | {
      readonly outcome: 'replay-succeeded';
      readonly failureId: ProjectionFailureId;
      readonly attemptId: ProjectionReplayAttemptId;
      readonly resolvedPosition: bigint;
    }
  | {
      readonly outcome: 'replay-failed';
      readonly failureId: ProjectionFailureId;
      readonly attemptId: ProjectionReplayAttemptId;
      readonly safeErrorCode: string;
    }
  | { readonly outcome: 'already-resolved'; readonly failureId: ProjectionFailureId };

interface ReplayClaim {
  readonly attemptId: ProjectionReplayAttemptId;
  readonly failureGeneration: number;
}

/** A private sentinel: the registered handler threw during the replay success transaction. */
class ReplayHandlerThrew extends Error {
  public constructor(public readonly handlerError: unknown) {
    super('the replayed projection handler threw.');
    this.name = 'ReplayHandlerThrew';
  }
}

/**
 * Execute an authorized one-shot replay. Explicitly invoked (no scheduler/poller): claims (or resumes)
 * exactly one lease-protected replay attempt, applies the registered handler to the exact blocked event
 * under the name+version advisory lock, and — on success — atomically resumes the checkpoint, succeeds
 * the attempt, resolves the failure, consumes the authorization, and appends evidence. A deterministic
 * handler failure records terminal replay-failed evidence and returns the failure to quarantined (no
 * automatic retry, checkpoint untouched). A transient/unknown failure fails closed and leaves the live
 * attempt for reconciliation/takeover. An ambiguous state is reconciled, never blindly retried.
 */
export async function executeAuthorizedProjectionReplay(
  pool: DatabasePool,
  authorizer: ProjectionReplayAuthorizer,
  registry: ProjectionRegistry,
  context: ProjectionReplayContext,
  input: ExecuteReplayInput,
): Promise<ProjectionReplayExecutionResult> {
  validateContext(context);
  assertReplayUuid(input.failureId);
  assertReplayUuid(input.authorizationId);
  const leaseOwner = validateLeaseOwner(input.leaseOwner);
  if (
    !Number.isInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < MIN_LEASE_MS ||
    input.leaseDurationMs > MAX_LEASE_MS
  ) {
    throw new ProjectionReplayError('invalid-lease-duration');
  }

  // Phase 1 — claim (or reconcile to) exactly one live attempt owned by us.
  const claim = await runReplayTransaction(pool, (client) =>
    claimReplayAttempt(client, authorizer, context, input, leaseOwner),
  );
  if (claim === 'already-resolved') {
    return { outcome: 'already-resolved', failureId: input.failureId };
  }

  // Phase 2 — apply the handler and complete atomically; on handler failure, record it terminally.
  return completeReplay(pool, registry, context, input, leaseOwner, claim);
}

async function claimReplayAttempt(
  client: DatabaseClient,
  authorizer: ProjectionReplayAuthorizer,
  context: ProjectionReplayContext,
  input: ExecuteReplayInput,
  leaseOwner: string,
): Promise<ReplayClaim | 'already-resolved'> {
  const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
  await authorizeOrThrow(authorizer, {
    capability: 'projection-failure:execute-replay',
    actorType: context.actorType,
    actorId: context.actorId,
    failureId: input.failureId,
    currentStatus: failure?.status ?? null,
    correlationId: context.correlationId,
  });
  if (failure === null) throw new ProjectionReplayError('failure-not-found');
  if (failure.status === 'resolved') return 'already-resolved';

  if (
    !(await tryProjectionLock(
      client,
      failure.projectionName as ProjectionName,
      failure.projectionVersion,
    ))
  ) {
    throw new ProjectionReplayError('infrastructure-failed');
  }
  await assertBlockedCheckpoint(client, failure);

  // Resume path: the failure is already REPLAYING with a live attempt.
  if (failure.status === 'replaying') {
    const live = await readLiveReplayAttempt(client, failure.failureId);
    if (live === null) throw new ProjectionReplayError('repository-invariant');
    if (live.authorizationId !== input.authorizationId || live.leaseOwner !== leaseOwner) {
      if (live.leaseExpiresAt.getTime() > input.now.getTime()) {
        throw new ProjectionReplayError('lease-held');
      }
      // Expired lease held by another owner — takeover is a separate explicit operation.
      throw new ProjectionReplayError('lease-held');
    }
    return { attemptId: live.attemptId, failureGeneration: failure.generation };
  }

  // Claim path: the failure is REPLAY_AUTHORIZED with an active authorization and no live attempt.
  if (failure.status !== 'replay-authorized') {
    throw new ProjectionReplayError('invalid-source-status');
  }
  const authorization = await readActiveReplayAuthorization(client, failure.failureId);
  validateAuthorizationForExecution(authorization, failure, input, input.now);
  if ((await readLiveReplayAttempt(client, failure.failureId)) !== null) {
    throw new ProjectionReplayError('lease-held');
  }

  const attemptNumber = (await countReplayAttemptsForFailure(client, failure.failureId)) + 1;
  const attemptId = randomUUID() as ProjectionReplayAttemptId;
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs);
  await startReplayAttempt(client, {
    attemptId,
    failureId: failure.failureId,
    authorizationId: input.authorizationId,
    attemptNumber,
    leaseOwner,
    leaseAcquiredAt: input.now,
    leaseExpiresAt,
    startedAt: input.now,
  });
  const replaying = await transitionFailureToReplaying(client, {
    failureId: failure.failureId,
    expectedGeneration: failure.generation,
    now: input.now,
  });
  await appendProjectionFailureAction(client, {
    actionId: randomUUID() as ProjectionFailureActionId,
    failureId: failure.failureId,
    actionType: 'replay-started',
    actorType: context.actorType,
    actorId: context.actorId,
    idempotencyKey: `start-replay:${input.authorizationId}`,
    expectedGeneration: failure.generation,
    resultingGeneration: replaying.generation,
    occurredAt: input.now,
  });
  return { attemptId, failureGeneration: replaying.generation };
}

async function completeReplay(
  pool: DatabasePool,
  registry: ProjectionRegistry,
  context: ProjectionReplayContext,
  input: ExecuteReplayInput,
  leaseOwner: string,
  claim: ReplayClaim,
): Promise<ProjectionReplayExecutionResult> {
  try {
    return await runReplaySuccess(pool, registry, context, input, leaseOwner, claim);
  } catch (error: unknown) {
    if (error instanceof ProjectionReplayError) throw error;
    if (error instanceof ReplayHandlerThrew) {
      const classification = classifyProjectionFailure(error.handlerError);
      if (classification.category === 'DETERMINISTIC_HANDLER_FAILURE') {
        return recordReplayFailure(pool, context, input, claim, 'projection-handler-failed');
      }
      throw new ProjectionReplayError(handlerFailureCode(classification.category));
    }
    if (error instanceof ProjectionCheckpointInvalidError) {
      throw new ProjectionReplayError('repository-invariant');
    }
    // Ambiguous COMMIT or other: fail closed; the caller reconciles with the same identity.
    throw new ProjectionReplayError('commit-outcome-unknown');
  }
}

async function runReplaySuccess(
  pool: DatabasePool,
  registry: ProjectionRegistry,
  context: ProjectionReplayContext,
  input: ExecuteReplayInput,
  leaseOwner: string,
  claim: ReplayClaim,
): Promise<ProjectionReplayExecutionResult> {
  return withTransaction(pool, async (client) => {
    const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
    if (failure === null) throw new ProjectionReplayError('failure-not-found');
    if (failure.status === 'resolved') {
      return { outcome: 'already-resolved', failureId: input.failureId };
    }
    if (failure.status !== 'replaying') throw new ProjectionReplayError('invalid-source-status');
    if (
      !(await tryProjectionLock(
        client,
        failure.projectionName as ProjectionName,
        failure.projectionVersion,
      ))
    ) {
      throw new ProjectionReplayError('infrastructure-failed');
    }
    const definition = resolveDefinition(registry, failure);

    const live = await readLiveReplayAttempt(client, failure.failureId);
    if (live?.attemptId !== claim.attemptId) {
      throw new ProjectionReplayError('attempt-not-live');
    }
    if (live.leaseOwner !== leaseOwner) throw new ProjectionReplayError('lease-held');

    const authorization = await readActiveReplayAuthorization(client, failure.failureId);
    if (authorization?.authorizationId !== input.authorizationId) {
      throw new ProjectionReplayError('authorization-not-active');
    }
    await assertBlockedCheckpoint(client, failure);
    const { event } = await loadPoisonEvent(client, failure);

    // Apply the registered handler. A throw here is the handler's (possibly deterministic) failure.
    try {
      await definition.apply(client, event as never);
    } catch (handlerError: unknown) {
      throw new ReplayHandlerThrew(handlerError);
    }

    await resumeCheckpointAfterReplay(client, {
      name: failure.projectionName as ProjectionName,
      version: failure.projectionVersion,
      resolvedPosition: failure.projectionPosition,
      now: input.now,
    });
    await completeReplayAttempt(client, {
      attemptId: claim.attemptId,
      state: 'succeeded',
      finishedAt: input.now,
      resultingPosition: failure.projectionPosition,
      commitObserved: true,
    });
    const resolved = await resolveProjectionFailure(client, {
      failureId: failure.failureId,
      resolvedAttemptId: claim.attemptId,
      at: input.now,
      now: input.now,
      expectedGeneration: failure.generation,
    });
    await consumeReplayAuthorization(client, {
      authorizationId: input.authorizationId,
      consumedAttemptId: claim.attemptId,
      at: input.now,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'replay-succeeded',
      actorType: context.actorType,
      actorId: context.actorId,
      idempotencyKey: `complete-replay:${claim.attemptId}:success`,
      expectedGeneration: failure.generation,
      resultingGeneration: resolved.generation,
      occurredAt: input.now,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'authorization-consumed',
      actorType: context.actorType,
      actorId: context.actorId,
      occurredAt: input.now,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'resolved',
      actorType: context.actorType,
      actorId: context.actorId,
      occurredAt: input.now,
    });
    return {
      outcome: 'replay-succeeded',
      failureId: failure.failureId,
      attemptId: claim.attemptId,
      resolvedPosition: failure.projectionPosition,
    };
  });
}

async function recordReplayFailure(
  pool: DatabasePool,
  context: ProjectionReplayContext,
  input: ExecuteReplayInput,
  claim: ReplayClaim,
  safeErrorCode: 'projection-handler-failed',
): Promise<ProjectionReplayExecutionResult> {
  await runReplayTransaction(pool, async (client) => {
    const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
    if (failure === null) throw new ProjectionReplayError('failure-not-found');
    if (failure.status !== 'replaying') {
      // Already reconciled elsewhere — nothing to record.
      return;
    }
    const live = await readLiveReplayAttempt(client, failure.failureId);
    if (live?.attemptId !== claim.attemptId) {
      throw new ProjectionReplayError('attempt-not-live');
    }
    await completeReplayAttempt(client, {
      attemptId: claim.attemptId,
      state: 'failed',
      finishedAt: input.now,
      outcomeCode: safeErrorCode,
      commitObserved: false,
    });
    // One-shot: the authorization is consumed by the (failed) attempt; a further replay needs a NEW one.
    await consumeReplayAuthorization(client, {
      authorizationId: input.authorizationId,
      consumedAttemptId: claim.attemptId,
      at: input.now,
    });
    // Back to a controlled state; the checkpoint stays blocked and last_position is untouched.
    const quarantined = await transitionFailureToQuarantinedAfterReplay(client, {
      failureId: failure.failureId,
      expectedGeneration: failure.generation,
      now: input.now,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'replay-failed',
      actorType: context.actorType,
      actorId: context.actorId,
      idempotencyKey: `complete-replay:${claim.attemptId}:failure`,
      expectedGeneration: failure.generation,
      resultingGeneration: quarantined.generation,
      occurredAt: input.now,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'authorization-consumed',
      actorType: context.actorType,
      actorId: context.actorId,
      occurredAt: input.now,
    });
  });
  return {
    outcome: 'replay-failed',
    failureId: input.failureId,
    attemptId: claim.attemptId,
    safeErrorCode,
  };
}

// --- Expired-lease takeover ---------------------------------------------------------------------

export interface TakeoverReplayInput {
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly previousAttemptId: ProjectionReplayAttemptId;
  readonly newLeaseOwner: string;
  readonly leaseDurationMs: number;
  readonly now: Date;
}

export interface ProjectionReplayTakeoverResult {
  readonly failureId: ProjectionFailureId;
  readonly newAttemptId: ProjectionReplayAttemptId;
  readonly previousAttemptId: ProjectionReplayAttemptId;
  readonly idempotent: boolean;
}

/**
 * Take over an EXPIRED replay lease. Since migration 0006 makes the lease immutable, takeover abandons
 * the expired attempt and starts a FRESH attempt (new lease, next attempt number) for the same failure +
 * authorization, appending lease-taken-over evidence. It refuses before expiry, refuses a still-committed
 * or ambiguous previous outcome (reconcile first), never executes the handler, and is idempotent.
 */
export async function takeOverExpiredProjectionReplayLease(
  pool: DatabasePool,
  authorizer: ProjectionReplayAuthorizer,
  context: ProjectionReplayContext,
  input: TakeoverReplayInput,
): Promise<ProjectionReplayTakeoverResult> {
  validateContext(context);
  assertReplayUuid(input.failureId);
  assertReplayUuid(input.authorizationId);
  assertReplayUuid(input.previousAttemptId);
  const newOwner = validateLeaseOwner(input.newLeaseOwner);
  if (
    !Number.isInteger(input.leaseDurationMs) ||
    input.leaseDurationMs < MIN_LEASE_MS ||
    input.leaseDurationMs > MAX_LEASE_MS
  ) {
    throw new ProjectionReplayError('invalid-lease-duration');
  }

  return runReplayTransaction(pool, async (client) => {
    const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
    await authorizeOrThrow(authorizer, {
      capability: 'projection-failure:take-over-replay',
      actorType: context.actorType,
      actorId: context.actorId,
      failureId: input.failureId,
      currentStatus: failure?.status ?? null,
      correlationId: context.correlationId,
    });
    if (failure === null) throw new ProjectionReplayError('failure-not-found');
    if (failure.status !== 'replaying') throw new ProjectionReplayError('invalid-source-status');
    if (
      !(await tryProjectionLock(
        client,
        failure.projectionName as ProjectionName,
        failure.projectionVersion,
      ))
    ) {
      throw new ProjectionReplayError('infrastructure-failed');
    }
    await assertBlockedCheckpoint(client, failure);

    const live = await readLiveReplayAttempt(client, failure.failureId);
    if (live === null) throw new ProjectionReplayError('attempt-not-live');
    if (live.attemptId !== input.previousAttemptId) {
      // The prior attempt is already terminal and a new one is live — idempotent takeover already ran.
      const idempotencyKey = `takeover-replay:${input.previousAttemptId}:${newOwner}`;
      const existing = await readProjectionFailureActionByIdempotencyKey(client, idempotencyKey);
      if (existing !== null && live.leaseOwner === newOwner) {
        return {
          failureId: failure.failureId,
          newAttemptId: live.attemptId,
          previousAttemptId: input.previousAttemptId,
          idempotent: true,
        };
      }
      throw new ProjectionReplayError('lease-held');
    }
    if (live.leaseExpiresAt.getTime() > input.now.getTime()) {
      throw new ProjectionReplayError('lease-not-expired');
    }
    const authorization = await readActiveReplayAuthorization(client, failure.failureId);
    if (authorization?.authorizationId !== input.authorizationId) {
      throw new ProjectionReplayError('authorization-not-active');
    }

    // Abandon the expired attempt and start a fresh lease-holding attempt (immutable-lease model).
    await completeReplayAttempt(client, {
      attemptId: input.previousAttemptId,
      state: 'abandoned',
      finishedAt: input.now,
      commitObserved: false,
    });
    const attemptNumber = (await countReplayAttemptsForFailure(client, failure.failureId)) + 1;
    const newAttemptId = randomUUID() as ProjectionReplayAttemptId;
    await startReplayAttempt(client, {
      attemptId: newAttemptId,
      failureId: failure.failureId,
      authorizationId: input.authorizationId,
      attemptNumber,
      leaseOwner: newOwner,
      leaseAcquiredAt: input.now,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseDurationMs),
      startedAt: input.now,
    });
    await appendProjectionFailureAction(client, {
      actionId: randomUUID() as ProjectionFailureActionId,
      failureId: failure.failureId,
      actionType: 'lease-taken-over',
      actorType: context.actorType,
      actorId: context.actorId,
      idempotencyKey: `takeover-replay:${input.previousAttemptId}:${newOwner}`,
      occurredAt: input.now,
    });
    return {
      failureId: failure.failureId,
      newAttemptId,
      previousAttemptId: input.previousAttemptId,
      idempotent: false,
    };
  });
}

// --- Reconcile ----------------------------------------------------------------------------------

export interface ProjectionReplayReconciliation {
  readonly failureId: ProjectionFailureId;
  readonly failureStatus: string;
  readonly generation: number;
  readonly liveAttemptId: ProjectionReplayAttemptId | null;
  readonly leaseOwner: string | null;
  readonly leaseExpired: boolean | null;
  readonly activeAuthorizationId: ProjectionReplayAuthorizationId | null;
  readonly divergences: readonly string[];
}

/**
 * Read-only reconciliation of a failure's replay state (used after an ambiguous COMMIT). Reports the
 * durable failure status, live attempt/lease, active authorization, and any relevant divergence codes —
 * never repairs. The caller decides: a resolved failure is a committed success; a replaying failure with
 * our live attempt may be resumed; a quarantined failure with a terminal attempt is a recorded failure;
 * a divergence fails closed.
 */
export async function reconcileProjectionReplayOutcome(
  pool: DatabasePool,
  authorizer: ProjectionReplayAuthorizer,
  context: ProjectionReplayContext,
  input: { readonly failureId: ProjectionFailureId; readonly now: Date },
): Promise<ProjectionReplayReconciliation> {
  validateContext(context);
  assertReplayUuid(input.failureId);
  return runReplayTransaction(pool, async (client) => {
    const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
    await authorizeOrThrow(authorizer, {
      capability: 'projection-failure:execute-replay',
      actorType: context.actorType,
      actorId: context.actorId,
      failureId: input.failureId,
      currentStatus: failure?.status ?? null,
      correlationId: context.correlationId,
    });
    if (failure === null) throw new ProjectionReplayError('failure-not-found');
    const live = await readLiveReplayAttempt(client, failure.failureId);
    const authorization = await readActiveReplayAuthorization(client, failure.failureId);
    const divergences = relevantDivergences(
      await detectProjectionFailureDivergences(client),
      failure,
    ).map((d) => d.code);
    return {
      failureId: failure.failureId,
      failureStatus: failure.status,
      generation: failure.generation,
      liveAttemptId: live?.attemptId ?? null,
      leaseOwner: live?.leaseOwner ?? null,
      leaseExpired: live === null ? null : live.leaseExpiresAt.getTime() <= input.now.getTime(),
      activeAuthorizationId: authorization?.authorizationId ?? null,
      divergences,
    };
  });
}

// --- Shared validation / transaction helpers ----------------------------------------------------

function validateReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  try {
    return assertBoundedText(reason, B.reason, 'reason');
  } catch {
    throw new ProjectionReplayError('invalid-reason');
  }
}

function validateLeaseOwner(owner: string): string {
  try {
    return assertBoundedText(owner, B.leaseOwner, 'lease owner');
  } catch {
    throw new ProjectionReplayError('invalid-actor');
  }
}

function validateAuthorizationForExecution(
  authorization: ProjectionReplayAuthorizationRow | null,
  failure: ProjectionFailureRow,
  input: ExecuteReplayInput,
  now: Date,
): void {
  if (authorization === null) throw new ProjectionReplayError('authorization-not-found');
  if (authorization.authorizationId !== input.authorizationId) {
    throw new ProjectionReplayError('authorization-mismatch');
  }
  if (authorization.state !== 'active') throw new ProjectionReplayError('authorization-not-active');
  if (authorization.failureId !== failure.failureId) {
    throw new ProjectionReplayError('authorization-mismatch');
  }
  if (authorization.failureGeneration !== failure.generation) {
    throw new ProjectionReplayError('authorization-mismatch');
  }
  if (authorization.expiresAt !== null && authorization.expiresAt.getTime() <= now.getTime()) {
    throw new ProjectionReplayError('authorization-not-active');
  }
}

function handlerFailureCode(
  category: ReturnType<typeof classifyProjectionFailure>['category'],
): ProjectionReplayErrorCode {
  switch (category) {
    case 'TRANSIENT_INFRASTRUCTURE_FAILURE':
      return 'infrastructure-failed';
    case 'REPOSITORY_INVARIANT_FAILURE':
      return 'repository-invariant';
    case 'CANCELLATION_OR_SHUTDOWN':
      return 'cancelled';
    default:
      return 'unknown-failure';
  }
}

/** Run a callback in one transaction, translating unknown failures to a stable commit-unknown code. */
async function runReplayTransaction<T>(
  pool: DatabasePool,
  callback: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(pool, callback);
  } catch (error: unknown) {
    if (error instanceof ProjectionReplayError) throw error;
    if (error instanceof ProjectionCheckpointInvalidError) {
      throw new ProjectionReplayError('repository-invariant');
    }
    throw new ProjectionReplayError('commit-outcome-unknown');
  }
}

export {
  ProjectionReplayError,
  isProjectionReplayError,
  PROJECTION_REPLAY_ERROR_CODES,
  type ProjectionReplayErrorCode,
} from './projection-failure-replay-errors.js';
