/**
 * The ACTIVE RAG retrieval entry point (JF-3, ADR-0148).
 *
 * ### One entry point, one attempt, one authority
 *
 * A provisioner that is ACTIVE and bound calls its backend exactly once and returns what the governed
 * authority returned. There is no retry, no widening of a request that returned nothing, no second
 * selector, no fallback store and no cache. A retrieval that finds nothing is a retrieval that found
 * nothing — trying again with a looser request is how a bounded exact lookup turns into a search.
 *
 * ### Everything it refuses, it refuses before touching the backend
 *
 * Not ACTIVE, no bound backend, a request that is not a valid bounded governed request: all decided
 * here, from declarations, with `retrievalCount: 0`. The backend is called only once the attempt is
 * known to be legitimate -- and once it HAS been called, `retrievalCount` is 1 even if the authority
 * then refused, because the counter records what this boundary did rather than how well it went.
 *
 * ### The request is checked, not repaired
 *
 * `createRetrievalRequest` is the authority on what a valid request is, and this function does not
 * reimplement it. What it does is refuse a request that was never built by that factory — a plain
 * object cast through `as`, or one mutated afterwards. The checks are the load-bearing invariants
 * only: an exact selector must be present, and `requireCitation` must be `true`. A request is never
 * silently corrected, because a corrected request is a request the caller did not make.
 *
 * ### A thrown backend never escapes
 *
 * The seam is synchronous and in-memory, so a throw means a defect rather than an outage — but a
 * defect that propagates out of a retrieval boundary becomes an unhandled rejection somewhere far from
 * here, and worse, the thrown value may carry the very content this boundary exists to bound. It is
 * caught, discarded unread, and reported as `rag-backend-failed`.
 */
import type {
  KnowledgeRetrievalReason,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
  RetrievedKnowledge,
} from '@qf-jarvis/governed-knowledge';

import type { RagObservabilityHook } from '../contracts/observability.js';
import { NOOP_RAG_OBSERVABILITY } from '../contracts/observability.js';
import type { RagRetrievalCounters, RagRetrievalOutcome } from '../contracts/retrieval-outcome.js';
import type { RagReason } from '../contracts/vocabularies.js';
import type { RagProvisioner } from './create-rag-provisioner.js';

export interface InvokeRagRetrievalOptions {
  readonly observability?: RagObservabilityHook;
}

/** The counters of a refusal. `called` records whether the backend was actually invoked first. */
function refusedCounters(called: boolean): RagRetrievalCounters {
  return Object.freeze({
    retrievalCount: called ? (1 as const) : (0 as const),
    embeddingCount: 0,
    vectorQueryCount: 0,
    augmentedCharacterCount: 0,
  });
}

/**
 * Is this a bounded exact governed request?
 *
 * Deliberately narrow: the full schema belongs to `createRetrievalRequest`. This rejects the shapes
 * that a cast could smuggle past the type system and that would change what retrieval MEANS — a
 * selector-free request (which is the "return anything" mode the governed contract does not have) and
 * a request that does not require a citation.
 *
 * The parameter is `unknown` on purpose. Typing it as the request would make every check below look
 * redundant to the compiler and the linter — and they would be right about the DECLARED type and
 * wrong about reality, because the whole reason this function exists is the caller who wrote
 * `as unknown as KnowledgeRetrievalRequest` one package away. Narrowing from `unknown` is the shape
 * in which the checks are honest.
 */
function isBoundedGovernedRequest(request: unknown): request is KnowledgeRetrievalRequest {
  if (request === null || typeof request !== 'object') {
    return false;
  }
  const candidate = request as {
    requireCitation?: unknown;
    requestId?: unknown;
    selectors?: { ids?: unknown; topics?: unknown } | null;
  };
  if (candidate.requireCitation !== true) {
    return false;
  }
  if (typeof candidate.requestId !== 'string' || candidate.requestId.length === 0) {
    return false;
  }
  const selectors = candidate.selectors;
  if (selectors === null || selectors === undefined || typeof selectors !== 'object') {
    return false;
  }
  const ids = Array.isArray(selectors.ids) ? selectors.ids.length : 0;
  const topics = Array.isArray(selectors.topics) ? selectors.topics.length : 0;
  return ids + topics > 0;
}

