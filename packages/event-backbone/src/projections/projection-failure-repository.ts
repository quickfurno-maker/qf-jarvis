/**
 * The INTERNAL projection-failure PERSISTENCE repository (QFJ-P03.07C, ADR-0040).
 *
 * Intent-specific persistence operations over the migration-0006 tables: the failure aggregate, the
 * append-only action ledger, replay authorizations, and replay-attempt/lease evidence — plus the
 * fail-closed divergence detector. Every function operates on an ALREADY-BORROWED {@link DatabaseClient}
 * and opens no transaction, takes no lock, and calls no handler; the atomic multi-step transactions the
 * future slices need are composed by the caller from these primitives. It NEVER writes a raw Error,
 * message, stack, SQL, payload, or unbounded text — every input is validated at the boundary and every
 * stored value is parsed back through the closed vocabularies.
 *
 * This slice DOES NOT wire any of this into the production runner (QFJ-P03.07D) and implements NO
 * operator API, quarantine command, replay execution, or lease worker (QFJ-P03.07E/F/G). Nothing here
 * is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import type { DatabaseClient } from '../persistence/pool.js';
import {
  ProjectionCheckpointInvalidError,
  ProjectionInputError,
  ProjectionStoredDataError,
} from './projection-errors.js';
import { toProjectionName, type ProjectionName } from './projection-name.js';
import { isProjectionFailureCategory } from './projection-failure-taxonomy.js';
import {
  assertBoundedText,
  assertNonNegativeInteger,
  assertOptionalBoundedText,
  assertPositiveBigint,
  assertPositiveInteger,
  assertUuid,
  assertValidDate,
  isProjectionFailureActionType,
  isProjectionFailureActorType,
  isProjectionFailureStatus,
  isProjectionPersistedFailureCode,
  isProjectionReplayAttemptState,
  isProjectionReplayAuthorizationState,
  PROJECTION_FAILURE_TEXT_BOUNDS,
  type ProjectionFailureActionId,
  type ProjectionFailureActionRow,
  type ProjectionFailureActionType,
  type ProjectionFailureActorType,
  type ProjectionFailureDivergenceCode,
  type ProjectionFailureId,
  type ProjectionFailureRow,
  type ProjectionReplayAttemptId,
  type ProjectionReplayAttemptRow,
  type ProjectionReplayAttemptState,
  type ProjectionReplayAuthorizationId,
  type ProjectionReplayAuthorizationRow,
} from './projection-failure-persistence.js';

const B = PROJECTION_FAILURE_TEXT_BOUNDS;

/** A pg error whose SQLSTATE is exactly `code` (guarded, hostile-safe read). */
function isSqlstate(error: unknown, code: string): boolean {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return descriptor !== undefined && 'value' in descriptor && descriptor.value === code;
  } catch {
    return false;
  }
}

// --- Row mappers (parse stored values through the closed vocabularies) ----------------------------

