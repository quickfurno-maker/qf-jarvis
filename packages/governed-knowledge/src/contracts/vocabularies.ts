/**
 * The closed vocabularies of the governed-knowledge system (QFJ-P04.03, ADR-0051).
 *
 * Every categorical value a record, request, permission, or event may carry is one of these
 * fixed sets — there is no open-ended string enum, no arbitrary metadata bag, and no wildcard.
 * The excluded vendor identifier appears nowhere in this package.
 */

/**
 * The closed knowledge lifecycle. Retrieval serves `ACTIVE` only; `RETIRED` remains citable via a
 * separate audit lookup but is never current. There is no silent deletion and no auto-approval.
 */
export const KNOWLEDGE_LIFECYCLE_STATES = [
  'UPLOADED',
  'SCANNED',
  'REVIEWED',
  'APPROVED',
  'ACTIVE',
  'RETIRED',
] as const;
export type KnowledgeLifecycleState = (typeof KNOWLEDGE_LIFECYCLE_STATES)[number];

/**
 * The only permitted forward lifecycle transitions. Every other transition fails closed. Rollback is
 * an explicit re-activation of a prior approved version through a NEW immutable registry revision —
 * never an in-place backward transition here.
 */
export const KNOWLEDGE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<KnowledgeLifecycleState, readonly KnowledgeLifecycleState[]>
> = Object.freeze({
  UPLOADED: ['SCANNED'],
  SCANNED: ['REVIEWED'],
  REVIEWED: ['APPROVED'],
  APPROVED: ['ACTIVE'],
  ACTIVE: ['RETIRED'],
  RETIRED: [],
});

