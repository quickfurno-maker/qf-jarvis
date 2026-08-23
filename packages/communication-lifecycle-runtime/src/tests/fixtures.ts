/**
 * Canonical record fixtures (QFJ-P09.05, ADR-0110).
 *
 * TEST-ONLY, and excluded from the emitting build.
 *
 * ### Every fixture carries all three evidence ids, deliberately
 *
 * The state-record schema requires a decision id for three states, an execution intent id for two,
 * and an execution result id for six. The obvious fixture builder would encode that table so each
 * state gets exactly the ids it needs -- and that would be this package writing down the canonical
 * evidence rules a SECOND time, free to drift from the schema and quietly wrong the day the schema
 * changes.
 *
 * So the builder attaches all three to every record instead. The extra ids are schema-legal
 * everywhere (they are plain optional fields; only their ABSENCE is constrained), which means one
 * unconditional builder produces a canonically valid record for all eighteen states without knowing
 * anything about which state needs what.
 *
 * The evidence rules are then proved separately, and in the only way that proves anything: by
 * REMOVING an id and watching the canonical schema -- not this package -- reject the record.
 */
import {
  COMMUNICATION_STATE_RECORD_CONTRACT_VERSION,
  type CommunicationChannel,
  type CommunicationState,
  type CommunicationStateRecordV1,
  type EntityReference,
} from '@qf-jarvis/contracts';

/** One governed communication, held constant so a mismatch in a spec is always deliberate. */
export const COMMUNICATION_ID = '9f1c2f26-2b2d-4a6f-9c1e-3b0a6d5e7f01';
export const CORRELATION_ID = '4a7d6c15-8e33-4f21-b0d9-2c5a8e1f3b44';
const APPROVAL_DECISION_ID = 'c3b5a7e9-1d4f-4c82-8a60-5e2b9f7d1c33';
const EXECUTION_INTENT_ID = '6e8a1b4c-7f92-4d05-a3c1-8b0d2e6f4a57';
const EXECUTION_RESULT_ID = '1b9d4e7a-3c50-4a18-9f26-7d3c5b8e0a92';

export const CHANNEL: CommunicationChannel = 'whatsapp';
export const RECIPIENT: EntityReference = Object.freeze({
  entityType: 'vendor',
  entityId: 'vendor-8842',
});
export const PURPOSE_CODE = 'vendor-availability-check';

/** Two instants, five minutes apart. Written down, never read from a clock. */
export const EARLIER = '2026-08-23T10:00:00Z';
export const LATER = '2026-08-23T10:05:00Z';

export interface StateRecordOptions {
  readonly state: CommunicationState;
  /** Omitted entirely when not supplied -- which is what a lifecycle-start record looks like. */
  readonly previousState?: CommunicationState;
  readonly recordedAt?: string;
  readonly communicationId?: string;
  readonly channel?: CommunicationChannel;
  readonly recipient?: EntityReference;
  readonly purposeCode?: string;
  readonly correlationId?: string;
}

/** Build a canonically valid `CommunicationStateRecordV1` for any of the eighteen states. */
export function stateRecord(options: StateRecordOptions): CommunicationStateRecordV1 {
  const base = {
    communicationId: options.communicationId ?? COMMUNICATION_ID,
    contractVersion: COMMUNICATION_STATE_RECORD_CONTRACT_VERSION,
    channel: options.channel ?? CHANNEL,
    state: options.state,
    recordedAt: options.recordedAt ?? EARLIER,
    recipient: options.recipient ?? RECIPIENT,
    purposeCode: options.purposeCode ?? PURPOSE_CODE,
    approvalDecisionId: APPROVAL_DECISION_ID,
    executionIntentId: EXECUTION_INTENT_ID,
    executionResultId: EXECUTION_RESULT_ID,
    reasonCode: 'lifecycle-transition-fixture',
    correlationId: options.correlationId ?? CORRELATION_ID,
  } satisfies Omit<CommunicationStateRecordV1, 'previousState'>;

  return options.previousState === undefined
    ? base
    : { ...base, previousState: options.previousState };
}

/**
 * Strip one evidence id from an otherwise valid record.
 *
 * The cast is the point of the helper, not a shortcut around it: it produces a value that a
 * TypeScript caller could hand to the runtime while claiming it is a valid record. If a cast were
 * enough to get past the runtime, the canonical schema would not be load-bearing -- and these specs
 * exist to show that it is.
 */
export function withoutEvidence(
  record: CommunicationStateRecordV1,
  field: 'approvalDecisionId' | 'executionIntentId' | 'executionResultId',
): CommunicationStateRecordV1 {
  const withoutField = Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
  return withoutField as unknown as CommunicationStateRecordV1;
}
