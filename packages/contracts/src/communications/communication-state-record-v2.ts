/**
 * `CommunicationStateRecordV2` — the first honest Model-2 communication state record (QFJ-P09 D3,
 * ADR-0141).
 *
 * ### What this contract IS
 *
 * A **Jarvis-LOCAL projection / read-model contract** for the exact six durable, evidence-bearing
 * states D2 (ADR-0137) selected and D2b (ADR-0139) confirmed. Every variant carries the **specific
 * Tier-C evidence** that state is derived from, so a record cannot exist without naming what it was
 * built out of.
 *
 * ### What it is NOT — and this list is the point
 *
 * It is **not** a Core wire payload, **not** a canonical event, **not** Core business history, **not**
 * permission, **not** authorization, **not** evidence by itself, **not** provenance by itself, **not**
 * a D4 trusted-evidence object, **not** a database row, and **not** a projection handler.
 *
 * **A shape-valid V2 record proves schema validity and nothing else.** There is deliberately no
 * `trusted`, `verified` or `authoritative` field, because a boolean a caller can type is not a fact.
 * **D5** will be the first producer, and it will build V2 only from D4's nominal trusted evidence —
 * which is why this file exposes no constructor that could manufacture a record from an id.
 *
 * ### Six states, not eighteen
 *
 * The domain vocabulary stays **18** (`COMMUNICATION_STATES` is untouched). What is *durable and
 * evidence-bearing* today is **six**. The two conditional Tier-B states (`authorization-requested`,
 * `scheduled`) are absent on purpose: admitting them would need a placeholder event name, a fake
 * receipt or scheduling id, or an evidence variant implying a durable replay source that does not
 * exist. ADR-0139 declined that, and so does this contract.
 *
 * ### Versions, which are three different axes
 *
 * | Axis | Value |
 * | --- | --- |
 * | this record contract | **2** |
 * | D4's target canonical **event wire** version | `@2` |
 * | nested `CommunicationAuthorizationV1` / `CommunicationResultV1` artifact contract | **1** |
 *
 * ### No V1 → V2 migration
 *
 * V1 is published, immutable, and **not generally convertible**: it admits all 18 states, its
 * `rejected` variant is self-contradictory (ADR-0134), and it can rest on execution ids D4
 * deliberately strips. **V2 is REBUILT from governed primitive evidence, never migrated from V1
 * records.** No conversion helper exists here, and none should be added.
 */
import { z } from 'zod';

import {
  communicationIdSchema,
  communicationRequestIdSchema,
  communicationResultIdSchema,
  correlationIdSchema,
  eventIdSchema,
} from '../common/identifiers.js';
import { reasonCodeSchema } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';
import {
  executionOutcomeSchema,
  retryClassificationSchema,
} from '../execution/execution-result.js';
import { communicationAuthorizationOutcomeSchema } from './communication-authorization.js';

/** This record contract's version. Distinct from the event wire version and the artifact version. */
export const COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION = 2;

/**
 * The six durable, evidence-bearing states.
 *
 * Deliberately its own list rather than a filter over `COMMUNICATION_STATES`: the domain vocabulary
 * and the durable subset move for different reasons and on different slices, and deriving one from
 * the other would silently widen this contract the day the vocabulary grows.
 */
export const COMMUNICATION_STATE_RECORD_V2_STATES = [
  'rejected',
  'authorized',
  'provider-accepted',
  'delivered',
  'read',
  'failed',
] as const;

export const communicationStateRecordV2StateSchema = z.enum(COMMUNICATION_STATE_RECORD_V2_STATES);
export type CommunicationStateRecordV2State = z.infer<typeof communicationStateRecordV2StateSchema>;

/** The four result lifecycle states, mirroring exactly what D4 admits. */
const RESULT_BACKED_STATES = ['provider-accepted', 'delivered', 'read', 'failed'] as const;
const resultBackedStateSchema = z.enum(RESULT_BACKED_STATES);

