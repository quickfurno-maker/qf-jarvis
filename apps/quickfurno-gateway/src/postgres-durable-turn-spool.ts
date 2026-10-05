import type { DatabasePool } from '@qf-jarvis/event-backbone';

import type {
  DurableTraceContextV1,
  DurableTurnClaimSelection,
  DurableTurnRecordV1,
  DurableTurnSpool,
  DurableTurnSpoolStats,
  TurnAcceptResult,
} from './durable-turn-spool.js';
import type { WhatsAppTurnV1 } from './whatsapp-turn-protocol.js';

interface TurnRow {
  readonly request_id: string | null;
  readonly traceparent: string | null;
  readonly tracestate: string | null;
  readonly conversation_id: string;
  readonly conversation_revision: string | number;
  readonly inbound_message_id: string;
  readonly received_at: Date | string;
  readonly assigned_actor: DurableTurnRecordV1['assignedActor'];
  readonly subject_type: DurableTurnRecordV1['subjectType'];
  readonly turn_purpose: 'lead_qualification' | null;
  readonly qualification_request_id: string | null;
  readonly accepted_at: Date | string;
}

const TABLE = 'qf_jarvis.quickfurno_turn_spool';

const RETURNING = `
  request_id,
  traceparent,
  tracestate,
  conversation_id,
  conversation_revision,
  inbound_message_id,
  received_at,
  assigned_actor,
  subject_type,
  turn_purpose,
  qualification_request_id,
  accepted_at
`;

const RETURNING_TURN = `
  turn.request_id,
  turn.traceparent,
  turn.tracestate,
  turn.conversation_id,
  turn.conversation_revision,
  turn.inbound_message_id,
  turn.received_at,
  turn.assigned_actor,
  turn.subject_type,
  turn.turn_purpose,
  turn.qualification_request_id,
  turn.accepted_at
`;

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function record(row: TurnRow): DurableTurnRecordV1 {
  const revision =
    typeof row.conversation_revision === 'number'
      ? row.conversation_revision
      : Number.parseInt(row.conversation_revision, 10);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('turn_spool_corrupt');

  return Object.freeze({
    version: 1,
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
    ...(row.traceparent === null ? {} : { traceparent: row.traceparent }),
    ...(row.tracestate === null ? {} : { tracestate: row.tracestate }),
    conversationId: row.conversation_id,
    conversationRevision: revision,
    inboundMessageId: row.inbound_message_id,
    receivedAt: instant(row.received_at),
    assignedActor: row.assigned_actor,
    subjectType: row.subject_type,
    ...(row.turn_purpose === 'lead_qualification' && row.qualification_request_id !== null
      ? {
          turnPurpose: 'lead_qualification' as const,
          qualificationRequestId: row.qualification_request_id,
        }
      : {}),
    acceptedAt: instant(row.accepted_at),
  });
}

function sameIdentity(a: DurableTurnRecordV1, b: DurableTurnRecordV1): boolean {
  return (
    a.conversationId === b.conversationId &&
    a.conversationRevision === b.conversationRevision &&
    a.inboundMessageId === b.inboundMessageId &&
    a.receivedAt === b.receivedAt &&
    a.assignedActor === b.assignedActor &&
    a.subjectType === b.subjectType &&
    a.turnPurpose === b.turnPurpose &&
    a.qualificationRequestId === b.qualificationRequestId
  );
}

function candidateRecord(
  turn: WhatsAppTurnV1,
  acceptedAt: string,
  traceContext?: DurableTraceContextV1,
): DurableTurnRecordV1 {
  return Object.freeze({
    version: 1,
    requestId: turn.requestId,
    ...(traceContext === undefined
      ? {}
      : {
          traceparent: traceContext.traceparent,
          ...(traceContext.tracestate === undefined ? {} : { tracestate: traceContext.tracestate }),
        }),
    conversationId: turn.conversationId,
    conversationRevision: turn.conversationRevision,
    inboundMessageId: turn.inboundMessageId,
    receivedAt: turn.receivedAt,
    assignedActor: turn.assignedActor,
    subjectType: turn.subjectType,
    ...(turn.turnPurpose === 'lead_qualification'
      ? {
          turnPurpose: 'lead_qualification' as const,
          qualificationRequestId: turn.qualificationRequestId,
        }
      : {}),
    acceptedAt,
  });
}

