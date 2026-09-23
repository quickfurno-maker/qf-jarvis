import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseQuickFurnoWorkerObservation } from '@qf-jarvis/worker-observation-contract';
import { describe, expect, it } from 'vitest';

import { createQuickFurnoWorkerObservationWriter } from '../quickfurno-whatsapp/production-observation.js';

describe('QuickFurno worker production observation', () => {
  it('writes an atomic bounded aggregate snapshot with no turn content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qfj-production-observation-'));
    const filePath = join(root, 'observation', 'worker.json');
    const writer = createQuickFurnoWorkerObservationWriter({
      filePath,
      revision: 'a'.repeat(40),
      runtimeId: 'qfj.whatsapp.production.v1',
      knowledgeRevision: 'knowledge.quickfurno.release.1',
      embeddingModelRef: 'embedding/model-v1',
    });
    writer.recordModelLatency(123, '2026-09-23T00:00:00.000Z');
    writer.recordModelOutcome(true, false);
    writer.recordModelUsage({ inputTokens: 120, outputTokens: 40, totalTokens: 160 });
    writer.recordEmbeddingUsage(['first query', 'second']);
    writer.recordKnowledgeRetrieval('hybrid-served', 37, '2026-09-23T00:00:00.000Z');
    writer.recordKnowledgeRetrieval('hybrid-governance-refused', 11, '2026-09-23T00:00:00.500Z');
    writer.recordOutcome('completed-queued');
    writer.recordOutcome('failed-indeterminate');

    await writer.write(
      'DEGRADED',
      {
        pending: 2,
        processing: 1,
        completed: 7,
        failed: 1,
        oldestPendingAgeMs: 500,
      },
      '2026-09-23T00:00:01.000Z',
    );

    const raw = readFileSync(filePath, 'utf8');
    const parsed = parseQuickFurnoWorkerObservation(JSON.parse(raw));
    expect(parsed.protocol).toBe('qfj.quickfurno-worker-observation.v2');
    expect(parsed.state).toBe('DEGRADED');
    expect(parsed.outcomes.completedQueued).toBe(1);
    expect(parsed.outcomes.failedIndeterminate).toBe(1);
    expect(parsed.modelLatency[0]?.latencyMs).toBe(123);
    expect(parsed.knowledgeRetrieval.served).toBe(1);
    expect(parsed.knowledgeRetrieval.governanceRefused).toBe(1);
    expect(parsed.knowledgeRetrieval.latency.map((sample) => sample.latencyMs)).toEqual([37, 11]);
    if (parsed.protocol !== 'qfj.quickfurno-worker-observation.v2') return;
    expect(parsed.modelGateway).toEqual({ completed: 1, failed: 0, fallbackUsed: 0 });
    expect(parsed.modelUsage).toEqual({
      invocations: 1,
      reportedTokenInvocations: 1,
      inputTokens: 120,
      outputTokens: 40,
      totalTokens: 160,
    });
    expect(parsed.embeddingUsage).toEqual({
      requests: 1,
      texts: 2,
      characters: 17,
    });
    expect(raw).not.toContain('conversationId');
    expect(raw).not.toContain('messageText');
    expect(raw).not.toContain('subjectRef');
  });
});
