const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export interface SemanticAuthorityBinding {
  readonly knowledgeRevision: string;
  readonly policyRevision: string;
  readonly agentScope: string;
  readonly purpose: string;
  readonly dataClass: 'HOSTED_ALLOWED' | 'LOCAL_ONLY';
}

export interface SemanticContextCacheEntry {
  readonly entryId: string;
  readonly queryText: string;
  readonly binding: SemanticAuthorityBinding;
  readonly context: string;
  readonly citationRefs: readonly string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly approvedForReuse: boolean;
}

export interface SemanticSimilarityPort {
  score(
    queryText: string,
    candidates: readonly { readonly entryId: string; readonly queryText: string }[],
  ): Promise<ReadonlyMap<string, number>>;
}

function exactInstant(value: string): number | undefined {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return undefined;
  return parsed;
}

function validBinding(value: SemanticAuthorityBinding): boolean {
  return (
    REF.test(value.knowledgeRevision) &&
    REF.test(value.policyRevision) &&
    REF.test(value.agentScope) &&
    REF.test(value.purpose)
  );
}

function sameBinding(a: SemanticAuthorityBinding, b: SemanticAuthorityBinding): boolean {
  return (
    a.knowledgeRevision === b.knowledgeRevision &&
    a.policyRevision === b.policyRevision &&
    a.agentScope === b.agentScope &&
    a.purpose === b.purpose &&
    a.dataClass === b.dataClass
  );
}

function cloneEntry(entry: SemanticContextCacheEntry): SemanticContextCacheEntry {
  return Object.freeze({
    ...entry,
    binding: Object.freeze({ ...entry.binding }),
    citationRefs: Object.freeze([...entry.citationRefs]),
  });
}

/**
 * Reuse only previously approved retrieved CONTEXT under an exact authority binding.
 *
 * This deliberately cannot cache a final reply or a Core fact: its public entry shape contains only
 * query/context/citations plus revision/scope metadata. The similarity implementation is injected and
 * has no storage or provider authority here.
 */
export async function findReusableSemanticContext(input: {
  readonly queryText: string;
  readonly binding: SemanticAuthorityBinding;
  readonly asOf: string;
  readonly similarityThreshold: number;
  readonly entries: readonly SemanticContextCacheEntry[];
  readonly similarity: SemanticSimilarityPort;
}): Promise<{
  readonly hit: boolean;
  readonly entry?: SemanticContextCacheEntry;
  readonly similarity?: number;
  readonly reusedArtifact: 'CONTEXT_ONLY';
}> {
  if (
    input.queryText.length < 1 ||
    input.queryText.length > 4096 ||
    !validBinding(input.binding) ||
    input.similarityThreshold < 0.8 ||
    input.similarityThreshold > 1
  ) {
    throw new TypeError('semantic-cache-request-invalid');
  }
  const asOf = exactInstant(input.asOf);
  if (asOf === undefined) throw new TypeError('semantic-cache-request-invalid');

  const seen = new Set<string>();
  const eligible = input.entries.filter((entry) => {
    const createdAt = exactInstant(entry.createdAt);
    const expiresAt = exactInstant(entry.expiresAt);
    const citationSet = new Set(entry.citationRefs);
    if (
      !REF.test(entry.entryId) ||
      seen.has(entry.entryId) ||
      entry.queryText.length < 1 ||
      entry.queryText.length > 4096 ||
      entry.context.length < 1 ||
      entry.context.length > 65_536 ||
      !validBinding(entry.binding) ||
      entry.citationRefs.length < 1 ||
      entry.citationRefs.length > 64 ||
      citationSet.size !== entry.citationRefs.length ||
      entry.citationRefs.some((ref) => !REF.test(ref)) ||
      createdAt === undefined ||
      expiresAt === undefined ||
      expiresAt <= createdAt
    ) {
      throw new TypeError('semantic-cache-entry-invalid');
    }
    seen.add(entry.entryId);
    return (
      entry.approvedForReuse &&
      sameBinding(entry.binding, input.binding) &&
      createdAt <= asOf &&
      expiresAt > asOf
    );
  });
  if (eligible.length === 0)
    return Object.freeze({ hit: false, reusedArtifact: 'CONTEXT_ONLY' as const });

  const scores = await input.similarity.score(
    input.queryText,
    eligible.map((entry) => ({
      entryId: entry.entryId,
      queryText: entry.queryText,
    })),
  );
  let best: { entry: SemanticContextCacheEntry; score: number } | undefined;
  for (const entry of eligible) {
    const score = scores.get(entry.entryId);
    if (score === undefined || !Number.isFinite(score) || score < 0 || score > 1)
      throw new TypeError('semantic-similarity-result-invalid');
    if (
      score >= input.similarityThreshold &&
      (best === undefined ||
        score > best.score ||
        (score === best.score && entry.entryId.localeCompare(best.entry.entryId) < 0))
    ) {
      best = { entry, score };
    }
  }
  return best === undefined
    ? Object.freeze({ hit: false, reusedArtifact: 'CONTEXT_ONLY' as const })
    : Object.freeze({
        hit: true,
        entry: cloneEntry(best.entry),
        similarity: best.score,
        reusedArtifact: 'CONTEXT_ONLY' as const,
      });
}

