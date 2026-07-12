/**
 * The vendor assignment policy, as numbers rather than as prose.
 *
 * This file exists so that the limits are stated **once**. A rule that is written
 * as `3` in a schema, `three` in a document, and `MAX` in a test is a rule with
 * three chances to drift, and drift here means a real vendor is contacted about a
 * lead they should never have seen — or a client is quietly shopped to nine vendors
 * because nobody was counting across batches.
 *
 * ### The policy
 *
 * A qualified lead, **within one category**, is offered to at most three vendors.
 * If the client is genuinely dissatisfied with that batch, and **says so explicitly**,
 * Core may authorize **one** replacement batch of at most three *further* vendors,
 * none of whom appeared in the first.
 *
 * That is the end of it. Six unique vendors, per lead-category, for all time. There
 * is no third batch, and the shape of a third batch does not exist
 * (ADR-0015, docs/architecture/quickfurno-compatibility-directive.md).
 *
 * ### Why the cap is per *lead-category*, not per lead
 *
 * A client who initially wanted a wardrobe and later also wants a kitchen has not
 * used up their wardrobe vendors by exploring kitchens. The second need is a
 * **separate linked lead**, with its own identity, its own consent, its own
 * verification, its own scoring, and its own fresh batch of three
 * (see linked-lead.ts).
 *
 * Counting those two together would starve a legitimate second requirement.
 * Counting them as one lead would let a client walk through an unbounded number of
 * vendors by renaming what they wanted. The lead-category pair is the unit that
 * makes both of those wrong.
 *
 * ### Who may do any of this
 *
 * **QuickFurno Core, and only Core.** Riya may *notice* dissatisfaction, may *ask*
 * for a reassignment, and may carry the client's confirmation. Riya may not choose
 * a vendor, may not create a batch, and could not act on such a decision if she made
 * one — there is no write path, and `AssignmentBatchV1.issuer` is a literal
 * (docs/architecture/responsibility-matrix.md).
 */

import { z } from 'zod';

import type { EntityReference } from '../common/entity-reference.js';

/** At most three vendors in any one batch — initial or replacement. */
export const MAX_VENDORS_PER_BATCH = 3;

/** Two batches, ever: the initial one, and at most one replacement. */
export const MAX_BATCHES_PER_LEAD_CATEGORY = 2;

/**
 * Six unique vendors per lead-category, for all time.
 *
 * Not "three plus three, roughly". A vendor who appeared in the initial batch and
 * again in the replacement is **one** vendor, not two — and would also be a
 * re-offer of a vendor the client has already rejected, which is why the overlap
 * is refused outright rather than merely counted once.
 */
export const MAX_VENDORS_PER_LEAD_CATEGORY = 6;

export const INITIAL_BATCH_NUMBER = 1;
export const REPLACEMENT_BATCH_NUMBER = 2;

/**
 * The batch number. One, or two. There is no three.
 *
 * A union of literals rather than a bounded integer, because the closed set is the
 * point: a `batchNumber: 3` must be a *contract* violation a reviewer can see, not
 * an off-by-one somebody has to reason about.
 */
export const batchNumberSchema = z.union([
  z.literal(INITIAL_BATCH_NUMBER),
  z.literal(REPLACEMENT_BATCH_NUMBER),
]);

export type BatchNumber = z.infer<typeof batchNumberSchema>;

/**
 * A comparable key for an entity reference.
 *
 * Vendor uniqueness is decided on `entityType` **and** `entityId` together. Using
 * the id alone would let `{vendor, 42}` and `{client, 42}` collide, and a collision
 * in this particular check means a vendor overlap goes undetected.
 */
export function entityKey(reference: EntityReference): string {
  return `${reference.entityType}:${reference.entityId}`;
}

/** The distinct entities in a list, by key. */
export function distinctEntityKeys(references: readonly EntityReference[]): ReadonlySet<string> {
  return new Set(references.map(entityKey));
}
