import { safeParseCanonicalPayload } from '@qf-jarvis/contracts';

import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';

export const CLIENT_LIFETIME_EVENT_TYPES = Object.freeze([
  'qf.client.requirement-completed',
  'qf.client.follow-up-due-detected',
  'qf.client.follow-up-completed',
  'qf.client.satisfaction-recorded',
  'qf.client.dissatisfaction-recorded',
  'qf.client.complaint-recorded',
  'qf.client.reassignment-requested',
  'qf.client.reassignment-authorized',
  'qf.client.reassignment-rejected',
  'qf.client.additional-service-identified',
  'qf.client.additional-service-confirmed',
  'qf.client.additional-service-rejected',
  'qf.client.review-requested',
  'qf.client.lifecycle-closed',
  'qf.privacy.erasure-recorded',
] as const);

export type ClientLifetimeEventType = (typeof CLIENT_LIFETIME_EVENT_TYPES)[number];

export interface ClientLifetimeEvidence {
  readonly clientId: string;
  readonly eventType: ClientLifetimeEventType;
  readonly leadId?: string;
  readonly categoryId?: string;
  readonly reasonCode?: string;
  readonly additionalServiceRequestId?: string;
  readonly additionalServiceStatus?: 'identified' | 'confirmed' | 'rejected';
  readonly lifecycleOutcome?: 'converted' | 'lost' | 'abandoned' | 'withdrawn';
}

interface RawEvidenceRow {
  readonly position: unknown;
  readonly event_type: unknown;
  readonly event_version: unknown;
  readonly source: unknown;
  readonly subject_type: unknown;
  readonly subject_id: unknown;
  readonly payload: unknown;
}

const SUPPORTED_EVENT_VERSION = 2;
const CANONICAL_CORE_SOURCE = 'quickfurno-core';
const CANONICAL_POSITION_PATTERN = /^[1-9][0-9]*$/;
const EVENT_TYPE_PATTERN = /^[a-z0-9]+([-.][a-z0-9]+)*$/;
const OPAQUE_REF_PATTERN = /^[A-Za-z0-9._:-]+$/;
const REASON_CODE_PATTERN = /^[a-z0-9]+([-.][a-z0-9]+)*$/;

const ADMITTED_SQL_LITERALS = CLIENT_LIFETIME_EVENT_TYPES.map(
  (_value, index) => '$' + String(index + 2),
).join(', ');

const SELECT_CLIENT_LIFETIME_EVIDENCE_BY_POSITION_SQL = `
SELECT
  m.position,
  e.event_type,
  e.event_version,
  e.source,
  e.subject_type,
  e.subject_id,
  CASE
    WHEN e.event_type IN (${ADMITTED_SQL_LITERALS}) AND e.event_version = $$VERSION
      THEN e.payload
    ELSE NULL
  END AS payload
FROM qf_jarvis.projection_event_position AS m
JOIN qf_jarvis.event AS e ON e.sequence = m.event_storage_sequence
WHERE m.position = $1
`.replace('$$VERSION', '$' + String(CLIENT_LIFETIME_EVENT_TYPES.length + 2));
function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectionStoredDataError(message);
  }
  return value as Record<string, unknown>;
}

function opaqueRef(value: unknown, message: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    !OPAQUE_REF_PATTERN.test(value)
  ) {
    throw new ProjectionStoredDataError(message);
  }
  return value;
}

function reasonCode(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 64 ||
    !REASON_CODE_PATTERN.test(value)
  ) {
    throw new ProjectionStoredDataError('A stored client lifetime reason code is invalid.');
  }
  return value;
}

function entityId(value: unknown, expectedType?: string): string {
  const entity = record(value, 'A stored client lifetime entity reference is invalid.');
  if (expectedType !== undefined && entity['entityType'] !== expectedType) {
    throw new ProjectionStoredDataError('A stored client lifetime entity type is invalid.');
  }
  return opaqueRef(entity['entityId'], 'A stored client lifetime entity id is invalid.');
}

function parsedPayload(
  eventType: ClientLifetimeEventType,
  payload: unknown,
): Record<string, unknown> {
  const parsed = safeParseCanonicalPayload(eventType, SUPPORTED_EVENT_VERSION, payload);
  if (!parsed.success) {
    throw new ProjectionStoredDataError(
      'A stored client lifetime payload does not satisfy its canonical contract.',
    );
  }
  return record(parsed.data, 'A stored client lifetime payload is not an object.');
}

function isClientLifetimeEventType(value: string): value is ClientLifetimeEventType {
  return (CLIENT_LIFETIME_EVENT_TYPES as readonly string[]).includes(value);
}

