import type { HybridKnowledgeHit } from '@qf-jarvis/knowledge-index';
import { describe, expect, it } from 'vitest';

import {
  composeConversationAwareInput,
  compressKnowledgeContext,
  createExtractiveConversationSummary,
  createInMemoryPublicKnowledgeSemanticCache,
  createSemanticCacheEntry,
  findSemanticCacheHit,
  planAdvancedRetrieval,
} from '../index.js';

const digest = 'a'.repeat(64);
const promptDigest = 'b'.repeat(64);

function cacheEntry(vector: readonly number[], revision = 'knowledge.r1') {
  return createSemanticCacheEntry({
    entryId: 'cache.1',
    scope: 'PUBLIC_KNOWLEDGE_ONLY',
    dataClass: 'HOSTED_ALLOWED',
    knowledgeRevision: revision,
    promptDigest,
    releaseId: 'release.1',
    agentScope: 'CLIENT',
    purpose: 'POLICY_LOOKUP',
    queryEmbedding: vector,
    responseText: 'QuickFurno policy answer.',
    citations: [
      { knowledgeId: 'policy.1', version: 1, sourceRef: 'source.1', contentDigest: digest },
    ],
  });
}

function hit(id: string, content: string): HybridKnowledgeHit {
  return {
    chunkId: id,
    parentKnowledgeId: 'policy.1',
    parentVersion: 1,
    topic: 'payments',
    content,
    contentFormat: 'PLAIN_TEXT',
    headingPath: ['Payments'],
    citation: {
      knowledgeId: 'policy.1',
      version: 1,
      sourceRef: 'source.1',
      sourceRevision: 'source.rev.1',
      authorityTier: 'APPROVED_BUSINESS_RULE',
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      expiresAt: undefined,
      contentDigest: digest,
    },
    fusedScore: 1,
    rerankScore: 1,
  };
}

