/**
 * The durable approval queue (QFJ-P08, ADR-0081).
 *
 * PostgreSQL durability for the approval-runtime foundation, and exactly one coordination
 * invariant on top of it.
 *
 * ### The invariant, and why it exists
 *
 * `ApprovalDecisionV1` carries no `approvalRequestId` — deliberately, because Core answers about a
 * recommendation's actions, not about Jarvis's bookkeeping. If two unanswered asks for the same
 * (recommendation, action) could be open at once, an arriving decision would be ambiguous between
 * them and nothing in the artifacts could resolve it. So the ambiguity is made unrepresentable: at
 * most ONE active ask per action, enforced by a per-key row lock on the slot table.
 *
 * ### There is no local authority
 *
 * No `status`, no `pending`, no `approved`, no `isAuthorized`. A request exists; a decision may
 * exist; a link may exist. "Active" is derived at a caller-supplied observation instant, never
 * stored — a stored `pending` goes stale silently, and a stale `pending` in Jarvis is precisely the
 * authorization state ADR-0002 puts in Core.
 *
 * ### Nothing here reimplements an approval semantic
 *
 * Faithfulness is proved by REBUILDING through the public `@qf-jarvis/approval-runtime`, and
 * decisions are correlated by calling its `validateDecision`. A second definition of the approval
 * rules living in a storage adapter is a definition free to drift from the one that governs.
 *
 * It reads no clock, calls no Core, emits no event, and creates no execution intent.
 */
import {
  approvalDecisionV1Schema,
  approvalRequestIdSchema,
  approvalRequestV1Schema,
} from '@qf-jarvis/contracts';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';
import type { Pool, PoolClient } from 'pg';

import { PostgresApprovalQueueError, classifyDatabaseError } from '../contracts/errors.js';
import type {
  ApprovalQueueActiveEntry,
  ApprovalQueueAuditRecord,
  ApprovalQueueEnqueueResult,
  ApprovalQueueRecordDecisionResult,
  ApprovalQueueRequestRecord,
  PostgresApprovalQueue,
} from '../contracts/api.js';
import {
  asRuntimeResult,
  assertFaithfulRequest,
  canonicalSourceJson,
  canonicalizeSource,
  deepEquals,
} from '../internal/canonicalize.js';
import type { CanonicalSource } from '../internal/canonicalize.js';
import { assertQueueReady } from '../internal/readiness.js';
import {
  CLEAR_SLOT_POINTER,
  INSERT_AUDIT,
  INSERT_DECISION,
  INSERT_LINK,
  INSERT_REQUEST,
  INSERT_SLOT,
  SELECT_ACTIVE_REQUESTS,
  SELECT_AUDIT_FOR_REQUEST,
  SELECT_DECISION,
  SELECT_LINK,
  SELECT_REQUEST,
  SELECT_REQUEST_FOR_UPDATE,
  SELECT_SLOT_FOR_UPDATE,
  UPDATE_SLOT_POINTER,
  withQueueTransaction,
} from '../internal/sql.js';

/** A private sentinel: a concurrent session claimed this identity while we were writing. */
class DuplicateRace extends Error {
  constructor() {
    super('duplicate-race');
    this.name = 'DuplicateRace';
  }
}

