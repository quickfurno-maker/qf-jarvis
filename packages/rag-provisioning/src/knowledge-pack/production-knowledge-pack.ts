/**
 * The revision-bound PRODUCTION knowledge pack (JF-3, ADR-0148).
 *
 * ### It is empty, and that is the finding
 *
 * This pack ships ZERO production records. Repository inspection found no accepted business-knowledge
 * source to build one from: the synthetic corpora state in their own headers that their content is
 * invented, and the architecture documents describe the system rather than the business. Nothing in
 * this repository has been reviewed and approved as customer-facing truth.
 *
 * So the mechanism is real and the content is absent, which is the only honest combination available.
 * The alternative — filling this file with plausible package prices, warranty terms, delivery
 * timelines, service cities or vendor counts — would produce a pack that passes every test and then
 * tells a customer something nobody ever approved. A grounding store that is confidently wrong is
 * strictly worse than one that is empty, because an empty one refuses and a wrong one persuades.
 *
 * An empty pack is not a broken pack, and it is not silently useless either. An ACTIVE profile bound
 * to it composes and is genuinely ACTIVE — and every retrieval against it REFUSES, with
 * `rag-retrieval-refused` and the authority's own `knowledge-not-found`, because the governed
 * authority fails a whole retrieval whose selector resolves to nothing rather than returning an empty
 * success. A caller therefore cannot mistake "no approved knowledge exists" for "nothing applies
 * here": it is told, on every request, that it has no grounding.
 *
 * ### The revision is the binding
 *
 * `PRODUCTION_KNOWLEDGE_PACK_REVISION` is what an ACTIVE profile names as its `knowledgeRevision`, and
 * the provisioner refuses unless the bound backend carries that same revision. The revision is
 * therefore a claim about WHICH body of knowledge was approved — and it must change whenever the
 * records do. `v0-empty` says what this one contains.
 *
 * ### What it cannot do
 *
 * No filesystem, no network, no environment, no clock, no database, no digest computation. The records
 * array is a literal, and the registry is built in memory from it.
 */
import { createGovernedKnowledgeRegistry } from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeObservabilityHook,
  KnowledgePrivacyGate,
  KnowledgeRecordInput,
} from '@qf-jarvis/governed-knowledge';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';

/**
 * The exact revision of this pack.
 *
 * `v0-empty` is deliberately self-describing: a deployment that pins it is pinning a pack with no
 * records. The first pack carrying owner-approved content takes a NEW revision, and every ACTIVE
 * profile then has to be re-approved against it rather than inheriting the approval of an empty one.
 */
export const PRODUCTION_KNOWLEDGE_PACK_REVISION = 'qfj.production.knowledge.v0-empty';

/**
 * One owner-supplied input this pack still needs.
 *
 * These are the fields the governed record contract REQUIRES, listed so the gap is actionable rather
 * than a shrug. Each names a repository-owned field; none of them guesses at its value.
 */
export interface MissingKnowledgeItem {
  /** What the owner must supply. */
  readonly item: string;
  /** The governed field it becomes, so there is no ambiguity about what is being asked for. */
  readonly requiredField: string;
  /** Why the pack cannot be built without it. */
  readonly blocks: string;
}

/**
 * Exactly what is missing, derived from the governed record contract rather than from imagination.
 *
 * Every entry is a field `createKnowledgeRecord` requires and that only the business owner can
 * legitimately provide. Nothing here names a product, a price, a city, a timeline or a term, because
 * this repository has no approved source for any of those and a placeholder would become the answer.
 */
