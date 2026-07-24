/**
 * The INTERNAL projection-failure OPERATIONS boundary (QFJ-P03.07E, ADR-0040).
 *
 * A safe, bounded, operator-facing service for INSPECTING projection failures and performing the two
 * non-replay lifecycle mutations — ACKNOWLEDGE and QUARANTINE. It composes the already-merged
 * QFJ-P03.07C persistence repository and the QFJ-P03.07D failure state; it opens no ad-hoc SQL, never
 * writes the projection checkpoint, never advances or skips a position, never resolves a failure, and
 * never authorizes or executes a replay. Every mutation is authorized, generation-guarded, idempotent
 * (via the action ledger's deterministic idempotency key), atomic (transition + one append-only action
 * in one transaction), and gated on the fail-closed divergence detector.
 *
 * Quarantine is failure-lifecycle metadata, NOT projection progress: the blocked checkpoint, the blocked
 * position, `last_position`, every attempt, the failure identity, and the action history are all
 * preserved. Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is
 * unchanged.
 */

import { randomUUID } from 'node:crypto';

import type { ProjectionLogIdentity } from '../observability/projection-log-events.js';
import {
  NOOP_PROJECTION_LOGGER,
  type ProjectionLogger,
} from '../observability/projection-logger.js';
import type { ProjectionMetricsRegistry } from '../observability/projection-metrics.js';
import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import { withTransaction } from '../persistence/transaction.js';
import { readAttemptsForEvent } from './attempt-store.js';
import { readCheckpoint } from './checkpoint-store.js';
import { isProjectionFailureCategory } from './projection-failure-taxonomy.js';
import {
  ProjectionFailureOperationError,
  type ProjectionFailureOperationErrorCode,
} from './projection-failure-operations-errors.js';
import {
  assertBoundedText,
  assertUuid,
  isProjectionFailureActorType,
  isProjectionFailureStatus,
  PROJECTION_FAILURE_TEXT_BOUNDS,
  type ProjectionFailureActionId,
  type ProjectionFailureActorType,
  type ProjectionFailureDivergenceCode,
  type ProjectionFailureId,
  type ProjectionFailureRow,
} from './projection-failure-persistence.js';
import {
  acknowledgeProjectionFailure,
  appendProjectionFailureAction,
  detectProjectionFailureDivergences,
  listProjectionFailuresKeyset,
  quarantineProjectionFailure,
  readActiveReplayAuthorization,
  readLiveReplayAttempt,
  readProjectionFailureActionByIdempotencyKey,
  readProjectionFailureActions,
  readProjectionFailureByIdForUpdate,
  readProjectionFailureById,
  type ProjectionFailureDivergence,
} from './projection-failure-repository.js';
import type { ProjectionName } from './projection-name.js';

const B = PROJECTION_FAILURE_TEXT_BOUNDS;

// --- Authorization ------------------------------------------------------------------------------

/** The closed operation capabilities. Quarantine is strictly stronger than inspect. */
export const PROJECTION_FAILURE_OPERATION_CAPABILITIES = [
  'projection-failure:inspect',
  'projection-failure:acknowledge',
  'projection-failure:quarantine',
] as const;
export type ProjectionFailureOperationCapability =
  (typeof PROJECTION_FAILURE_OPERATION_CAPABILITIES)[number];

/** The context every operation carries: who is acting, and the correlation id for the audit trail. */
export interface ProjectionFailureOperationContext {
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly correlationId: string;
  /**
   * Optional structured logger (QFJ-P03.07G). Defaults to discarding. Emission happens only after the
   * mutation transaction has committed, and the operator's free-text `reason` is NEVER emitted — it is
   * persisted in the action ledger for audit and is the one unbounded operator-supplied string in the
   * whole lifecycle.
   */
  readonly logger?: ProjectionLogger;
  /** Optional metrics registry (QFJ-P03.07G). Defaults to discarding. */
  readonly metrics?: ProjectionMetricsRegistry;
}

/** The decision input handed to the injected authorizer. Carries no secret and no token. */
export interface ProjectionFailureAuthorizationRequest {
  readonly capability: ProjectionFailureOperationCapability;
  readonly actorType: ProjectionFailureActorType;
  readonly actorId: string;
  readonly failureId: ProjectionFailureId | null;
  readonly currentStatus: string | null;
  readonly correlationId: string;
}