function invariant(): never {
  throw new PostgresApprovalQueueError('repository-invariant');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored row rebuilt into its two governed artifacts, both re-validated. */
interface StoredRequest {
  readonly request: ApprovalRequestV1;
  readonly canonical: CanonicalSource;
}

/**
 * Rebuild a stored request row.
 *
 * Every row is treated as untrusted structural input. "The CHECK constraints prevent that" is a
 * claim about a schema this process has not verified it is connected to — a partially applied
 * migration, a restore from an older dump or a hand-corrected row all arrive here looking exactly
 * like data. And this is durable evidence a later audit will be read against, so a malformed row
 * becomes a refusal rather than a confident answer.
 */
function rebuildStoredRequest(row: unknown): StoredRequest {
  if (!isRecord(row)) {
    return invariant();
  }
  const parsed = approvalRequestV1Schema.safeParse(row['request_payload']);
  if (!parsed.success) {
    return invariant();
  }
  let canonical: CanonicalSource;
  try {
    // Re-canonicalized, not merely re-read: the fingerprints are recomputed from the stored
    // recommendation, so a source edited in place after storage is caught here.
    canonical = canonicalizeSource(row['source_snapshot']);
  } catch {
    return invariant();
  }
  return { request: parsed.data, canonical };
}

/** Read one request row and rebuild it, or `undefined` when there is none. */
async function loadRequest(
  client: PoolClient,
  approvalRequestId: string,
  statement: string,
): Promise<StoredRequest | undefined> {
  const result = await client.query(statement, [approvalRequestId]);
  const row: unknown = result.rows[0];
  return row === undefined ? undefined : rebuildStoredRequest(row);
}

/**
 * The exact identity of an approval-request id, before any SQL runs.
 *
 * A wildcard, a `latest` or a fragment is not a query a database should be asked to interpret --
 * and a malformed UUID reaching a `WHERE ... = $1` on a UUID column would surface as a driver error
 * rather than as the refusal it is.
 */
function validRequestId(value: unknown): string {
  const parsed = approvalRequestIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new PostgresApprovalQueueError('invalid-input');
  }
  return parsed.data;
}

