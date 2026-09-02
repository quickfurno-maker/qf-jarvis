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
type ResultBackedState = 'provider-accepted' | 'delivered' | 'read' | 'failed';

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
 * The fields every authorization evidence variant shares.
 *
 * `sourceEventId` is an **audit POINTER to provenance, never provenance itself** — an event id is a
 * name any caller can type. It is validated so a malformed id cannot sit in the record, but validity
 * is not authority: a naked UUID cannot make otherwise-invalid evidence valid, and there is
 * deliberately no helper anywhere that turns an event id into a record.
 */
const authorizationEvidenceBase = {
  tier: z.literal('tier-c'),
  kind: z.literal('communication-authorization'),
  sourceEventId: eventIdSchema,
  communicationRequestId: communicationRequestIdSchema,
} as const;

/**
 * Rejection evidence. **`authorizedChannel` is not a field here at all**, rather than an optional one.
 *
 * That distinction is load-bearing twice over. Statically, the inferred type for a `rejected` record
 * cannot even name the property. At runtime, `strictObject` treats an explicitly-passed
 * `authorizedChannel: undefined` as an unknown key and refuses it — where an `.optional()` field would
 * have quietly accepted it, which is exactly the hole this replaced.
 */
const rejectedEvidenceSchema = z.strictObject({
  ...authorizationEvidenceBase,
  outcome: z.literal('rejected'),
});

/** Authorization evidence. The channel is REQUIRED and can only be the one this runtime executes. */
const authorizedEvidenceSchema = z.strictObject({
  ...authorizationEvidenceBase,
  outcome: z.literal('authorized'),
  authorizedChannel: z.literal(SUPPORTED_AUTHORIZED_CHANNEL),
});

/**
 * Result evidence for ONE exact lifecycle state.
 *
 * Built per state so `state` and `evidence.lifecycleState` are the *same literal* in the type, not two
 * enums a runtime check has to reconcile afterwards. They are one fact stated twice; if the type let
 * them disagree, one of them would be decoration.
 *
 * Carries no `executionIntentId`, no `executionResultId`, no `providerEvidence`, no
 * `providerOccurredAt` and no `explanation` — exactly the minimisation D4 performs. The source
 * contract still mandates the execution ids; D4 parses them and strips them, and this record never
 * sees them.
 */
function resultEvidenceSchemaFor<S extends ResultBackedState>(lifecycleState: S) {
  return z.strictObject({
    tier: z.literal('tier-c'),
    kind: z.literal('communication-result'),
    sourceEventId: eventIdSchema,
    communicationResultId: communicationResultIdSchema,
    lifecycleState: z.literal(lifecycleState),
    outcome: executionOutcomeSchema,
    failure: minimisedFailureSchema.optional(),
  });
}

/** Fields every V2 record carries, whatever its state. */
const commonShape = {
  communicationId: communicationIdSchema,
  contractVersion: z.literal(COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION),
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
} as const;

/**
 * The six variants. **State/evidence coupling is STRUCTURAL, not a runtime afterthought.**
 *
 * A `z.union` of two broad branches plus a `superRefine` would reject the same inputs at runtime while
 * still letting the inferred TYPE describe impossible records — a `rejected` whose outcome is
 * `authorized`, or a `read` whose evidence says `delivered`. Discriminating on `state` and pinning
 * every coupled field to a literal makes those combinations unrepresentable, so a caller building a
 * record in TypeScript is corrected by the compiler rather than at parse time.
 */
const rejectedRecordSchema = z.strictObject({
  ...commonShape,
  state: z.literal('rejected'),
  evidence: rejectedEvidenceSchema,
});

const authorizedRecordSchema = z.strictObject({
  ...commonShape,
  state: z.literal('authorized'),
  evidence: authorizedEvidenceSchema,
});

const providerAcceptedRecordSchema = z.strictObject({
  ...commonShape,
  state: z.literal('provider-accepted'),
  evidence: resultEvidenceSchemaFor('provider-accepted'),
});

const deliveredRecordSchema = z.strictObject({
  ...commonShape,
  state: z.literal('delivered'),
  evidence: resultEvidenceSchemaFor('delivered'),
});

const readRecordSchema = z.strictObject({
  ...commonShape,
  state: z.literal('read'),
  evidence: resultEvidenceSchemaFor('read'),
});

const failedRecordSchema = z.strictObject({
  ...commonShape,
  state: z.literal('failed'),
  evidence: resultEvidenceSchemaFor('failed'),
});

/**
 * The first honest V2 record: six variants, each structurally bound to the evidence that produces it.
 *
 * The remaining runtime rules are the ones a type cannot express — the outcome/failure relationships,
 * which depend on values rather than shape. They **mirror `CommunicationResultV1` rather than
 * tightening it**.
 */
export const communicationStateRecordV2Schema = z
  .discriminatedUnion('state', [
    rejectedRecordSchema,
    authorizedRecordSchema,
    providerAcceptedRecordSchema,
    deliveredRecordSchema,
    readRecordSchema,
    failedRecordSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.evidence.kind === 'communication-authorization') {
      // Nothing left to check: `rejected`/`authorized`, their outcomes, and the presence or absence
      // of `authorizedChannel` are all pinned by the variant shapes above.
      return;
    }

    const { outcome, failure } = value.evidence;
    const reachedRecipient = DELIVERED_STATES.includes(value.state);

    if (outcome === 'succeeded' && !reachedRecipient) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'outcome'],
        message:
          'A "succeeded" outcome must report a state in which the communication actually reached the recipient',
      });
    }
    if (outcome === 'succeeded' && failure !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'failure'],
        message: 'A succeeded result must not carry a failure',
      });
    }
    if (outcome === 'failed' && failure === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidence', 'failure'],
        message: 'A failed result must carry a structured failure',
      });
    }
    if (outcome === 'indeterminate') {
      if (failure === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'failure'],
          message:
            'An indeterminate result must carry a structured failure classified as requires-reconciliation',
        });
      } else if (failure.retryClassification !== 'requires-reconciliation') {
        ctx.addIssue({
          code: 'custom',
          path: ['evidence', 'failure', 'retryClassification'],
          message:
            'An indeterminate outcome must be classified "requires-reconciliation": it must never be retried, and it must never be treated as success',
        });
      }
      if (reachedRecipient) {
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
