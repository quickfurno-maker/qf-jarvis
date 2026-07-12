/**
 * AssignmentBatchV1 — the vendors a lead was actually offered to, in one batch.
 *
 * **Created by QuickFurno Core, and by nothing else.** `issuer` is the literal
 * `quickfurno-core`. Riya cannot construct a valid assignment batch, Jarvis cannot,
 * and no agent can — the shape refuses it. "Lead assignment is Core's, and so is the
 * whole assignment policy" (docs/architecture/responsibility-matrix.md).
 *
 * This is the same move the rest of the package makes with execution intents, and it
 * is made here for the same reason: an agent that can *manufacture the artifact* has,
 * in every way that matters, manufactured the authority.
 *
 * ### Every limit in the policy is enforced here, on one record
 *
 * | Rule | How |
 * | --- | --- |
 * | At most three vendors in a batch | `vendors` is `.max(3)` |
 * | Batch one, or batch two. Never three | `batchNumber` is a union of two literals |
 * | No vendor twice in one batch | uniqueness check on `vendors` |
 * | No vendor in **both** batches | overlap check — *when both lists are on the record* |
 * | At most six unique vendors | union of both batches — *within the declared history* |
 * | A replacement needs the client to have asked | `clientConfirmationId` required on batch two |
 * | A replacement needs Core to have authorized it | `reassignmentDecisionId` required on batch two |
 * | An initial batch is not a replacement | batch one must carry *none* of the above |
 *
 * Note the two italicised qualifications. They are load-bearing — see "What this schema
 * cannot prove" below.
 *
 * ### Why the replacement batch carries the previous batch's vendors
 *
 * Because a single record must be checkable on its own. The alternative — trusting a
 * caller to have counted correctly across two records it did not show us — is how the
 * lifetime cap becomes a rule that is true only when everyone remembers it.
 *
 * `previousBatchVendors` is therefore not redundant data. It is the evidence that
 * makes the overlap rule and the six-vendor cap **decidable by the validator**, at the
 * moment the batch is created, rather than by a query somebody might forget to run.
 *
 * ### What this schema cannot prove, and does not pretend to
 *
 * **A standalone contract cannot prove historical Core state.** It validates one record
 * against itself. It has no memory and no view of what else exists.
 *
 * So the six-vendor cap is enforced **within the history this record declares** — not
 * across separate records. Specifically, these remain **Core's** to enforce:
 *
 * - **Only one `batchNumber: 2` may ever exist for a lead-category.** Two such records
 *   both parse. Uniqueness across records is a question about history.
 * - **`previousBatchVendors` actually matches the authoritative batch 1.** The record
 *   asserts its own history; a caller could assert a false one.
 * - **`clientConfirmationId` and `reassignmentDecisionId` resolve to real records**, and
 *   the decision is still valid. An id is a pointer; its target is Core's.
 * - Vendor eligibility, capacity, location, category, credits, anti-abuse, and
 *   concurrency.
 *
 * Saying this plainly is the point. A schema that *appeared* to enforce the lifetime
 * invariant would be worse than one that admits it cannot, because nobody would then
 * build the thing that actually does (docs/contracts/assignment-and-reassignment.md).
 *
 * What the schema does buy is real: a malformed, over-sized, self-contradicting, or
 * agent-issued batch **cannot reach Core at all**.
 *
 * ### What is absent
 *
 * No vendor contact details, by any path. `vendors` holds opaque Core references, and
 * the entity-id character set excludes `@` and `+`. Core knows who the vendor is;
 * this contract knows only *which* vendor.
 */

import { z } from 'zod';

import {
  assignmentBatchIdSchema,
  clientConfirmationIdSchema,
  correlationIdSchema,
  reassignmentDecisionIdSchema,
} from '../common/identifiers.js';
import {
  batchNumberSchema,
  distinctEntityKeys,
  entityKey,
  INITIAL_BATCH_NUMBER,
  MAX_VENDORS_PER_BATCH,
  MAX_VENDORS_PER_LEAD_CATEGORY,
  REPLACEMENT_BATCH_NUMBER,
} from './assignment-policy.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { reasonCodeSchema } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const ASSIGNMENT_BATCH_CONTRACT_VERSION = 1;

