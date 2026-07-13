/**
 * **The taxonomy: cities, categories, subcategories — and the version that pins them.**
 *
 * QuickFurno Core owns the taxonomy. It creates a city, renames a category, moves a subcategory
 * under a different parent, and retires one that stopped selling. **Jarvis is told. Jarvis never
 * decides** — there is no create, update or deactivate that Jarvis can express, because these are
 * payloads on events **Core emits**, not commands Jarvis sends. Taxonomy administration is
 * Core/admin-only, and this file adds no authority to Jarvis whatsoever.
 *
 * ### IDs are for logic. Labels are for humans. Confusing them is the bug.
 *
 * A label is renamed by an admin on a Tuesday. *"Painter"* becomes *"Painting"* — and every rule,
 * projection and model feature keyed on the **string** silently changes meaning, with nothing
 * going red. QuickFurno already carries this exact wound: categories are **denormalised text**,
 * matched by **three divergent label/synonym rulesets**, with no foreign key from a vendor to a
 * category.
 *
 * So: **`categoryId` is permanent and is what logic uses. `categoryName` is a bounded display
 * label and is what a human reads.** A projection that groups by name is wrong the first time
 * somebody fixes a typo.
 *
 * ### Historical events keep their historical taxonomy
 *
 * Every taxonomy-bearing payload carries the **`taxonomyVersion` that was current when it
 * happened**, and it is never rewritten. An event from March saying `categoryId: cat_painter @
 * taxonomy 3` still says that after the April rename — and a replay of March reproduces March,
 * which is the whole promise of an immutable log. **Rewriting history to agree with the present
 * is how a replay stops being evidence.**
 */

import { z } from 'zod';

import { entityReferenceSchema } from '../common/entity-reference.js';
import { utcTimestampSchema } from '../common/timestamp.js';
import {
  contractPayloadV2,
  observationPayloadV2,
  taxonomyLabelSchema,
} from './payload-primitives.js';

/**
 * The taxonomy version in force.
 *
 * A monotonically increasing integer published by Core. **An integer, not a semantic version** —
 * "what would a patch release of a category list even mean?" has no good answer, and a single
 * integer forces every consumer to make an explicit decision.
 */
export const taxonomyVersionSchema = z.number().int().min(1).max(1_000_000);
export type TaxonomyVersion = z.infer<typeof taxonomyVersionSchema>;

/**
 * The taxonomy coordinates an event may carry: which version, and which nodes.
 *
 * `taxonomyVersion` is **mandatory** wherever a taxonomy node appears. An event that names a
 * category without saying which taxonomy it meant is an event nobody can interpret two renames
 * later — and it *will* be interpreted anyway, against today's taxonomy, silently and wrongly.
 */
export const taxonomyReferenceShape = {
  taxonomyVersion: taxonomyVersionSchema,
  cityId: entityReferenceSchema.optional(),
  cityName: taxonomyLabelSchema.optional(),
  categoryId: entityReferenceSchema.optional(),
  categoryName: taxonomyLabelSchema.optional(),
  subcategoryId: entityReferenceSchema.optional(),
  subcategoryName: taxonomyLabelSchema.optional(),
} as const;

/** A node's lifecycle. Core's word, not ours. */
export const TAXONOMY_NODE_STATES = ['active', 'deactivated'] as const;
export const taxonomyNodeStateSchema = z.enum(TAXONOMY_NODE_STATES);

/** The shape shared by every taxonomy node payload. */
const taxonomyNodeShape = {
  taxonomyVersion: taxonomyVersionSchema,
  nodeId: entityReferenceSchema,
  displayName: taxonomyLabelSchema,
  state: taxonomyNodeStateSchema,
  effectiveAt: utcTimestampSchema,
} as const;

// --- Cities ------------------------------------------------------------------------------

export const cityCreatedPayloadSchema = contractPayloadV2(taxonomyNodeShape);

export const cityUpdatedPayloadSchema = contractPayloadV2({
  ...taxonomyNodeShape,
  /** The label it had before. Bounded, and still not free text. */
  previousDisplayName: taxonomyLabelSchema.optional(),
});

export const cityDeactivatedPayloadSchema = contractPayloadV2(taxonomyNodeShape);

// --- Categories --------------------------------------------------------------------------

export const categoryCreatedPayloadSchema = contractPayloadV2(taxonomyNodeShape);

export const categoryUpdatedPayloadSchema = contractPayloadV2({
  ...taxonomyNodeShape,
  previousDisplayName: taxonomyLabelSchema.optional(),
});

export const categoryDeactivatedPayloadSchema = contractPayloadV2(taxonomyNodeShape);

// --- Subcategories -----------------------------------------------------------------------

export const subcategoryCreatedPayloadSchema = contractPayloadV2({
  ...taxonomyNodeShape,
  parentCategoryId: entityReferenceSchema,
});

/**
 * A subcategory **moved** to a different parent.
 *
 * This has its own payload rather than being folded into `-updated`, because a move changes what
 * the node *means* while its id and label stay identical. A consumer that treats a move as a
 * rename keeps a stale parent forever, and nothing tells it otherwise.
 */
export const subcategoryMovedPayloadSchema = contractPayloadV2({
  ...taxonomyNodeShape,
  parentCategoryId: entityReferenceSchema,
  previousParentCategoryId: entityReferenceSchema,
});

export const subcategoryUpdatedPayloadSchema = contractPayloadV2({
  ...taxonomyNodeShape,
  parentCategoryId: entityReferenceSchema,
  previousDisplayName: taxonomyLabelSchema.optional(),
});

export const subcategoryDeactivatedPayloadSchema = contractPayloadV2({
  ...taxonomyNodeShape,
  parentCategoryId: entityReferenceSchema,
});

// --- The version itself ------------------------------------------------------------------

/**
 * Core published a new taxonomy version.
 *
 * This is the event that makes the others interpretable. A consumer that has not seen
 * `qf.taxonomy.version-published@N` **must not** assume it understands an event stamped with
 * version `N` — it is missing the node set that gives the ids their meaning.
 */
export const taxonomyVersionPublishedPayloadSchema = observationPayloadV2({
  taxonomyVersion: taxonomyVersionSchema,
  previousTaxonomyVersion: taxonomyVersionSchema.optional(),
  effectiveAt: utcTimestampSchema,
});

/** The eleven taxonomy event types. */
export const TAXONOMY_EVENT_TYPES = [
  'qf.taxonomy.city-created',
  'qf.taxonomy.city-updated',
  'qf.taxonomy.city-deactivated',
  'qf.taxonomy.category-created',
  'qf.taxonomy.category-updated',
  'qf.taxonomy.category-deactivated',
  'qf.taxonomy.subcategory-created',
  'qf.taxonomy.subcategory-moved',
  'qf.taxonomy.subcategory-updated',
  'qf.taxonomy.subcategory-deactivated',
  'qf.taxonomy.version-published',
] as const;

export type TaxonomyEventType = (typeof TAXONOMY_EVENT_TYPES)[number];
