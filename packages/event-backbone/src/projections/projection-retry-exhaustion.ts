/**
 * The INTERNAL atomic retry-exhaustion integration (QFJ-P03.07D, ADR-0040).
 *
 * This is the single seam that connects the projection runner's FIFTH deterministic failure to the
 * QFJ-P03.07C failure-persistence foundation. It composes the already-merged, already-borrowed-client
 * persistence primitives ({@link createProjectionFailure}, {@link appendProjectionFailureAction}, and
 * the active-failure readers) into two operations the runner calls INSIDE its own single
 * READ COMMITTED transaction:
 *
 *   * {@link establishRetryExhaustionFailure} — on the fifth deterministic failure, create exactly one
 *     active failure aggregate at the blocked position and append its `created` action. It opens NO
 *     transaction, takes NO lock, and connects to NO pool: the runner's transaction already holds the
 *     advisory lock and owns the checkpoint block + fifth attempt, so all five effects (final attempt +
 *     blocked checkpoint + blocked position + active failure + creation action) commit or roll back as
 *     one. It writes ONLY closed, bounded, sanitized values — never a raw Error, message, stack, SQL, or
 *     payload.
 *   * {@link reconcileBlockedExhaustion} — on a later invocation that finds an already-blocked
 *     checkpoint, prove the active-failure biconditional (exactly one active failure, at the blocked
 *     position). It NEVER repairs anything: a divergence fails closed.
 *
 * There is NO operator API, quarantine command, replay authorization, replay execution, or lease worker
 * here (those are QFJ-P03.07E/F/G). Nothing in this module is exported from the package root; the
 * barrel's runtime surface is unchanged.
 */

import { randomUUID } from 'node:crypto';

import type { DatabaseClient } from '../persistence/pool.js';
import type { ProjectionDivergenceKind } from '../observability/projection-log-events.js';
import {
  ProjectionCheckpointInvalidError,
  ProjectionStoredDataError,
} from './projection-errors.js';
import type { ProjectionName } from './projection-name.js';
import { PROJECTION_FAILURE_DIAGNOSTIC_CODES } from './projection-failure-taxonomy.js';
import {
  PROJECTION_FAILURE_TEXT_BOUNDS,
  type ProjectionFailureActionId,
  type ProjectionFailureId,
} from './projection-failure-persistence.js';
import {
  appendProjectionFailureAction,
  createProjectionFailure,
  readActiveProjectionFailuresForProjection,
} from './projection-failure-repository.js';
import { MAX_PROJECTION_ATTEMPTS } from './projection-status.js';

/**
 * A divergence that additionally names WHICH invariant broke, drawn from a closed vocabulary
 * (QFJ-P03.07G).
 *
 * It EXTENDS {@link ProjectionCheckpointInvalidError} rather than replacing it, so every existing
 * `instanceof ProjectionCheckpointInvalidError` check — including the runner's two error-mapping
 * branches — continues to match exactly as before. This is purely additive: the classification, the
 * fail-closed behaviour, and the resulting runner error code are unchanged. The kind exists so
 * observability can report a bounded discriminator instead of parsing a message, which it must never
 * do.
 */
export class ProjectionDivergenceError extends ProjectionCheckpointInvalidError {
  public readonly divergenceKind: ProjectionDivergenceKind;

  public constructor(divergenceKind: ProjectionDivergenceKind, message: string) {
    super(message);
    this.name = 'ProjectionDivergenceError';
    this.divergenceKind = divergenceKind;
  }
}

/** Read a closed divergence kind off a caught value, or `null` when it is not one of ours. */
export function divergenceKindOf(value: unknown): ProjectionDivergenceKind | null {
  try {
    return value instanceof ProjectionDivergenceError ? value.divergenceKind : null;
  } catch {
    // `instanceof` performs [[GetPrototypeOf]] and THROWS for a revoked Proxy. Anything that cannot be
    // safely identified is simply not one of ours.
    return null;
  }
}

/** The persisted category + safe code for a retry-exhausted deterministic failure (ADR-0040). */
const EXHAUSTION_CATEGORY = 'DETERMINISTIC_HANDLER_FAILURE' as const;
const EXHAUSTION_SAFE_CODE = PROJECTION_FAILURE_DIAGNOSTIC_CODES.DETERMINISTIC_HANDLER_FAILURE;

/** The system actor that establishes a retry-exhaustion failure (never an operator). */
const EXHAUSTION_ACTOR_ID = 'projection-runner';

/**
 * The DETERMINISTIC idempotency key for the retry-exhaustion `created` action. Derived ONLY from stable
 * repository-owned identity — the projection name, version, and blocked position — never from a message,
 * stack, raw thrown value, or a timestamp. The action ledger's partial-unique index on `idempotency_key`
 * turns this into a database-level guarantee that a single blocked position yields a single creation
 * action, even under a repeated invocation. Bounded well under the 128-char ledger limit
 * (name ≤ 64 + fixed prefix/segments).
 */
export function retryExhaustionIdempotencyKey(
  name: ProjectionName,
  version: number,
  blockedPosition: bigint,
): string {
  const key = `retry-exhaustion:${name}:v${String(version)}:p${blockedPosition.toString()}`;
  if (key.length > PROJECTION_FAILURE_TEXT_BOUNDS.idempotencyKey) {
    // Unreachable for a valid projection name (≤ 64) and a bounded position, but fail closed rather
    // than silently persist an oversized key.
    throw new ProjectionStoredDataError('the retry-exhaustion idempotency key exceeds its bound.');
  }
  return key;
}

/** The raw storage identity of the poison event at a projection position. */
interface PoisonEventStorageIdentity {
  readonly eventStorageSequence: bigint;
  readonly eventId: string | null;
}

