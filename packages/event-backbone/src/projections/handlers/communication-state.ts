/**
 * The `communication-state` projection handler — D5, the first lawful producer of
 * `CommunicationStateRecordV2` (QFJ-P09 D5, ADR-0142).
 *
 * One CURRENT row per `communication_id` in `qf_jarvis.rm_communication_state`, for exactly the six
 * durable, evidence-bearing states D3 published: `rejected`, `authorized`, `provider-accepted`,
 * `delivered`, `read`, `failed`.
 *
 * ### The evidence route is the only one
 *
 * The handler receives the metadata-only {@link ProjectionEvent} like every other projection, and
 * resolves communication evidence INTERNALLY by `event.position` through the D4 reader
 * {@link ../communication-evidence-reader.readTrustedCommunicationEvidenceAtPosition} — exactly as
 * `subject-activity` resolves its subject. **This file is the ONE production importer of that reader**,
 * enforced by a restricted-import rule and by a tracked-source scan.
 *
 * There is no fallback parser, no direct `qf_jarvis.event` query, no read-by-`eventId`, and no second
 * evidence path. `null` from the reader means the positioned event is not admitted by D4's purpose:
 * **nothing is written and no state is invented.** A reader error propagates unchanged — the runner
 * classifies it, and swallowing it here would turn corruption or a connection failure into a silently
 * missing state.
 *
 * ### Ordering, replay and staleness
 *
 * Ordering is the existing gap-free projection position; there is no second cursor, no local sequence
 * and no timestamp comparison. The upsert is position-guarded, so a re-presented position is a no-op
 * and a stale or out-of-order position cannot overwrite newer state. Replaying the same ordered stream
 * therefore reproduces the same final row.
 *
 * ### Determinism
 *
 * It reads no clock, no randomness and no environment. Every instant stored comes from the evidence —
 * the authorization's `decidedAt` or the result's `recordedAt` — never from `Date.now()`, never from
 * the projection's execution time, and never from `event.acceptedAt`. It performs no I/O beyond the
 * borrowed transaction client, and puts no communication value in an error, log or metric.
 *
 * Not exported from the package root, and deliberately NOT registered in the production registry: D5
 * is implemented and testable OFFLINE. **Rollout remains OFF.**
 */
import {
  communicationStateRecordV2Schema,
  type CommunicationStateRecordV2,
} from '@qf-jarvis/contracts';

