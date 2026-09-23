import { describe, expect, it } from 'vitest';

import { createScaleReadinessPolicy, evaluateScaleReadiness } from '../scaling.js';

function observation(pending: number, oldestPendingAgeMs: number) {
  return {
    spool: { pending, oldestPendingAgeMs },
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
  };
}

const policy = createScaleReadinessPolicy({
  policyRef: 'qfj.scale-readiness.test.v1',
  minObservationCount: 10,
  minPressureFraction: 0.7,
  minPendingTurns: 20,
  minOldestPendingAgeMs: 15_000,
});

describe('scale readiness', () => {
  it('requires enough observations before considering a topology change', () => {
    expect(evaluateScaleReadiness([observation(100, 60_000)], policy)).toEqual({
      policyRef: policy.policyRef,
      decision: 'INSUFFICIENT_DATA',
      observationCount: 1,
      pressureObservationCount: 0,
      pressureFraction: 0,
    });
  });

  it('keeps SINGLE_OWNER when pressure is not sustained', () => {
    const samples = [
      ...Array.from({ length: 3 }, () => observation(30, 20_000)),
      ...Array.from({ length: 7 }, () => observation(2, 1000)),
    ];
    expect(evaluateScaleReadiness(samples, policy)).toMatchObject({
      decision: 'KEEP_SINGLE_OWNER',
      pressureObservationCount: 3,
      pressureFraction: 0.3,
    });
  });

  it('only marks shared-queue DESIGN eligible after sustained measured pressure', () => {
    const samples = [
      ...Array.from({ length: 8 }, () => observation(30, 20_000)),
      ...Array.from({ length: 2 }, () => observation(2, 1000)),
    ];
    expect(evaluateScaleReadiness(samples, policy)).toMatchObject({
      decision: 'ELIGIBLE_FOR_SHARED_QUEUE_DESIGN',
      pressureObservationCount: 8,
      pressureFraction: 0.8,
    });
  });
});