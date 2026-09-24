import { describe, expect, it } from 'vitest';

import { planAdvancedRetrieval } from '../index.js';

describe('advanced retrieval planning', () => {
  it('uses exact-first for a narrow unambiguous referenced request', () => {
    expect(
      planAdvancedRetrieval({
        exactReferenceAvailable: true,
        ambiguityScore: 0.1,
        semanticBreadthScore: 0.1,
        freshnessSensitive: false,
        maxCandidatePool: 32,
      }),
    ).toEqual({
      strategy: 'EXACT_FIRST',
      candidatePool: 8,
      rerankTopK: 0,
      requiresFreshnessCheck: false,
      actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT',
    });
  });

  it('uses hybrid reranking for broad or ambiguous requests', () => {
    expect(
      planAdvancedRetrieval({
        exactReferenceAvailable: false,
        ambiguityScore: 0.7,
        semanticBreadthScore: 0.8,
        freshnessSensitive: true,
        maxCandidatePool: 64,
      }),
    ).toEqual({
      strategy: 'HYBRID_RERANKED',
      candidatePool: 32,
      rerankTopK: 8,
      requiresFreshnessCheck: true,
      actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT',
    });
  });
});