/** The states in which a communication actually reached the recipient (`CommunicationResultV1`). */
const DELIVERED_STATES: readonly string[] = ['delivered', 'read'];

/**
 * The only channel the first live runtime supports (ADR-0137 Q11).
 *
 * Core may lawfully authorize `sms`, `email` or `voice`, and `CommunicationAuthorizationV1` can
 * represent all of them — but this runtime cannot execute them, and a record that says `authorized`
 * for a channel nothing can send is a record that lies about capability. Widening this is a
 * deliberate future compatibility decision, not an oversight.
 */
const SUPPORTED_AUTHORIZED_CHANNEL = 'whatsapp';

/**
 * Minimised failure evidence: a machine code and a retry class.
 *
 * Deliberately NOT `executionFailureSchema` — D4 strips `failureCategory` and the free-text
 * `description`, so requiring the full schema would demand fields the only lawful producer cannot
 * supply, and inviting them back would re-open a free-text channel this projection has no business
 * carrying.
 */
const minimisedFailureSchema = z.strictObject({
  failureCode: reasonCodeSchema,
  retryClassification: retryClassificationSchema,
});

/**
 * Tier-C evidence from a Core communication AUTHORIZATION decision.
 *
 * `sourceEventId` is an **audit POINTER to provenance, never provenance itself** — an event id is a
 * name any caller can type. It is validated so a malformed id cannot sit in the record, but validity
 * is not authority: a naked UUID cannot make otherwise-invalid evidence valid, and there is
 * deliberately no helper anywhere that turns an event id into a record.
 */
const authorizationEvidenceSchema = z.strictObject({
  tier: z.literal('tier-c'),
  kind: z.literal('communication-authorization'),
  sourceEventId: eventIdSchema,
  communicationRequestId: communicationRequestIdSchema,
  outcome: communicationAuthorizationOutcomeSchema,
  /** Present only for `authorized`, and only for the channel this runtime can execute. */
  authorizedChannel: z.literal(SUPPORTED_AUTHORIZED_CHANNEL).optional(),
});

/**
 * Tier-C evidence from a Core-recorded communication RESULT.
 *
 * Carries no `executionIntentId`, no `executionResultId`, no `providerEvidence`, no
 * `providerOccurredAt` and no `explanation` — exactly the minimisation D4 performs. The source
 * contract still mandates the execution ids; D4 parses them and strips them, and this record simply
 * never sees them.
 */
const resultEvidenceSchema = z.strictObject({
  tier: z.literal('tier-c'),
  kind: z.literal('communication-result'),
  sourceEventId: eventIdSchema,
  communicationResultId: communicationResultIdSchema,
  lifecycleState: resultBackedStateSchema,
  outcome: executionOutcomeSchema,
  failure: minimisedFailureSchema.optional(),
});

/** Fields every V2 record carries, whatever its state. */
const commonShape = {
  communicationId: communicationIdSchema,
  contractVersion: z.literal(COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION),
  state: communicationStateRecordV2StateSchema,
  /**
   * When the underlying fact was recorded: the authorization's `decidedAt`, or the result's
   * `recordedAt`. **Never a wall clock, and never inferred** — a projection that timestamps itself
   * has invented a fact.
   */
  recordedAt: utcTimestampSchema,
  /**
   * Why this state was recorded. An OPEN machine token, kept open on purpose: Core's refusal taxonomy
   * is Core's, and closing it to a local enum would silently drop a reason Jarvis had never heard of.
   */
  reasonCode: reasonCodeSchema,
  correlationId: correlationIdSchema,
  /**
   * Optional context, **never source evidence**, and restricted to the same six durable states.
   *
   * It cannot name `authorization-requested`, `scheduled`, `completed` or any other excluded state —
   * writing one here would smuggle an undurable state into a durable record through the back door.
   */
  previousState: communicationStateRecordV2StateSchema.optional(),
};

