/**
 * `@qf-jarvis/rag-provisioning` — the RAG provisioning boundary (ADR-0053; JF-3 ADR-0148).
 *
 * The smallest stable composition surface: the closed vocabularies, the profile/request factories and
 * types, the provisioner factory, the no-op invocation, the ACTIVE retrieval entry point, the
 * revision-bound pack factory, the GOVERNED_EXACT backend, the production knowledge pack, and the
 * content-free result/error/observability types. It does NOT export mutable internals or the synthetic
 * fixtures (those live under `./testing`).
 *
 * ### One thing this surface deliberately cannot do
 *
 * There is no exported way to pair an arbitrary registry with an arbitrary knowledge revision. A
 * revision is only ever DERIVED from the records it names, by `createRevisionBoundKnowledgePack`. The
 * earlier surface allowed the pairing, and measurement confirmed what that permitted: unapproved
 * records activating under an approved revision.
 *
 * ### What ACTIVE is, and what it is not
 *
 * ACTIVE is deterministic EXACT retrieval delegated to `@qf-jarvis/governed-knowledge`. There is still
 * no embedding, no vector index, no similarity ranking, no free-text query, no chunking, no external
 * service and no network seam anywhere in this package — an ACTIVE profile resolves exact identities
 * and exact topics through the governed authority, or it refuses.
 */

// Closed vocabularies.
export {
  RAG_PROVISIONING_MODES,
  RAG_BACKEND_KINDS,
  RUNTIME_ELIGIBLE_BACKEND,
  ACTIVE_ELIGIBLE_BACKEND,
  RAG_DATA_CLASSES,
  RAG_TASK_CLASSES,
  RAG_REASONS,
} from './contracts/vocabularies.js';
export type {
  RagProvisioningMode,
  RagBackendKind,
  RagDataClass,
  RagTaskClass,
  RagReason,
} from './contracts/vocabularies.js';

// Errors.
export { RagProvisioningError, RAG_ERROR_CODES } from './contracts/errors.js';
export type { RagErrorCode } from './contracts/errors.js';

// Profile / request / result.
export { createRagProvisioningProfile } from './contracts/provisioning-profile.js';
export type {
  RagProvisioningProfile,
  RagProvisioningProfileInput,
} from './contracts/provisioning-profile.js';
export { createRagRequestMetadata } from './contracts/request.js';
export type { RagRequestMetadata, RagRequestMetadataInput } from './contracts/request.js';
export type { RagNoOpResult } from './contracts/no-op-result.js';

// The retrieval seam, the revision-bound pack, and the bounded outcome (JF-3).
export type { RagRetrievalBackend } from './contracts/retrieval-backend.js';
export type { RevisionBoundKnowledgePack } from './contracts/revision-bound-knowledge-pack.js';
export type {
  RagRetrievalCounters,
  RagRetrievalOutcome,
  RagRetrievalRefused,
  RagRetrievalServed,
} from './contracts/retrieval-outcome.js';

// Observability.
export { NOOP_RAG_OBSERVABILITY } from './contracts/observability.js';
export type {
  RagEvent,
  RagEventType,
  RagNoOpEvent,
  RagRetrievalEvent,
  RagObservabilityHook,
} from './contracts/observability.js';

// Services.
export { createRagProvisioner } from './service/create-rag-provisioner.js';
export type {
  RagProvisioner,
  RagProvisionerState,
  CreateRagProvisionerOptions,
} from './service/create-rag-provisioner.js';
export { invokeNoOpRag } from './service/invoke-no-op-rag.js';
export type { InvokeNoOpRagOptions } from './service/invoke-no-op-rag.js';
export { invokeRagRetrieval } from './service/invoke-rag-retrieval.js';
export type { InvokeRagRetrievalOptions } from './service/invoke-rag-retrieval.js';
export { createGovernedExactBackend } from './service/governed-exact-backend.js';
export type { GovernedExactBackendOptions } from './service/governed-exact-backend.js';
// The ONLY way to obtain a knowledge revision: derive it from the records it names. There is
// deliberately no exported helper that pairs an arbitrary registry with an arbitrary revision.
export { createRevisionBoundKnowledgePack } from './service/create-revision-bound-knowledge-pack.js';

// The revision-bound production knowledge pack (JF-3). It currently holds ZERO records; the
// manifest says so, and enumerates exactly what the owner must still supply.
export {
  PRODUCTION_KNOWLEDGE_PACK_REVISION,
  PRODUCTION_KNOWLEDGE_PACK_LABEL,
  PRODUCTION_KNOWLEDGE_PACK_MANIFEST,
  PRODUCTION_KNOWLEDGE_RECORDS,
  MISSING_PRODUCTION_KNOWLEDGE,
  productionKnowledgePack,
  createProductionRagBackend,
} from './knowledge-pack/production-knowledge-pack.js';
export type {
  MissingKnowledgeItem,
  ProductionKnowledgePackManifest,
  ProductionRagBackendOptions,
} from './knowledge-pack/production-knowledge-pack.js';
