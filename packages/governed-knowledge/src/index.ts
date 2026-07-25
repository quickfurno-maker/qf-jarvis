/**
 * `@qf-jarvis/governed-knowledge` — the QFJ-P04.03 Governed Knowledge System (ADR-0051).
 *
 * The smallest stable composition surface: the closed vocabularies, the record/request factories and
 * types, the immutable registry factory, the deterministic bounded retrieval authority, the audit
 * lookup, the citation/result/privacy-gate/observability types, and the closed error/reason
 * vocabularies. It does NOT export mutable internals, conflict-resolution internals, or the test
 * privacy gate (that lives under `./testing`). Knowledge is evidence only; QuickFurno Core remains
 * the authoritative system of record.
 */

// Closed vocabularies.
export {
  KNOWLEDGE_LIFECYCLE_STATES,
  KNOWLEDGE_LIFECYCLE_TRANSITIONS,
  isValidLifecycleTransition,
  KNOWLEDGE_AUTHORITY_TIERS,
  authorityRank,
  KNOWLEDGE_SOURCE_TYPES,
  VOLATILE_SOURCE_TYPES,
  KNOWLEDGE_CONTENT_FORMATS,
  KNOWLEDGE_DATA_CLASSES,
  dataClassRank,
  KNOWLEDGE_AGENT_SCOPES,
  KNOWLEDGE_PURPOSES,
  KNOWLEDGE_SUBJECT_STATUSES,
  KNOWLEDGE_RETRIEVAL_REASONS,
} from './contracts/vocabularies.js';
export type {
  KnowledgeLifecycleState,
  KnowledgeAuthorityTier,
  KnowledgeSourceType,
  KnowledgeContentFormat,
  KnowledgeDataClass,
  KnowledgeAgentScope,
  KnowledgePurpose,
  KnowledgeSubjectStatus,
  KnowledgeRetrievalReason,
} from './contracts/vocabularies.js';

// Errors.
export { GovernedKnowledgeError, KNOWLEDGE_ERROR_CODES } from './contracts/errors.js';
export type { KnowledgeErrorCode } from './contracts/errors.js';

// Records and permissions.
export {
  createKnowledgeRecord,
  recordIdentityKey,
  MAX_RECORD_CONTENT_CHARS,
} from './contracts/knowledge-record.js';
export type {
  KnowledgeRecord,
  KnowledgeRecordInput,
  KnowledgeVersionRef,
} from './contracts/knowledge-record.js';
export { GLOBAL_TENANT } from './contracts/permissions.js';
export type { RetrievalPermissions } from './contracts/permissions.js';

// Requests, results, citation.
export { createRetrievalRequest, MAX_REQUEST_SELECTORS } from './contracts/retrieval-request.js';
export type {
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalRequestInput,
  KnowledgeSelectors,
} from './contracts/retrieval-request.js';
export type { KnowledgeRetrievalResult, RetrievedKnowledge } from './contracts/retrieval-result.js';
export type { KnowledgeCitation } from './contracts/citation.js';

// Privacy gate + observability (interfaces only; the concrete gate lives under ./testing).
export type { KnowledgePrivacyGate } from './contracts/privacy-gate.js';
export { NOOP_KNOWLEDGE_OBSERVABILITY } from './contracts/observability.js';
export type { KnowledgeEvent, KnowledgeObservabilityHook } from './contracts/observability.js';

// Registry.
export { createGovernedKnowledgeRegistry } from './registry/governed-knowledge-registry.js';
export type {
  GovernedKnowledgeRegistry,
  KnowledgeRecordSummary,
} from './registry/governed-knowledge-registry.js';

// Retrieval + audit.
export { retrieveGovernedKnowledge } from './retrieval/retrieve-governed-knowledge.js';
export type { RetrieveOptions } from './retrieval/retrieve-governed-knowledge.js';
export { auditLookup } from './retrieval/audit.js';
export type { KnowledgeAuditCitation } from './retrieval/audit.js';
