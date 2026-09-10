/**
 * The closed vocabularies of the RAG provisioning boundary (QFJ-P04.05 ADR-0053; JF-3 ADR-0148).
 *
 * Every categorical value is one of these fixed sets — no open-ended enum, no arbitrary metadata, no
 * wildcard. The excluded vendor identifier appears nowhere.
 *
 * ### What JF-3 changed, and what it deliberately did not
 *
 * ADR-0053 shipped this boundary with no serving mode at all: two modes, one inert backend, and a
 * runtime that could not retrieve anything. That was the correct posture for a slice whose job was to
 * prove RAG was OFF. JF-3 supersedes exactly one part of it — a third mode, `ACTIVE`, and one backend
 * kind, `GOVERNED_EXACT`, which delegates to the existing governed-knowledge authority.
 *
 * `ENABLED` still does not exist, in any spelling. The `FUTURE_*` vector placeholders are still
 * placeholders and are still refused at runtime. Production V1 does deterministic exact retrieval, and
 * semantic/vector search stays a post-V1 question that real usage has not yet asked.
 */

/**
 * The closed provisioning modes.
 *
 * `DISABLED` is fully inert and remains the DEFAULT for an absent configuration. `PROVISIONED_NO_OP`
 * validates future-facing metadata and still does nothing — preserved byte-for-byte in behaviour so a
 * composition written against ADR-0053 keeps working. `ACTIVE` serves, and only under the exact
 * bindings JF-3 requires.
 *
 * There is still no `ENABLED` and no `enabled=true` flag: a boolean is exactly the shape that lets a
 * configuration mistake read as consent.
 */
export const RAG_PROVISIONING_MODES = ['DISABLED', 'PROVISIONED_NO_OP', 'ACTIVE'] as const;
export type RagProvisioningMode = (typeof RAG_PROVISIONING_MODES)[number];

/**
 * The closed backend kinds.
 *
 * `NONE` is what the inert modes pair with. `GOVERNED_EXACT` is the one real V1 backend and delegates
 * to the governed-knowledge retrieval authority — no index of its own, no ranking, no similarity. The
 * `FUTURE_*` values remain what ADR-0053 made them: placeholders that contact nothing and are refused
 * at runtime until a superseding ADR enables them. JF-3 did not enable them.
 */
export const RAG_BACKEND_KINDS = [
  'NONE',
  'GOVERNED_EXACT',
  'FUTURE_LOCAL_VECTOR',
  'FUTURE_MANAGED_VECTOR',
] as const;
export type RagBackendKind = (typeof RAG_BACKEND_KINDS)[number];

/**
 * The backend kind the historical no-op path pairs with. Unchanged: `PROVISIONED_NO_OP` still does
 * nothing, and `NONE` is still what it does it with.
 */
export const RUNTIME_ELIGIBLE_BACKEND: RagBackendKind = 'NONE';

/**
 * The ONE backend kind an `ACTIVE` profile may name (JF-3, ADR-0148).
 *
 * Deterministic exact retrieval delegated to the governed-knowledge authority. The `FUTURE_*` values
 * stay exactly what ADR-0053 made them: placeholders that contact nothing. Production V1 needs no
 * embedding, no vector index and no similarity search, so none is built — and an `ACTIVE` profile
 * naming one is refused rather than quietly downgraded.
 */
export const ACTIVE_ELIGIBLE_BACKEND: RagBackendKind = 'GOVERNED_EXACT';

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
  // JF-3 (ADR-0148). One success reason, then refusals decided from declarations alone.
  /** The provisioner is ACTIVE and bound. The only non-refusal reason in this vocabulary. */
  'rag-active',
  /** An ACTIVE profile was supplied with no retrieval backend to serve it. */
  'rag-backend-missing',
  /** The backend does not implement the kind the ACTIVE profile names. */
  'rag-backend-kind-mismatch',
  /** The profile knowledge revision is not the revision the supplied backend actually carries. */
  'rag-knowledge-revision-mismatch',
  /**
   * The knowledge revision is not an EXACT identity.
   *
   * `latest` is the whole problem in one word: it names whatever happens to be current, so an
   * approval written against it approves nothing in particular and silently re-approves every
   * future change to the pack.
   */
  'rag-knowledge-revision-not-exact',
  /** The retrieval request is not a valid bounded governed request. */
  'rag-request-invalid',
  /** The governed authority refused the retrieval. Its own reason is carried alongside. */
  'rag-retrieval-refused',
  /** The backend threw. The thrown value never escapes; this is what a caller sees instead. */
  'rag-backend-failed',
  /** Retrieval was attempted against a provisioner that is not ACTIVE. */
  'rag-not-active',
] as const;
export type RagReason = (typeof RAG_REASONS)[number];
