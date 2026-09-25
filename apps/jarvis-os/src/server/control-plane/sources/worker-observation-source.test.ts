import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createWorkerObservationReadSource } from './worker-observation-source';

function observation(emittedAt = new Date().toISOString()): Record<string, unknown> {
  return {
    protocol: 'qfj.quickfurno-worker-observation.v1',
    emittedAt,
    revision: 'a'.repeat(40),
    runtimeId: 'qfj.whatsapp.production.v1',
    state: 'HEALTHY',
    providerMode: 'GROQ_ONLY',
    knowledgeRevision: 'knowledge.quickfurno.release.1',
    embeddingModelRef: 'embedding/model-v1',
    spool: {
      pending: 2,
      processing: 1,
      completed: 7,
      failed: 1,
      oldestPendingAgeMs: 500,
    },
    outcomes: {
      completedNoReply: 1,
      completedQueued: 5,
      completedStale: 1,
      releasedPreAgent: 0,
      failedIndeterminate: 1,
    },
    modelLatency: [{ at: emittedAt, latencyMs: 125 }],
    knowledgeRetrieval: {
      served: 9,
      noCandidates: 2,
      governanceRefused: 1,
      embeddingFailed: 0,
      storeFailed: 1,
      rerankerFailed: 0,
      otherFailed: 0,
      latency: [
        { at: emittedAt, latencyMs: 10 },
        { at: emittedAt, latencyMs: 40 },
      ],
    },
  };
}

describe('worker observation read source', () => {
  it('maps a fresh bounded worker snapshot to only its owned operational sections', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qfj-worker-observation-'));
    const path = join(root, 'worker.json');
    writeFileSync(path, JSON.stringify(observation()), 'utf8');
    const source = createWorkerObservationReadSource(path);

    const result = await source.acquire(new AbortController().signal);
    expect(result.status).toBe('OBSERVED');
    if (result.status !== 'OBSERVED') return;
    expect(source.owns).toEqual([
      'headlineMetrics',
      'workers',
      'models',
      'knowledge',
      'modelLatency',
    ]);
    expect(result.sections.headlineMetrics?.items[0]?.value).toBe('2');
    expect(
      result.sections.headlineMetrics?.items.find((item) => item.id === 'rag-served')?.value,
    ).toBe('9');
    expect(
      result.sections.headlineMetrics?.items.find((item) => item.id === 'rag-refused')?.value,
    ).toBe('2');
    expect(
      result.sections.headlineMetrics?.items.find((item) => item.id === 'rag-p95-ms')?.value,
    ).toBe('40');
    expect(result.sections.modelLatency?.points[0]?.value).toBe(125);
    expect(JSON.stringify(result)).not.toContain('embedding/model-v1');
    expect(JSON.stringify(result)).not.toContain('knowledge.quickfurno.release.1');
  });

  it('surfaces v2 usage aggregates and an explicit engineering SLO state without content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qfj-worker-observation-'));
    const path = join(root, 'worker-v2.json');
    const v2 = {
      ...observation(),
      protocol: 'qfj.quickfurno-worker-observation.v2',
      modelGateway: { completed: 5, failed: 0, fallbackUsed: 0 },
      modelUsage: {
        invocations: 5,
        reportedTokenInvocations: 5,
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      },
      embeddingUsage: { requests: 3, texts: 3, characters: 120 },
    };
    writeFileSync(path, JSON.stringify(v2), 'utf8');
    const result = await createWorkerObservationReadSource(path).acquire(
      new AbortController().signal,
    );
    expect(result.status).toBe('OBSERVED');
    if (result.status !== 'OBSERVED') return;
    const items = result.sections.headlineMetrics?.items ?? [];
    expect(items.find((item) => item.id === 'model-total-tokens')?.value).toBe('1500');
    expect(items.find((item) => item.id === 'embedding-requests')?.value).toBe('3');
    expect(items).toHaveLength(12);
    expect(items.find((item) => item.id === 'embedding-requests')?.caption).toContain(
      '120 query characters',
    );
    // The fixture has one pending turn aged 60s, above the engineering 30s queue-age ceiling.
    // Queue-age is directly measurable without a minimum sample count, so this is a real BREACH.
    expect(items.find((item) => item.id === 'engineering-slo-state')?.value).toBe('BREACH');
    expect(JSON.stringify(result)).not.toContain('queryText');
    expect(JSON.stringify(result)).not.toContain('conversationId');
  });

  it('renders v3 disabled knowledge as disabled rather than as an active revision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qfj-worker-observation-'));
    const path = join(root, 'worker-v3-disabled.json');
    const base = observation();
    const {
      knowledgeRevision: _knowledgeRevision,
      embeddingModelRef: _embeddingModelRef,
      ...withoutLegacyKnowledge
    } = base;
    const v3 = {
      ...withoutLegacyKnowledge,
      protocol: 'qfj.quickfurno-worker-observation.v3',
      knowledge: { mode: 'DISABLED' },
      modelGateway: { completed: 1, failed: 0, fallbackUsed: 0 },
      modelUsage: {
        invocations: 1,
        reportedTokenInvocations: 1,
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
      },
      embeddingUsage: { requests: 0, texts: 0, characters: 0 },
    };
    writeFileSync(path, JSON.stringify(v3), 'utf8');

    const result = await createWorkerObservationReadSource(path).acquire(
      new AbortController().signal,
    );
    expect(result.status).toBe('OBSERVED');
    if (result.status !== 'OBSERVED') return;
    const item = result.sections.knowledge?.items[0];
    expect(item?.state).toBe('DISABLED');
    expect(item?.detail).toContain('intentionally disabled');
    expect(JSON.stringify(result)).not.toContain('knowledge.quickfurno.release.1');
    expect(JSON.stringify(result)).not.toContain('embedding/model-v1');
  });

  it('refuses stale or content-bearing snapshots rather than rendering them as live', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qfj-worker-observation-'));
    const stalePath = join(root, 'stale.json');
    writeFileSync(stalePath, JSON.stringify(observation('2026-01-01T00:00:00.000Z')), 'utf8');
    const stale = await createWorkerObservationReadSource(stalePath).acquire(
      new AbortController().signal,
    );
    expect(stale).toEqual({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
    });

    const contentPath = join(root, 'content.json');
    writeFileSync(
      contentPath,
      JSON.stringify({ ...observation(), messageText: 'must never reach Jarvis OS' }),
      'utf8',
    );
    const content = await createWorkerObservationReadSource(contentPath).acquire(
      new AbortController().signal,
    );
    expect(content).toEqual({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
    });
  });
});