interface RawFailure {
  readonly failure_id: string;
  readonly projection_name: string;
  readonly projection_version: number;
  readonly projection_position: string;
  readonly event_storage_sequence: string;
  readonly event_id: string | null;
  readonly category: string;
  readonly safe_error_code: string;
  readonly detail_digest: string | null;
  readonly status: string;
  readonly generation: number;
  readonly automatic_attempt_count: number;
  readonly replay_attempt_count: number;
  readonly resolved_attempt_id: string | null;
  readonly first_failed_at: Date;
  readonly last_failed_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function mapFailure(raw: RawFailure): ProjectionFailureRow {
  if (!isProjectionFailureCategory(raw.category)) {
    throw new ProjectionStoredDataError('A stored failure category is not in the vocabulary.');
  }
  if (!isProjectionPersistedFailureCode(raw.safe_error_code)) {
    throw new ProjectionStoredDataError('A stored failure code is not in the vocabulary.');
  }
  if (!isProjectionFailureStatus(raw.status)) {
    throw new ProjectionStoredDataError('A stored failure status is not in the vocabulary.');
  }
  return {
    failureId: raw.failure_id as ProjectionFailureId,
    projectionName: raw.projection_name,
    projectionVersion: raw.projection_version,
    projectionPosition: BigInt(raw.projection_position),
    eventStorageSequence: BigInt(raw.event_storage_sequence),
    eventId: raw.event_id,
    category: raw.category,
    safeErrorCode: raw.safe_error_code,
    detailDigest: raw.detail_digest,
    status: raw.status,
    generation: raw.generation,
    automaticAttemptCount: raw.automatic_attempt_count,
    replayAttemptCount: raw.replay_attempt_count,
    resolvedAttemptId: raw.resolved_attempt_id as ProjectionReplayAttemptId | null,
    firstFailedAt: raw.first_failed_at,
    lastFailedAt: raw.last_failed_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

const FAILURE_COLUMNS = `failure_id, projection_name, projection_version, projection_position,
  event_storage_sequence, event_id, category, safe_error_code, detail_digest, status, generation,
  automatic_attempt_count, replay_attempt_count, resolved_attempt_id, first_failed_at, last_failed_at,
  created_at, updated_at`;

// --- Failure aggregate ---------------------------------------------------------------------------

export interface CreateFailureInput {
  readonly failureId: ProjectionFailureId;
  readonly name: ProjectionName;
  readonly version: number;
  readonly position: bigint;
  readonly eventStorageSequence: bigint;
  readonly eventId?: string | null;
  readonly category: string;
  readonly safeErrorCode: string;
  readonly detailDigest?: string | null;
  readonly automaticAttemptCount: number;
  readonly firstFailedAt: Date;
  readonly lastFailedAt: Date;
  readonly now: Date;
}

/**
 * Create exactly one OPEN failure aggregate. The partial unique index enforces "at most one active
 * failure per (name, version, position)": a duplicate active failure fails deterministically with a
 * typed {@link ProjectionCheckpointInvalidError}.
 */
export async function createProjectionFailure(
  client: DatabaseClient,
  input: CreateFailureInput,
): Promise<ProjectionFailureRow> {
  assertUuid(input.failureId, 'failure id');
  toProjectionName(input.name);
  assertPositiveInteger(input.version, 'projection version');
  assertPositiveBigint(input.position, 'projection position');
  assertPositiveBigint(input.eventStorageSequence, 'event storage sequence');
  const eventId = input.eventId == null ? null : assertUuid(input.eventId, 'event id');
  if (!isProjectionFailureCategory(input.category)) {
    throw new ProjectionInputError('category must be a known failure category.');
  }
  if (!isProjectionPersistedFailureCode(input.safeErrorCode)) {
    throw new ProjectionInputError('safe error code must be a known persisted failure code.');
  }
  const detailDigest = assertOptionalBoundedText(
    input.detailDigest,
    B.detailDigest,
    'detail digest',
  );
  if (
    !Number.isInteger(input.automaticAttemptCount) ||
    input.automaticAttemptCount < 0 ||
    input.automaticAttemptCount > 5
  ) {
    throw new ProjectionInputError('automatic attempt count must be between 0 and 5.');
  }
  assertValidDate(input.firstFailedAt, 'first failed at');
  assertValidDate(input.lastFailedAt, 'last failed at');
  assertValidDate(input.now, 'now');
  if (input.lastFailedAt.getTime() < input.firstFailedAt.getTime()) {
    throw new ProjectionInputError('last failed at must not be earlier than first failed at.');
  }

  try {
    const result = await client.query<RawFailure>(
      `INSERT INTO qf_jarvis.projection_failure
         (failure_id, projection_name, projection_version, projection_position,
          event_storage_sequence, event_id, category, safe_error_code, detail_digest,
          status, generation, automatic_attempt_count, replay_attempt_count,
          first_failed_at, last_failed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',0,$10,0,$11,$12,$13,$13)
       RETURNING ${FAILURE_COLUMNS}`,
      [
        input.failureId,
        input.name,
        input.version,
        input.position.toString(),
        input.eventStorageSequence.toString(),
        eventId,
        input.category,
        input.safeErrorCode,
        detailDigest,
        input.automaticAttemptCount,
        input.firstFailedAt,
        input.lastFailedAt,
        input.now,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ProjectionInputError('the failure insert returned no row.');
    return mapFailure(row);
  } catch (error) {
    if (isSqlstate(error, '23505')) {
      throw new ProjectionCheckpointInvalidError(
        'an active failure already exists for this projection position, or the failure id is not unique.',
      );
    }
    throw error;
  }
}

/** Read one failure by id, or null. */
export async function readProjectionFailureById(
  client: DatabaseClient,
  failureId: ProjectionFailureId,
): Promise<ProjectionFailureRow | null> {
  assertUuid(failureId, 'failure id');
  const result = await client.query<RawFailure>(
    `SELECT ${FAILURE_COLUMNS} FROM qf_jarvis.projection_failure WHERE failure_id = $1`,
    [failureId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapFailure(row);
}

/** Read and row-lock one failure by id FOR UPDATE (the operator mutation locks it before transition). */
export async function readProjectionFailureByIdForUpdate(
  client: DatabaseClient,
  failureId: ProjectionFailureId,
): Promise<ProjectionFailureRow | null> {
  assertUuid(failureId, 'failure id');
  const result = await client.query<RawFailure>(
    `SELECT ${FAILURE_COLUMNS} FROM qf_jarvis.projection_failure WHERE failure_id = $1 FOR UPDATE`,
    [failureId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapFailure(row);
}

/** Read the single active (non-terminal) failure for a projection, or null. */
export async function readActiveProjectionFailure(
  client: DatabaseClient,
  identity: { readonly name: ProjectionName; readonly version: number },
): Promise<ProjectionFailureRow | null> {
  toProjectionName(identity.name);
  assertPositiveInteger(identity.version, 'projection version');
  const result = await client.query<RawFailure>(
    `SELECT ${FAILURE_COLUMNS} FROM qf_jarvis.projection_failure
      WHERE projection_name = $1 AND projection_version = $2
        AND status NOT IN ('resolved','superseded','retired')
      ORDER BY projection_position ASC`,
    [identity.name, identity.version],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapFailure(row);
}

/**
 * Read ALL active (non-terminal) failures for a projection, ordered by position. The retry-exhaustion
 * reconciliation (QFJ-P03.07D) uses this to prove the active-failure biconditional at a blocked
 * checkpoint: exactly one active failure must exist, and it must sit at the blocked position. The
 * single-row {@link readActiveProjectionFailure} cannot distinguish "one" from "many", so the plural
 * read is the fail-closed primitive for detecting the multiple-active-failure divergence.
 */
export async function readActiveProjectionFailuresForProjection(
  client: DatabaseClient,
  identity: { readonly name: ProjectionName; readonly version: number },
): Promise<readonly ProjectionFailureRow[]> {
  toProjectionName(identity.name);
  assertPositiveInteger(identity.version, 'projection version');
  const result = await client.query<RawFailure>(
    `SELECT ${FAILURE_COLUMNS} FROM qf_jarvis.projection_failure
      WHERE projection_name = $1 AND projection_version = $2
        AND status NOT IN ('resolved','superseded','retired')
      ORDER BY projection_position ASC`,
    [identity.name, identity.version],
  );
  return result.rows.map(mapFailure);
}

/** Bounded inspection listing (newest first), for a future operator queue. */
export async function listProjectionFailures(
  client: DatabaseClient,
  options: { readonly status?: string; readonly limit: number; readonly offset?: number },
): Promise<readonly ProjectionFailureRow[]> {
  const limit = assertPositiveInteger(options.limit, 'limit');
  if (limit > 500) throw new ProjectionInputError('limit must be at most 500.');
  const offset =
    options.offset === undefined ? 0 : assertNonNegativeInteger(options.offset, 'offset');
  if (options.status !== undefined && !isProjectionFailureStatus(options.status)) {
    throw new ProjectionInputError('status filter must be a known failure status.');
  }
  const result = await client.query<RawFailure>(
    `SELECT ${FAILURE_COLUMNS} FROM qf_jarvis.projection_failure
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC, failure_id ASC
      LIMIT $2 OFFSET $3`,
    [options.status ?? null, limit, offset],
  );
  return result.rows.map(mapFailure);
}

export interface ListFailuresKeysetInput {
  readonly name?: ProjectionName | undefined;
  readonly version?: number | undefined;
  readonly status?: string | undefined;
  readonly category?: string | undefined;
  readonly createdBefore?: Date | undefined;
  readonly createdAfter?: Date | undefined;
  readonly activeOnly?: boolean | undefined;
  /** Keyset cursor: return rows strictly AFTER (created_at, failure_id) in the DESC ordering. */
  readonly cursorCreatedAt?: Date | undefined;
  readonly cursorFailureId?: ProjectionFailureId | undefined;
  readonly limit: number;
}

/**
 * Keyset-paginated inspection listing, ordered `created_at DESC, failure_id DESC`. Every filter is a
 * closed, validated, parameterized value — no arbitrary column, order-by, or raw SQL fragment. The
 * cursor is a stable `(created_at, failure_id)` pair; there is no OFFSET scan. `limit` is validated by
 * the caller (the operations boundary clamps it to the approved maximum).
 */
export async function listProjectionFailuresKeyset(
  client: DatabaseClient,
  input: ListFailuresKeysetInput,
): Promise<readonly ProjectionFailureRow[]> {
  const limit = assertPositiveInteger(input.limit, 'limit');
  if (limit > 500) throw new ProjectionInputError('limit must be at most 500.');
  if (input.name !== undefined) toProjectionName(input.name);
  if (input.version !== undefined) assertPositiveInteger(input.version, 'projection version');
  if (input.status !== undefined && !isProjectionFailureStatus(input.status)) {
    throw new ProjectionInputError('status filter must be a known failure status.');
  }
  if (input.category !== undefined && !isProjectionFailureCategory(input.category)) {
    throw new ProjectionInputError('category filter must be a known failure category.');
  }
  if (input.createdBefore !== undefined) assertValidDate(input.createdBefore, 'created before');
  if (input.createdAfter !== undefined) assertValidDate(input.createdAfter, 'created after');
  const cursorGiven = input.cursorCreatedAt !== undefined || input.cursorFailureId !== undefined;
  if (cursorGiven) {
    if (input.cursorCreatedAt === undefined || input.cursorFailureId === undefined) {
      throw new ProjectionInputError('a keyset cursor requires both created_at and failure_id.');
    }
    assertValidDate(input.cursorCreatedAt, 'cursor created at');
    assertUuid(input.cursorFailureId, 'cursor failure id');
  }
  const result = await client.query<RawFailure>(
    `SELECT ${FAILURE_COLUMNS} FROM qf_jarvis.projection_failure
      WHERE ($1::text IS NULL OR projection_name = $1)
        AND ($2::int IS NULL OR projection_version = $2)
        AND ($3::text IS NULL OR status = $3)
        AND ($4::text IS NULL OR category = $4)
        AND ($5::timestamptz IS NULL OR created_at < $5)
        AND ($6::timestamptz IS NULL OR created_at > $6)
        AND ($7::boolean IS NOT TRUE OR status NOT IN ('resolved','superseded','retired'))
        AND ($8::timestamptz IS NULL OR (created_at, failure_id) < ($8, $9::uuid))
      ORDER BY created_at DESC, failure_id DESC
      LIMIT $10`,
    [
      input.name ?? null,
      input.version ?? null,
      input.status ?? null,
      input.category ?? null,
      input.createdBefore ?? null,
      input.createdAfter ?? null,
      input.activeOnly ?? null,
      input.cursorCreatedAt ?? null,
      input.cursorFailureId ?? null,
      limit,
    ],
  );
  return result.rows.map(mapFailure);
}

/**
 * Advance a failure from an expected prior status to a new status (repository-mediated transition).
 * When `expectedGeneration` is supplied, the UPDATE additionally requires the current generation to
 * match — a DB-enforced optimistic-concurrency guard on top of the prior-status guard. The generation
 * always increments by exactly one on a successful transition.
 */
async function transitionFailure(
  client: DatabaseClient,
  params: {
    readonly failureId: ProjectionFailureId;
    readonly fromStatuses: readonly string[];
    readonly toStatus: string;
    readonly now: Date;
    readonly expectedGeneration?: number | undefined;
    readonly extraSet?: string;
    readonly extraParams?: readonly unknown[];
  },
): Promise<ProjectionFailureRow> {
  assertUuid(params.failureId, 'failure id');
  assertValidDate(params.now, 'now');
  const extraSet = params.extraSet ?? '';
  const values: unknown[] = [
    params.failureId,
    params.toStatus,
    params.now,
    params.fromStatuses,
    ...(params.extraParams ?? []),
  ];
  let generationClause = '';
  if (params.expectedGeneration !== undefined) {
    assertNonNegativeInteger(params.expectedGeneration, 'expected generation');
    values.push(params.expectedGeneration);
    generationClause = ` AND generation = $${String(values.length)}`;
  }
  const result = await client.query<RawFailure>(
    `UPDATE qf_jarvis.projection_failure
        SET status = $2, generation = generation + 1, updated_at = $3${extraSet}
      WHERE failure_id = $1 AND status = ANY($4::text[])${generationClause}
      RETURNING ${FAILURE_COLUMNS}`,
    values,
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ProjectionCheckpointInvalidError(
      'the failure does not exist or is not in a status permitting this transition.',
    );
  }
  return mapFailure(row);
}

/** Acknowledge an OPEN failure (operator review; does not permit replay or resolve). */
export function acknowledgeProjectionFailure(
  client: DatabaseClient,
  input: {
    readonly failureId: ProjectionFailureId;
    readonly actorId: string;
    readonly at: Date;
    readonly now: Date;
    readonly expectedGeneration?: number;
  },
): Promise<ProjectionFailureRow> {
  assertBoundedText(input.actorId, B.actorId, 'actor id');
  assertValidDate(input.at, 'acknowledged at');
  return transitionFailure(client, {
    failureId: input.failureId,
    fromStatuses: ['open'],
    toStatus: 'acknowledged',
    now: input.now,
    expectedGeneration: input.expectedGeneration,
    extraSet: ', acknowledged_at = $5, acknowledged_by = $6',
    extraParams: [input.at, input.actorId],
  });
}

/** Quarantine an OPEN or ACKNOWLEDGED failure (isolate for controlled investigation; never skips). */
export function quarantineProjectionFailure(
  client: DatabaseClient,
  input: {
    readonly failureId: ProjectionFailureId;
    readonly actorId: string;
    readonly at: Date;
    readonly now: Date;
    readonly expectedGeneration?: number;
  },
): Promise<ProjectionFailureRow> {
  assertBoundedText(input.actorId, B.actorId, 'actor id');
  assertValidDate(input.at, 'quarantined at');
  return transitionFailure(client, {
    failureId: input.failureId,
    fromStatuses: ['open', 'acknowledged'],
    toStatus: 'quarantined',
    now: input.now,
    expectedGeneration: input.expectedGeneration,
    extraSet: ', quarantined_at = $5, quarantined_by = $6',
    extraParams: [input.at, input.actorId],
  });
}

/** Resolve a REPLAYING failure after a proven successful replay attempt (terminal). */
export function resolveProjectionFailure(
  client: DatabaseClient,
  input: {
    readonly failureId: ProjectionFailureId;
    readonly resolvedAttemptId: ProjectionReplayAttemptId;
    readonly at: Date;
    readonly now: Date;
    readonly expectedGeneration?: number | undefined;
  },
): Promise<ProjectionFailureRow> {
  assertUuid(input.resolvedAttemptId, 'resolved attempt id');
  assertValidDate(input.at, 'resolved at');
  return transitionFailure(client, {
    failureId: input.failureId,
    fromStatuses: ['replaying'],
    toStatus: 'resolved',
    now: input.now,
    expectedGeneration: input.expectedGeneration,
    extraSet: ', resolved_at = $5, resolved_attempt_id = $6',
    extraParams: [input.at, input.resolvedAttemptId],
  });
}

/**
 * Transition a QUARANTINED failure to REPLAY_AUTHORIZED (QFJ-P03.07F authorize step). Generation-guarded;
 * only a quarantined failure may be authorized for replay (ADR-0040 §39 lifecycle).
 */
export function transitionFailureToReplayAuthorized(
  client: DatabaseClient,
  input: {
    readonly failureId: ProjectionFailureId;
    readonly expectedGeneration: number;
    readonly now: Date;
  },
): Promise<ProjectionFailureRow> {
  return transitionFailure(client, {
    failureId: input.failureId,
    fromStatuses: ['quarantined'],
    toStatus: 'replay-authorized',
    now: input.now,
    expectedGeneration: input.expectedGeneration,
  });
}

/**
 * Transition a REPLAY_AUTHORIZED failure to REPLAYING (QFJ-P03.07F replay-start/claim step).
 * Generation-guarded.
 */
export function transitionFailureToReplaying(
  client: DatabaseClient,
  input: {
    readonly failureId: ProjectionFailureId;
    readonly expectedGeneration: number;
    readonly now: Date;
  },
): Promise<ProjectionFailureRow> {
  return transitionFailure(client, {
    failureId: input.failureId,
    fromStatuses: ['replay-authorized'],
    toStatus: 'replaying',
    now: input.now,
    expectedGeneration: input.expectedGeneration,
  });
}

/**
 * Transition a REPLAYING failure back to QUARANTINED after an UNSUCCESSFUL replay (ADR-0040 §39 "back to
 * a controlled state"). The failure stays active and blocked; a further replay requires a NEW
 * authorization (no automatic retry). Generation-guarded. Preserves the original quarantine attribution
 * (quarantined_at/by are unchanged and remain paired).
 */
export function transitionFailureToQuarantinedAfterReplay(
  client: DatabaseClient,
  input: {
    readonly failureId: ProjectionFailureId;
    readonly expectedGeneration: number;
    readonly now: Date;
  },
): Promise<ProjectionFailureRow> {
  return transitionFailure(client, {
    failureId: input.failureId,
    fromStatuses: ['replaying'],
    toStatus: 'quarantined',
    now: input.now,
    expectedGeneration: input.expectedGeneration,
  });
}

// --- Action ledger (append-only) -----------------------------------------------------------------

interface RawAction {
  readonly sequence: string;
  readonly action_id: string;
  readonly failure_id: string;
  readonly action_type: string;
  readonly actor_type: string;
  readonly actor_id: string;
  readonly reason: string | null;
  readonly idempotency_key: string | null;
  readonly expected_generation: number | null;
  readonly resulting_generation: number | null;
  readonly occurred_at: Date;
  readonly recorded_at: Date;
}

function mapAction(raw: RawAction): ProjectionFailureActionRow {
  if (!isProjectionFailureActionType(raw.action_type)) {
    throw new ProjectionStoredDataError('A stored action type is not in the vocabulary.');
  }
  if (!isProjectionFailureActorType(raw.actor_type)) {
    throw new ProjectionStoredDataError('A stored actor type is not in the vocabulary.');
  }
  return {
    sequence: BigInt(raw.sequence),
    actionId: raw.action_id as ProjectionFailureActionId,
    failureId: raw.failure_id as ProjectionFailureId,
    actionType: raw.action_type,
    actorType: raw.actor_type,
    actorId: raw.actor_id,
    reason: raw.reason,
    idempotencyKey: raw.idempotency_key,
    expectedGeneration: raw.expected_generation,
    resultingGeneration: raw.resulting_generation,
    occurredAt: raw.occurred_at,
    recordedAt: raw.recorded_at,
  };
}

export interface AppendActionInput {
  readonly actionId: ProjectionFailureActionId;
  readonly failureId: ProjectionFailureId;
  readonly actionType: ProjectionFailureActionType;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly reason?: string | null;
  readonly idempotencyKey?: string | null;
  readonly expectedGeneration?: number | null;
  readonly resultingGeneration?: number | null;
  readonly occurredAt: Date;
}

/** Append one immutable action row (attributable audit evidence). */
export async function appendProjectionFailureAction(
  client: DatabaseClient,
  input: AppendActionInput,
): Promise<ProjectionFailureActionRow> {
  assertUuid(input.actionId, 'action id');
  assertUuid(input.failureId, 'failure id');
  if (!isProjectionFailureActionType(input.actionType)) {
    throw new ProjectionInputError('action type must be a known action type.');
  }
  if (!isProjectionFailureActorType(input.actorType)) {
    throw new ProjectionInputError('actor type must be a known actor type.');
  }
  assertBoundedText(input.actorId, B.actorId, 'actor id');
  const reason = assertOptionalBoundedText(input.reason, B.reason, 'reason');
  const idempotencyKey = assertOptionalBoundedText(
    input.idempotencyKey,
    B.idempotencyKey,
    'idempotency key',
  );
  const expectedGeneration =
    input.expectedGeneration == null
      ? null
      : assertNonNegativeInteger(input.expectedGeneration, 'expected generation');
  const resultingGeneration =
    input.resultingGeneration == null
      ? null
      : assertNonNegativeInteger(input.resultingGeneration, 'resulting generation');
  assertValidDate(input.occurredAt, 'occurred at');

  const result = await client.query<RawAction>(
    `INSERT INTO qf_jarvis.projection_failure_action
       (action_id, failure_id, action_type, actor_type, actor_id, reason, idempotency_key,
        expected_generation, resulting_generation, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING sequence, action_id, failure_id, action_type, actor_type, actor_id, reason,
               idempotency_key, expected_generation, resulting_generation, occurred_at, recorded_at`,
    [
      input.actionId,
      input.failureId,
      input.actionType,
      input.actorType,
      input.actorId,
      reason,
      idempotencyKey,
      expectedGeneration,
      resultingGeneration,
      input.occurredAt,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ProjectionInputError('the action insert returned no row.');
  return mapAction(row);
}

/** Read all actions for a failure, in recording order. */
export async function readProjectionFailureActions(
  client: DatabaseClient,
  failureId: ProjectionFailureId,
): Promise<readonly ProjectionFailureActionRow[]> {
  assertUuid(failureId, 'failure id');
  const result = await client.query<RawAction>(
    `SELECT sequence, action_id, failure_id, action_type, actor_type, actor_id, reason,
            idempotency_key, expected_generation, resulting_generation, occurred_at, recorded_at
       FROM qf_jarvis.projection_failure_action WHERE failure_id = $1 ORDER BY sequence ASC`,
    [failureId],
  );
  return result.rows.map(mapAction);
}

/**
 * Read the single action carrying a given idempotency key, or null. The operator-mutation operations
 * use this to detect an ALREADY-APPLIED request (the action ledger's partial-unique `idempotency_key`
 * index guarantees at most one), so an exact duplicate returns the stable prior result instead of
 * appending a second action or double-transitioning.
 */
export async function readProjectionFailureActionByIdempotencyKey(
  client: DatabaseClient,
  idempotencyKey: string,
): Promise<ProjectionFailureActionRow | null> {
  assertBoundedText(idempotencyKey, B.idempotencyKey, 'idempotency key');
  const result = await client.query<RawAction>(
    `SELECT sequence, action_id, failure_id, action_type, actor_type, actor_id, reason,
            idempotency_key, expected_generation, resulting_generation, occurred_at, recorded_at
       FROM qf_jarvis.projection_failure_action WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapAction(row);
}

// --- Replay authorization ------------------------------------------------------------------------

interface RawAuthorization {
  readonly authorization_id: string;
  readonly failure_id: string;
  readonly failure_generation: number;
  readonly state: string;
  readonly authorized_by: string;
  readonly reason: string | null;
  readonly idempotency_key: string;
  readonly created_at: Date;
  readonly expires_at: Date | null;
  readonly consumed_at: Date | null;
  readonly consumed_attempt_id: string | null;
}

function mapAuthorization(raw: RawAuthorization): ProjectionReplayAuthorizationRow {
  if (!isProjectionReplayAuthorizationState(raw.state)) {
    throw new ProjectionStoredDataError('A stored authorization state is not in the vocabulary.');
  }
  return {
    authorizationId: raw.authorization_id as ProjectionReplayAuthorizationId,
    failureId: raw.failure_id as ProjectionFailureId,
    failureGeneration: raw.failure_generation,
    state: raw.state,
    authorizedBy: raw.authorized_by,
    reason: raw.reason,
    idempotencyKey: raw.idempotency_key,
    createdAt: raw.created_at,
    expiresAt: raw.expires_at,
    consumedAt: raw.consumed_at,
    consumedAttemptId: raw.consumed_attempt_id as ProjectionReplayAttemptId | null,
  };
}

const AUTHORIZATION_COLUMNS = `authorization_id, failure_id, failure_generation, state, authorized_by,
  reason, idempotency_key, created_at, expires_at, consumed_at, consumed_attempt_id`;

export interface CreateAuthorizationInput {
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly failureId: ProjectionFailureId;
  readonly failureGeneration: number;
  readonly authorizedBy: string;
  readonly reason?: string | null;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly expiresAt?: Date | null;
}

/**
 * Create an ACTIVE replay authorization for a non-terminal failure at an exact generation. The partial
 * unique index enforces "at most one active authorization per failure"; the idempotency key is unique.
 * A repeated idempotency key returns the existing authorization (idempotent). Authorizing a resolved,
 * missing, or generation-mismatched failure fails closed.
 */
export async function createReplayAuthorization(
  client: DatabaseClient,
  input: CreateAuthorizationInput,
): Promise<ProjectionReplayAuthorizationRow> {
  assertUuid(input.authorizationId, 'authorization id');
  assertUuid(input.failureId, 'failure id');
  assertNonNegativeInteger(input.failureGeneration, 'failure generation');
  assertBoundedText(input.authorizedBy, B.authorizedBy, 'authorized by');
  const reason = assertOptionalBoundedText(input.reason, B.reason, 'reason');
  assertBoundedText(input.idempotencyKey, B.idempotencyKey, 'idempotency key');
  assertValidDate(input.createdAt, 'created at');
  if (input.expiresAt != null) {
    assertValidDate(input.expiresAt, 'expires at');
    if (input.expiresAt.getTime() <= input.createdAt.getTime()) {
      throw new ProjectionInputError('expires at must be after created at.');
    }
  }

  const failure = await readProjectionFailureById(client, input.failureId);
  if (failure === null) {
    throw new ProjectionCheckpointInvalidError('no such failure to authorize replay for.');
  }
  if (
    failure.status === 'resolved' ||
    failure.status === 'superseded' ||
    failure.status === 'retired'
  ) {
    throw new ProjectionCheckpointInvalidError('cannot authorize replay for a terminal failure.');
  }
  if (failure.generation !== input.failureGeneration) {
    throw new ProjectionCheckpointInvalidError(
      'the authorization generation does not match the current failure generation.',
    );
  }

  try {
    const result = await client.query<RawAuthorization>(
      `INSERT INTO qf_jarvis.projection_replay_authorization
         (authorization_id, failure_id, failure_generation, state, authorized_by, reason,
          idempotency_key, created_at, expires_at)
       VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8)
       RETURNING ${AUTHORIZATION_COLUMNS}`,
      [
        input.authorizationId,
        input.failureId,
        input.failureGeneration,
        input.authorizedBy,
        reason,
        input.idempotencyKey,
        input.createdAt,
        input.expiresAt ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ProjectionInputError('the authorization insert returned no row.');
    }
    return mapAuthorization(row);
  } catch (error) {
    if (isSqlstate(error, '23505')) {
      // Idempotent re-create: a repeated idempotency key returns the existing authorization.
      const existing = await client.query<RawAuthorization>(
        `SELECT ${AUTHORIZATION_COLUMNS} FROM qf_jarvis.projection_replay_authorization
          WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row !== undefined) return mapAuthorization(row);
      throw new ProjectionCheckpointInvalidError(
        'an active authorization already exists for this failure.',
      );
    }
    throw error;
  }
}

/** Read the single active authorization for a failure, or null. */
export async function readActiveReplayAuthorization(
  client: DatabaseClient,
  failureId: ProjectionFailureId,
): Promise<ProjectionReplayAuthorizationRow | null> {
  assertUuid(failureId, 'failure id');
  const result = await client.query<RawAuthorization>(
    `SELECT ${AUTHORIZATION_COLUMNS} FROM qf_jarvis.projection_replay_authorization
      WHERE failure_id = $1 AND state = 'active'`,
    [failureId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapAuthorization(row);
}

/** Consume an ACTIVE authorization (single-consume). Consuming a non-active authorization fails closed. */
export async function consumeReplayAuthorization(
  client: DatabaseClient,
  input: {
    readonly authorizationId: ProjectionReplayAuthorizationId;
    readonly consumedAttemptId: ProjectionReplayAttemptId;
    readonly at: Date;
  },
): Promise<ProjectionReplayAuthorizationRow> {
  assertUuid(input.authorizationId, 'authorization id');
  assertUuid(input.consumedAttemptId, 'consumed attempt id');
  assertValidDate(input.at, 'consumed at');
  const result = await client.query<RawAuthorization>(
    `UPDATE qf_jarvis.projection_replay_authorization
        SET state = 'consumed', consumed_at = $2, consumed_attempt_id = $3
      WHERE authorization_id = $1 AND state = 'active'
      RETURNING ${AUTHORIZATION_COLUMNS}`,
    [input.authorizationId, input.at, input.consumedAttemptId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ProjectionCheckpointInvalidError(
      'the authorization does not exist or is not active (already consumed, expired, or revoked).',
    );
  }
  return mapAuthorization(row);
}

// --- Replay attempt + lease ----------------------------------------------------------------------

interface RawAttempt {
  readonly attempt_id: string;
  readonly failure_id: string;
  readonly authorization_id: string;
  readonly attempt_number: number;
  readonly state: string;
  readonly lease_owner: string;
  readonly lease_acquired_at: Date;
  readonly lease_expires_at: Date;
  readonly started_at: Date;
  readonly finished_at: Date | null;
  readonly outcome_code: string | null;
  readonly resulting_position: string | null;
  readonly commit_observed: boolean | null;
}

function mapAttempt(raw: RawAttempt): ProjectionReplayAttemptRow {
  if (!isProjectionReplayAttemptState(raw.state)) {
    throw new ProjectionStoredDataError('A stored attempt state is not in the vocabulary.');
  }
  let outcomeCode: ProjectionReplayAttemptRow['outcomeCode'] = null;
  if (raw.outcome_code !== null) {
    if (!isProjectionPersistedFailureCode(raw.outcome_code)) {
      throw new ProjectionStoredDataError(
        'A stored attempt outcome code is not in the vocabulary.',
      );
    }
    outcomeCode = raw.outcome_code;
  }
  return {
    attemptId: raw.attempt_id as ProjectionReplayAttemptId,
    failureId: raw.failure_id as ProjectionFailureId,
    authorizationId: raw.authorization_id as ProjectionReplayAuthorizationId,
    attemptNumber: raw.attempt_number,
    state: raw.state,
    leaseOwner: raw.lease_owner,
    leaseAcquiredAt: raw.lease_acquired_at,
    leaseExpiresAt: raw.lease_expires_at,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    outcomeCode,
    resultingPosition: raw.resulting_position === null ? null : BigInt(raw.resulting_position),
    commitObserved: raw.commit_observed,
  };
}

const ATTEMPT_COLUMNS = `attempt_id, failure_id, authorization_id, attempt_number, state, lease_owner,
  lease_acquired_at, lease_expires_at, started_at, finished_at, outcome_code, resulting_position,
  commit_observed`;

export interface StartAttemptInput {
  readonly attemptId: ProjectionReplayAttemptId;
  readonly failureId: ProjectionFailureId;
  readonly authorizationId: ProjectionReplayAuthorizationId;
  readonly attemptNumber: number;
  readonly leaseOwner: string;
  readonly leaseAcquiredAt: Date;
  readonly leaseExpiresAt: Date;
  readonly startedAt: Date;
}

/**
 * Start one replay attempt with a bounded lease. The composite FK ties the authorization to the
 * failure; the partial unique index enforces "at most one live attempt per failure"; the attempt
 * number is unique per failure. Any of those conflicts fails closed.
 */
export async function startReplayAttempt(
  client: DatabaseClient,
  input: StartAttemptInput,
): Promise<ProjectionReplayAttemptRow> {
  assertUuid(input.attemptId, 'attempt id');
  assertUuid(input.failureId, 'failure id');
  assertUuid(input.authorizationId, 'authorization id');
  assertPositiveInteger(input.attemptNumber, 'attempt number');
  assertBoundedText(input.leaseOwner, B.leaseOwner, 'lease owner');
  assertValidDate(input.leaseAcquiredAt, 'lease acquired at');
  assertValidDate(input.leaseExpiresAt, 'lease expires at');
  assertValidDate(input.startedAt, 'started at');
  if (input.leaseExpiresAt.getTime() <= input.leaseAcquiredAt.getTime()) {
    throw new ProjectionInputError('lease expires at must be after lease acquired at.');
  }
  if (input.startedAt.getTime() < input.leaseAcquiredAt.getTime()) {
    throw new ProjectionInputError('started at must not be earlier than lease acquired at.');
  }

  try {
    const result = await client.query<RawAttempt>(
      `INSERT INTO qf_jarvis.projection_replay_attempt
         (attempt_id, failure_id, authorization_id, attempt_number, state, lease_owner,
          lease_acquired_at, lease_expires_at, started_at)
       VALUES ($1,$2,$3,$4,'started',$5,$6,$7,$8)
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        input.attemptId,
        input.failureId,
        input.authorizationId,
        input.attemptNumber,
        input.leaseOwner,
        input.leaseAcquiredAt,
        input.leaseExpiresAt,
        input.startedAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new ProjectionInputError('the attempt insert returned no row.');
    return mapAttempt(row);
  } catch (error) {
    if (isSqlstate(error, '23505')) {
      throw new ProjectionCheckpointInvalidError(
        'a live attempt already exists for this failure, or the attempt number/id is not unique.',
      );
    }
    if (isSqlstate(error, '23503')) {
      throw new ProjectionCheckpointInvalidError(
        'the authorization does not belong to this failure (or the failure/authorization is missing).',
      );
    }
    throw error;
  }
}

/** Read the single live (started) attempt for a failure, or null. */
export async function readLiveReplayAttempt(
  client: DatabaseClient,
  failureId: ProjectionFailureId,
): Promise<ProjectionReplayAttemptRow | null> {
  assertUuid(failureId, 'failure id');
  const result = await client.query<RawAttempt>(
    `SELECT ${ATTEMPT_COLUMNS} FROM qf_jarvis.projection_replay_attempt
      WHERE failure_id = $1 AND state = 'started'`,
    [failureId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapAttempt(row);
}

/** Read one replay attempt by id, or null (used to validate a specific attempt during completion/takeover). */
export async function readReplayAttemptById(
  client: DatabaseClient,
  attemptId: ProjectionReplayAttemptId,
): Promise<ProjectionReplayAttemptRow | null> {
  assertUuid(attemptId, 'attempt id');
  const result = await client.query<RawAttempt>(
    `SELECT ${ATTEMPT_COLUMNS} FROM qf_jarvis.projection_replay_attempt WHERE attempt_id = $1`,
    [attemptId],
  );
  const row = result.rows[0];
  return row === undefined ? null : mapAttempt(row);
}

/**
 * Count all replay attempts (any state) for a failure — used to allocate the next `attempt_number`
 * (count + 1) for a takeover's fresh attempt. Race-safe under the failure row lock + advisory lock; the
 * `UNIQUE(failure_id, attempt_number)` constraint is the durable backstop.
 */
export async function countReplayAttemptsForFailure(
  client: DatabaseClient,
  failureId: ProjectionFailureId,
): Promise<number> {
  assertUuid(failureId, 'failure id');
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM qf_jarvis.projection_replay_attempt WHERE failure_id = $1`,
    [failureId],
  );
  return Number(result.rows[0]?.n ?? '0');
}

export interface CompleteAttemptInput {
  readonly attemptId: ProjectionReplayAttemptId;
  readonly state: Exclude<ProjectionReplayAttemptState, 'started'>;
  readonly finishedAt: Date;
  readonly outcomeCode?: string | null;
  readonly resultingPosition?: bigint | null;
  readonly commitObserved: boolean;
}

/** Complete a started attempt with its single terminal transition. A non-live attempt fails closed. */
export async function completeReplayAttempt(
  client: DatabaseClient,
  input: CompleteAttemptInput,
): Promise<ProjectionReplayAttemptRow> {
  assertUuid(input.attemptId, 'attempt id');
  // Guard the runtime value (a caller could pass 'started' or an invalid value through a cast).
  const terminalState: string = input.state;
  if (terminalState === 'started' || !isProjectionReplayAttemptState(terminalState)) {
    throw new ProjectionInputError('terminal state must be succeeded, failed, or abandoned.');
  }
  assertValidDate(input.finishedAt, 'finished at');
  if (typeof input.commitObserved !== 'boolean') {
    throw new ProjectionInputError('commit observed must be a boolean.');
  }
  let resultingPosition: string | null = null;
  if (input.state === 'succeeded') {
    if (input.resultingPosition == null) {
      throw new ProjectionInputError('a succeeded attempt must carry a resulting position.');
    }
    resultingPosition = assertPositiveBigint(
      input.resultingPosition,
      'resulting position',
    ).toString();
  }
  let outcomeCode: string | null = null;
  if (input.state === 'failed') {
    if (!isProjectionPersistedFailureCode(input.outcomeCode)) {
      throw new ProjectionInputError('a failed attempt must carry a known outcome code.');
    }
    outcomeCode = input.outcomeCode;
  }

  const result = await client.query<RawAttempt>(
    `UPDATE qf_jarvis.projection_replay_attempt
        SET state = $2, finished_at = $3, outcome_code = $4, resulting_position = $5, commit_observed = $6
      WHERE attempt_id = $1 AND state = 'started'
      RETURNING ${ATTEMPT_COLUMNS}`,
    [
      input.attemptId,
      input.state,
      input.finishedAt,
      outcomeCode,
      resultingPosition,
      input.commitObserved,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new ProjectionCheckpointInvalidError(
      'the attempt does not exist or is not live (already terminal).',
    );
  }
  return mapAttempt(row);
}

// --- Divergence detection (fail-closed; no auto-repair) ------------------------------------------

export interface ProjectionFailureDivergence {
  readonly code: ProjectionFailureDivergenceCode;
  readonly projectionName: string | null;
  readonly projectionVersion: number | null;
  readonly failureId: ProjectionFailureId | null;
}

/**
 * Detect every ADR-0040 divergence between the checkpoint, failure, authorization, and attempt tables.
 * Returns a bounded list of closed divergence codes; it NEVER repairs anything. An empty list means the
 * active-failure biconditional and the authorization/attempt invariants currently hold.
 */
export async function detectProjectionFailureDivergences(
  client: DatabaseClient,
): Promise<readonly ProjectionFailureDivergence[]> {
  const result = await client.query<{
    code: string;
    projection_name: string | null;
    projection_version: number | null;
    failure_id: string | null;
  }>(
    `WITH active_failure AS (
       SELECT failure_id, projection_name, projection_version, projection_position
         FROM qf_jarvis.projection_failure
        WHERE status NOT IN ('resolved','superseded','retired')
     ),
     blocked_cp AS (
       SELECT projection_name, projection_version, blocked_position
         FROM qf_jarvis.projection_checkpoint
        WHERE status = 'blocked' AND blocked_position IS NOT NULL
     )
     -- 1. blocked checkpoint with no active failure at all
     SELECT 'blocked-checkpoint-without-active-failure' AS code,
            b.projection_name, b.projection_version, NULL::uuid AS failure_id
       FROM blocked_cp b
      WHERE NOT EXISTS (SELECT 1 FROM active_failure f
                         WHERE f.projection_name = b.projection_name
                           AND f.projection_version = b.projection_version)
     UNION ALL
     -- 2. blocked checkpoint with more than one active failure
     SELECT 'blocked-checkpoint-with-multiple-active-failures', b.projection_name, b.projection_version, NULL::uuid
       FROM blocked_cp b
       JOIN active_failure f ON f.projection_name = b.projection_name
                            AND f.projection_version = b.projection_version
      GROUP BY b.projection_name, b.projection_version
     HAVING count(*) > 1
     UNION ALL
     -- 3. active failure whose projection has no blocked checkpoint
     SELECT 'active-failure-without-blocked-checkpoint', f.projection_name, f.projection_version, f.failure_id
       FROM active_failure f
      WHERE NOT EXISTS (SELECT 1 FROM blocked_cp b
                         WHERE b.projection_name = f.projection_name
                           AND b.projection_version = f.projection_version)
     UNION ALL
     -- 4. active failure at a position different from the checkpoint's blocked_position
     SELECT 'active-failure-position-mismatch', f.projection_name, f.projection_version, f.failure_id
       FROM active_failure f
       JOIN blocked_cp b ON b.projection_name = f.projection_name
                        AND b.projection_version = f.projection_version
      WHERE f.projection_position <> b.blocked_position
     UNION ALL
     -- 5. active authorization for a resolved or missing failure
     SELECT 'authorization-for-resolved-or-missing-failure', NULL, NULL, a.failure_id
       FROM qf_jarvis.projection_replay_authorization a
      WHERE a.state = 'active'
        AND NOT EXISTS (SELECT 1 FROM active_failure f WHERE f.failure_id = a.failure_id)
     UNION ALL
     -- 6. more than one active authorization for a failure (defence-in-depth vs the partial index)
     SELECT 'multiple-active-authorizations', NULL, NULL, a.failure_id
       FROM qf_jarvis.projection_replay_authorization a
      WHERE a.state = 'active'
      GROUP BY a.failure_id
     HAVING count(*) > 1
     UNION ALL
     -- 7. live replay attempt whose authorization is not active
     SELECT 'attempt-lease-inconsistent', NULL, NULL, t.failure_id
       FROM qf_jarvis.projection_replay_attempt t
       JOIN qf_jarvis.projection_replay_authorization a ON a.authorization_id = t.authorization_id
      WHERE t.state = 'started' AND a.state <> 'active'`,
  );

  return result.rows.map((raw) => {
    const code = raw.code as ProjectionFailureDivergenceCode;
    return {
      code,
      projectionName: raw.projection_name,
      projectionVersion: raw.projection_version,
      failureId: raw.failure_id as ProjectionFailureId | null,
    };
  });
}
