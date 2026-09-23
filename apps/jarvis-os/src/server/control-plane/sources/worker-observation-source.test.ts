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
