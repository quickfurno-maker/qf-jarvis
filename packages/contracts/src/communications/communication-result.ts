/**
 * CommunicationResultV1 — what actually happened to a governed communication, as
 * recorded by QuickFurno Core.
 *
 * The authority rule, stated once and then enforced: **`issuer` is the literal
 * `quickfurno-core`.** n8n and the QF Communications Runtime *observe* a provider
 * and *report*; the QuickFurno Communication Core *records*, and that recording is
 * what makes it true. A provider's own view of a delivery is not truth until Core
 * has recorded it (execution-governance.md §6).
 *
 * ### Two collapses this contract refuses to allow
 *
 * **`provider-accepted` is not `delivered`.** The provider taking a message off our
 * hands tells us the provider has it. It does not tell us anybody received it. A
 * result whose lifecycle state is `provider-accepted` therefore **cannot** carry the
 * outcome `succeeded` — the schema refuses it. This is the exact defect that shows a
 * founder one confident tick and lets them believe a conversation happened.
 *
 * **`indeterminate` is not success, and it is not failure either.** When a call
 * drops mid-dial, or a webhook never arrives, the honest answer to "did that
 * connect?" is *we do not know*. Recorded as failure, the system retries and
 * someone's phone rings twice. Recorded as success, a founder acts on a conversation
 * that never happened. So ambiguity is a first-class outcome, and it **must** be
 * classified `requires-reconciliation`: the answer is to go and find out, not to
 * dial and see (execution-governance.md §7).
 *
 * ### What it will not carry
 *
 * No message body. No transcript. No recording or recording URL. No raw provider
 * payload. No credential. `providerEvidence` carries an **opaque handle** — a
 * message id, a call id — which is evidence a human can go and look up, not content
 * we have copied into our own store. Transcript and summary processing belongs to
 * the QF Communications Runtime, on the far side of the boundary, and never crosses
 * it (communication-model.md, privacy-principles.md).
 */

import { z } from 'zod';

import {
  communicationIdSchema,
  communicationResultIdSchema,
  correlationIdSchema,
  executionIntentIdSchema,
  executionResultIdSchema,
  providerReferenceSchema,
} from '../common/identifiers.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import type { CommunicationState } from './communication-state.js';
import { executionFailureSchema, executionOutcomeSchema } from '../execution/execution-result.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const COMMUNICATION_RESULT_CONTRACT_VERSION = 1;

/**
 * The lifecycle states that a *result* may report.
 *
 * A subset of the eighteen, and deliberately so. `draft`,
 * `authorization-requested`, `authorized`, and `scheduled` are states a
 * communication passes *through* before anything is attempted — they are not
 * outcomes of an execution, and a result claiming one of them would be a result for
 * something that never ran.
 */
export const COMMUNICATION_RESULT_STATES = [
  'execution-submitted',
  'provider-accepted',
  'delivered',
  'read',
  'answered',
  'no-answer',
  'busy',
  'failed',
  'follow-up-requested',
  'human-handoff-required',
  'completed',
  'cancelled',
  'expired',
  'rejected',
] as const;

/**
 * States that mean the message or call actually reached the person.
 *
 * These, and only these, may accompany an outcome of `succeeded`. Note what is
 * absent: `execution-submitted` and `provider-accepted`. We handed it on. That is
 * not the same as it arriving, and this list is where that distinction is kept.
 */
const DELIVERED_STATES: readonly CommunicationState[] = [
  'delivered',
  'read',
  'answered',
  'completed',
];

const communicationResultShapeSchema = z.strictObject({
  communicationResultId: communicationResultIdSchema,
  contractVersion: z.literal(COMMUNICATION_RESULT_CONTRACT_VERSION),

  /** The governed communication this closes, and the execution chain behind it. */
  communicationId: communicationIdSchema,
  executionIntentId: executionIntentIdSchema,
  executionResultId: executionResultIdSchema,

  /** The authority. Always Core. Reporting is not authority. */
  issuer: quickfurnoCoreSchema,

  /** The Core-recorded lifecycle outcome. One of the eighteen — never a nineteenth. */
  lifecycleState: z.enum(COMMUNICATION_RESULT_STATES),

  /** Whether it worked. `indeterminate` is its own answer, and it is not a success. */
  outcome: executionOutcomeSchema,

  /** When Core recorded it. This is the moment it became true. */
  recordedAt: utcTimestampSchema,
  /** When the provider says it happened — where the provider says anything at all. */
  providerOccurredAt: utcTimestampSchema.optional(),

  /**
   * An opaque provider handle. Evidence, never authority, and never content.
   *
   * A message id a human can look up. Not the message.
   */
  providerEvidence: z
    .strictObject({
      providerReference: providerReferenceSchema,
    })
    .optional(),

  failure: executionFailureSchema.optional(),

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  correlationId: correlationIdSchema,
});

export const communicationResultV1Schema = communicationResultShapeSchema.superRefine(
  (value, ctx) => {
    // "Provider accepted is not delivered." Handing a message to a provider is not
    // the message arriving, and a success recorded here is a lie told to a founder.
    if (value.lifecycleState === 'provider-accepted' && value.outcome === 'succeeded') {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome'],
        message:
          '"provider-accepted" means the provider took it, not that anybody received it. It must never be recorded as "succeeded"',
      });
    }

    if (value.lifecycleState === 'execution-submitted' && value.outcome === 'succeeded') {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome'],
        message:
          '"execution-submitted" means the intent was dispatched, not that anything was delivered. It must never be recorded as "succeeded"',
      });
    }

    // A success must name a state in which the thing actually reached the person.
    if (value.outcome === 'succeeded' && !DELIVERED_STATES.includes(value.lifecycleState)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lifecycleState'],
        message: `A "succeeded" communication result must report a state in which it actually reached the recipient: ${DELIVERED_STATES.join(', ')}`,
      });
    }

    if (value.outcome === 'succeeded' && value.failure !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'A succeeded result must not carry a failure',
      });
    }

    if (value.outcome === 'failed' && value.failure === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'A failed result must carry a structured failure',
      });
    }

    // Ambiguity is routed to reconciliation, never to another attempt.
    if (value.outcome === 'indeterminate') {
      if (value.failure === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['failure'],
          message:
            'An indeterminate result must carry a structured failure classified as requires-reconciliation',
        });
      } else if (value.failure.retryClassification !== 'requires-reconciliation') {
        ctx.addIssue({
          code: 'custom',
          path: ['failure', 'retryClassification'],
          message:
            'An indeterminate outcome must be classified "requires-reconciliation": it must never be retried, and it must never be treated as success',
        });
      }

      if (DELIVERED_STATES.includes(value.lifecycleState)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lifecycleState'],
          message:
            'An indeterminate outcome cannot report a delivered state. If we do not know, we do not claim it arrived',
        });
      }
    }
  },
);

export type CommunicationResultV1 = z.infer<typeof communicationResultV1Schema>;