/** The injected authorizer contract. A denial must be a plain `false` (or a rejected promise). */
export interface ProjectionFailureAuthorizer {
  authorize(request: ProjectionFailureAuthorizationRequest): boolean | Promise<boolean>;
}

/** Validate the operation context, failing closed with a bounded operation error. */
function validateContext(context: ProjectionFailureOperationContext): void {
  if (!isProjectionFailureActorType(context.actorType)) {
    throw new ProjectionFailureOperationError('invalid-actor');
  }
  try {
    assertBoundedText(context.actorId, B.actorId, 'actor id');
  } catch {
    throw new ProjectionFailureOperationError('invalid-actor');
  }
  try {
    assertUuid(context.correlationId, 'correlation id');
  } catch {
    throw new ProjectionFailureOperationError('invalid-correlation-id');
  }
}

/** Run the injected authorizer, translating any denial (false or throw) into a stable denial error. */
async function authorizeOrThrow(
  authorizer: ProjectionFailureAuthorizer,
  request: ProjectionFailureAuthorizationRequest,
): Promise<void> {
  let granted: boolean;
  try {
    granted = await Promise.resolve(authorizer.authorize(request));
  } catch {
    granted = false;
  }
  if (!granted) {
    throw new ProjectionFailureOperationError('authorization-denied');
  }
}

// --- Bounded inspection models ------------------------------------------------------------------

/** A bounded list item — never a payload, message, or stack. */
export interface ProjectionFailureListItem {
  readonly failureId: ProjectionFailureId;
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly projectionPosition: bigint;
  readonly category: string;
  readonly safeErrorCode: string;
  readonly status: string;
  readonly generation: number;
  readonly createdAt: Date;
}

/** A bounded inspection page with an opaque keyset cursor for the next page (null at the end). */
export interface ProjectionFailureInspectionPage {
  readonly items: readonly ProjectionFailureListItem[];
  readonly nextCursor: string | null;
}

/** A bounded blocked-checkpoint correlation summary. */
export interface BlockedCheckpointSummary {
  readonly status: string;
  readonly blockedPosition: bigint | null;
  readonly lastPosition: bigint;
  readonly failedAttemptCount: number;
  readonly lastSafeErrorCode: string | null;
}

/** A bounded final-attempt evidence summary (no raw error/stack). */
export interface FinalAttemptSummary {
  readonly attemptCount: number;
  readonly finalAttemptNumber: number | null;
  readonly finalOutcome: string | null;
  readonly finalSafeErrorCode: string | null;
}

/** A bounded action summary (closed vocabularies only). */
export interface ActionSummary {
  readonly actionType: string;
  readonly actorType: string;
  readonly occurredAt: Date;
}

/** An optional replay-authorization summary — present only when one already exists in storage. */
export interface ReplayAuthorizationSummary {
  readonly state: string;
  readonly failureGeneration: number;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

/** An optional replay-attempt summary — present only when one already exists in storage. */
export interface ReplayAttemptSummary {
  readonly attemptNumber: number;
  readonly state: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: Date;
}

/** The bounded, immutable failure detail an operator may see. Excludes all sensitive fields. */
export interface ProjectionFailureInspection {
  readonly failureId: ProjectionFailureId;
  readonly projectionName: string;
  readonly projectionVersion: number;
  readonly projectionPosition: bigint;
  readonly eventStorageSequence: bigint;
  readonly category: string;
  readonly safeErrorCode: string;
  readonly detailDigest: string | null;
  readonly status: string;
  readonly generation: number;
  readonly automaticAttemptCount: number;
  readonly replayAttemptCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly firstFailedAt: Date;
  readonly lastFailedAt: Date;
  readonly checkpoint: BlockedCheckpointSummary;
  readonly finalAttempt: FinalAttemptSummary;
  readonly divergences: readonly ProjectionFailureDivergenceCode[];
  readonly actionCount: number;
  readonly recentActions: readonly ActionSummary[];
  readonly activeReplayAuthorization: ReplayAuthorizationSummary | null;
  readonly liveReplayAttempt: ReplayAttemptSummary | null;
}

/** The bounded outcome of an acknowledge/quarantine mutation. */
export interface ProjectionFailureMutationOutcome {
  readonly failureId: ProjectionFailureId;
  readonly status: string;
  readonly generation: number;
  readonly actionType: string;
  readonly actionId: ProjectionFailureActionId;
  readonly idempotent: boolean;
}

// --- Pagination ---------------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_RECENT_ACTIONS = 10;

function resolvePageSize(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested <= 0 || requested > MAX_PAGE_SIZE) {
    throw new ProjectionFailureOperationError('invalid-page-size');
  }
  return requested;
}

