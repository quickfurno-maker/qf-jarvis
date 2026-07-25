/**
 * `@qf-jarvis/rag-provisioning` — the QFJ-P04.05 No-Op RAG Provisioning boundary (ADR-0053).
 *
 * The smallest stable composition surface: the closed vocabularies, the profile/request factories and
 * types, the inert provisioner factory, the no-op invocation, and the content-free result/error/
 * observability types. It does NOT export mutable internals or the synthetic fixtures (those live
 * under `./testing`). RAG is DISABLED: there is no retriever, embedding, vector, or network seam, and
 * every invocation is a content-free no-op with zero counters.
 */

// Closed vocabularies.
export {
  RAG_PROVISIONING_MODES,
  RAG_BACKEND_KINDS,
  RUNTIME_ELIGIBLE_BACKEND,
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

// Observability.
export { NOOP_RAG_OBSERVABILITY } from './contracts/observability.js';
export type { RagEvent, RagEventType, RagObservabilityHook } from './contracts/observability.js';

// Services.
export { createRagProvisioner } from './service/create-rag-provisioner.js';
export type {
  RagProvisioner,
  RagProvisionerState,
  CreateRagProvisionerOptions,
} from './service/create-rag-provisioner.js';
export { invokeNoOpRag } from './service/invoke-no-op-rag.js';
export type { InvokeNoOpRagOptions } from './service/invoke-no-op-rag.js';