export interface RetrievedContextHit {
  readonly chunkId: string;
  readonly content: string;
  readonly citationRef: string;
  readonly score: number;
}

/**
 * Deterministic extractive-only context compression.
 *
 * Truncation uses an exact source substring and adds no ellipsis/marker/synthetic summary. Citations
 * travel with each selected source chunk.
 */
export function compressRetrievedContext(input: {
  readonly hits: readonly RetrievedContextHit[];
  readonly maxChars: number;
  readonly maxItems: number;
  readonly minScore: number;
}): {
  readonly items: readonly (RetrievedContextHit & { readonly truncated: boolean })[];
  readonly omittedCount: number;
  readonly coverageScore: number;
  readonly compressionMode: 'EXTRACTIVE_ONLY';
} {
  if (
    !Number.isInteger(input.maxChars) ||
    input.maxChars < 1 ||
    !Number.isInteger(input.maxItems) ||
    input.maxItems < 1 ||
    !Number.isFinite(input.minScore) ||
    input.minScore < 0 ||
    input.minScore > 1
  ) {
    throw new TypeError('context-compression-request-invalid');
  }
  const seenChunks = new Set<string>();
  const seenContent = new Set<string>();
  const ranked = [...input.hits]
    .filter((hit) => {
      if (
        !REF.test(hit.chunkId) ||
        seenChunks.has(hit.chunkId) ||
        !REF.test(hit.citationRef) ||
        hit.content.length < 1 ||
        hit.content.length > 65_536 ||
        !Number.isFinite(hit.score) ||
        hit.score < 0 ||
        hit.score > 1
      ) {
        throw new TypeError('context-hit-invalid');
      }
      seenChunks.add(hit.chunkId);
      const key = hit.content.trim().replace(/\s+/gu, ' ').toLowerCase();
      if (seenContent.has(key) || hit.score < input.minScore) return false;
      seenContent.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));

  let remaining = input.maxChars;
  const items: (RetrievedContextHit & { truncated: boolean })[] = [];
  for (const hit of ranked) {
    if (items.length >= input.maxItems || remaining <= 0) break;
    const content = hit.content.slice(0, remaining);
    if (content.length === 0) break;
    items.push(
      Object.freeze({ ...hit, content, truncated: content.length !== hit.content.length }),
    );
    remaining -= content.length;
  }
  const total = ranked.reduce((sum, hit) => sum + hit.score, 0);
  const selected = items.reduce((sum, hit) => sum + hit.score, 0);
  return Object.freeze({
    items: Object.freeze(items),
    omittedCount: Math.max(0, ranked.length - items.length),
    coverageScore: total === 0 ? 0 : Math.min(1, selected / total),
    compressionMode: 'EXTRACTIVE_ONLY' as const,
  });
}

export type RetrievalStrategy = 'EXACT_FIRST' | 'HYBRID' | 'HYBRID_RERANKED';

export interface RetrievalStrategyIntent {
  readonly strategy: RetrievalStrategy;
  readonly candidatePool: number;
  readonly rerankTopK: number;
  readonly requiresFreshnessCheck: boolean;
  readonly actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT';
}

/**
 * Content-free search-budget planner. It never receives the user's prose or constructs selectors;
 * the existing governed retrieval boundary remains the only component allowed to execute retrieval.
 */
export function planAdvancedRetrieval(input: {
  readonly exactReferenceAvailable: boolean;
  readonly ambiguityScore: number;
  readonly semanticBreadthScore: number;
  readonly freshnessSensitive: boolean;
  readonly maxCandidatePool: number;
}): RetrievalStrategyIntent {
  if (
    !Number.isFinite(input.ambiguityScore) ||
    input.ambiguityScore < 0 ||
    input.ambiguityScore > 1 ||
    !Number.isFinite(input.semanticBreadthScore) ||
    input.semanticBreadthScore < 0 ||
    input.semanticBreadthScore > 1 ||
    !Number.isInteger(input.maxCandidatePool) ||
    input.maxCandidatePool < 4 ||
    input.maxCandidatePool > 64
  ) {
    throw new TypeError('retrieval-strategy-input-invalid');
  }

  if (
    input.exactReferenceAvailable &&
    input.ambiguityScore <= 0.2 &&
    input.semanticBreadthScore <= 0.25
  ) {
    return Object.freeze({
      strategy: 'EXACT_FIRST' as const,
      candidatePool: Math.min(8, input.maxCandidatePool),
      rerankTopK: 0,
      requiresFreshnessCheck: input.freshnessSensitive,
      actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT' as const,
    });
  }

  const rerank = input.ambiguityScore >= 0.45 || input.semanticBreadthScore >= 0.5;
  const candidatePool = Math.min(rerank ? 32 : 16, input.maxCandidatePool);
  return Object.freeze({
    strategy: rerank ? ('HYBRID_RERANKED' as const) : ('HYBRID' as const),
    candidatePool,
    rerankTopK: rerank ? Math.min(8, candidatePool) : 0,
    requiresFreshnessCheck: input.freshnessSensitive,
    actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT' as const,
  });
}
