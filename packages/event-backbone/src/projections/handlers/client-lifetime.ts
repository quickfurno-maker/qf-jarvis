import type { DatabaseClient } from '../../persistence/pool.js';
import {
  readClientLifetimeEvidenceAtPosition,
  type ClientLifetimeEvidence,
} from '../client-lifetime-evidence-reader.js';
import {
  defineProjection,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projection-definition.js';

export const CLIENT_LIFETIME_PROJECTION_NAME = 'client-lifetime';
export const CLIENT_LIFETIME_PROJECTION_VERSION = 1;

const APPLY_STATE_SQL = `
INSERT INTO qf_jarvis.rm_client_lifetime_state AS rm (
  client_id, last_position, last_event_type, last_accepted_at,
  last_lead_id, last_category_id, last_reason_code,
  follow_up_due, satisfaction_state, service_recovery_needed,
  reassignment_state, lifecycle_state, erased
)
VALUES (
  $1, $2::bigint, $3, $4::timestamptz,
  $5, $6, $7,
  COALESCE($8::boolean, false),
  COALESCE($9, 'unknown'),
  COALESCE($10::boolean, false),
  COALESCE($11, 'none'),
  COALESCE($12, 'open'),
  false
)
ON CONFLICT (client_id) DO UPDATE SET
  last_position = EXCLUDED.last_position,
  last_event_type = EXCLUDED.last_event_type,
  last_accepted_at = EXCLUDED.last_accepted_at,
  last_lead_id = COALESCE(EXCLUDED.last_lead_id, rm.last_lead_id),
  last_category_id = COALESCE(EXCLUDED.last_category_id, rm.last_category_id),
  last_reason_code = COALESCE(EXCLUDED.last_reason_code, rm.last_reason_code),
  follow_up_due = COALESCE($8::boolean, rm.follow_up_due),
  satisfaction_state = COALESCE($9, rm.satisfaction_state),
  service_recovery_needed = COALESCE($10::boolean, rm.service_recovery_needed),
  reassignment_state = COALESCE($11, rm.reassignment_state),
  lifecycle_state = COALESCE($12, rm.lifecycle_state)
WHERE NOT rm.erased
  AND EXCLUDED.last_position > rm.last_position
`;

const APPLY_TIMELINE_SQL = `
INSERT INTO qf_jarvis.rm_client_lifetime_timeline
  (client_id, event_position, event_type, accepted_at, lead_id, category_id, reason_code)
SELECT $1, $2::bigint, $3, $4::timestamptz, $5, $6, $7
WHERE EXISTS (
  SELECT 1
  FROM qf_jarvis.rm_client_lifetime_state
  WHERE client_id = $1 AND NOT erased
)
ON CONFLICT (client_id, event_position) DO NOTHING
`;

const APPLY_OPPORTUNITY_SQL = `
INSERT INTO qf_jarvis.rm_client_service_opportunity AS rm
  (client_id, category_id, request_id, status, last_position, last_accepted_at)
SELECT $1, $2, $3, $4, $5::bigint, $6::timestamptz
WHERE EXISTS (
  SELECT 1
  FROM qf_jarvis.rm_client_lifetime_state
  WHERE client_id = $1 AND NOT erased
)
ON CONFLICT (client_id, category_id) DO UPDATE SET
  request_id = EXCLUDED.request_id,
  status = EXCLUDED.status,
  last_position = EXCLUDED.last_position,
  last_accepted_at = EXCLUDED.last_accepted_at
WHERE EXCLUDED.last_position > rm.last_position
`;
const ERASE_TIMELINE_SQL = 'DELETE FROM qf_jarvis.rm_client_lifetime_timeline WHERE client_id = $1';
const ERASE_OPPORTUNITIES_SQL =
  'DELETE FROM qf_jarvis.rm_client_service_opportunity WHERE client_id = $1';

const APPLY_ERASURE_SQL = `
INSERT INTO qf_jarvis.rm_client_lifetime_state AS rm (
  client_id, last_position, follow_up_due, satisfaction_state,
  service_recovery_needed, reassignment_state, lifecycle_state,
  erased, erased_at_position, erased_at
)
VALUES ($1, $2::bigint, false, 'unknown', false, 'none', 'open', true, $2::bigint, $3::timestamptz)
ON CONFLICT (client_id) DO UPDATE SET
  last_position = EXCLUDED.last_position,
  last_event_type = NULL,
  last_accepted_at = NULL,
  last_lead_id = NULL,
  last_category_id = NULL,
  last_reason_code = NULL,
  follow_up_due = false,
  satisfaction_state = 'unknown',
  service_recovery_needed = false,
  reassignment_state = 'none',
  lifecycle_state = 'open',
  erased = true,
  erased_at_position = EXCLUDED.erased_at_position,
  erased_at = EXCLUDED.erased_at
WHERE NOT rm.erased
`;

interface StateDelta {
  readonly followUpDue: boolean | null;
  readonly satisfactionState: 'unknown' | 'satisfied' | 'dissatisfied' | 'complaint' | null;
  readonly serviceRecoveryNeeded: boolean | null;
  readonly reassignmentState: 'none' | 'requested' | 'authorized' | 'rejected' | null;
  readonly lifecycleState: 'open' | 'converted' | 'lost' | 'abandoned' | 'withdrawn' | null;
}

function stateDelta(evidence: ClientLifetimeEvidence): StateDelta {
  const base: StateDelta = {
    followUpDue: null,
    satisfactionState: null,
    serviceRecoveryNeeded: null,
    reassignmentState: null,
    lifecycleState: null,
  };

  switch (evidence.eventType) {
    case 'qf.client.follow-up-due-detected':
      return { ...base, followUpDue: true };
    case 'qf.client.follow-up-completed':
      return { ...base, followUpDue: false };
    case 'qf.client.satisfaction-recorded':
      return { ...base, satisfactionState: 'satisfied', serviceRecoveryNeeded: false };
    case 'qf.client.dissatisfaction-recorded':
      return { ...base, satisfactionState: 'dissatisfied', serviceRecoveryNeeded: true };
    case 'qf.client.complaint-recorded':
      return { ...base, satisfactionState: 'complaint', serviceRecoveryNeeded: true };
    case 'qf.client.reassignment-requested':
      return { ...base, reassignmentState: 'requested', serviceRecoveryNeeded: true };
    case 'qf.client.reassignment-authorized':
      return { ...base, reassignmentState: 'authorized' };
    case 'qf.client.reassignment-rejected':
      return { ...base, reassignmentState: 'rejected', serviceRecoveryNeeded: true };
    case 'qf.client.lifecycle-closed':
      return { ...base, followUpDue: false, lifecycleState: evidence.lifecycleOutcome ?? 'open' };
    default:
      return base;
  }
}
async function applyErasure(
  client: DatabaseClient,
  event: ProjectionEvent,
  evidence: ClientLifetimeEvidence,
): Promise<void> {
  await client.query(ERASE_TIMELINE_SQL, [evidence.clientId]);
  await client.query(ERASE_OPPORTUNITIES_SQL, [evidence.clientId]);
  await client.query(APPLY_ERASURE_SQL, [
    evidence.clientId,
    event.position.toString(),
    event.acceptedAt,
  ]);
}

async function applyOpportunity(
  client: DatabaseClient,
  event: ProjectionEvent,
  evidence: ClientLifetimeEvidence,
): Promise<void> {
  if (evidence.additionalServiceStatus === undefined || evidence.categoryId === undefined) {
    return;
  }

  await client.query(APPLY_OPPORTUNITY_SQL, [
    evidence.clientId,
    evidence.categoryId,
    evidence.additionalServiceRequestId ?? null,
    evidence.additionalServiceStatus,
    event.position.toString(),
    event.acceptedAt,
  ]);
}

export async function applyClientLifetime(
  client: DatabaseClient,
  event: ProjectionEvent,
): Promise<void> {
  const evidence = await readClientLifetimeEvidenceAtPosition(client, event.position);
  if (evidence === null) return;

  if (evidence.eventType === 'qf.privacy.erasure-recorded') {
    await applyErasure(client, event, evidence);
    return;
  }

  const delta = stateDelta(evidence);
  await client.query(APPLY_STATE_SQL, [
    evidence.clientId,
    event.position.toString(),
    evidence.eventType,
    event.acceptedAt,
    evidence.leadId ?? null,
    evidence.categoryId ?? null,
    evidence.reasonCode ?? null,
    delta.followUpDue,
    delta.satisfactionState,
    delta.serviceRecoveryNeeded,
    delta.reassignmentState,
    delta.lifecycleState,
  ]);

  await client.query(APPLY_TIMELINE_SQL, [
    evidence.clientId,
    event.position.toString(),
    evidence.eventType,
    event.acceptedAt,
    evidence.leadId ?? null,
    evidence.categoryId ?? null,
    evidence.reasonCode ?? null,
  ]);

  await applyOpportunity(client, event, evidence);
}

/**
 * Offline-only definition. Intentionally absent from production-registry.ts until Core emission,
 * runtime grants, rebuild/erasure behavior and projection backfill are certified together.
 */
export const clientLifetimeProjection: ProjectionDefinition = defineProjection({
  name: CLIENT_LIFETIME_PROJECTION_NAME,
  version: CLIENT_LIFETIME_PROJECTION_VERSION,
  apply: applyClientLifetime,
});
