/**
 * CommunicationStateRecordV1 — where a governed communication stands.
 *
 * **A draft is not a message. A script is not a call.** This record describes the
 * state of a governed request; it sends nothing, and nothing here can.
 *
 * ### The recipient is a reference, never a person
 *
 * `recipient` is an opaque QuickFurno Core entity reference — and structurally
 * cannot be anything else. The entity-id character set excludes `@` and `+`, so an
 * email address and an E.164 phone number will not parse. Contact resolution
 * belongs to Core, which owns contact identity, phone number, WhatsApp
 * eligibility, and voice consent, and which resolves the recipient **from its own
 * records at execution time**.
 *
 * This is what degrades prompt injection from *"make the system call me"* to
 * *"make the system suggest something odd to a human who can see the evidence"*: a
 * request naming an attacker's number is refused rather than dialled, because
 * there is nowhere to put a number (security-principles.md).
 *
 * ### There are no consent booleans here
 *
 * You will not find `hasConsent`, `optedIn`, or `withinQuietHours`. Copying Core's
 * consent state into a contract would turn a *courtesy check* into an *apparent
 * permission* — and a stale copy of a permission is the most dangerous field in
 * any system that reaches real people. Jarvis's derived view of consent "is a
 * courtesy check, never a permission — and never authoritative in either
 * direction". Core enforces, and the runtime re-validates at execution time
 * (system-boundary.md, communication-model.md).
 *
 * ### Transitions are policy, not schema
 *
 * The approved model includes a state diagram. This contract does not encode it as
 * a matrix, for the reason given in recommendation-lifecycle.ts: a single record
 * is a point-in-time fact, and transition validity is a stateful question about
 * history. `previousState` is carried as optional *evidence*, not as a validated
 * edge. **Transition enforcement is the coordination layer's job in a later phase**
 * — stated plainly so that nobody assumes this schema already did it.
 *
 * What *is* enforced is reference integrity: a state that only exists because Core
 * decided, dispatched, or recorded something must carry the artifact that proves it.
 */

import { z } from 'zod';

import {
  communicationIdSchema,
  correlationIdSchema,
  decisionIdSchema,
  executionIntentIdSchema,
  executionResultIdSchema,
} from '../common/identifiers.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { communicationChannelSchema } from './communication-channel.js';
import { communicationStateSchema, type CommunicationState } from './communication-state.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { utcTimestampSchema } from '../common/timestamp.js';

/**
 * States that exist only because QuickFurno Core recorded an approval decision.
 *
 * `rejected` is included, and deliberately so: a refusal *is* a decision Core made
 * and recorded, and it is the decision most worth being able to point at later —
 * "the reason is recorded", including consent withdrawal, opt-out, do-not-contact,
 * unverified identity, quiet hours, and attempt limits.
 */
const STATES_REQUIRING_DECISION: readonly CommunicationState[] = [
  'rejected',
  'authorized',
  'scheduled',
];

/** States that exist only because Core dispatched an execution intent to n8n. */
const STATES_REQUIRING_INTENT: readonly CommunicationState[] = [
  'execution-submitted',
  'provider-accepted',
];

/**
 * States that exist only because an authoritative execution result came back and
 * Core recorded it.
 *
 * "No provider state becomes authoritative until Core records it." Requiring the
 * result id is how `delivered` stops being something a hopeful UI can assert.
 */
const STATES_REQUIRING_RESULT: readonly CommunicationState[] = [
  'delivered',
  'read',
  'answered',
  'no-answer',
  'busy',
  'failed',
];

export const COMMUNICATION_STATE_RECORD_CONTRACT_VERSION = 1;

const communicationStateRecordShapeSchema = z.strictObject({
  communicationId: communicationIdSchema,
  contractVersion: z.literal(COMMUNICATION_STATE_RECORD_CONTRACT_VERSION),

  channel: communicationChannelSchema,
  state: communicationStateSchema,
  recordedAt: utcTimestampSchema,

  /** Opaque Core reference. Never a phone number, never an email address. */
  recipient: entityReferenceSchema,

  /** The approved purpose this communication serves. Core validates it. */
  purposeCode: reasonCodeSchema,

  /** Evidence of where this came from. Not a validated transition edge. */
  previousState: communicationStateSchema.optional(),

  approvalDecisionId: decisionIdSchema.optional(),
  executionIntentId: executionIntentIdSchema.optional(),
  executionResultId: executionResultIdSchema.optional(),

  /**
   * Why this state was recorded. Mandatory.
   *
   * For `rejected`, this is where the refusal reason lives — and it is the reason
   * an opt-out needs no state of its own.
   */
  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export const communicationStateRecordV1Schema = communicationStateRecordShapeSchema.superRefine(
  (value, ctx) => {
    if (STATES_REQUIRING_DECISION.includes(value.state) && value.approvalDecisionId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvalDecisionId'],
        message: `State "${value.state}" exists only because QuickFurno Core recorded a decision, so approvalDecisionId is required`,
      });
    }

    if (STATES_REQUIRING_INTENT.includes(value.state) && value.executionIntentId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionIntentId'],
        message: `State "${value.state}" exists only because Core dispatched an execution intent, so executionIntentId is required`,
      });
    }

    if (STATES_REQUIRING_RESULT.includes(value.state) && value.executionResultId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['executionResultId'],
        message: `State "${value.state}" is a provider outcome and becomes authoritative only when Core records an execution result, so executionResultId is required`,
      });
    }
  },
);

export type CommunicationStateRecordV1 = z.infer<typeof communicationStateRecordV1Schema>;