const authorizationBackedSchema = z.strictObject({
  ...commonShape,
  state: z.enum(['rejected', 'authorized']),
  evidence: authorizationEvidenceSchema,
});

const resultBackedSchema = z.strictObject({
  ...commonShape,
  state: resultBackedStateSchema,
  evidence: resultEvidenceSchema,
});

/**
 * The first honest V2 record: six states, each bound to the exact evidence that can produce it.
 *
 * The cross-field rules below are the ones that stop a schema-valid record from being a false one.
 */
export const communicationStateRecordV2Schema = z
  .union([authorizationBackedSchema, resultBackedSchema])
  .superRefine((value, ctx) => {
    if (value.evidence.kind === 'communication-authorization') {
      /**
       * **This is the ADR-0134 deadlock, resolved.**
       *
       * V1 required an `approvalDecisionId` for `rejected` while `CommunicationAuthorizationV1`
       * FORBIDS one on a refusal — so a lawful opt-out could not become a lawful V1 record without
       * attaching a human approval id to a decision no human made. V2 has no `approvalDecisionId`
       * field at all, so a rejection needs no invented id and cannot carry one. V1's behaviour is
       * unchanged and still pinned by its characterization tests.
       */
      if (value.state === 'rejected' && value.evidence.outcome !== 'rejected') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'outcome'],
          message: 'A "rejected" state must rest on an authorization whose outcome is "rejected"',
        });
      }
      if (value.state === 'rejected' && value.evidence.authorizedChannel !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'authorizedChannel'],
          message: 'A refusal authorizes no channel, so it must not name one',
        });
      }
      if (value.state === 'authorized') {
        if (value.evidence.outcome !== 'authorized') {
          ctx.addIssue({
            code: 'custom',
            path: ['evidence', 'outcome'],
            message:
              'An "authorized" state must rest on an authorization whose outcome is "authorized"',
          });
        }
        if (value.evidence.authorizedChannel === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['evidence', 'authorizedChannel'],
            message:
              'An authorized communication must name the channel it was authorized for. The first runtime supports WhatsApp only',
          });
        }
      }
      return;
    }

    // Result-backed. The record's state and the evidence's lifecycle state are the same fact stated
    // twice; if they can disagree, one of them is decoration.
    if (value.state !== value.evidence.lifecycleState) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'lifecycleState'],
        message:
          'The recorded state and the result evidence lifecycle state must be the same state',
      });
    }

    // These mirror CommunicationResultV1 rather than tightening it: the provider taking a message is
    // not delivery, a failure must be structured, and ambiguity routes to reconciliation instead of
    // being reported as success.
    if (value.evidence.outcome === 'succeeded' && !DELIVERED_STATES.includes(value.state)) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'outcome'],
        message:
          'A "succeeded" outcome must report a state in which the communication actually reached the recipient',
      });
    }
    if (value.evidence.outcome === 'succeeded' && value.evidence.failure !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'failure'],
        message: 'A succeeded result must not carry a failure',
      });
    }
    if (value.evidence.outcome === 'failed' && value.evidence.failure === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'failure'],
        message: 'A failed result must carry a structured failure',
      });
    }
    if (value.evidence.outcome === 'indeterminate') {
      if (value.evidence.failure === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'failure'],
          message:
            'An indeterminate result must carry a structured failure classified as requires-reconciliation',
        });
      } else if (value.evidence.failure.retryClassification !== 'requires-reconciliation') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'failure', 'retryClassification'],
          message:
            'An indeterminate outcome must be classified "requires-reconciliation": it must never be retried, and it must never be treated as success',
        });
      }
      if (DELIVERED_STATES.includes(value.state)) {
        ctx.addIssue({
          code: 'custom',
          path: ['state'],
          message:
            'An indeterminate outcome cannot report a delivered state. If we do not know, we do not claim it arrived',
        });
      }
    }
  });

export type CommunicationStateRecordV2 = z.infer<typeof communicationStateRecordV2Schema>;
