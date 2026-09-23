import { describe, expect, it } from 'vitest';

import type { ApprovalEvidence } from '../contracts/evidence.js';
import { chooseCostEfficientQualifiedCandidate, estimateModelCostUsd } from '../service/cost-efficiency.js';
import { createSyntheticBinding } from '../testing/fixtures.js';

function evidence(
  evaluationRef: string,
  releaseId: string,
  modelId: string,
  over: Partial<ApprovalEvidence> = {},
): ApprovalEvidence {
  return {
    evaluationRef,
    target: 'ACTIVE_MODEL_RELEASE',
    binding: createSyntheticBinding({
      release: {
        releaseId,
        providerId: 'groq',
        modelId,
        modelVersion: 'v1',
        configDigest: releaseId.endsWith('2') ? 'abcdef02' : 'abcdef01',
        executionClass: 'HOSTED',
      },
    }),
    suiteResultDigest: 'a'.repeat(64),
    caseSetDigest: 'b'.repeat(64),
    createdAt: '2026-09-23T00:00:00.000Z',
    synthetic: false,
    productionApproval: true,
    ...over,
  };
}

describe('cost-efficient qualified model selection', () => {
  it('chooses the cheaper production-approved candidate when quality remains within the allowed band', () => {
    const result = chooseCostEfficientQualifiedCandidate(
      [
        {
          candidateId: 'baseline',
          evidence: evidence('ev.baseline', 'rel.1', 'model-one'),
          qualityScore: 0.94,
          priceCard: {
            priceCardRef: 'price.baseline.v1',
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 4,
          },
        },
        {
          candidateId: 'cheaper',
          evidence: evidence('ev.cheaper', 'rel.2', 'model-two'),
          qualityScore: 0.93,
          priceCard: {
            priceCardRef: 'price.cheaper.v1',
            inputUsdPerMillionTokens: 0.5,
            outputUsdPerMillionTokens: 1,
          },
        },
      ],
      { inputTokens: 1_000_000, outputTokens: 100_000 },
      { baselineEvaluationRef: 'ev.baseline', maxQualityDrop: 0.02 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selected.candidateId).toBe('cheaper');
    expect(result.baselineEstimatedUsd).toBeCloseTo(2.4);
    expect(result.selectedEstimatedUsd).toBeCloseTo(0.6);
    expect(result.estimatedSavingsUsd).toBeCloseTo(1.8);
  });

  it('never treats synthetic or non-production evidence as eligible for serving-cost selection', () => {
    const result = chooseCostEfficientQualifiedCandidate(
      [
        {
          candidateId: 'baseline',
          evidence: evidence('ev.baseline', 'rel.1', 'model-one', {
            synthetic: true,
            productionApproval: false,
          }),
          qualityScore: 1,
          priceCard: {
            priceCardRef: 'price.baseline.v1',
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 1,
          },
        },
      ],
      { inputTokens: 100, outputTokens: 50 },
      { baselineEvaluationRef: 'ev.baseline', maxQualityDrop: 0 },
    );
    expect(result).toEqual({ ok: false, reason: 'baseline-not-production-approved' });
  });

  it('does not buy cost savings by crossing the permitted quality drop', () => {
    const result = chooseCostEfficientQualifiedCandidate(
      [
        {
          candidateId: 'baseline',
          evidence: evidence('ev.baseline', 'rel.1', 'model-one'),
          qualityScore: 0.95,
          priceCard: {
            priceCardRef: 'price.baseline.v1',
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 2,
          },
        },
        {
          candidateId: 'cheap-low-quality',
          evidence: evidence('ev.cheap', 'rel.2', 'model-two'),
          qualityScore: 0.8,
          priceCard: {
            priceCardRef: 'price.cheap.v1',
            inputUsdPerMillionTokens: 0.1,
            outputUsdPerMillionTokens: 0.1,
          },
        },
      ],
      { inputTokens: 1000, outputTokens: 500 },
      { baselineEvaluationRef: 'ev.baseline', maxQualityDrop: 0.02 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selected.candidateId).toBe('baseline');
  });

  it('validates versioned price cards instead of guessing provider pricing', () => {
    expect(
      estimateModelCostUsd(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        { priceCardRef: 'price.v1', inputUsdPerMillionTokens: 1.25, outputUsdPerMillionTokens: 2.5 },
      ),
    ).toBeCloseTo(3.75);
    expect(() =>
      estimateModelCostUsd(
        { inputTokens: 1, outputTokens: 1 },
        { priceCardRef: 'bad price', inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 },
      ),
    ).toThrow('model-cost-input-invalid');
  });
});