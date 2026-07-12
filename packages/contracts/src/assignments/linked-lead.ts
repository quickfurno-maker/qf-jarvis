/**
 * LinkedLeadCreatedV1 — QuickFurno Core created a *separate* lead for a new category.
 *
 * Linked, not merged. The word doing the work is **separate**.
 *
 * ### Independence is asserted as four literals, not as a promise
 *
 * `independence` carries four fields, each of which can only be `true`:
 * `independentConsent`, `independentVerification`, `independentScoring`,
 * `independentMatching`.
 *
 * A boolean that can only be `true` looks pointless until you ask what the `false`
 * case would have meant. It would have meant a kitchen lead inheriting a wardrobe
 * lead's consent — reaching vendors on the strength of a check it never passed. There
 * is no legitimate linked lead for which any of these is `false`, so `false` does not
 * parse. The fields exist to make the guarantee **explicit and checkable at the
 * boundary**, rather than an assumption that holds until somebody writes an adapter
 * that quietly copies the parent's state across.
 *
 * ### The new lead may not be the old lead
 *
 * `newLead` must not equal `originatingLead`. This is the check that stops the whole
 * mechanism from collapsing back into "widen the existing lead and call it linked" —
 * which would re-import every failure the separation was designed to prevent, while
 * appearing in the audit trail as if it had not.
 *
 * Likewise `newCategory` must differ from `originatingCategory`: a linked lead in the
 * same category is a second lead for the same need, and a second lead for the same
 * need is a second batch of three vendors that the lifetime cap exists to forbid.
 *
 * ### The new lead starts fresh — including its vendor cap
 *
 * The new lead-category pair gets its own initial batch of at most three, and its own
 * one-replacement allowance. It does **not** inherit the parent's consumed batches,
 * and it does not contribute to them. The cap is per lead-category, and this is a new
 * one (see assignment-policy.ts).
 *
 * ### Core creates it. Jarvis asked.
 *
 * `issuer` is the literal `quickfurno-core`, and `clientConfirmation` is mandatory —
 * the client actually said they also wanted this.
 */

import { z } from 'zod';

import {
  additionalServiceRequestIdSchema,
  correlationIdSchema,
  linkedLeadIdSchema,
} from '../common/identifiers.js';
import { clientConfirmationV1Schema } from './client-confirmation.js';
import { entityKey } from './assignment-policy.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { reasonCodeSchema } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const LINKED_LEAD_CONTRACT_VERSION = 1;

/**
 * The four independence guarantees. Each can only be `true`.
 *
 * See the file header for why a boolean with one legal value is the right shape
 * here: the illegal value is what we are refusing to let anyone express.
 */
export const leadIndependenceSchema = z.strictObject({
  /** The new lead's consent is its own. It is not inherited from the parent lead. */
  independentConsent: z.literal(true),
  /** It is verified on its own merits, not on the parent's. */
  independentVerification: z.literal(true),
  /** It is scored on its own merits. A wardrobe's score says nothing about a kitchen. */
  independentScoring: z.literal(true),
  /** It is matched to its own vendors, with its own fresh batch of at most three. */
  independentMatching: z.literal(true),
});

export type LeadIndependence = z.infer<typeof leadIndependenceSchema>;

const linkedLeadCreatedShapeSchema = z.strictObject({
  linkedLeadId: linkedLeadIdSchema,
  contractVersion: z.literal(LINKED_LEAD_CONTRACT_VERSION),

  /** Only QuickFurno Core creates a lead. Jarvis asked; Core did it. */
  issuer: quickfurnoCoreSchema,

  client: entityReferenceSchema,

  /** The new lead. Its own identity — not the parent's. */
  newLead: entityReferenceSchema,
  newCategory: entityReferenceSchema,

  /** Where it came from. A link, not a parent-child inheritance of state. */
  originatingLead: entityReferenceSchema,
  originatingCategory: entityReferenceSchema,

  /** The request this answers. */
  additionalServiceRequestId: additionalServiceRequestIdSchema,

  /** Mandatory. The client explicitly asked for this second thing. */
  clientConfirmation: clientConfirmationV1Schema,

  /** Four literals that can only be `true`. See leadIndependenceSchema. */
  independence: leadIndependenceSchema,

  createdAt: utcTimestampSchema,
  reasonCode: reasonCodeSchema,

  correlationId: correlationIdSchema,
});

export const linkedLeadCreatedV1Schema = linkedLeadCreatedShapeSchema.superRefine((value, ctx) => {
  // The check that stops "linked" from quietly meaning "the same lead, widened".
  if (entityKey(value.newLead) === entityKey(value.originatingLead)) {
    ctx.addIssue({
      code: 'custom',
      path: ['newLead'],
      message:
        'A linked lead must have its own identity. Reusing the originating lead is not a linked lead — it is the existing lead with a second category bolted on, which is exactly what the separation exists to prevent',
    });
  }

  // A linked lead in the same category is a duplicate of the lead we already have,
  // and it would mint a second batch of three vendors for one need.
  if (entityKey(value.newCategory) === entityKey(value.originatingCategory)) {
    ctx.addIssue({
      code: 'custom',
      path: ['newCategory'],
      message:
        'A linked lead must be in a different category from the lead it links to. Same-category needs belong to the existing lead',
    });
  }

  if (value.clientConfirmation.confirmedBy.entityId !== value.client.entityId) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientConfirmation', 'confirmedBy'],
      message: 'The confirming party must be the client the linked lead belongs to',
    });
  }
});

export type LinkedLeadCreatedV1 = z.infer<typeof linkedLeadCreatedV1Schema>;