export const MISSING_PRODUCTION_KNOWLEDGE: readonly MissingKnowledgeItem[] = Object.freeze([
  Object.freeze({
    item: 'The exact topic identifiers a deployment will ground on.',
    requiredField: 'KnowledgeRecordInput.topic',
    blocks:
      'Retrieval is exact-selector only. With no approved topic, there is no selector a request could name.',
  }),
  Object.freeze({
    item: 'The reviewed, approved text of each topic, as the business wants it stated to a customer.',
    requiredField: 'KnowledgeRecordInput.content',
    blocks:
      'This is the answer a customer reads. It is the one field that cannot be inferred, derived or reconstructed from anything in this repository.',
  }),
  Object.freeze({
    item: 'The approved source document each record is drawn from, and its revision.',
    requiredField: 'KnowledgeRecordInput.sourceRef / sourceRevision',
    blocks:
      'Every returned record is cited by source and revision. Without a real source, the citation would attest to a document that does not exist.',
  }),
  Object.freeze({
    item: 'The approver identity and approval instant for each record.',
    requiredField: 'KnowledgeRecordInput.approvedBy / approvedAt',
    blocks:
      'APPROVED, ACTIVE and RETIRED records require attributable approval. A record cannot become ACTIVE without a named human who approved it.',
  }),
  Object.freeze({
    item: 'The effective window of each record, and an expiry for anything time-bound.',
    requiredField: 'KnowledgeRecordInput.effectiveFrom / expiresAt',
    blocks:
      'Freshness is enforced, not assumed. A record with no owner-set window would either never expire or expire arbitrarily.',
  }),
  Object.freeze({
    item: 'The data classification of each record.',
    requiredField: 'KnowledgeRecordInput.classification',
    blocks:
      'Classification decides whether a hosted model may ever see the text. Guessing it is how LOCAL_ONLY or HUMAN_ONLY material reaches a hosted provider.',
  }),
  Object.freeze({
    item: 'The retrieval permissions of each record: tenants, agent scopes and purposes.',
    requiredField: 'KnowledgeRecordInput.permissions',
    blocks:
      'Permissions decide who may retrieve a record. A default would be a decision about disclosure made by this file rather than by the business.',
  }),
  Object.freeze({
    item: 'The accepted revision identifier for the first content-bearing pack.',
    requiredField: 'PRODUCTION_KNOWLEDGE_PACK_REVISION',
    blocks:
      'The revision is what an ACTIVE profile approves. A new body of knowledge under the old revision would inherit an approval it never earned.',
  }),
]);

/** The manifest of this pack. Content-free by construction: there is no content to describe. */
export interface ProductionKnowledgePackManifest {
  readonly revision: string;
  /** The number of production records this pack ships. Currently, and truthfully, zero. */
  readonly recordCount: number;
  /** The exact topics this pack can serve. Empty while `recordCount` is zero. */
  readonly topics: readonly string[];
  /** Whether the pack holds owner-approved business content. */
  readonly hasApprovedContent: boolean;
  /** What is still required before it can. */
  readonly missing: readonly MissingKnowledgeItem[];
}

/**
 * The production records.
 *
 * EMPTY. Adding an entry here is a business-content decision, not an engineering one: it requires an
 * approved source, a named approver and an owner-set classification, and it requires the pack revision
 * to change in the same commit.
 */
export const PRODUCTION_KNOWLEDGE_RECORDS: readonly KnowledgeRecordInput[] = Object.freeze([]);

/** The manifest, derived from the records rather than declared alongside them. */
export const PRODUCTION_KNOWLEDGE_PACK_MANIFEST: ProductionKnowledgePackManifest = Object.freeze({
  revision: PRODUCTION_KNOWLEDGE_PACK_REVISION,
  recordCount: PRODUCTION_KNOWLEDGE_RECORDS.length,
  topics: Object.freeze([...new Set(PRODUCTION_KNOWLEDGE_RECORDS.map((r) => r.topic))].sort()),
  hasApprovedContent: PRODUCTION_KNOWLEDGE_RECORDS.length > 0,
  missing: MISSING_PRODUCTION_KNOWLEDGE,
});

/** Build the immutable registry for this pack. In memory, from the literal above, and nothing else. */
export function createProductionKnowledgeRegistry(): GovernedKnowledgeRegistry {
  return createGovernedKnowledgeRegistry(PRODUCTION_KNOWLEDGE_RECORDS);
}

export interface ProductionRagBackendOptions {
  /** Optional subject privacy gate, passed to the authority verbatim. Never invented here. */
  readonly privacyGate?: KnowledgePrivacyGate;
  /** Optional content-free knowledge observability. */
  readonly observability?: KnowledgeObservabilityHook;
}

/**
 * Build the GOVERNED_EXACT backend for the production pack, bound to this pack's exact revision.
 *
 * The revision is taken from the pack rather than accepted as a parameter: a caller that could pass
 * its own would be able to claim an approved revision for a registry that is not it, which is the one
 * thing the profile/backend revision check exists to prevent.
 */
export function createProductionRagBackend(
  options?: ProductionRagBackendOptions,
): RagRetrievalBackend {
  return createGovernedExactBackend({
    registry: createProductionKnowledgeRegistry(),
    knowledgeRevision: PRODUCTION_KNOWLEDGE_PACK_REVISION,
    ...(options?.privacyGate === undefined ? {} : { privacyGate: options.privacyGate }),
    ...(options?.observability === undefined ? {} : { observability: options.observability }),
  });
}
