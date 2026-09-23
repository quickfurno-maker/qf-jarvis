import { describe, expect, it } from 'vitest';

import type { KnowledgeSourceDocumentInput } from '@qf-jarvis/knowledge-ingestion';
import { prepareKnowledgeBatch } from '@qf-jarvis/knowledge-ingestion';

import type { HybridCandidateStore, RankedChunkCandidate } from '../contracts.js';
import { embedPreparedKnowledgeBatch } from '../embedding.js';
import { fuseHybridCandidates } from '../fusion.js';
import { createHybridKnowledgeRetriever } from '../retriever.js';
import { createHybridKnowledgeSearchRequest } from '../request.js';
import { createDeterministicTestEmbeddingPort } from '../testing/index.js';

function source(
  knowledgeId: string,
  text: string,
  over: Partial<KnowledgeSourceDocumentInput> = {},
): KnowledgeSourceDocumentInput {
  return {
    knowledgeId,
    version: 1,
    topic: 'installation',
    sourceLayer: 'BUSINESS_DOCUMENT',
    sourceType: 'PROCESS_GUIDE',
    authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
    contentFormat: 'PLAIN_TEXT',
    payload: { kind: 'TEXT', text },
    sourceRef: 'guide.installation',
    sourceRevision: 'rev.1',
    owner: 'quickfurno',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['CLIENT'],
      allowedPurposes: ['CLIENT_RESPONSE'],
    },
    approvedBy: 'owner.quickfurno',
    approvedAt: '2025-12-31T00:00:00.000Z',
    ...over,
  };
}

function request(over: Record<string, unknown> = {}) {
  return createHybridKnowledgeSearchRequest({
    requestId: 'req.1',
    tenantId: 'quickfurno',
    agentScope: 'CLIENT',
    purpose: 'CLIENT_RESPONSE',
    dataClass: 'HOSTED_ALLOWED',
    asOf: '2026-09-22T00:00:00.000Z',
    queryText: 'how does installation scheduling work',
    topicFilters: ['installation'],
    candidatePool: 16,
    maxResults: 4,
    maxContentChars: 8000,
    ...over,
  } as never);
}

function storeFor(chunks: readonly RankedChunkCandidate['chunk'][]): HybridCandidateStore {
  const ranked = (scoreBase: number): readonly RankedChunkCandidate[] =>
    Object.freeze(
      chunks.map((chunk, index) =>
        Object.freeze({ chunk, rank: index + 1, score: scoreBase - index * 0.01 }),
      ),
    );
  return Object.freeze({
    knowledgeRevision: 'test.release.v1',
    search() {
      return Promise.resolve(
        Object.freeze({
          lexical: ranked(1),
          vector: ranked(0.9),
        }),
      );
    },
  });
}

