/**
 * The closed vocabularies of the no-op RAG provisioning boundary (QFJ-P04.05, ADR-0053).
 *
 * There are exactly two modes and NO `ENABLED`/`ACTIVE` mode; only one backend kind is runtime-
 * eligible, and it does nothing. Every categorical value is one of these fixed sets — no open-ended
 * enum, no arbitrary metadata, no wildcard. The excluded vendor identifier appears nowhere.
 */

/**
 * The closed provisioning modes. There is deliberately NO `ENABLED`/`ACTIVE` mode and no
 * `enabled=true`: RAG stays off. `DISABLED` is fully inert; `PROVISIONED_NO_OP` validates future-
 * facing metadata and still does nothing.
 */
export const RAG_PROVISIONING_MODES = ['DISABLED', 'PROVISIONED_NO_OP'] as const;
export type RagProvisioningMode = (typeof RAG_PROVISIONING_MODES)[number];

/**
 * The closed backend placeholders. There is NO backend adapter. `NONE` is the ONLY runtime-eligible
 * value; the `FUTURE_*` values are refused and contact nothing until a superseding ADR enables them.
 */
export const RAG_BACKEND_KINDS = ['NONE', 'FUTURE_LOCAL_VECTOR', 'FUTURE_MANAGED_VECTOR'] as const;
export type RagBackendKind = (typeof RAG_BACKEND_KINDS)[number];

/** The only runtime-eligible backend kind. Every other value is a no-op / refused. */
export const RUNTIME_ELIGIBLE_BACKEND: RagBackendKind = 'NONE';

/** The closed data classes (mirrors the model/knowledge data-class lattice). */
export const RAG_DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
export type RagDataClass = (typeof RAG_DATA_CLASSES)[number];

/** The closed task classes a content-free request may name (mirrors the capability task classes). */
export const RAG_TASK_CLASSES = [
  'INTENT_CLASSIFICATION',
  'STRUCTURED_EXTRACTION',
  'RESPONSE_GENERATION',
  'CONVERSATION_SUMMARY',
  'TOOL_INTENT_PROPOSAL',
  'RESPONSE_EVALUATION',
] as const;
export type RagTaskClass = (typeof RAG_TASK_CLASSES)[number];

/** The closed set of content-free no-op reason codes (ADR-0053 §H). */
export const RAG_REASONS = [
  'rag-disabled',
  'rag-provisioned-no-op',
  'rag-profile-invalid',
  'rag-profile-missing',
  'rag-evaluation-reference-missing',
  'rag-capability-reference-missing',
  'rag-knowledge-revision-missing',
  'rag-backend-not-runtime-eligible',
  'rag-invariant',
] as const;
export type RagReason = (typeof RAG_REASONS)[number];
