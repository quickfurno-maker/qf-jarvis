import { describe, expect, it, vi } from 'vitest';
import {
  compressRetrievedContext,
  findReusableSemanticContext,
  planAdvancedRetrieval,
} from '../index.js';

const binding = {
  knowledgeRevision: 'knowledge.rev.1',
  policyRevision: 'policy.rev.1',
  agentScope: 'CLIENT',
  purpose: 'POLICY_LOOKUP',
  dataClass: 'HOSTED_ALLOWED' as const,
};

describe('semantic context engine', () => {
  it('reuses only authority-bound context above threshold', async () => {
    const similarity = { score: vi.fn().mockResolvedValue(new Map([['cache.1', 0.96]])) };
    const result = await findReusableSemanticContext({
      queryText: 'Explain payment rules',
      binding,
      asOf: '2026-09-24T10:00:00.000Z',
      similarityThreshold: 0.92,
      entries: [
        {
          entryId: 'cache.1',
          queryText: 'What is the payment policy?',
          binding,
          context: 'Approved payment-policy context.',
          citationRefs: ['cite.payment.1'],
          createdAt: '2026-09-24T00:00:00.000Z',
          expiresAt: '2026-09-25T00:00:00.000Z',
          approvedForReuse: true,
        },
      ],
      similarity,
    });
    expect(result).toMatchObject({ hit: true, similarity: 0.96, reusedArtifact: 'CONTEXT_ONLY' });
  });

  it('does not score another knowledge revision', async () => {
    const similarity = { score: vi.fn() };
    const result = await findReusableSemanticContext({
      queryText: 'Payment?',
      binding,
      asOf: '2026-09-24T10:00:00.000Z',
      similarityThreshold: 0.92,
      entries: [
        {
          entryId: 'cache.1',
          queryText: 'Payment?',
          binding: { ...binding, knowledgeRevision: 'knowledge.rev.2' },
          context: 'Other revision.',
          citationRefs: ['cite.2'],
          createdAt: '2026-09-24T00:00:00.000Z',
          expiresAt: '2026-09-25T00:00:00.000Z',
          approvedForReuse: true,
        },
      ],
      similarity,
    });
    expect(result).toEqual({ hit: false, reusedArtifact: 'CONTEXT_ONLY' });
    expect(similarity.score).not.toHaveBeenCalled();
  });

  it('rejects malformed authority bindings, timestamps and citation lists', async () => {
    const similarity = { score: vi.fn() };
    await expect(
      findReusableSemanticContext({
        queryText: 'Payment?',
        binding: { ...binding, policyRevision: 'bad revision with spaces' },
        asOf: '2026-09-24T10:00:00.000Z',
        similarityThreshold: 0.92,
        entries: [],
        similarity,
      }),
    ).rejects.toThrow('semantic-cache-request-invalid');

    await expect(
      findReusableSemanticContext({
        queryText: 'Payment?',
        binding,
        asOf: '2026-09-24T10:00:00.000Z',
        similarityThreshold: 0.92,
        entries: [
          {
            entryId: 'cache.1',
            queryText: 'Payment?',
            binding,
            context: 'Context.',
            citationRefs: ['cite.1', 'cite.1'],
            createdAt: 'not-an-instant',
            expiresAt: '2026-09-25T00:00:00.000Z',
            approvedForReuse: true,
          },
        ],
        similarity,
      }),
    ).rejects.toThrow('semantic-cache-entry-invalid');
    expect(similarity.score).not.toHaveBeenCalled();
  });

  it('compresses extractively, preserves citations and deduplicates text', () => {
    const result = compressRetrievedContext({
      maxChars: 60,
      maxItems: 2,
      minScore: 0.2,
      hits: [
        { chunkId: 'c1', content: 'Highest priority evidence.', citationRef: 'cite.1', score: 0.9 },
        { chunkId: 'c2', content: 'Lower priority evidence.', citationRef: 'cite.2', score: 0.5 },
        {
          chunkId: 'c3',
          content: ' highest  priority evidence. ',
          citationRef: 'cite.3',
          score: 0.8,
        },
      ],
    });
    expect(result.items.map((x) => x.chunkId)).toEqual(['c1', 'c2']);
    expect(result.compressionMode).toBe('EXTRACTIVE_ONLY');
  });

  it('truncates with a literal source substring and adds no synthetic marker', () => {
    const source = 'This retrieved evidence is longer than budget.';
    const result = compressRetrievedContext({
      maxChars: 20,
      maxItems: 1,
      minScore: 0,
      hits: [{ chunkId: 'c1', content: source, citationRef: 'cite.1', score: 1 }],
    });
    expect(result.items[0]?.truncated).toBe(true);
    expect(result.items[0]?.content).toBe(source.slice(0, 20));
  });

  it('plans exact-first retrieval for a precise reference and bounded hybrid reranking for broad work', () => {
    expect(
      planAdvancedRetrieval({
        exactReferenceAvailable: true,
        ambiguityScore: 0.1,
        semanticBreadthScore: 0.1,
        freshnessSensitive: true,
        maxCandidatePool: 64,
      }),
    ).toEqual({
      strategy: 'EXACT_FIRST',
      candidatePool: 8,
      rerankTopK: 0,
      requiresFreshnessCheck: true,
      actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT',
    });

    expect(
      planAdvancedRetrieval({
        exactReferenceAvailable: false,
        ambiguityScore: 0.7,
        semanticBreadthScore: 0.8,
        freshnessSensitive: false,
        maxCandidatePool: 20,
      }),
    ).toEqual({
      strategy: 'HYBRID_RERANKED',
      candidatePool: 20,
      rerankTopK: 8,
      requiresFreshnessCheck: false,
      actualRetrievalAuthority: 'GOVERNED_RETRIEVAL_PORT',
    });
  });

  it('refuses unbounded retrieval budgets', () => {
    expect(() =>
      planAdvancedRetrieval({
        exactReferenceAvailable: false,
        ambiguityScore: 0.5,
        semanticBreadthScore: 0.5,
        freshnessSensitive: false,
        maxCandidatePool: 65,
      }),
    ).toThrow('retrieval-strategy-input-invalid');
  });
});