/** Build a durable approval queue over an injected pool. The caller owns the pool. */
export function createPostgresApprovalQueue(config: {
  readonly pool: Pool;
}): PostgresApprovalQueue {
  // Typed `unknown` at the check: the declared parameter says a pool is present, but this is a
  // package boundary and an untyped caller -- or a bare Pool passed instead of `{ pool }` -- would
  // otherwise reach the first query as `undefined`.
  const supplied: unknown = config;
  if (
    !isRecord(supplied) ||
    supplied['pool'] === undefined ||
    supplied['pool'] === null ||
    typeof (supplied['pool'] as { query?: unknown }).query !== 'function'
  ) {
    throw new PostgresApprovalQueueError('invalid-input');
  }
  const pool = supplied['pool'] as Pool;

  async function assertReady(): Promise<void> {
    await assertQueueReady(pool);
  }

  /**
   * Durably enqueue one ask.
   *
   * Order, and why each step is where it is:
   *
   * 1. canonicalize and re-prove the ask BEFORE any SQL, so an invalid one never reaches a
   *    connection;
   * 2. lock the ONE slot row for this action. This is what serialises concurrent asks for the same
   *    action, what leaves different actions completely independent, and what makes every read
   *    below authoritative rather than racy;
   * 3. look for the request id -- an exact replay must return the stored original rather than being
   *    re-decided, because that is the crash-recovery case;
   * 4. compare the incumbent's expiry to the INCOMING request's `createdAt` -- a causal instant the
   *    caller stated, never a clock this process read;
   * 5. write the request, move the pointer, append the audit, all in one transaction.
   */
  async function enqueueRequest(input: unknown): Promise<ApprovalQueueEnqueueResult> {
    if (!isRecord(input)) {
      throw new PostgresApprovalQueueError('invalid-input');
    }
    const parsedRequest = approvalRequestV1Schema.safeParse(input['request']);
    if (!parsedRequest.success) {
      throw new PostgresApprovalQueueError('invalid-input');
    }
    const request = parsedRequest.data;
    // Canonicalize the source and prove the ask is exactly what the runtime would have built. Both
    // throw `binding-invalid`, and both happen before a connection is requested.
    const canonical = canonicalizeSource(input['source']);
    assertFaithfulRequest(canonical, request);

    const sourceJson = canonicalSourceJson(canonical);

    try {
      return await withQueueTransaction(pool, async (client) => {
        // 2. The coordination slot FIRST. Creating it is racy and harmless; the lock is not.
        //
        //    The lock is taken BEFORE the request lookup on purpose. Reading the request first
        //    would make the duplicate check racy: two sessions replaying the same ask would both
        //    see nothing, and the loser would then meet its OWN request sitting in the slot and
        //    report `active-request-conflict` -- an exact replay misreported as an overlap. Inside
        //    the lock, every read below is authoritative.
        await client.query(INSERT_SLOT, [request.recommendationId, request.proposedActionId]);
        const slotResult = await client.query(SELECT_SLOT_FOR_UPDATE, [
          request.recommendationId,
          request.proposedActionId,
        ]);
        const slotRow: unknown = slotResult.rows[0];
        if (!isRecord(slotRow)) {
          // Inserted-or-existing, then absent. Nothing in this schema permits that.
          return invariant();
        }

        // 3. Exact replay, or the same id naming a different ask.
        const existing = await loadRequest(client, request.approvalRequestId, SELECT_REQUEST);
        if (existing !== undefined) {
          if (
            !deepEquals(existing.request, request) ||
            !deepEquals(canonicalSourceJson(existing.canonical), sourceJson)
          ) {
            throw new PostgresApprovalQueueError('request-conflict');
          }
          // Read-only. No second audit row, no slot movement: nothing happened this time.
          return Object.freeze({ outcome: 'REPLAYED' as const, request: existing.request });
        }

        const incumbentId: unknown = slotRow['active_approval_request_id'];

        if (typeof incumbentId === 'string') {
          const incumbent = await loadRequest(client, incumbentId, SELECT_REQUEST);
          if (incumbent === undefined) {
            // The slot points at a request that does not exist. The foreign key forbids it.
            return invariant();
          }
          const linked = await client.query(SELECT_LINK, [incumbentId]);
          if (linked.rows.length > 0) {
            // A decided ask must have had its pointer cleared in the same transaction that linked
            // it. A slot still pointing at one means the two disagree.
            return invariant();
          }

          // 4. Expiry, at the incoming ask's own causal instant. READ NO CLOCK: comparing against
          //    `now` would make the same pair of asks succeed or fail depending on when the process
          //    happened to run them, and would make a replayed sequence non-deterministic.
          if (incumbent.request.expiresAt > request.createdAt) {
            throw new PostgresApprovalQueueError('active-request-conflict');
          }

          // The incumbent had already expired when this ask was made, so it may be replaced. Record
          // the observation once, so an auditor can see WHY the slot moved.
          await client.query(INSERT_AUDIT, [
            'REQUEST_EXPIRY_OBSERVED',
            incumbent.request.approvalRequestId,
            null,
            incumbent.request.recommendationId,
            incumbent.request.proposedActionId,
          ]);
        }

        // 5. Write.
        const inserted = await client.query(INSERT_REQUEST, [
          request.approvalRequestId,
          request.recommendationId,
          request.proposedActionId,
          request.actionFingerprint,
          request.createdAt,
          request.expiresAt,
          request,
          sourceJson,
        ]);
        if (inserted.rowCount !== 1) {
          // Another session claimed this id between the lookup above and here. Roll the WHOLE
          // transaction back and reconcile afterwards against the row that actually won.
          throw new DuplicateRace();
        }

        await client.query(UPDATE_SLOT_POINTER, [
          request.recommendationId,
          request.proposedActionId,
          request.approvalRequestId,
        ]);

        await client.query(INSERT_AUDIT, [
          'REQUEST_ENQUEUED',
          request.approvalRequestId,
          null,
          request.recommendationId,
          request.proposedActionId,
        ]);

        return Object.freeze({ outcome: 'CREATED' as const, request });
      });
    } catch (error) {
      // THE classification boundary. `withQueueTransaction` rethrows the callback's error
      // unclassified precisely so the sentinel is still recognisable here; classify first and an
      // ordinary duplicate race becomes an invented database fault (the QFJ-P08-B2 lesson).
      if (!(error instanceof DuplicateRace)) {
        throw classifyDatabaseError(error);
      }
    }

    // Reconciliation after a rolled-back duplicate race. Nothing is decided here, only read.
    return reconcileEnqueue(request, sourceJson);
  }

  async function reconcileEnqueue(
    request: ApprovalRequestV1,
    sourceJson: Record<string, unknown>,
  ): Promise<ApprovalQueueEnqueueResult> {
    let row: unknown;
    try {
      row = (await pool.query(SELECT_REQUEST, [request.approvalRequestId])).rows[0];
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    if (row === undefined) {
      return invariant();
    }
    const winner = rebuildStoredRequest(row);
    if (
      !deepEquals(winner.request, request) ||
      !deepEquals(canonicalSourceJson(winner.canonical), sourceJson)
    ) {
      throw new PostgresApprovalQueueError('request-conflict');
    }
    return Object.freeze({ outcome: 'REPLAYED' as const, request: winner.request });
  }

  async function readRequest(approvalRequestId: string): Promise<ApprovalQueueRequestRecord> {
    const id = validRequestId(approvalRequestId);
    let row: unknown;
    try {
      row = (await pool.query(SELECT_REQUEST, [id])).rows[0];
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    if (row === undefined) {
      throw new PostgresApprovalQueueError('request-not-found');
    }
    const stored = rebuildStoredRequest(row);
    return Object.freeze({
      request: stored.request,
      source: asRuntimeResult(stored.canonical),
    });
  }

  async function listActiveRequests(input: unknown): Promise<readonly ApprovalQueueActiveEntry[]> {
    if (!isRecord(input)) {
      throw new PostgresApprovalQueueError('invalid-input');
    }
    const observedAt: unknown = input['observedAt'];
    const limit: unknown = input['limit'];
    if (
      typeof observedAt !== 'string' ||
      observedAt.length === 0 ||
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      throw new PostgresApprovalQueueError('invalid-input');
    }

    let rows: unknown[];
    try {
      rows = (await pool.query(SELECT_ACTIVE_REQUESTS, [observedAt, limit])).rows;
    } catch (error) {
      throw classifyDatabaseError(error);
    }

    return Object.freeze(
      rows.map((row): ApprovalQueueActiveEntry => {
        if (!isRecord(row)) {
          return invariant();
        }
        const parsed = approvalRequestV1Schema.safeParse(row['request_payload']);
        if (!parsed.success) {
          return invariant();
        }
        const request = parsed.data;
        // A minimal projection. The rationale, the evidence and the action's governed parameters are
        // deliberately absent: a queue listing is read far more often than it is acted on, and every
        // field it carries ends up in a log, a screenshot or a support ticket.
        return Object.freeze({
          approvalRequestId: request.approvalRequestId,
          recommendationId: request.recommendationId,
          proposedActionId: request.proposedActionId,
          createdAt: request.createdAt,
          expiresAt: request.expiresAt,
          requestedAuthority: request.requestedAuthority,
          risk: request.risk,
          requestingAgent: request.requestingAgent,
          requestingAgentVersion: request.requestingAgentVersion,
          summary: request.summary,
          policy: Object.freeze({ ...request.policy }),
          correlationId: request.correlationId,
        });
      }),
    );
  }

  /**
   * Durably record a decision Core has ALREADY issued.
   *
   * The correlation itself is the public approval runtime's, computed from the PERSISTED source and
   * request rather than from anything the caller supplied alongside the decision. That is what makes
   * the anti-substitution control survive storage: the fingerprint is recomputed from the
   * recommendation as it was stored, and a decision whose action content has since changed fails.
   */
  async function recordDecision(input: unknown): Promise<ApprovalQueueRecordDecisionResult> {
    if (!isRecord(input)) {
      throw new PostgresApprovalQueueError('invalid-input');
    }
    const approvalRequestId = validRequestId(input['approvalRequestId']);
    const parsedDecision = approvalDecisionV1Schema.safeParse(input['decision']);
    if (!parsedDecision.success) {
      // A malformed decision is refused before any SQL. It is never reconstructed or normalized:
      // the contract is what proves `issuer` is Core and that `decidedBy` is not an agent.
      throw new PostgresApprovalQueueError('invalid-input');
    }
    const decision = parsedDecision.data;

    try {
      return await withQueueTransaction(pool, async (client) => {
        const stored = await loadRequest(client, approvalRequestId, SELECT_REQUEST_FOR_UPDATE);
        if (stored === undefined) {
          throw new PostgresApprovalQueueError('request-not-found');
        }

        // Already answered? An exact replay returns the same observation and writes nothing.
        const linkRow: unknown = (await client.query(SELECT_LINK, [approvalRequestId])).rows[0];
        if (isRecord(linkRow)) {
          if (linkRow['decision_id'] !== decision.decisionId) {
            throw new PostgresApprovalQueueError('request-already-decided');
          }
          const storedDecision = await loadDecision(client, decision.decisionId);
          if (storedDecision === undefined || !deepEquals(storedDecision, decision)) {
            // Same id, different content -- the stored decision and this one disagree.
            throw new PostgresApprovalQueueError('decision-conflict');
          }
          return Object.freeze({
            outcome: 'REPLAYED' as const,
            correlation: correlate(stored, storedDecision),
          });
        }

        // The correlation, through the PUBLIC runtime, against the PERSISTED source and request.
        const correlation = correlate(stored, decision);

        // The decision row. One per Core decision even when it answers several actions: copies
        // could diverge, and the link table is what expresses the one-to-many.
        const existingDecision = await loadDecision(client, decision.decisionId);
        if (existingDecision === undefined) {
          const inserted = await client.query(INSERT_DECISION, [
            decision.decisionId,
            decision.recommendationId,
            decision.decidedAt,
            decision,
          ]);
          if (inserted.rowCount !== 1) {
            // A concurrent session inserted the same decision between the read and the write.
            throw new DuplicateRace();
          }
        } else if (!deepEquals(existingDecision, decision)) {
          throw new PostgresApprovalQueueError('decision-conflict');
        }

        const linked = await client.query(INSERT_LINK, [
          approvalRequestId,
          decision.decisionId,
          correlation.actionDecision.decision,
        ]);
        if (linked.rowCount !== 1) {
          // Another session answered this same ask first. Roll back entirely and reconcile.
          throw new DuplicateRace();
        }

        // Clear the pointer ONLY when it still names this exact request. A decision for an ask that
        // has since expired and been replaced must not clear its replacement's slot -- which is why
        // the predicate is in the statement rather than in a comparison here.
        const slotResult = await client.query(SELECT_SLOT_FOR_UPDATE, [
          stored.request.recommendationId,
          stored.request.proposedActionId,
        ]);
        if (!isRecord(slotResult.rows[0])) {
          // A stored request whose action has no coordination slot. Enqueue always creates one.
          return invariant();
        }
        await client.query(CLEAR_SLOT_POINTER, [
          stored.request.recommendationId,
          stored.request.proposedActionId,
          approvalRequestId,
        ]);

        await client.query(INSERT_AUDIT, [
          'DECISION_LINKED',
          approvalRequestId,
          decision.decisionId,
          stored.request.recommendationId,
          stored.request.proposedActionId,
        ]);

        return Object.freeze({ outcome: 'CREATED' as const, correlation });
      });
    } catch (error) {
      if (!(error instanceof DuplicateRace)) {
        throw classifyDatabaseError(error);
      }
    }

    // Reconciliation after a rolled-back duplicate race: read what actually won.
    return reconcileDecision(approvalRequestId, decision);
  }

  async function reconcileDecision(
    approvalRequestId: string,
    decision: ApprovalDecisionV1,
  ): Promise<ApprovalQueueRecordDecisionResult> {
    let stored: ApprovalQueueRequestRecord;
    let winnerDecisionId: unknown;
    let winnerDecision: ApprovalDecisionV1 | undefined;
    try {
      stored = await readRequest(approvalRequestId);
      const linkRow: unknown = (await pool.query(SELECT_LINK, [approvalRequestId])).rows[0];
      if (!isRecord(linkRow)) {
        return invariant();
      }
      winnerDecisionId = linkRow['decision_id'];
      const decisionRow: unknown = (await pool.query(SELECT_DECISION, [winnerDecisionId])).rows[0];
      winnerDecision = parseDecisionRow(decisionRow);
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    if (winnerDecision === undefined) {
      return invariant();
    }
    if (winnerDecisionId !== decision.decisionId) {
      throw new PostgresApprovalQueueError('request-already-decided');
    }
    if (!deepEquals(winnerDecision, decision)) {
      throw new PostgresApprovalQueueError('decision-conflict');
    }
    const canonical = canonicalizeSource(stored.source);
    return Object.freeze({
      outcome: 'REPLAYED' as const,
      correlation: correlate({ request: stored.request, canonical }, winnerDecision),
    });
  }

  async function loadDecision(
    client: PoolClient,
    decisionId: string,
  ): Promise<ApprovalDecisionV1 | undefined> {
    const row: unknown = (await client.query(SELECT_DECISION, [decisionId])).rows[0];
    return parseDecisionRow(row);
  }

  function parseDecisionRow(row: unknown): ApprovalDecisionV1 | undefined {
    if (row === undefined) {
      return undefined;
    }
    if (!isRecord(row)) {
      return invariant();
    }
    const parsed = approvalDecisionV1Schema.safeParse(row['decision_payload']);
    if (!parsed.success) {
      return invariant();
    }
    return parsed.data;
  }

  /** The public runtime's own correlation, over the persisted source and request. */
  function correlate(
    stored: StoredRequest,
    decision: ApprovalDecisionV1,
  ): ApprovalDecisionCorrelation {
    try {
      return createApprovalRuntime().validateDecision({
        source: asRuntimeResult(stored.canonical),
        request: stored.request,
        decision,
      });
    } catch (error) {
      // The runtime's vocabulary is its own; this package's is closed. A decision that does not
      // correlate is refused, never stored, and never repaired.
      if (error instanceof Error && error.name === 'ApprovalRuntimeError') {
        throw new PostgresApprovalQueueError('binding-invalid');
      }
      throw new PostgresApprovalQueueError('binding-invalid');
    }
  }

  async function readDecisionForRequest(
    approvalRequestId: string,
  ): Promise<ApprovalDecisionCorrelation> {
    const stored = await readRequest(approvalRequestId);
    let linkRow: unknown;
    let decisionRow: unknown;
    try {
      linkRow = (await pool.query(SELECT_LINK, [approvalRequestId])).rows[0];
      if (!isRecord(linkRow)) {
        throw new PostgresApprovalQueueError('request-not-found');
      }
      decisionRow = (await pool.query(SELECT_DECISION, [linkRow['decision_id']])).rows[0];
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    const decision = parseDecisionRow(decisionRow);
    if (decision === undefined) {
      // A link pointing at a decision that does not exist. The foreign key forbids it.
      return invariant();
    }
    // Re-correlated from durable evidence rather than replayed from a stored summary: the
    // fingerprint is recomputed, so a source altered after the fact is caught on read too.
    const canonical = canonicalizeSource(stored.source);
    return correlate({ request: stored.request, canonical }, decision);
  }

  async function readAuditForRequest(
    approvalRequestId: string,
  ): Promise<readonly ApprovalQueueAuditRecord[]> {
    const id = validRequestId(approvalRequestId);
    let rows: unknown[];
    try {
      rows = (await pool.query(SELECT_AUDIT_FOR_REQUEST, [id])).rows;
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    return Object.freeze(
      rows.map((row): ApprovalQueueAuditRecord => {
        if (!isRecord(row)) {
          return invariant();
        }
        const sequence = Number(row['sequence']);
        const eventType = row['event_type'];
        const decisionId = row['decision_id'];
        const recordedAt = row['recorded_at'];
        if (
          !Number.isSafeInteger(sequence) ||
          (eventType !== 'REQUEST_ENQUEUED' &&
            eventType !== 'REQUEST_EXPIRY_OBSERVED' &&
            eventType !== 'DECISION_LINKED') ||
          typeof row['approval_request_id'] !== 'string' ||
          typeof row['recommendation_id'] !== 'string' ||
          typeof row['proposed_action_id'] !== 'string' ||
          (decisionId !== null && typeof decisionId !== 'string') ||
          !(recordedAt instanceof Date)
        ) {
          return invariant();
        }
        return Object.freeze({
          sequence,
          eventType,
          approvalRequestId: row['approval_request_id'],
          ...(decisionId === null ? {} : { decisionId }),
          recommendationId: row['recommendation_id'],
          proposedActionId: row['proposed_action_id'],
          recordedAt: recordedAt.toISOString(),
        });
      }),
    );
  }

  return Object.freeze({
    assertReady,
    enqueueRequest,
    readRequest,
    listActiveRequests,
    recordDecision,
    readDecisionForRequest,
    readAuditForRequest,
  });
}