describe('hybrid knowledge index', () => {
  it('embeds duplicate chunk bodies once while retaining both governed chunks', async () => {
    const batch = prepareKnowledgeBatch([
      source('doc.a', 'Same approved installation statement.'),
      source('doc.b', 'Same approved installation statement.', {
        sourceRef: 'guide.installation.copy',
      }),
    ]);
    const embedded = await embedPreparedKnowledgeBatch(
      batch,
      createDeterministicTestEmbeddingPort(),
    );
    expect(embedded.chunks).toHaveLength(2);
    expect(embedded.uniqueEmbeddingsComputed).toBe(1);
    expect(embedded.chunks[0]?.embedding).toEqual(embedded.chunks[1]?.embedding);
  });

  it('fuses lexical and vector ranks deterministically', () => {
    const chunks = prepareKnowledgeBatch([
      source('doc.a', 'Alpha installation.'),
      source('doc.b', 'Beta installation.'),
    ]).chunks;
    const a = chunks[0];
    const b = chunks[1];
    if (a === undefined || b === undefined) throw new Error('fixture');
    const fused = fuseHybridCandidates(
      [
        { chunk: a, rank: 1, score: 0.9 },
        { chunk: b, rank: 2, score: 0.8 },
      ],
      [
        { chunk: b, rank: 1, score: 0.95 },
        { chunk: a, rank: 2, score: 0.7 },
      ],
      10,
    );
    expect(fused).toHaveLength(2);
    expect(fused[0]?.chunk.chunkId).toBe(a.chunkId);
    expect(fused[0]?.lexicalRank).toBe(1);
    expect(fused[0]?.vectorRank).toBe(2);
  });

  it('serves hybrid hits only after the existing governed authority accepts each chunk', async () => {
    const chunks = prepareKnowledgeBatch([
      source('doc.install', 'Installation scheduling starts after an approved measurement.'),
    ]).chunks;
    const retriever = createHybridKnowledgeRetriever({
      embedding: createDeterministicTestEmbeddingPort(),
      store: storeFor(chunks),
    });
    const result = await retriever.retrieve(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.citation.sourceRef).toBe('guide.installation');
    expect(result.hits[0]?.content).toContain('Installation scheduling');
  });

  it('rejects a candidate when the request tries to cross an agent permission boundary', async () => {
    const chunks = prepareKnowledgeBatch([
      source('doc.client-only', 'Client-only approved material.'),
    ]).chunks;
    const retriever = createHybridKnowledgeRetriever({
      embedding: createDeterministicTestEmbeddingPort(),
      store: storeFor(chunks),
    });
    const result = await retriever.retrieve(
      request({ agentScope: 'VENDOR', purpose: 'VENDOR_RESPONSE' }),
    );
    expect(result).toEqual({ ok: false, reason: 'hybrid-governance-refused' });
  });

  it('never sends LOCAL_ONLY query text to a hosted embedding port', async () => {
    const chunks = prepareKnowledgeBatch([
      source('doc.local', 'Local-only material.', { classification: 'LOCAL_ONLY' }),
    ]).chunks;
    const retriever = createHybridKnowledgeRetriever({
      embedding: createDeterministicTestEmbeddingPort('HOSTED'),
      store: storeFor(chunks),
    });
    const result = await retriever.retrieve(request({ dataClass: 'LOCAL_ONLY' }));
    expect(result).toEqual({ ok: false, reason: 'hybrid-query-embedding-denied' });
  });

  it('refuses LOCAL_ONLY candidates before a hosted reranker can observe content', async () => {
    const chunks = prepareKnowledgeBatch([
      source('doc.local', 'Local-only approved material.', { classification: 'LOCAL_ONLY' }),
    ]).chunks;
    let called = false;
    const retriever = createHybridKnowledgeRetriever({
      embedding: createDeterministicTestEmbeddingPort('LOCAL'),
      store: storeFor(chunks),
      reranker: {
        executionClass: 'HOSTED',
        rerank(candidatesQuery, candidates) {
          void candidatesQuery;
          called = true;
          return Promise.resolve(candidates);
        },
      },
    });
    const result = await retriever.retrieve(request({ dataClass: 'LOCAL_ONLY' }));
    expect(result).toEqual({ ok: false, reason: 'hybrid-reranker-data-class-denied' });
    expect(called).toBe(false);
  });
});

it('bounds embedding provider calls by text count instead of sending an unbounded corpus request', async () => {
  const batch = prepareKnowledgeBatch([
    source('doc.batch.a', 'Alpha installation batch statement.'),
    source('doc.batch.b', 'Beta installation batch statement.'),
    source('doc.batch.c', 'Gamma installation batch statement.'),
    source('doc.batch.d', 'Delta installation batch statement.'),
    source('doc.batch.e', 'Epsilon installation batch statement.'),
  ]);
  const base = createDeterministicTestEmbeddingPort();
  const calls: number[] = [];
  const port = Object.freeze({
    ...base,
    async embed(texts: readonly string[]) {
      calls.push(texts.length);
      return base.embed(texts);
    },
  });
  const embedded = await embedPreparedKnowledgeBatch(batch, port, {
    maxTextsPerRequest: 2,
    maxCharsPerRequest: 64_000,
  });
  expect(embedded.chunks).toHaveLength(5);
  expect(calls).toEqual([2, 2, 1]);
});