function transitionCount(rowCount: number | null): void {
  if (rowCount !== 1) throw new Error('turn_spool_transition_invalid');
}

/**
 * PostgreSQL-backed implementation of the existing DurableTurnSpool port.
 *
 * The caller owns the pool lifecycle. This adapter creates no pool, reads no
 * environment and grants no business authority.
 */
export function createPostgresDurableTurnSpool(pool: DatabasePool): DurableTurnSpool {
  return Object.freeze({
    async accept(
      turn: WhatsAppTurnV1,
      acceptedAt: string,
      traceContext?: DurableTraceContextV1,
    ): Promise<TurnAcceptResult> {
      const expected = candidateRecord(turn, acceptedAt, traceContext);
      const inserted = await pool.query<TurnRow>(
        `INSERT INTO ${TABLE}
          (request_id, traceparent, tracestate, conversation_id, conversation_revision,
           inbound_message_id, received_at, assigned_actor, subject_type, turn_purpose,
           qualification_request_id, accepted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (inbound_message_id) DO NOTHING
         RETURNING ${RETURNING}`,
        [
          turn.requestId,
          traceContext?.traceparent ?? null,
          traceContext?.tracestate ?? null,
          turn.conversationId,
          turn.conversationRevision,
          turn.inboundMessageId,
          turn.receivedAt,
          turn.assignedActor,
          turn.subjectType,
          turn.turnPurpose ?? null,
          turn.qualificationRequestId ?? null,
          acceptedAt,
        ],
      );
      if (inserted.rowCount === 1 && inserted.rows[0] !== undefined) {
        return { outcome: 'accepted', record: record(inserted.rows[0]) };
      }

      const found = await pool.query<TurnRow>(
        `SELECT ${RETURNING} FROM ${TABLE} WHERE inbound_message_id = $1`,
        [turn.inboundMessageId],
      );
      const row = found.rows[0];
      if (row === undefined) return { outcome: 'conflict' };
      const prior = record(row);
      const same = sameIdentity(prior, expected);
      if (same && prior.requestId === turn.requestId) return { outcome: 'replay', record: prior };
      return same ? { outcome: 'duplicate', record: prior } : { outcome: 'conflict' };
    },

    async claimNext(
      selection: DurableTurnClaimSelection = {},
    ): Promise<DurableTurnRecordV1 | null> {
      const allowedActors =
        selection.allowedActors === undefined ? null : [...selection.allowedActors];
      const excludedConversations = [...(selection.excludedConversationIds ?? [])];
      const claimed = await pool.query<TurnRow>(
        `WITH candidate AS (
           SELECT turn.inbound_message_id
             FROM ${TABLE} AS turn
            WHERE turn.state = 'PENDING'
              AND ($1::text[] IS NULL OR turn.assigned_actor = ANY($1::text[]))
              AND NOT (turn.conversation_id = ANY($2::uuid[]))
              AND NOT EXISTS (
                SELECT 1
                  FROM ${TABLE} AS prior
                 WHERE prior.conversation_id = turn.conversation_id
                   AND (
                     prior.state = 'PROCESSING'
                     OR (
                       prior.state = 'PENDING'
                       AND ROW(
                         prior.accepted_at,
                         prior.received_at,
                         prior.conversation_revision,
                         prior.inbound_message_id
                       ) < ROW(
                         turn.accepted_at,
                         turn.received_at,
                         turn.conversation_revision,
                         turn.inbound_message_id
                       )
                     )
                   )
              )
            ORDER BY turn.accepted_at, turn.received_at, turn.conversation_revision, turn.inbound_message_id
            FOR UPDATE OF turn SKIP LOCKED
            LIMIT 1
         )
         UPDATE ${TABLE} AS turn
            SET state = 'PROCESSING',
                processing_started_at = clock_timestamp()
           FROM candidate
          WHERE turn.inbound_message_id = candidate.inbound_message_id
         RETURNING ${RETURNING_TURN}`,
        [allowedActors, excludedConversations],
      );
      return claimed.rows[0] === undefined ? null : record(claimed.rows[0]);
    },

    async complete(inboundMessageId: string): Promise<void> {
      const result = await pool.query(
        `UPDATE ${TABLE}
            SET state = 'COMPLETED', finalized_at = clock_timestamp()
          WHERE inbound_message_id = $1 AND state = 'PROCESSING'`,
        [inboundMessageId],
      );
      transitionCount(result.rowCount);
    },

    async fail(inboundMessageId: string): Promise<void> {
      const result = await pool.query(
        `UPDATE ${TABLE}
            SET state = 'FAILED', finalized_at = clock_timestamp()
          WHERE inbound_message_id = $1 AND state = 'PROCESSING'`,
        [inboundMessageId],
      );
      transitionCount(result.rowCount);
    },

    async release(inboundMessageId: string): Promise<void> {
      const result = await pool.query(
        `UPDATE ${TABLE}
            SET state = 'PENDING', processing_started_at = NULL
          WHERE inbound_message_id = $1 AND state = 'PROCESSING'`,
        [inboundMessageId],
      );
      transitionCount(result.rowCount);
    },

    async recoverStale(maxAgeMs: number, nowMs: number): Promise<number> {
      if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1_000 || maxAgeMs > 86_400_000) {
        throw new Error('turn_spool_invalid_recovery_window');
      }
      if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error('turn_spool_invalid_recovery_time');
      const cutoff = new Date(nowMs - maxAgeMs).toISOString();
      const result = await pool.query(
        `UPDATE ${TABLE}
            SET state = 'PENDING', processing_started_at = NULL
          WHERE state = 'PROCESSING' AND processing_started_at < $1::timestamptz`,
        [cutoff],
      );
      return result.rowCount ?? 0;
    },

    async snapshot(nowMs: number): Promise<DurableTurnSpoolStats> {
      if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error('turn_spool_invalid_snapshot_time');
      const result = await pool.query<{
        pending: string;
        processing: string;
        completed: string;
        failed: string;
        oldest_pending_age_ms: string | null;
      }>(
        `SELECT
           count(*) FILTER (WHERE state = 'PENDING')::text AS pending,
           count(*) FILTER (WHERE state = 'PROCESSING')::text AS processing,
           count(*) FILTER (WHERE state = 'COMPLETED')::text AS completed,
           count(*) FILTER (WHERE state = 'FAILED')::text AS failed,
           CASE
             WHEN min(accepted_at) FILTER (WHERE state = 'PENDING') IS NULL THEN NULL
             ELSE greatest(
               0,
               floor(extract(epoch FROM ($1::timestamptz -
                 min(accepted_at) FILTER (WHERE state = 'PENDING'))) * 1000)
             )::bigint::text
           END AS oldest_pending_age_ms
         FROM ${TABLE}`,
        [new Date(nowMs).toISOString()],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('turn_spool_snapshot_invalid');
      return Object.freeze({
        pending: Number.parseInt(row.pending, 10),
        processing: Number.parseInt(row.processing, 10),
        completed: Number.parseInt(row.completed, 10),
        failed: Number.parseInt(row.failed, 10),
        oldestPendingAgeMs:
          row.oldest_pending_age_ms === null
            ? null
            : Number.parseInt(row.oldest_pending_age_ms, 10),
      });
    },
  });
}
