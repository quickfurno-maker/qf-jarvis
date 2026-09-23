import { describe, expect, it } from 'vitest';

import {
  INITIAL_WORKER_SLO_POLICY_V1,
  createWorkerSloPolicy,
  evaluateWorkerSlo,
} from '../slo.js';

function observation(over: Record<string, unknown> = {}) {
  return {
    spool: { pending: 0, oldestPendingAgeMs: 0 },
    outcomes: {
      completedNoReply: 20,
      completedQueued: 80,
      completedStale: 0,
      releasedPreAgent: 0,
      failedIndeterminate: 0,
    },
    modelLatency: Array.from({ length: 20 }, () => ({ latencyMs: 1000 })),
    knowledgeRetrieval: {
      served: 100,
      noCandidates: 0,
      governanceRefused: 0,
      embeddingFailed: 0,
      storeFailed: 0,
      rerankerFailed: 0,
      otherFailed: 0,
      latency: Array.from({ length: 20 }, () => ({ latencyMs: 50 })),
    },
    ...over,
  };
}

describe('worker SLO evaluation', () => {
  it('passes healthy measurements under the engineering policy', () => {
    expect(evaluateWorkerSlo(observation(), INITIAL_WORKER_SLO_POLICY_V1)).toMatchObject({
      status: 'PASS',
      breaches: [],
      insufficient: [],
    });
  });

  it('reports insufficient data instead of declaring a latency SLO pass from tiny samples', () => {
    const result = evaluateWorkerSlo(
      observation({
        modelLatency: [{ latencyMs: 100 }],
        knowledgeRetrieval: {
          ...observation().knowledgeRetrieval,
          latency: [{ latencyMs: 10 }],
        },
      }),
      INITIAL_WORKER_SLO_POLICY_V1,
    );
    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.insufficient).toEqual(['MODEL_P95_LATENCY', 'KNOWLEDGE_P95_LATENCY']);
  });

  it('surfaces queue, failure-rate and latency breaches independently', () => {
    const policy = createWorkerSloPolicy({
      policyRef: 'test.slo.v1',
      minModelLatencySamples: 1,
      minKnowledgeLatencySamples: 1,
      maxModelP95Ms: 500,
      maxKnowledgeP95Ms: 100,
      maxOldestPendingAgeMs: 1000,
      maxFailedIndeterminateRate: 0.01,
      maxKnowledgeTechnicalFailureRate: 0.01,
    });
    const result = evaluateWorkerSlo(
      {
        spool: { pending: 4, oldestPendingAgeMs: 5000 },
        outcomes: {
          completedNoReply: 0,
          completedQueued: 9,
          completedStale: 0,
          releasedPreAgent: 0,
          failedIndeterminate: 1,
        },
        modelLatency: [{ latencyMs: 900 }],
        knowledgeRetrieval: {
          served: 9,
          noCandidates: 0,
          governanceRefused: 0,
          embeddingFailed: 0,
          storeFailed: 1,
          rerankerFailed: 0,
          otherFailed: 0,
          latency: [{ latencyMs: 400 }],
        },
      },
      policy,
    );
    expect(result.status).toBe('BREACH');
    expect(result.breaches).toEqual([
      'MODEL_P95_LATENCY',
      'KNOWLEDGE_P95_LATENCY',
      'OLDEST_PENDING_AGE',
      'FAILED_INDETERMINATE_RATE',
      'KNOWLEDGE_TECHNICAL_FAILURE_RATE',
    ]);
  });
});