import { describe, expect, it } from 'vitest';

import { parseQuickFurnoWorkerObservation } from '../index.js';

describe('worker observation contract', () => {
  it('accepts bounded content-free operational data', () => {
    const parsed = parseQuickFurnoWorkerObservation({
      protocol: 'qfj.quickfurno-worker-observation.v1',
      emittedAt: '2026-09-23T00:00:00.000Z',
      revision: 'a'.repeat(40),
      runtimeId: 'qfj.whatsapp.production.v1',
      state: 'HEALTHY',
      providerMode: 'GROQ_ONLY',
      knowledgeRevision: 'knowledge.quickfurno.release.1',
      embeddingModelRef: 'embedding/model-v1',
      spool: { pending: 1, processing: 0, completed: 2, failed: 0, oldestPendingAgeMs: 50 },
      outcomes: {
        completedNoReply: 0,
        completedQueued: 2,
        completedStale: 0,
        releasedPreAgent: 0,
        failedIndeterminate: 0,
      },
      modelLatency: [{ at: '2026-09-23T00:00:00.000Z', latencyMs: 123 }],
      knowledgeRetrieval: {
        served: 1,
        noCandidates: 0,
        governanceRefused: 0,
        embeddingFailed: 0,
        storeFailed: 0,
        rerankerFailed: 0,
        otherFailed: 0,
        latency: [{ at: '2026-09-23T00:00:00.000Z', latencyMs: 37 }],
      },
    });
    expect(parsed.spool.pending).toBe(1);
    expect(parsed.modelLatency).toHaveLength(1);
    expect(parsed.knowledgeRetrieval.served).toBe(1);
    expect(parsed.knowledgeRetrieval.latency[0]?.latencyMs).toBe(37);
  });


  it('accepts v2 aggregate usage without customer or message identifiers', () => {
    const parsed = parseQuickFurnoWorkerObservation({
      protocol: 'qfj.quickfurno-worker-observation.v2',
      emittedAt: '2026-09-23T00:00:00.000Z',
      revision: 'a'.repeat(40),
      runtimeId: 'qfj.whatsapp.production.v1',
      state: 'HEALTHY',
      providerMode: 'GROQ_ONLY',
      knowledgeRevision: 'knowledge.quickfurno.release.1',
      embeddingModelRef: 'embedding/model-v1',
      spool: { pending: 1, processing: 0, completed: 2, failed: 0, oldestPendingAgeMs: 50 },
      outcomes: {
        completedNoReply: 0,
        completedQueued: 2,
        completedStale: 0,
        releasedPreAgent: 0,
        failedIndeterminate: 0,
      },
      modelLatency: [{ at: '2026-09-23T00:00:00.000Z', latencyMs: 123 }],
      knowledgeRetrieval: {
        served: 1,
        noCandidates: 0,
        governanceRefused: 0,
        embeddingFailed: 0,
        storeFailed: 0,
        rerankerFailed: 0,
        otherFailed: 0,
        latency: [{ at: '2026-09-23T00:00:00.000Z', latencyMs: 37 }],
      },
      modelGateway: { completed: 2, failed: 0, fallbackUsed: 0 },
      modelUsage: {
        invocations: 2,
        reportedTokenInvocations: 2,
        inputTokens: 240,
        outputTokens: 80,
        totalTokens: 320,
      },
      embeddingUsage: { requests: 3, texts: 3, characters: 100 },
    });
    expect(parsed.protocol).toBe('qfj.quickfurno-worker-observation.v2');
    if (parsed.protocol !== 'qfj.quickfurno-worker-observation.v2') return;
    expect(parsed.modelUsage.totalTokens).toBe(320);
    expect(parsed.embeddingUsage.characters).toBe(100);
  });

  it('refuses extra content-bearing fields', () => {
    expect(() =>
      parseQuickFurnoWorkerObservation({
        protocol: 'qfj.quickfurno-worker-observation.v1',
        emittedAt: '2026-09-23T00:00:00.000Z',
        revision: 'a'.repeat(40),
        runtimeId: 'qfj.whatsapp.production.v1',
        state: 'HEALTHY',
        providerMode: 'GROQ_ONLY',
        knowledgeRevision: 'knowledge.quickfurno.release.1',
        embeddingModelRef: 'embedding/model-v1',
        spool: { pending: 0, processing: 0, completed: 0, failed: 0, oldestPendingAgeMs: null },
        outcomes: {
          completedNoReply: 0,
          completedQueued: 0,
          completedStale: 0,
          releasedPreAgent: 0,
          failedIndeterminate: 0,
        },
        modelLatency: [],
        knowledgeRetrieval: {
          served: 0,
          noCandidates: 0,
          governanceRefused: 0,
          embeddingFailed: 0,
          storeFailed: 0,
          rerankerFailed: 0,
          otherFailed: 0,
          latency: [],
        },
        messageText: 'must never be observable',
      }),
    ).toThrow();
  });
});
