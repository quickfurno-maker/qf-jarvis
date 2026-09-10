/**
 * The no-op RAG invocation (QFJ-P04.05, ADR-0053 §G).
 *
 * ALWAYS returns a content-free {@link RagNoOpResult} with exact zero counters — it performs no
 * retrieval, embedding, vector query, augmentation, chunking, indexing, network, or side effect. The
 * reason names why it did nothing: disabled, provisioned-no-op, invalid, a non-runtime-eligible
 * backend, or a missing future-facing reference. Deterministic: same provisioner → same result.
 *
 * JF-3 (ADR-0148) added an ACTIVE mode, and this function is NOT its entry point -- it still does
 * nothing, for every provisioner it is handed. ACTIVE retrieval is `invokeRagRetrieval`.
 */
import { noOpResult } from '../contracts/no-op-result.js';
import type { RagNoOpResult } from '../contracts/no-op-result.js';
import type { RagRequestMetadata } from '../contracts/request.js';
import type { RagObservabilityHook } from '../contracts/observability.js';
import { NOOP_RAG_OBSERVABILITY } from '../contracts/observability.js';
import { RUNTIME_ELIGIBLE_BACKEND } from '../contracts/vocabularies.js';
import type { RagReason } from '../contracts/vocabularies.js';
import type { RagProvisioner } from './create-rag-provisioner.js';

export interface InvokeNoOpRagOptions {
  readonly observability?: RagObservabilityHook;
}

function reasonFor(provisioner: RagProvisioner): RagReason {
  // JF-3. An ACTIVE, bound provisioner routed through the NO-OP entry point is a composition
  // defect: retrieval lives in `invokeRagRetrieval`. It still does nothing here -- but it is
  // reported as an invariant rather than as one of the ordinary no-op reasons, because none of
  // those would be true and a reason that is not true is worse than no reason at all.
  if (provisioner.state === 'active') {
    return 'rag-invariant';
  }
  if (provisioner.state === 'invalid') {
    return 'rag-profile-invalid';
  }
  const profile = provisioner.profile;
  if (provisioner.state === 'disabled' || profile === undefined || profile.mode === 'DISABLED') {
    return 'rag-disabled';
  }
  // PROVISIONED_NO_OP: still does nothing; name the precise precondition, if any is unmet.
  if (profile.backendKind !== RUNTIME_ELIGIBLE_BACKEND) {
    return 'rag-backend-not-runtime-eligible';
  }
  if (profile.knowledgeRevision === undefined) {
    return 'rag-knowledge-revision-missing';
  }
  if (profile.capabilityRef === undefined) {
    return 'rag-capability-reference-missing';
  }
  if (profile.evaluationEvidenceRef === undefined) {
    return 'rag-evaluation-reference-missing';
  }
  return 'rag-provisioned-no-op';
}

/**
 * Invoke the no-op boundary. Returns a content-free result with zero counters and a safe reason. The
 * optional request metadata is already content-free (validated by `createRagRequestMetadata`); it is
 * never used to retrieve anything.
 */
export function invokeNoOpRag(
  provisioner: RagProvisioner,
  request?: RagRequestMetadata,
  options?: InvokeNoOpRagOptions,
): RagNoOpResult {
  const hook = options?.observability ?? NOOP_RAG_OBSERVABILITY;
  const profile = provisioner.profile;
  const mode = profile?.mode ?? 'DISABLED';
  const profileId = profile?.profileId ?? request?.profileId ?? 'none';
  const profileVersion = profile?.profileVersion ?? request?.profileVersion ?? 0;
  const reason = reasonFor(provisioner);

  hook.onEvent(
    Object.freeze({
      type: 'rag-no-op',
      profileId,
      profileVersion,
      mode,
      backendKind: profile?.backendKind ?? 'NONE',
      reason,
      retrievalCount: 0,
      embeddingCount: 0,
      vectorQueryCount: 0,
      augmentedCharacterCount: 0,
    }),
  );

  return noOpResult(profileId, profileVersion, mode, reason);
}