function commonObservation(
  payload: Record<string, unknown>,
): Pick<ClientLifetimeEvidence, 'leadId' | 'categoryId' | 'reasonCode'> {
  const parsedReasonCode = reasonCode(payload['reasonCode']);
  return {
    ...(payload['lead'] === undefined ? {} : { leadId: entityId(payload['lead'], 'lead') }),
    ...(payload['category'] === undefined
      ? {}
      : { categoryId: entityId(payload['category'], 'category') }),
    ...(parsedReasonCode === undefined ? {} : { reasonCode: parsedReasonCode }),
  };
}
function evidenceFromPayload(
  clientId: string,
  eventType: ClientLifetimeEventType,
  payload: Record<string, unknown>,
): ClientLifetimeEvidence {
  if (eventType === 'qf.privacy.erasure-recorded') {
    return Object.freeze({ clientId, eventType });
  }

  if (eventType === 'qf.client.reassignment-requested') {
    const request = record(
      payload['request'],
      'A stored client reassignment request wrapper is invalid.',
    );
    if (entityId(request['client'], 'client') !== clientId) {
      throw new ProjectionStoredDataError(
        'A stored client reassignment request does not match its client subject.',
      );
    }
    const dissatisfaction = record(
      request['dissatisfaction'],
      'A stored client reassignment dissatisfaction block is invalid.',
    );
    const parsedReasonCode = reasonCode(dissatisfaction['reasonCode']);
    return Object.freeze({
      clientId,
      eventType,
      leadId: entityId(request['lead'], 'lead'),
      categoryId: entityId(request['category'], 'category'),
      ...(parsedReasonCode === undefined ? {} : { reasonCode: parsedReasonCode }),
    });
  }

  if (
    eventType === 'qf.client.reassignment-authorized' ||
    eventType === 'qf.client.reassignment-rejected'
  ) {
    return Object.freeze({ clientId, eventType });
  }

  if (eventType === 'qf.client.additional-service-identified') {
    const request = record(
      payload['request'],
      'A stored additional-service request wrapper is invalid.',
    );
    if (entityId(request['client'], 'client') !== clientId) {
      throw new ProjectionStoredDataError(
        'A stored additional-service request does not match its client subject.',
      );
    }
    const parsedReasonCode = reasonCode(request['reasonCode']);
    return Object.freeze({
      clientId,
      eventType,
      leadId: entityId(request['originatingLead'], 'lead'),
      categoryId: entityId(request['proposedCategory'], 'category'),
      additionalServiceRequestId: opaqueRef(
        request['additionalServiceRequestId'],
        'A stored additional-service request id is invalid.',
      ),
      additionalServiceStatus: 'identified',
      ...(parsedReasonCode === undefined ? {} : { reasonCode: parsedReasonCode }),
    });
  }

  if (
    eventType === 'qf.client.additional-service-confirmed' ||
    eventType === 'qf.client.additional-service-rejected'
  ) {
    const parsedReasonCode = reasonCode(payload['reasonCode']);
    return Object.freeze({
      clientId,
      eventType,
      categoryId: entityId(payload['proposedCategory'], 'category'),
      additionalServiceRequestId: opaqueRef(
        payload['additionalServiceRequestId'],
        'A stored additional-service request id is invalid.',
      ),
      additionalServiceStatus:
        eventType === 'qf.client.additional-service-confirmed' ? 'confirmed' : 'rejected',
      ...(parsedReasonCode === undefined ? {} : { reasonCode: parsedReasonCode }),
    });
  }

  if (eventType === 'qf.client.lifecycle-closed') {
    const outcome = payload['outcome'];
    if (
      outcome !== 'converted' &&
      outcome !== 'lost' &&
      outcome !== 'abandoned' &&
      outcome !== 'withdrawn'
    ) {
      throw new ProjectionStoredDataError('A stored client lifecycle outcome is invalid.');
    }
    return Object.freeze({
      clientId,
      eventType,
      ...commonObservation(payload),
      lifecycleOutcome: outcome,
    });
  }

  return Object.freeze({ clientId, eventType, ...commonObservation(payload) });
}
export async function readClientLifetimeEvidenceAtPosition(
  client: DatabaseClient,
  position: bigint,
): Promise<ClientLifetimeEvidence | null> {
  if (typeof position !== 'bigint' || position <= 0n) {
    throw new ProjectionInputError('projection position must be a positive integer position.');
  }

  const result = await client.query<RawEvidenceRow>(
    SELECT_CLIENT_LIFETIME_EVIDENCE_BY_POSITION_SQL,
    [position.toString(), ...CLIENT_LIFETIME_EVENT_TYPES, SUPPORTED_EVENT_VERSION],
  );
  const raw = result.rows[0];
  if (raw === undefined) {
    throw new ProjectionStoredDataError('No event maps to the requested projection position.');
  }

  if (typeof raw.position !== 'string' || !CANONICAL_POSITION_PATTERN.test(raw.position)) {
    throw new ProjectionStoredDataError(
      'A stored projection position is not a canonical position.',
    );
  }
  if (BigInt(raw.position) !== position) {
    throw new ProjectionStoredDataError(
      'A stored projection position does not match the requested position.',
    );
  }

  if (
    typeof raw.event_type !== 'string' ||
    raw.event_type.length < 1 ||
    raw.event_type.length > 64 ||
    !EVENT_TYPE_PATTERN.test(raw.event_type)
  ) {
    throw new ProjectionStoredDataError('A stored event type is not a valid machine token.');
  }
  if (
    typeof raw.event_version !== 'number' ||
    !Number.isSafeInteger(raw.event_version) ||
    raw.event_version < 1 ||
    raw.event_version > 1000
  ) {
    throw new ProjectionStoredDataError('A stored event version is not a valid contract version.');
  }

  if (!isClientLifetimeEventType(raw.event_type)) return null;
  if (raw.event_version !== SUPPORTED_EVENT_VERSION) {
    throw new ProjectionStoredDataError(
      'A stored client lifetime event is at an unsupported contract version.',
    );
  }
  if (raw.source !== CANONICAL_CORE_SOURCE) {
    throw new ProjectionStoredDataError(
      'A stored client lifetime event does not carry the canonical Core source.',
    );
  }
  if (raw.subject_type !== 'client') {
    throw new ProjectionStoredDataError(
      'A stored client lifetime event does not carry a client subject.',
    );
  }

  const clientId = opaqueRef(
    raw.subject_id,
    'A stored client lifetime event subject id is invalid.',
  );
  const payload = parsedPayload(raw.event_type, raw.payload);
  return evidenceFromPayload(clientId, raw.event_type, payload);
}
