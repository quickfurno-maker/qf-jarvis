/**
 * AdditionalServiceRequestV1 — the client wants something in a *different* category.
 *
 * A client who came for a wardrobe now also mentions a kitchen. That is not a change
 * to the wardrobe lead, and it must never be treated as one.
 *
 * ### Why this is a separate contract, and a separate lead
 *
 * The tempting shortcut is to widen the existing lead — add a category, offer it to a
 * few more vendors, keep one thread. It fails in three ways at once, and each one is
 * expensive:
 *
 * 1. **The vendor cap becomes meaningless.** Wardrobe vendors and kitchen vendors are
 *    different vendors. Counting them against one cap either starves the second need
 *    or blows through the first — and a client could be walked past an unbounded
 *    number of vendors simply by mentioning more rooms.
 *
 * 2. **Consent, verification, and scoring are silently inherited.** A lead qualified
 *    for a wardrobe is not thereby qualified for a kitchen. The budget is different,
 *    the plausibility is different, the vendors are different, and pretending
 *    otherwise means a kitchen lead reaches vendors having passed a wardrobe's checks.
 *
 * 3. **The audit trail forks.** One lead with two histories cannot answer "what was
 *    this client actually offered, and for what?"
 *
 * So a new category means a **new lead**, linked to the old one, with its own
 * identity, its own consent, its own verification, its own scoring, its own matching,
 * and its own fresh batch of three (see linked-lead.ts).
 *
 * ### The client must actually ask
 *
 * Riya may *identify* an additional service — that is exactly her domain. She may not
 * conclude one. `clientConfirmation` is mandatory before the linked lead is created,
 * for the same reason it is mandatory for a reassignment: a real person's project is
 * about to be shown to real vendors, and inferring that they wanted that is not good
 * enough.
 */

import { z } from 'zod';

import {
  additionalServiceRequestIdSchema,
  correlationIdSchema,
  eventIdSchema,
} from '../common/identifiers.js';
import { agentIdSchema, qfJarvisSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { clientConfirmationV1Schema } from './client-confirmation.js';
import { entityKey } from './assignment-policy.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { evidenceItemSchema, MAX_EVIDENCE_ITEMS } from '../recommendations/recommendation.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { policyReferenceSchema } from '../common/policy.js';

export const ADDITIONAL_SERVICE_REQUEST_CONTRACT_VERSION = 1;

const additionalServiceRequestShapeSchema = z.strictObject({
  additionalServiceRequestId: additionalServiceRequestIdSchema,
  contractVersion: z.literal(ADDITIONAL_SERVICE_REQUEST_CONTRACT_VERSION),

  client: entityReferenceSchema,

  /** Where the client came from. */
  originatingLead: entityReferenceSchema,
  originatingCategory: entityReferenceSchema,

  /** What they now also want. Must be a *different* category — that is the whole point. */
  proposedCategory: entityReferenceSchema,

  /** Only QF Jarvis identifies. Core creates the lead. */
  producingSystem: qfJarvisSchema,
  identifyingAgent: agentIdSchema,
  identifyingAgentVersion: machineTokenSchema,

  /** Why we think they want it. Mandatory and non-empty. */
  evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),

  /**
   * The client's explicit confirmation.
   *
   * **Optional at identification, mandatory before a linked lead is created.** Riya
   * may raise "this client appears to also want a kitchen" with evidence and no
   * confirmation; Core will not create the lead until the confirmation exists
   * (see linked-lead.ts, where it is required).
   */
  clientConfirmation: clientConfirmationV1Schema.optional(),

  summary: boundedText(TEXT_LIMITS.summary),
  reasonCode: reasonCodeSchema,

  policy: policyReferenceSchema,

  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,

  correlationId: correlationIdSchema,
  causationEventId: eventIdSchema.optional(),
});

export const additionalServiceRequestV1Schema = additionalServiceRequestShapeSchema.superRefine(
  (value, ctx) => {
    if (!isStrictlyBefore(value.createdAt, value.expiresAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be strictly after createdAt',
      });
    }

    // An "additional service" in the category they are already in is not an
    // additional service. It is the lead they already have, and routing it through
    // this contract would mint a second lead for the same need — and with it, a
    // second batch of three vendors that the cap was designed to prevent.
    if (entityKey(value.proposedCategory) === entityKey(value.originatingCategory)) {
      ctx.addIssue({
        code: 'custom',
        path: ['proposedCategory'],
        message:
          'An additional service must be in a different category from the originating lead. Same-category needs belong to the existing lead, not a new one',
      });
    }

    if (
      value.clientConfirmation !== undefined &&
      value.clientConfirmation.confirmedBy.entityId !== value.client.entityId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientConfirmation', 'confirmedBy'],
        message: 'The confirming party must be the client named on the request',
      });
    }
  },
);

export type AdditionalServiceRequestV1 = z.infer<typeof additionalServiceRequestV1Schema>;