/** True iff `to` is a permitted forward transition from `from`. */
export function isValidLifecycleTransition(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): boolean {
  return KNOWLEDGE_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/**
 * The closed source-authority hierarchy, HIGHEST trust first. Live structured Core state remains
 * ABOVE and OUTSIDE this package; even `CORE_PUBLISHED_REFERENCE` is a governed snapshot/evidence
 * record, not live operational truth. General model knowledge is outside the registry (lowest trust).
 */
export const KNOWLEDGE_AUTHORITY_TIERS = [
  'CORE_PUBLISHED_REFERENCE',
  'APPROVED_BUSINESS_RULE',
  'APPROVED_INTERNAL_DOCUMENT',
  'APPROVED_WEBSITE_CONTENT',
  'APPROVED_EXTERNAL_REFERENCE',
] as const;
export type KnowledgeAuthorityTier = (typeof KNOWLEDGE_AUTHORITY_TIERS)[number];

/** The rank of an authority tier: 0 is the highest trust. Lower rank wins conflict resolution. */
export function authorityRank(tier: KnowledgeAuthorityTier): number {
  return KNOWLEDGE_AUTHORITY_TIERS.indexOf(tier);
}

/** The closed, launch-focused set of governed source types. */
export const KNOWLEDGE_SOURCE_TYPES = [
  'POLICY',
  'PACKAGE_REFERENCE',
  'PRODUCT_REFERENCE',
  'WEBSITE_CONTENT',
  'FAQ',
  'PROCESS_GUIDE',
  'TRAINING_REFERENCE',
  'EXTERNAL_REFERENCE',
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/**
 * Volatile source types whose facts go stale, so an `expiresAt` is REQUIRED. Package/product/website
 * facts must not outlive their freshness window.
 */
export const VOLATILE_SOURCE_TYPES: ReadonlySet<KnowledgeSourceType> = new Set([
  'PACKAGE_REFERENCE',
  'PRODUCT_REFERENCE',
  'WEBSITE_CONTENT',
]);

/** The closed content formats a record body may use. */
export const KNOWLEDGE_CONTENT_FORMATS = ['PLAIN_TEXT', 'MARKDOWN'] as const;
export type KnowledgeContentFormat = (typeof KNOWLEDGE_CONTENT_FORMATS)[number];

/**
 * The closed data classes, ordered LEAST → MOST restrictive. Reuses the canonical model data-class
 * semantics (ADR-0045): `HOSTED_ALLOWED` may enter a hosted model context; `LOCAL_ONLY` never does;
 * `HUMAN_ONLY` is never returned to a model at all.
 */
export const KNOWLEDGE_DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
export type KnowledgeDataClass = (typeof KNOWLEDGE_DATA_CLASSES)[number];

/** The restrictiveness rank of a data class: 0 (HOSTED_ALLOWED) is least restrictive. */
export function dataClassRank(dataClass: KnowledgeDataClass): number {
  return KNOWLEDGE_DATA_CLASSES.indexOf(dataClass);
}

/**
 * The closed agent scopes. Riya is CLIENT-only, Anisha is VENDOR-only, Aarohi is PROSPECT-only,
 * Jarvis is COORDINATION; SYSTEM is a non-agent internal scope. Capability retrieval never blurs
 * these authority boundaries.
 *
 * `PROSPECT` was added by the JF-4B/C/D owner correction (ADR-0150 §4a), and adding it was the whole
 * point rather than a convenience. Aarohi's acquisition domain owns a party that is explicitly NOT a
 * Core vendor, so reusing `VENDOR` would have let acquisition material and registered-vendor material
 * see each other — and reusing `CLIENT` or `COORDINATION` would have done the same across a different
 * boundary. A scope exists to say who may read a record; sharing one between two authorities is how a
 * record written for one of them reaches the other.
 */
export const KNOWLEDGE_AGENT_SCOPES = [
  'CLIENT',
  'VENDOR',
  'PROSPECT',
  'COORDINATION',
  'SYSTEM',
] as const;
export type KnowledgeAgentScope = (typeof KNOWLEDGE_AGENT_SCOPES)[number];

/**
 * The closed, launch-focused set of retrieval purpose/task classes.
 *
 * `PROSPECT_RESPONSE` joins the two existing response purposes (ADR-0150 §4a). A purpose says what a
 * retrieval is FOR, and an acquisition answer is not a client answer or a vendor answer: the three are
 * governed differently, and a record approved for one of them has not been approved for another.
 */
export const KNOWLEDGE_PURPOSES = [
  'CLIENT_RESPONSE',
  'VENDOR_RESPONSE',
  'PROSPECT_RESPONSE',
  'INTERNAL_REASONING',
  'POLICY_LOOKUP',
  'PACKAGE_LOOKUP',
  'PRODUCT_LOOKUP',
  'FAQ_LOOKUP',
  'EVALUATION',
] as const;
export type KnowledgePurpose = (typeof KNOWLEDGE_PURPOSES)[number];

/**
 * The closed subject-privacy statuses an injected privacy gate may report. Only `clear` permits
 * exposure; every other status blocks the record before its content is read.
 */
export const KNOWLEDGE_SUBJECT_STATUSES = [
  'clear',
  'erased',
  'anonymised',
  'tombstoned',
  'in-progress',
] as const;
export type KnowledgeSubjectStatus = (typeof KNOWLEDGE_SUBJECT_STATUSES)[number];

/**
 * The closed set of content-free retrieval reason codes (ADR-0051 §M). Carried on observability
 * events and on a failed retrieval; never accompanied by content, prompt, subject reference, or PII.
 */
export const KNOWLEDGE_RETRIEVAL_REASONS = [
  'knowledge-served',
  'knowledge-not-found',
  'knowledge-not-active',
  'knowledge-not-effective',
  'knowledge-expired',
  'knowledge-superseded',
  'knowledge-permission-denied',
  'knowledge-tenant-denied',
  'knowledge-data-class-denied',
  'knowledge-subject-erased',
  'knowledge-privacy-gate-missing',
  'knowledge-conflict',
  'knowledge-limit-exceeded',
  'knowledge-invariant',
] as const;
export type KnowledgeRetrievalReason = (typeof KNOWLEDGE_RETRIEVAL_REASONS)[number];