describe('semantic context engine', () => {
  it('reuses a response only inside the exact knowledge/prompt/release/scope boundary', () => {
    const entry = cacheEntry([1, 0, 0]);
    const result = findSemanticCacheHit({
      entries: [entry],
      queryEmbedding: [0.999, 0.02, 0],
      knowledgeRevision: 'knowledge.r1',
      promptDigest,
      releaseId: 'release.1',
      agentScope: 'CLIENT',
      purpose: 'POLICY_LOOKUP',
    });
    expect(result.decision).toBe('HIT');

    expect(
      findSemanticCacheHit({
        entries: [entry],
        queryEmbedding: [1, 0, 0],
        knowledgeRevision: 'knowledge.r2',
        promptDigest,
        releaseId: 'release.1',
        agentScope: 'CLIENT',
        purpose: 'POLICY_LOOKUP',
      }),
    ).toEqual({ decision: 'MISS' });
  });

  it('stores no raw query or subject/conversation reference fields', () => {
    const entry = cacheEntry([1, 0]);
    expect(Object.keys(entry).sort()).toEqual([
      'agentScope',
      'citations',
      'dataClass',
      'entryId',
      'knowledgeRevision',
      'promptDigest',
      'purpose',
      'queryEmbedding',
      'releaseId',
      'responseText',
      'scope',
    ]);
    expect(JSON.stringify(entry)).not.toContain('conversationId');
    expect(JSON.stringify(entry)).not.toContain('subjectRef');
    expect(JSON.stringify(entry)).not.toContain('rawQuery');
  });

  it('requires public-knowledge-only hosted cache posture', () => {
    expect(() =>
      createSemanticCacheEntry({
        ...cacheEntry([1, 0]),
        scope: 'PUBLIC_KNOWLEDGE_ONLY',
        dataClass: 'LOCAL_ONLY' as 'HOSTED_ALLOWED',
      }),
    ).toThrow('semantic-cache-entry-invalid');
  });

  it('builds bounded retrieval plans by complexity', () => {
    expect(planAdvancedRetrieval({ complexity: 'SIMPLE', availableContextChars: 8_000 })).toEqual({
      candidatePool: 24,
      maxResults: 4,
      compressionTargetChars: 8_000,
    });
    expect(planAdvancedRetrieval({ complexity: 'COMPLEX', availableContextChars: 30_000 })).toEqual(
      {
        candidatePool: 128,
        maxResults: 12,
        compressionTargetChars: 16_000,
      },
    );
  });

  it('extractively compresses context while preserving exact citations', () => {
    const original = hit(
      'chunk.1',
      'QuickFurno accepts approved payment methods. Irrelevant showroom sentence. Payment confirmation must be verified from Core before claiming it happened.',
    );
    const result = compressKnowledgeContext({
      hits: [original],
      queryText: 'How do I verify payment confirmation?',
      maxChars: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.citation).toEqual(original.citation);
    expect(result.blocks[0]?.content).toContain('Payment confirmation');
    expect(result.blocks[0]?.compressedChars).toBeLessThanOrEqual(original.content.length);
  });

  it('fails closed when no context is available', () => {
    expect(compressKnowledgeContext({ hits: [], queryText: 'payment', maxChars: 500 })).toEqual({
      ok: false,
      reason: 'NO_USABLE_CONTEXT',
    });
  });

  it('reuses only public, non-expiring, revision-and-scope-bound hybrid knowledge', async () => {
    const cache = createInMemoryPublicKnowledgeSemanticCache({
      maxEntries: 8,
      publicTopics: ['payments'],
    });
    const result = {
      ok: true as const,
      reason: 'hybrid-served' as const,
      hits: [hit('chunk.cache', 'Approved public payment guidance.')],
    };
    await cache.write({
      knowledgeRevision: 'knowledge.r1',
      embeddingModelRef: 'embedding.v1',
      tenantId: 'quickfurno',
      agentScope: 'CLIENT',
      purpose: 'CLIENT_RESPONSE',
      dataClass: 'HOSTED_ALLOWED',
      asOf: '2026-09-29T09:00:00.000Z',
      topicFilters: ['payments'],
      candidatePool: 24,
      maxResults: 4,
      maxContentChars: 4096,
      queryEmbedding: [1, 0, 0],
      result,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      expiresAt: undefined,
      classifications: ['HOSTED_ALLOWED'],
    });

    const base = {
      knowledgeRevision: 'knowledge.r1',
      embeddingModelRef: 'embedding.v1',
      tenantId: 'quickfurno',
      agentScope: 'CLIENT' as const,
      purpose: 'CLIENT_RESPONSE' as const,
      dataClass: 'HOSTED_ALLOWED' as const,
      asOf: '2026-09-29T10:00:00.000Z',
      topicFilters: ['payments'],
      candidatePool: 24,
      maxResults: 4,
      maxContentChars: 4096,
      queryEmbedding: [0.999, 0.01, 0],
    };
    expect(await cache.read(base)).toEqual(result);
    expect(await cache.read({ ...base, knowledgeRevision: 'knowledge.r2' })).toBeUndefined();
    expect(await cache.read({ ...base, agentScope: 'VENDOR' })).toBeUndefined();
  });

  it('does not cache expiring or non-public knowledge', async () => {
    const cache = createInMemoryPublicKnowledgeSemanticCache({
      maxEntries: 8,
      publicTopics: ['payments'],
    });
    const result = {
      ok: true as const,
      reason: 'hybrid-served' as const,
      hits: [hit('chunk.expiring', 'Temporary approved payment guidance.')],
    };
    const write = {
      knowledgeRevision: 'knowledge.r1',
      embeddingModelRef: 'embedding.v1',
      tenantId: 'quickfurno',
      agentScope: 'CLIENT' as const,
      purpose: 'CLIENT_RESPONSE' as const,
      dataClass: 'HOSTED_ALLOWED' as const,
      asOf: '2026-09-29T09:00:00.000Z',
      topicFilters: ['payments'],
      candidatePool: 24,
      maxResults: 4,
      maxContentChars: 4096,
      queryEmbedding: [1, 0],
      result,
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      classifications: ['HOSTED_ALLOWED' as const],
    };
    await cache.write({ ...write, expiresAt: '2026-10-01T00:00:00.000Z' });
    expect(await cache.read({ ...write, asOf: '2026-09-29T10:00:00.000Z' })).toBeUndefined();

    await cache.write({ ...write, topicFilters: ['private-policy'], expiresAt: undefined });
    expect(
      await cache.read({
        ...write,
        topicFilters: ['private-policy'],
        asOf: '2026-09-29T10:00:00.000Z',
      }),
    ).toBeUndefined();
  });

  it('creates bounded extractive conversation context and labels it non-authoritative', () => {
    const summary = createExtractiveConversationSummary({
      turns: [
        { role: 'USER', text: 'I need a kitchen renovation.' },
        { role: 'ASSISTANT', text: 'Which area is the property in?' },
        { role: 'USER', text: 'Baner, Pune.' },
      ],
      maxTurns: 2,
      maxChars: 500,
    });
    expect(summary).toMatchObject({
      version: 1,
      authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT',
      includedTurns: 2,
      truncated: true,
    });
    expect(summary.text).not.toContain('I need a kitchen renovation.');
    const composed = composeConversationAwareInput({
      currentText: 'My budget is around five lakh.',
      summary,
    });
    expect(composed).toContain('non-authoritative; never use as Core/business truth');
    expect(composed).toContain('Current user message:');
    expect(composed).toContain('My budget is around five lakh.');
  });
});