const assignmentBatchShapeSchema = z.strictObject({
  assignmentBatchId: assignmentBatchIdSchema,
  contractVersion: z.literal(ASSIGNMENT_BATCH_CONTRACT_VERSION),

  /** The lead-category pair this batch belongs to. The cap is scoped to exactly this pair. */
  lead: entityReferenceSchema,
  category: entityReferenceSchema,
  client: entityReferenceSchema,

  batchNumber: batchNumberSchema,

  /** At most three. Opaque Core references — never vendor contact data. */
  vendors: z.array(entityReferenceSchema).min(1).max(MAX_VENDORS_PER_BATCH),

  /** Only QuickFurno Core creates a batch. Riya never assigns. */
  issuer: quickfurnoCoreSchema,

  createdAt: utcTimestampSchema,

  /**
   * Replacement-only. Required on batch two, forbidden on batch one.
   *
   * The client asked (`clientConfirmationId`), Core agreed (`reassignmentDecisionId`),
   * and here is what they are replacing (`previousBatchVendors`).
   */
  clientConfirmationId: clientConfirmationIdSchema.optional(),
  reassignmentDecisionId: reassignmentDecisionIdSchema.optional(),
  previousBatchId: assignmentBatchIdSchema.optional(),
  previousBatchVendors: z.array(entityReferenceSchema).min(1).max(MAX_VENDORS_PER_BATCH).optional(),

  reasonCode: reasonCodeSchema,

  correlationId: correlationIdSchema,
});

/** The four fields that only a replacement batch may carry. */
const REPLACEMENT_ONLY_FIELDS = [
  'clientConfirmationId',
  'reassignmentDecisionId',
  'previousBatchId',
  'previousBatchVendors',
] as const;

export const assignmentBatchV1Schema = assignmentBatchShapeSchema.superRefine((value, ctx) => {
  // A vendor listed twice in one batch is either a bug or an attempt to look like
  // three options while offering two.
  const vendorKeys = distinctEntityKeys(value.vendors);
  if (vendorKeys.size !== value.vendors.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['vendors'],
      message: 'A vendor must not appear twice in the same assignment batch',
    });
  }

  if (value.batchNumber === INITIAL_BATCH_NUMBER) {
    // An initial batch that carries a client confirmation and a reassignment
    // decision is a replacement batch wearing a "1". Refuse it, or the lifetime cap
    // is trivially defeated by relabelling.
    for (const field of REPLACEMENT_ONLY_FIELDS) {
      if (value[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `An initial batch (batchNumber ${String(INITIAL_BATCH_NUMBER)}) replaces nothing, so it must not carry "${field}"`,
        });
      }
    }
    return;
  }

  // From here on: batchNumber === REPLACEMENT_BATCH_NUMBER.

  // A replacement the client never asked for is the single worst outcome this
  // contract exists to prevent: three new vendors contacted about somebody's home
  // because an agent inferred dissatisfaction.
  if (value.clientConfirmationId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['clientConfirmationId'],
      message:
        'A replacement batch requires an explicit client confirmation. Dissatisfaction is never inferred, and silence is never a request',
    });
  }

  if (value.reassignmentDecisionId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['reassignmentDecisionId'],
      message:
        'A replacement batch exists only because QuickFurno Core authorized a reassignment, so reassignmentDecisionId is required',
    });
  }

  if (value.previousBatchId === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['previousBatchId'],
      message: 'A replacement batch must name the batch it replaces',
    });
  }

  if (value.previousBatchVendors === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['previousBatchVendors'],
      message:
        'A replacement batch must carry the vendors it is replacing, so that the overlap rule and the lifetime cap are decidable from this record alone',
    });
    return;
  }

  const previousKeys = distinctEntityKeys(value.previousBatchVendors);

  // Re-offering a vendor the client has just rejected is the exact thing a
  // "replacement" is not.
  const overlap = value.vendors.filter((vendor) => previousKeys.has(entityKey(vendor)));
  if (overlap.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['vendors'],
      message:
        'A replacement batch must contain vendors the client has not already been offered. No vendor may appear in both batches',
    });
  }

  // The lifetime cap, checked on the union rather than on the sum — because a
  // vendor in both batches is one vendor, and a rule that counts them twice is a
  // rule that can be gamed.
  const lifetimeKeys = new Set([...previousKeys, ...vendorKeys]);
  if (lifetimeKeys.size > MAX_VENDORS_PER_LEAD_CATEGORY) {
    ctx.addIssue({
      code: 'custom',
      path: ['vendors'],
      message: `A lead-category may reach at most ${String(MAX_VENDORS_PER_LEAD_CATEGORY)} unique vendors in its lifetime, across both batches`,
    });
  }

  // A replacement may not replace itself.
  if (value.previousBatchId === value.assignmentBatchId) {
    ctx.addIssue({
      code: 'custom',
      path: ['previousBatchId'],
      message: 'A batch may not replace itself',
    });
  }
});

export type AssignmentBatchV1 = z.infer<typeof assignmentBatchV1Schema>;

/** The replacement batch number, re-exported for callers building one. */
export { REPLACEMENT_BATCH_NUMBER, INITIAL_BATCH_NUMBER };