/** The real character total of returned governed content. Measured, never estimated. */
function charactersOf(records: readonly RetrievedKnowledge[]): number {
  let total = 0;
  for (const entry of records) {
    total += entry.record.content.length;
  }
  return total;
}

/**
 * Attempt one bounded governed retrieval through an ACTIVE provisioner.
 *
 * Returns a fail-closed {@link RagRetrievalOutcome}. It never throws, never returns partial records,
 * and never invokes a provider, a model, a network endpoint, an embedding or a vector index.
 */
export function invokeRagRetrieval(
  provisioner: RagProvisioner,
  request: KnowledgeRetrievalRequest,
  options?: InvokeRagRetrievalOptions,
): RagRetrievalOutcome {
  const hook = options?.observability ?? NOOP_RAG_OBSERVABILITY;
  const profile = provisioner.profile;
  const profileId = profile?.profileId ?? 'none';
  const profileVersion = profile?.profileVersion ?? 0;
  const mode = profile?.mode ?? 'DISABLED';
  const backendKind = profile?.backendKind ?? 'NONE';

  // `called` is measured, not assumed. An attempt refused before the backend was reached did not
  // retrieve anything; an attempt the AUTHORITY refused did call it, and reporting that as zero would
  // understate what the boundary actually did on the way to failing.
  const refuse = (
    reason: RagReason,
    knowledgeReason: KnowledgeRetrievalReason | undefined,
    revision: string | undefined,
    called: boolean,
  ): RagRetrievalOutcome => {
    const counters = refusedCounters(called);
    hook.onEvent(
      Object.freeze({
        type: 'rag-retrieval' as const,
        profileId,
        profileVersion,
        mode,
        backendKind,
        reason,
        retrievalCount: counters.retrievalCount,
        recordCount: 0,
        embeddingCount: 0 as const,
        vectorQueryCount: 0 as const,
        augmentedCharacterCount: 0,
        knowledgeReason,
      }),
    );
    return Object.freeze({
      ok: false as const,
      profileId,
      profileVersion,
      mode,
      knowledgeRevision: revision,
      reason,
      knowledgeReason,
      counters,
    });
  };

  // Not ACTIVE. The provisioner already decided why at construction, so that exact reason is carried
  // through rather than flattened -- `rag-backend-missing` and `rag-not-active` are different repairs.
  const backend = provisioner.backend;
  if (provisioner.state !== 'active' || backend === undefined) {
    return refuse(provisioner.refusal ?? 'rag-not-active', undefined, undefined, false);
  }

  if (!isBoundedGovernedRequest(request)) {
    return refuse('rag-request-invalid', undefined, backend.knowledgeRevision, false);
  }

  let result: KnowledgeRetrievalResult;
  try {
    result = backend.retrieve(request);
  } catch {
    // The thrown value is never read, logged, wrapped or re-thrown: it may carry content.
    return refuse('rag-backend-failed', undefined, backend.knowledgeRevision, true);
  }

  if (!result.ok) {
    return refuse('rag-retrieval-refused', result.reason, backend.knowledgeRevision, true);
  }

  const records = result.records;
  const augmentedCharacterCount = charactersOf(records);
  hook.onEvent(
    Object.freeze({
      type: 'rag-retrieval' as const,
      profileId,
      profileVersion,
      mode,
      backendKind,
      reason: 'rag-active' as const,
      retrievalCount: 1 as const,
      recordCount: records.length,
      embeddingCount: 0 as const,
      vectorQueryCount: 0 as const,
      augmentedCharacterCount,
      knowledgeReason: undefined,
    }),
  );

  return Object.freeze({
    ok: true as const,
    profileId,
    profileVersion,
    mode,
    knowledgeRevision: backend.knowledgeRevision,
    reason: 'rag-active' as const,
    records,
    counters: Object.freeze({
      retrievalCount: 1 as const,
      embeddingCount: 0 as const,
      vectorQueryCount: 0 as const,
      augmentedCharacterCount,
    }),
  });
}