/**
 * Read the immutable raw storage identity (`event_storage_sequence`, and the event's canonical id) of
 * the poison event at `position`, for the failure aggregate's reconciliation columns. Reads the
 * append-only position map joined to the event log — the same ordering authority the runner already
 * uses — and never a payload, subject, correlation id, or any sender-controlled field. A missing map
 * row means the checkpoint was blocked at a position with no event, which is impossible for a genuine
 * runner block and so fails closed.
 */
async function readPoisonEventStorageIdentity(
  client: DatabaseClient,
  position: bigint,
): Promise<PoisonEventStorageIdentity> {
  const result = await client.query<{
    event_storage_sequence: string;
    event_id: string | null;
  }>(
    `SELECT m.event_storage_sequence, e.event_id
       FROM qf_jarvis.projection_event_position AS m
       JOIN qf_jarvis.event AS e ON e.sequence = m.event_storage_sequence
      WHERE m.position = $1`,
    [position.toString()],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ProjectionDivergenceError(
      'missing-event-at-position',
      'no event maps to the blocked projection position; retry exhaustion cannot be established.',
    );
  }
  if (!/^[1-9][0-9]*$/.test(row.event_storage_sequence)) {
    throw new ProjectionStoredDataError(
      'a stored event storage sequence is not a canonical positive.',
    );
  }
  return {
    eventStorageSequence: BigInt(row.event_storage_sequence),
    eventId: row.event_id,
  };
}

/** The input the runner supplies for the atomic retry-exhaustion establishment. */
export interface EstablishRetryExhaustionInput {
  readonly name: ProjectionName;
  readonly version: number;
  /** The blocked projection position (the poison event's projection position). */
  readonly blockedPosition: bigint;
  /** The injected instant of the fifth (exhausting) failure. */
  readonly failedAt: Date;
  /** The injected transaction clock (equal to `failedAt` for the runner). */
  readonly now: Date;
}

/** The identity of the failure aggregate this establishment created. */
export interface EstablishedRetryExhaustion {
  readonly failureId: ProjectionFailureId;
  /**
   * The aggregate's generation at creation. Returned so post-commit observability can report it
   * WITHOUT a second query — re-reading after the commit would race a concurrent operator action and
   * could report a generation the creating transaction never saw.
   */
  readonly generation: number;
}

/**
 * Establish the durable retry-exhaustion failure inside the runner's transaction: create exactly ONE
 * active failure aggregate at the blocked position (persisting only the closed deterministic category
 * and safe code, with the automatic attempt count at the bound), then append its `created` action with
 * a deterministic idempotency key. The failure aggregate's partial-unique index and the action ledger's
 * idempotency index make a duplicate active failure or a duplicate creation action fail closed with a
 * typed {@link ProjectionCheckpointInvalidError}. This function performs NO commit and NO rollback — the
 * runner owns the transaction.
 */
export async function establishRetryExhaustionFailure(
  client: DatabaseClient,
  input: EstablishRetryExhaustionInput,
): Promise<EstablishedRetryExhaustion> {
  const storage = await readPoisonEventStorageIdentity(client, input.blockedPosition);

  const failureId = randomUUID() as ProjectionFailureId;
  const actionId = randomUUID() as ProjectionFailureActionId;

  const failure = await createProjectionFailure(client, {
    failureId,
    name: input.name,
    version: input.version,
    position: input.blockedPosition,
    eventStorageSequence: storage.eventStorageSequence,
    eventId: storage.eventId,
    category: EXHAUSTION_CATEGORY,
    safeErrorCode: EXHAUSTION_SAFE_CODE,
    automaticAttemptCount: MAX_PROJECTION_ATTEMPTS,
    firstFailedAt: input.failedAt,
    lastFailedAt: input.failedAt,
    now: input.now,
  });

  await appendProjectionFailureAction(client, {
    actionId,
    failureId: failure.failureId,
    actionType: 'created',
    actorType: 'system',
    actorId: EXHAUSTION_ACTOR_ID,
    idempotencyKey: retryExhaustionIdempotencyKey(input.name, input.version, input.blockedPosition),
    resultingGeneration: failure.generation,
    occurredAt: input.failedAt,
  });

  return { failureId: failure.failureId, generation: failure.generation };
}

/**
 * Reconcile an already-blocked checkpoint against the failure aggregate (the active-failure
 * biconditional half the database cannot prove alone). Requires EXACTLY one active failure for the
 * projection, sitting at the blocked position. Zero active failures, more than one, or a position
 * mismatch each fail closed with a typed {@link ProjectionCheckpointInvalidError}; nothing is ever
 * repaired. Reads only; performs no commit, rollback, or write.
 */
export async function reconcileBlockedExhaustion(
  client: DatabaseClient,
  input: {
    readonly name: ProjectionName;
    readonly version: number;
    readonly blockedPosition: bigint;
  },
): Promise<void> {
  const active = await readActiveProjectionFailuresForProjection(client, {
    name: input.name,
    version: input.version,
  });
  if (active.length === 0) {
    throw new ProjectionDivergenceError(
      'blocked-checkpoint-without-active-failure',
      'a blocked checkpoint has no matching active failure (blocked-checkpoint-without-active-failure).',
    );
  }
  if (active.length > 1) {
    throw new ProjectionDivergenceError(
      'blocked-checkpoint-with-multiple-active-failures',
      'a blocked checkpoint has more than one active failure (blocked-checkpoint-with-multiple-active-failures).',
    );
  }
  const failure = active[0];
  if (failure?.projectionPosition !== input.blockedPosition) {
    throw new ProjectionDivergenceError(
      'active-failure-position-mismatch',
      'the active failure position does not match the blocked checkpoint (active-failure-position-mismatch).',
    );
  }
}
