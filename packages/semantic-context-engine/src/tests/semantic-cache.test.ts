import { describe, expect, it, vi } from 'vitest';

import { findReusableSemanticContext } from '../index.js';

const binding = {
  knowledgeRevision: 'knowledge.1',
  policyRevision: 'policy.1',
  agentScope: 'RIYA',
  purpose: 'POLICY_LOOKUP',
  dataClass: 'HOSTED_ALLOWED' as const,
};

const entry = {
  entryId: 'cache.1',
  queryText: 'What is the warranty policy?',
  binding,
  context: 'Warranty policy source context.',
  citationRefs: ['kb.policy.warranty.v1'],
  createdAt: '2026-09-24T00:00:00.000Z',
  expiresAt: '2026-09-25T00:00:00.000Z',
  approvedForReuse: true,
};

describe('semantic context reuse', () => {
  it('reuses only an approved exact-authority-bound context', async () => {
    const score = vi.fn().mockResolvedValue(new Map([['cache.1', 0.94]]));
    await expect(
      findReusableSemanticContext({
        queryText: 'Can you explain the warranty?',
        binding,
        asOf: '2026-09-24T10:00:00.000Z',
        similarityThreshold: 0.9,
        entries: [entry],
        similarity: { score },
      }),
    ).resolves.toMatchObject({
      hit: true,
      similarity: 0.94,
      reusedArtifact: 'CONTEXT_ONLY',
      entry: { entryId: 'cache.1' },
    });
  });

  it('cannot cross knowledge or policy revisions', async () => {
    const score = vi.fn();
    const result = await findReusableSemanticContext({
      queryText: 'Can you explain the warranty?',
      binding: { ...binding, knowledgeRevision: 'knowledge.2' },
      asOf: '2026-09-24T10:00:00.000Z',
      similarityThreshold: 0.9,
      entries: [entry],
      similarity: { score },
    });
    expect(result).toEqual({ hit: false, reusedArtifact: 'CONTEXT_ONLY' });
    expect(score).not.toHaveBeenCalled();
  });

  it('does not reuse expired or unapproved context', async () => {
    for (const candidate of [
      { ...entry, expiresAt: '2026-09-24T09:00:00.000Z' },
      { ...entry, approvedForReuse: false },
    ]) {
      const result = await findReusableSemanticContext({
        queryText: 'Can you explain the warranty?',
        binding,
        asOf: '2026-09-24T10:00:00.000Z',
        similarityThreshold: 0.9,
        entries: [candidate],
        similarity: { score: vi.fn() },
      });
      expect(result.hit).toBe(false);
    }
  });

  it('fails closed on malformed similarity output', async () => {
    await expect(
      findReusableSemanticContext({
        queryText: 'Warranty?',
        binding,
        asOf: '2026-09-24T10:00:00.000Z',
        similarityThreshold: 0.9,
        entries: [entry],
        similarity: { score: vi.fn().mockResolvedValue(new Map()) },
      }),
    ).rejects.toThrow('semantic-similarity-result-invalid');
  });
});
