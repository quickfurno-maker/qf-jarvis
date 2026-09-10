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
 * ### The revision is the binding, and it is DERIVED (JF-3 owner correction)
 *
 * `PRODUCTION_KNOWLEDGE_PACK_REVISION` is what an ACTIVE profile names, and the provisioner refuses
 * unless the bound backend carries that same revision. It is computed from the records below by
 * `createRevisionBoundKnowledgePack` — a SHA-256 over the canonical form of every governed field of
 * every record — so it changes automatically whenever the pack's contents or governance metadata
 * change. Nobody chooses it, and nobody can label different records with it.
 *
 * `PRODUCTION_KNOWLEDGE_PACK_LABEL` is the human-readable name for this generation. It is display
 * metadata and NOT the approval binding: a label is what somebody typed, and the previous head proved
 * what a typed label is worth as a security property.
 *
 * ### What it cannot do
 *
 * No filesystem, no network, no environment, no clock, no database, no digest computation. The records
 * array is a literal, and the registry is built in memory from it.
 */
import type {
  KnowledgeObservabilityHook,
  KnowledgePrivacyGate,
  KnowledgeRecordInput,
} from '@qf-jarvis/governed-knowledge';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import type { RevisionBoundKnowledgePack } from '../contracts/revision-bound-knowledge-pack.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRevisionBoundKnowledgePack } from '../service/create-revision-bound-knowledge-pack.js';

/**
 * The human-readable name of this pack generation.
 *
 * `v0-empty` is deliberately self-describing: a deployment reading it is looking at a pack with no
 * records. It is metadata for people. It is NOT the approval binding and is never compared against a
 * profile -- {@link PRODUCTION_KNOWLEDGE_PACK_REVISION} is, and that one is derived from the records.
 */
export const PRODUCTION_KNOWLEDGE_PACK_LABEL = 'qfj.production.knowledge.v0-empty';

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
  /**
   * The AUTHORITATIVE revision: content-addressed, derived from the records, and the value an ACTIVE
   * profile must name. Changes whenever any record's text or governance metadata changes.
   */
  readonly revision: string;
  /** The human-readable generation name. Display metadata; never the approval binding. */
  readonly label: string;
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
 * approved source, a named approver and an owner-set classification. The pack revision then changes on
 * its own -- it is derived from exactly these records, so there is no way to add content and keep the
 * old approval identity, and no separate version somebody could forget to bump.
 */
export const PRODUCTION_KNOWLEDGE_RECORDS: readonly KnowledgeRecordInput[] = Object.freeze([]);

/**
 * The revision-bound production pack.
 *
 * Built once, from the literal above, at module evaluation: a pure synchronous computation with no
 * clock, no environment, no filesystem and no network. Every deployment of the same source therefore
 * derives the same revision, which is the property that makes an approval portable.
 */
const PRODUCTION_PACK: RevisionBoundKnowledgePack = createRevisionBoundKnowledgePack(
  PRODUCTION_KNOWLEDGE_RECORDS,
);

/**
 * The AUTHORITATIVE production knowledge revision.
 *
 * Content-addressed and derived -- `qfj.knowledge.sha256.<64 hex>` over the canonical form of every
 * governed field of every record above. Adding, removing or editing a record, or changing its
 * classification, permissions, approval, lifecycle, window, supersession or source identity, changes
 * this value. That is the whole point: an approval names a body of knowledge, not a label.
 */
export const PRODUCTION_KNOWLEDGE_PACK_REVISION = PRODUCTION_PACK.knowledgeRevision;

/** The manifest, derived from the pack rather than declared alongside it. */
export const PRODUCTION_KNOWLEDGE_PACK_MANIFEST: ProductionKnowledgePackManifest = Object.freeze({
  revision: PRODUCTION_PACK.knowledgeRevision,
  label: PRODUCTION_KNOWLEDGE_PACK_LABEL,
  recordCount: PRODUCTION_PACK.recordCount,
  topics: PRODUCTION_PACK.topics,
  hasApprovedContent: PRODUCTION_PACK.recordCount > 0,
  missing: MISSING_PRODUCTION_KNOWLEDGE,
});

/** The revision-bound production pack: registry and derived revision, inseparable. */
export function productionKnowledgePack(): RevisionBoundKnowledgePack {
  return PRODUCTION_PACK;
}

export interface ProductionRagBackendOptions {
  /** Optional subject privacy gate, passed to the authority verbatim. Never invented here. */
  readonly privacyGate?: KnowledgePrivacyGate;
  /** Optional content-free knowledge observability. */
  readonly observability?: KnowledgeObservabilityHook;
}

/**
 * Build the GOVERNED_EXACT backend for the production pack.
 *
 * It takes the whole bound pack, so the revision it reports is the one its own records produce. There
 * is no parameter through which a caller could claim an approved revision for a registry that is not
 * the approved one -- which is exactly the substitution the owner correction closed.
 */
export function createProductionRagBackend(
  options?: ProductionRagBackendOptions,
): RagRetrievalBackend {
  return createGovernedExactBackend({
    pack: PRODUCTION_PACK,
    ...(options?.privacyGate === undefined ? {} : { privacyGate: options.privacyGate }),
    ...(options?.observability === undefined ? {} : { observability: options.observability }),
  });
}