import type { DatabaseClient } from '../../persistence/pool.js';
import {
  readTrustedCommunicationEvidenceAtPosition,
  type TrustedCommunicationEvidence,
} from '../communication-evidence-reader.js';
import {
  defineProjection,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projection-definition.js';
import { ProjectionStoredDataError } from '../projection-errors.js';

/** The projection identity. Kebab-case name (NOT the `rm_*` table); version matches migration 0013. */
export const COMMUNICATION_STATE_PROJECTION_NAME = 'communication-state';
export const COMMUNICATION_STATE_PROJECTION_VERSION = 1;

/**
 * Insert on first sight, otherwise replace — but ONLY when the incoming position is strictly beyond
 * the stored `last_position`.
 *
 * `previous_state` is set from `rm.state`, the row being replaced: the PERSISTED prior state, never
 * anything derived from the incoming evidence, a timestamp, a lifecycle graph or a guess. On insert it
 * is NULL, and because the guard makes a replay or a stale position a no-op, neither can mutate it.
 */
const APPLY_COMMUNICATION_STATE_SQL = `
INSERT INTO qf_jarvis.rm_communication_state AS rm
  (communication_id, state, contract_version, recorded_at, reason_code, correlation_id,
   previous_state, evidence, last_position)
VALUES ($1::uuid, $2, $3::smallint, $4::timestamptz, $5, $6::uuid, NULL, $7::jsonb, $8::bigint)
ON CONFLICT (communication_id) DO UPDATE SET
  state            = EXCLUDED.state,
  contract_version = EXCLUDED.contract_version,
  recorded_at      = EXCLUDED.recorded_at,
  reason_code      = EXCLUDED.reason_code,
  correlation_id   = EXCLUDED.correlation_id,
  previous_state   = rm.state,
  evidence         = EXCLUDED.evidence,
  last_position    = EXCLUDED.last_position
WHERE EXCLUDED.last_position > rm.last_position
`;

/**
 * Build the V2 record for one piece of trusted evidence.
 *
 * The mapping is a copy, not a decision: D4 has already refused everything this projection may not
 * represent — a non-WhatsApp authorization, a lifecycle state outside the four result-backed ones, an
 * unrelated event — so re-deriving authority here would be a second, weaker copy of rules that already
 * exist. `sourceEventId` is carried as an audit POINTER and is never treated as provenance.
 */
function toStateRecord(evidence: TrustedCommunicationEvidence): CommunicationStateRecordV2 {
  if (evidence.kind === 'communication-authorization') {
    const base = {
      communicationId: evidence.communicationId,
      contractVersion: 2,
      // The authorization's own decision instant.
      recordedAt: evidence.decidedAt,
      reasonCode: evidence.reasonCode,
      correlationId: evidence.correlationId,
    } as const;

    if (evidence.outcome === 'authorized') {
      return {
        ...base,
        state: 'authorized',
        evidence: {
          tier: 'tier-c',
          kind: 'communication-authorization',
          sourceEventId: evidence.sourceEventId,
          communicationRequestId: evidence.communicationRequestId,
          outcome: 'authorized',
          // D4 admits an `authorized` outcome only for the channel this runtime executes, so the
          // literal is a restatement of what already passed, not a new decision.
          authorizedChannel: 'whatsapp',
        },
      } satisfies CommunicationStateRecordV2;
    }

    // A refusal authorizes no channel, so the key is ABSENT rather than undefined — the V2 rejected
    // variant has no such field, and an explicit `undefined` would be an unknown key.
    return {
      ...base,
      state: 'rejected',
      evidence: {
        tier: 'tier-c',
        kind: 'communication-authorization',
        sourceEventId: evidence.sourceEventId,
        communicationRequestId: evidence.communicationRequestId,
        outcome: 'rejected',
      },
    } satisfies CommunicationStateRecordV2;
  }

  const resultEvidence = {
    tier: 'tier-c',
    kind: 'communication-result',
    sourceEventId: evidence.sourceEventId,
    communicationResultId: evidence.communicationResultId,
    outcome: evidence.outcome,
    // Only the minimised failure survives: a machine code and a retry class. D4 already stripped the
    // category and the free-text description, and neither is re-added here.
    ...(evidence.failure === undefined
      ? {}
      : {
          failure: {
            failureCode: evidence.failure.failureCode,
            retryClassification: evidence.failure.retryClassification,
          },
        }),
  } as const;

  const base = {
    communicationId: evidence.communicationId,
    contractVersion: 2,
    // The instant Core recorded the result.
    recordedAt: evidence.recordedAt,
    reasonCode: evidence.reasonCode,
    correlationId: evidence.correlationId,
  } as const;

  // `state` and `evidence.lifecycleState` are the same fact, so they are written from the same value.
  // The switch exists because the V2 union pins them as matching literals per variant.
  switch (evidence.lifecycleState) {
    case 'provider-accepted':
      return {
        ...base,
        state: 'provider-accepted',
        evidence: { ...resultEvidence, lifecycleState: 'provider-accepted' },
      } satisfies CommunicationStateRecordV2;
    case 'delivered':
      return {
        ...base,
        state: 'delivered',
        evidence: { ...resultEvidence, lifecycleState: 'delivered' },
      } satisfies CommunicationStateRecordV2;
    case 'read':
      return {
        ...base,
        state: 'read',
        evidence: { ...resultEvidence, lifecycleState: 'read' },
      } satisfies CommunicationStateRecordV2;
    default:
      return {
        ...base,
        state: 'failed',
        evidence: { ...resultEvidence, lifecycleState: 'failed' },
      } satisfies CommunicationStateRecordV2;
  }
}

/**
 * Apply one event to `qf_jarvis.rm_communication_state`.
 *
 * Resolves trusted evidence by position, builds the V2 record, validates it with the CANONICAL schema
 * — not a local copy, and not TypeScript's shape alone, because the row is about to become durable —
 * and applies the position-guarded upsert in the borrowed transaction. Signals failure only by
 * rejecting; it adds no retry, dead-letter or new failure semantics.
 */
export async function applyCommunicationState(
  client: DatabaseClient,
  event: ProjectionEvent,
): Promise<void> {
  const evidence = await readTrustedCommunicationEvidenceAtPosition(client, event.position);
  if (evidence === null) {
    // Not admitted by D4's purpose. Writing anything here would invent a state.
    return;
  }

  const record = communicationStateRecordV2Schema.safeParse(toStateRecord(evidence));
  if (!record.success) {
    // Fail closed. A record that cannot satisfy its own published contract must never be persisted,
    // and the message carries no communication value.
    throw new ProjectionStoredDataError(
      'A constructed communication state record does not satisfy the canonical V2 contract.',
    );
  }

  await client.query(APPLY_COMMUNICATION_STATE_SQL, [
    record.data.communicationId,
    record.data.state,
    record.data.contractVersion,
    record.data.recordedAt,
    record.data.reasonCode,
    record.data.correlationId,
    JSON.stringify(record.data.evidence),
    event.position.toString(),
  ]);
}

/** The immutable, validated definition for `communication-state` v1. NOT in the production registry. */
export const communicationStateProjection: ProjectionDefinition = defineProjection({
  name: COMMUNICATION_STATE_PROJECTION_NAME,
  version: COMMUNICATION_STATE_PROJECTION_VERSION,
  apply: applyCommunicationState,
});
