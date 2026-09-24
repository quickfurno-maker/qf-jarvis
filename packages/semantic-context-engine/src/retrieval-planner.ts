export type RetrievalStrategy = 'EXACT_FIRST' | 'HYBRID' | 'HYBRID_RERANKED';

export interface RetrievalStrategyIntent {
  readonly strategy: RetrievalStrategy;
  readonly candidatePool: number;
  readonly rerankTopK: number;
  readonly requiresFreshnessCheck: boolean;
  readonly actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT';
}

/**
 * Content-free retrieval-budget planner.
 *
 * It never receives user prose and cannot construct selectors or execute search. The governed
 * retrieval port remains the only component allowed to execute retrieval.
 */
export function planAdvancedRetrieval(input: {
  readonly exactReferenceAvailable: boolean;
  readonly ambiguityScore: number;
  readonly semanticBreadthScore: number;
  readonly freshnessSensitive: boolean;
  readonly maxCandidatePool: number;
}): RetrievalStrategyIntent {
  if (
    typeof input.exactReferenceAvailable !== 'boolean' ||
    !Number.isFinite(input.ambiguityScore) ||
    input.ambiguityScore < 0 ||
    input.ambiguityScore > 1 ||
    !Number.isFinite(input.semanticBreadthScore) ||
    input.semanticBreadthScore < 0 ||
    input.semanticBreadthScore > 1 ||
    typeof input.freshnessSensitive !== 'boolean' ||
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
      strategy: 'EXACT_FIRST',
      candidatePool: Math.min(8, input.maxCandidatePool),
      rerankTopK: 0,
      requiresFreshnessCheck: input.freshnessSensitive,
      actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT',
    });
  }

  const rerank = input.ambiguityScore >= 0.45 || input.semanticBreadthScore >= 0.5;
  const candidatePool = Math.min(rerank ? 32 : 16, input.maxCandidatePool);

  return Object.freeze({
    strategy: rerank ? 'HYBRID_RERANKED' : 'HYBRID',
    candidatePool,
    rerankTopK: rerank ? Math.min(8, candidatePool) : 0,
    requiresFreshnessCheck: input.freshnessSensitive,
    actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT',
  });
}