/** Encode a stable keyset cursor. Opaque to the caller; decoded only here. */
function encodeCursor(row: ProjectionFailureRow): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.failureId}`, 'utf8').toString(
    'base64url',
  );
}

interface DecodedCursor {
  readonly createdAt: Date;
  readonly failureId: ProjectionFailureId;
}

function decodeCursor(cursor: string | undefined): DecodedCursor | undefined {
  if (cursor === undefined) return undefined;
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new ProjectionFailureOperationError('invalid-cursor');
  }
  const separator = decoded.indexOf('|');
  if (separator <= 0) throw new ProjectionFailureOperationError('invalid-cursor');
  const isoPart = decoded.slice(0, separator);
  const idPart = decoded.slice(separator + 1);
  const createdAt = new Date(isoPart);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== isoPart) {
    throw new ProjectionFailureOperationError('invalid-cursor');
  }
  let failureId: string;
  try {
    failureId = assertUuid(idPart, 'cursor failure id');
  } catch {
    throw new ProjectionFailureOperationError('invalid-cursor');
  }
  return { createdAt, failureId: failureId as ProjectionFailureId };
}

// --- Filters ------------------------------------------------------------------------------------

export interface ProjectionFailureListQuery {
  readonly name?: string;
  readonly version?: number;
  readonly status?: string;
  readonly category?: string;
  readonly createdBefore?: Date;
  readonly createdAfter?: Date;
  readonly activeOnly?: boolean;
  readonly pageSize?: number;
  readonly cursor?: string;
}

function validateFilters(query: ProjectionFailureListQuery): void {
  if (query.status !== undefined && !isProjectionFailureStatus(query.status)) {
    throw new ProjectionFailureOperationError('invalid-filter');
  }
  if (query.category !== undefined && !isProjectionFailureCategory(query.category)) {
    throw new ProjectionFailureOperationError('invalid-filter');
  }
  if (query.version !== undefined && (!Number.isInteger(query.version) || query.version <= 0)) {
    throw new ProjectionFailureOperationError('invalid-filter');
  }
  if (query.name !== undefined) {
    // A name that is not a valid projection name is a closed-vocabulary violation, not a scan filter.
    if (typeof query.name !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(query.name)) {
      throw new ProjectionFailureOperationError('invalid-filter');
    }
  }
}

// --- List inspection ----------------------------------------------------------------------------

/**
 * List projection failures for inspection with bounded keyset pagination (created_at DESC,
 * failure_id DESC). Requires the inspect capability. Applies only closed, validated filters; rejects an
 * oversized page size and a malformed cursor; never returns a payload, message, or stack.
 */
export async function listProjectionFailuresForInspection(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  query: ProjectionFailureListQuery = {},
): Promise<ProjectionFailureInspectionPage> {
  validateContext(context);
  await authorizeOrThrow(authorizer, {
    capability: 'projection-failure:inspect',
    actorType: context.actorType,
    actorId: context.actorId,
    failureId: null,
    currentStatus: null,
    correlationId: context.correlationId,
  });
  const pageSize = resolvePageSize(query.pageSize);
  validateFilters(query);
  const cursor = decodeCursor(query.cursor);

  const rows = await readInTransaction(pool, (client) =>
    listProjectionFailuresKeyset(client, {
      name: query.name as ProjectionName | undefined,
      version: query.version,
      status: query.status,
      category: query.category,
      createdBefore: query.createdBefore,
      createdAfter: query.createdAfter,
      activeOnly: query.activeOnly,
      cursorCreatedAt: cursor?.createdAt,
      cursorFailureId: cursor?.failureId,
      // Fetch one extra row to decide whether a next page exists, without a second query.
      limit: pageSize + 1,
    }),
  );

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last !== undefined ? encodeCursor(last) : null;
  return Object.freeze({
    items: page.map(toListItem),
    nextCursor,
  });
}

function toListItem(row: ProjectionFailureRow): ProjectionFailureListItem {
  return Object.freeze({
    failureId: row.failureId,
    projectionName: row.projectionName,
    projectionVersion: row.projectionVersion,
    projectionPosition: row.projectionPosition,
    category: row.category,
    safeErrorCode: row.safeErrorCode,
    status: row.status,
    generation: row.generation,
    createdAt: row.createdAt,
  });
}

// --- Detail inspection --------------------------------------------------------------------------

/** Divergences that concern this exact failure or its projection (name+version). */
function relevantDivergences(
  divergences: readonly ProjectionFailureDivergence[],
  failure: ProjectionFailureRow,
): ProjectionFailureDivergenceCode[] {
  return divergences
    .filter(
      (d) =>
        d.failureId === failure.failureId ||
        (d.projectionName === failure.projectionName &&
          d.projectionVersion === failure.projectionVersion),
    )
    .map((d) => d.code);
}

/**
 * Inspect one projection failure, returning a bounded immutable detail model over a single read
 * transaction. Requires the inspect capability. Fails closed with `failure-not-found` when the failure
 * does not exist and with `divergence-detected` when the failure is active but its checkpoint/attempt/
 * authorization correlation diverges — it never auto-repairs and never presents a diverged active
 * failure as healthy detail (use {@link inspectProjectionFailureDivergence} to enumerate the codes).
 */
export async function inspectProjectionFailure(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  input: { readonly failureId: ProjectionFailureId },
): Promise<ProjectionFailureInspection> {
  validateContext(context);
  assertOperationUuid(input.failureId);
  return readInTransaction(pool, async (client) => {
    const failure = await readProjectionFailureById(client, input.failureId);
    await authorizeOrThrow(authorizer, {
      capability: 'projection-failure:inspect',
      actorType: context.actorType,
      actorId: context.actorId,
      failureId: input.failureId,
      currentStatus: failure?.status ?? null,
      correlationId: context.correlationId,
    });
    if (failure === null) throw new ProjectionFailureOperationError('failure-not-found');

    const isActive =
      failure.status !== 'resolved' &&
      failure.status !== 'superseded' &&
      failure.status !== 'retired';

    const divergences = relevantDivergences(
      await detectProjectionFailureDivergences(client),
      failure,
    );
    if (isActive && divergences.length > 0) {
      throw new ProjectionFailureOperationError('divergence-detected');
    }

    const checkpoint = await readCheckpoint(client, {
      name: failure.projectionName as ProjectionName,
      version: failure.projectionVersion,
    });
    const attempts = await readAttemptsForEvent(client, {
      name: failure.projectionName as ProjectionName,
      version: failure.projectionVersion,
      eventPosition: failure.projectionPosition,
    });
    const actions = await readProjectionFailureActions(client, failure.failureId);
    const authorization = await readActiveReplayAuthorization(client, failure.failureId);
    const liveAttempt = await readLiveReplayAttempt(client, failure.failureId);

    const finalAttempt = attempts[attempts.length - 1];
    return Object.freeze({
      failureId: failure.failureId,
      projectionName: failure.projectionName,
      projectionVersion: failure.projectionVersion,
      projectionPosition: failure.projectionPosition,
      eventStorageSequence: failure.eventStorageSequence,
      category: failure.category,
      safeErrorCode: failure.safeErrorCode,
      detailDigest: failure.detailDigest,
      status: failure.status,
      generation: failure.generation,
      automaticAttemptCount: failure.automaticAttemptCount,
      replayAttemptCount: failure.replayAttemptCount,
      createdAt: failure.createdAt,
      updatedAt: failure.updatedAt,
      firstFailedAt: failure.firstFailedAt,
      lastFailedAt: failure.lastFailedAt,
      checkpoint: Object.freeze({
        status: checkpoint?.status ?? 'absent',
        blockedPosition: checkpoint?.blockedPosition ?? null,
        lastPosition: checkpoint?.lastPosition ?? 0n,
        failedAttemptCount: checkpoint?.failedAttemptCount ?? 0,
        lastSafeErrorCode: checkpoint?.lastSafeErrorCode ?? null,
      }),
      finalAttempt: Object.freeze({
        attemptCount: attempts.length,
        finalAttemptNumber: finalAttempt?.attemptNumber ?? null,
        finalOutcome: finalAttempt?.outcome ?? null,
        finalSafeErrorCode: finalAttempt?.safeErrorCode ?? null,
      }),
      divergences: Object.freeze(divergences),
      actionCount: actions.length,
      recentActions: Object.freeze(
        actions.slice(-MAX_RECENT_ACTIONS).map((a) =>
          Object.freeze({
            actionType: a.actionType,
            actorType: a.actorType,
            occurredAt: a.occurredAt,
          }),
        ),
      ),
      activeReplayAuthorization:
        authorization === null
          ? null
          : Object.freeze({
              state: authorization.state,
              failureGeneration: authorization.failureGeneration,
              createdAt: authorization.createdAt,
              expiresAt: authorization.expiresAt,
            }),
      liveReplayAttempt:
        liveAttempt === null
          ? null
          : Object.freeze({
              attemptNumber: liveAttempt.attemptNumber,
              state: liveAttempt.state,
              leaseOwner: liveAttempt.leaseOwner,
              leaseExpiresAt: liveAttempt.leaseExpiresAt,
            }),
    });
  });
}

// --- Action-history inspection ------------------------------------------------------------------

/** A bounded, immutable action-history record (closed vocabularies; bounded attribution). */
export interface ProjectionFailureActionView {
  readonly actionType: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/**
 * Read the append-only action history for one failure, filtered strictly by failure id, in
 * deterministic chronological order. Requires the inspect capability. Read-only; never mutates the
 * ledger and never exposes a generic ledger repository.
 */
export async function inspectProjectionFailureHistory(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  input: { readonly failureId: ProjectionFailureId },
): Promise<readonly ProjectionFailureActionView[]> {
  validateContext(context);
  assertOperationUuid(input.failureId);
  return readInTransaction(pool, async (client) => {
    const failure = await readProjectionFailureById(client, input.failureId);
    await authorizeOrThrow(authorizer, {
      capability: 'projection-failure:inspect',
      actorType: context.actorType,
      actorId: context.actorId,
      failureId: input.failureId,
      currentStatus: failure?.status ?? null,
      correlationId: context.correlationId,
    });
    if (failure === null) throw new ProjectionFailureOperationError('failure-not-found');
    const actions = await readProjectionFailureActions(client, failure.failureId);
    return Object.freeze(
      actions.map((a) =>
        Object.freeze({
          actionType: a.actionType,
          actorType: a.actorType,
          actorId: a.actorId,
          reason: a.reason,
          occurredAt: a.occurredAt,
        }),
      ),
    );
  });
}

// --- Divergence inspection ----------------------------------------------------------------------

/**
 * Report persistence/checkpoint divergences (fail-closed; never repairs). Requires the inspect
 * capability. When a `failureId` is supplied, only divergences concerning that failure or its
 * projection are returned; otherwise the full closed-code list is returned.
 */
export async function inspectProjectionFailureDivergence(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  input: { readonly failureId?: ProjectionFailureId } = {},
): Promise<readonly ProjectionFailureDivergence[]> {
  validateContext(context);
  if (input.failureId !== undefined) assertOperationUuid(input.failureId);
  await authorizeOrThrow(authorizer, {
    capability: 'projection-failure:inspect',
    actorType: context.actorType,
    actorId: context.actorId,
    failureId: input.failureId ?? null,
    currentStatus: null,
    correlationId: context.correlationId,
  });
  return readInTransaction(pool, async (client) => {
    const all = await detectProjectionFailureDivergences(client);
    if (input.failureId === undefined) return all;
    const failure = await readProjectionFailureById(client, input.failureId);
    if (failure === null) throw new ProjectionFailureOperationError('failure-not-found');
    const codes = new Set(relevantDivergences(all, failure));
    return all.filter(
      (d) =>
        codes.has(d.code) &&
        (d.failureId === failure.failureId ||
          (d.projectionName === failure.projectionName &&
            d.projectionVersion === failure.projectionVersion)),
    );
  });
}

// --- Mutations: acknowledge / quarantine --------------------------------------------------------

export interface FailureMutationInput {
  readonly failureId: ProjectionFailureId;
  readonly expectedGeneration: number;
  readonly reason?: string | null;
  readonly now: Date;
}

/** The deterministic idempotency key for an operator mutation (stable identity only). */
function mutationIdempotencyKey(
  operation: 'acknowledge' | 'quarantine',
  failureId: ProjectionFailureId,
  expectedGeneration: number,
): string {
  return `${operation}-failure:${failureId}:g${String(expectedGeneration)}`;
}

function validateMutationInput(input: FailureMutationInput): string | null {
  assertOperationUuid(input.failureId);
  if (!Number.isInteger(input.expectedGeneration) || input.expectedGeneration < 0) {
    throw new ProjectionFailureOperationError('stale-generation');
  }
  if (input.reason === null || input.reason === undefined) return null;
  try {
    return assertBoundedText(input.reason, B.reason, 'reason');
  } catch {
    throw new ProjectionFailureOperationError('invalid-reason');
  }
}

/**
 * Acknowledge an OPEN failure (operator review). Authorized, generation-guarded, idempotent, and atomic
 * (status transition open→acknowledged plus exactly one `acknowledged` action in one transaction). The
 * blocked checkpoint, blocked position, `last_position`, and every attempt are untouched. No replay is
 * authorized or executed.
 */
export function acknowledgeProjectionFailureOperation(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  input: FailureMutationInput,
): Promise<ProjectionFailureMutationOutcome> {
  return runMutation(pool, authorizer, context, input, {
    operation: 'acknowledge',
    capability: 'projection-failure:acknowledge',
    actionType: 'acknowledged',
    targetStatus: 'acknowledged',
    fromStatuses: ['open'],
    alreadyCode: 'already-acknowledged',
    runDivergenceGate: false,
  });
}

/**
 * Quarantine an OPEN or ACKNOWLEDGED failure (isolate for controlled handling; never skips, never
 * advances). Authorized, generation-guarded, idempotent, atomic, and gated on the fail-closed
 * divergence detector. Preserves the blocked checkpoint, blocked position, `last_position`, every
 * attempt, the failure identity, the event storage sequence, and the action history. Never resolves,
 * supersedes, retires, skips, authorizes replay, or executes replay.
 */
export function quarantineProjectionFailureOperation(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  input: FailureMutationInput,
): Promise<ProjectionFailureMutationOutcome> {
  return runMutation(pool, authorizer, context, input, {
    operation: 'quarantine',
    capability: 'projection-failure:quarantine',
    actionType: 'quarantined',
    targetStatus: 'quarantined',
    fromStatuses: ['open', 'acknowledged'],
    alreadyCode: 'already-quarantined',
    runDivergenceGate: true,
  });
}

interface MutationSpec {
  readonly operation: 'acknowledge' | 'quarantine';
  readonly capability: ProjectionFailureOperationCapability;
  readonly actionType: 'acknowledged' | 'quarantined';
  readonly targetStatus: string;
  readonly fromStatuses: readonly string[];
  readonly alreadyCode: ProjectionFailureOperationErrorCode;
  readonly runDivergenceGate: boolean;
}

async function runMutation(
  pool: DatabasePool,
  authorizer: ProjectionFailureAuthorizer,
  context: ProjectionFailureOperationContext,
  input: FailureMutationInput,
  spec: MutationSpec,
): Promise<ProjectionFailureMutationOutcome> {
  validateContext(context);
  const reason = validateMutationInput(input);
  const idempotencyKey = mutationIdempotencyKey(
    spec.operation,
    input.failureId,
    input.expectedGeneration,
  );

  // Captured inside the transaction, emitted after it commits (QFJ-P03.07G).
  let observedIdentity: ProjectionLogIdentity | null = null;

  try {
    const outcome = await withTransaction(pool, async (client) => {
      // Lock the row first so a concurrent mutation serialises behind us; then authorize with the real
      // current status. Authorization runs even when the failure is absent (currentStatus null) so an
      // unauthorized caller cannot probe existence.
      const failure = await readProjectionFailureByIdForUpdate(client, input.failureId);
      if (failure !== null) {
        // Captured for POST-COMMIT observability. Recording only; nothing is emitted inside the
        // transaction.
        observedIdentity = {
          projectionName: failure.projectionName as ProjectionName,
          projectionVersion: failure.projectionVersion,
        };
      }
      await authorizeOrThrow(authorizer, {
        capability: spec.capability,
        actorType: context.actorType,
        actorId: context.actorId,
        failureId: input.failureId,
        currentStatus: failure?.status ?? null,
        correlationId: context.correlationId,
      });
      if (failure === null) throw new ProjectionFailureOperationError('failure-not-found');

      // Idempotency: this exact operation (same target + generation) already committed its action.
      const existing = await readProjectionFailureActionByIdempotencyKey(client, idempotencyKey);
      if (existing !== null) {
        return Object.freeze({
          failureId: failure.failureId,
          status: failure.status,
          generation: failure.generation,
          actionType: existing.actionType,
          actionId: existing.actionId,
          idempotent: true,
        });
      }

      if (failure.generation !== input.expectedGeneration) {
        throw new ProjectionFailureOperationError('stale-generation');
      }
      if (failure.status === spec.targetStatus) {
        // Already in the target lifecycle state (acknowledged/quarantined) under a different key.
        throw new ProjectionFailureOperationError(spec.alreadyCode);
      }
      if (!spec.fromStatuses.includes(failure.status)) {
        throw new ProjectionFailureOperationError('invalid-transition');
      }

      if (spec.runDivergenceGate) {
        const divergences = relevantDivergences(
          await detectProjectionFailureDivergences(client),
          failure,
        );
        if (divergences.length > 0) {
          throw new ProjectionFailureOperationError('divergence-detected');
        }
      }

      const transition =
        spec.operation === 'acknowledge'
          ? acknowledgeProjectionFailure
          : quarantineProjectionFailure;
      const updated = await transition(client, {
        failureId: failure.failureId,
        actorId: context.actorId,
        at: input.now,
        now: input.now,
        expectedGeneration: input.expectedGeneration,
      });

      const actionId = randomUUID() as ProjectionFailureActionId;
      const action = await appendProjectionFailureAction(client, {
        actionId,
        failureId: failure.failureId,
        actionType: spec.actionType,
        actorType: context.actorType,
        actorId: context.actorId,
        reason,
        idempotencyKey,
        expectedGeneration: input.expectedGeneration,
        resultingGeneration: updated.generation,
        occurredAt: input.now,
      });

      return Object.freeze({
        failureId: updated.failureId,
        status: updated.status,
        generation: updated.generation,
        actionType: action.actionType,
        actionId: action.actionId,
        idempotent: false,
      });
    });
    // Reached ONLY after the transaction committed. A replayed (idempotent) call emits nothing: the
    // lifecycle transition it describes was already reported by the call that actually performed it.
    if (!outcome.idempotent) {
      emitMutationTelemetry(context, spec, observedIdentity, outcome);
    }
    return outcome;
  } catch (error: unknown) {
    if (error instanceof ProjectionFailureOperationError) throw error;
    // Any other failure (including an ambiguous COMMIT) fails closed as commit-outcome-unknown; the
    // caller re-invokes with the SAME idempotency key and the action ledger reconciles the truth.
    throw new ProjectionFailureOperationError('commit-outcome-unknown');
  }
}

/**
 * Emit the post-commit observability for an operator mutation (QFJ-P03.07G).
 *
 * Carries the bounded actor attribution the action ledger already persists — and deliberately NOT the
 * operator's free-text reason. Wholly guarded: the mutation has committed, so telemetry must not be
 * able to turn a successful operation into a thrown error.
 */
function emitMutationTelemetry(
  context: ProjectionFailureOperationContext,
  spec: MutationSpec,
  identity: ProjectionLogIdentity | null,
  outcome: ProjectionFailureMutationOutcome,
): void {
  if (identity === null) return;
  const logger = context.logger ?? NOOP_PROJECTION_LOGGER;
  try {
    logger.projectionEvent(
      identity,
      spec.operation === 'acknowledge'
        ? {
            event: 'projection.failure.acknowledged',
            failureId: outcome.failureId,
            actorType: context.actorType,
            actorId: context.actorId,
            resultingGeneration: outcome.generation,
          }
        : {
            event: 'projection.failure.quarantined',
            failureId: outcome.failureId,
            actorType: context.actorType,
            actorId: context.actorId,
            resultingGeneration: outcome.generation,
          },
    );
  } catch {
    // Swallowed without inspection.
  }
}

// --- Shared helpers -----------------------------------------------------------------------------

function assertOperationUuid(value: unknown): void {
  try {
    assertUuid(value, 'failure id');
  } catch {
    throw new ProjectionFailureOperationError('failure-not-found');
  }
}

/** Run a read-only callback inside one transaction, translating unknown failures to a stable code. */
async function readInTransaction<T>(
  pool: DatabasePool,
  callback: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  try {
    return await withTransaction(pool, callback);
  } catch (error: unknown) {
    if (error instanceof ProjectionFailureOperationError) throw error;
    throw new ProjectionFailureOperationError('repository-unavailable');
  }
}

// Re-export the operation error surface for callers that catch it (internal only).
export {
  ProjectionFailureOperationError,
  isProjectionFailureOperationError,
  PROJECTION_FAILURE_OPERATION_ERROR_CODES,
  type ProjectionFailureOperationErrorCode,
} from './projection-failure-operations-errors.js';
