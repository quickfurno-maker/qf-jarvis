import { describe, expect, it } from 'vitest';

import type { ApprovalEvidence } from '../contracts/evidence.js';
import {
  chooseCostEfficientQualifiedCandidate,
  estimateConversationCostUsd,
  estimateEmbeddingCostUsd,
  estimateModelCostUsd,
} from '../service/cost-efficiency.js';
import { createSyntheticBinding } from '../testing/fixtures.js';

function release(releaseId: string, modelId: string) {
  return {
    releaseId,
    providerId: 'groq',
    modelId,
    modelVersion: 'v1',
    configDigest: releaseId.endsWith('2') ? 'abcdef02' : 'abcdef01',
    executionClass: 'HOSTED' as const,
  };
}

function evidence(
  evaluationRef: string,
  releaseId: string,
  modelId: string,
  over: Partial<ApprovalEvidence> = {},
): ApprovalEvidence {
  return {
    evaluationRef,
    target: 'ACTIVE_MODEL_RELEASE',
    binding: createSyntheticBinding({ release: release(releaseId, modelId) }),
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
            release: release('rel.1', 'model-one'),
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
            release: release('rel.2', 'model-two'),
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
            release: release('rel.1', 'model-one'),
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
            release: release('rel.1', 'model-one'),
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
            release: release('rel.2', 'model-two'),
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

  it('estimates embedding usage from an explicit versioned billing unit', () => {
    expect(
      estimateEmbeddingCostUsd(
        {
          embeddingModelRef: 'embedding/model-v1',
          requests: 10,
          texts: 20,
          characters: 2_000_000,
        },
        {
          priceCardRef: 'embedding.price.v1',
          embeddingModelRef: 'embedding/model-v1',
          billingUnit: 'CHARACTER',
          usdPerMillionUnits: 0.25,
        },
      ),
    ).toBeCloseTo(0.5);
  });

  it('rejects an unknown embedding billing unit at the runtime boundary', () => {
    expect(() =>
      estimateEmbeddingCostUsd(
        { embeddingModelRef: 'embedding/model-v1', requests: 1, texts: 1, characters: 1 },
        {
          priceCardRef: 'embedding.price.v1',
          embeddingModelRef: 'embedding/model-v1',
          billingUnit: 'TOKEN' as never,
          usdPerMillionUnits: 1,
        },
      ),
    ).toThrow('embedding-cost-input-invalid');
  });

  it('combines model and embedding usage without requiring a conversation identifier', () => {
    expect(
      estimateConversationCostUsd(
        {
          model: { inputTokens: 1_000_000, outputTokens: 100_000 },
          embedding: {
            embeddingModelRef: 'embedding/model-v1',
            requests: 2,
            texts: 2,
            characters: 1_000_000,
          },
        },
        {
          priceCardRef: 'model.price.v1',
          release: release('rel.1', 'model-one'),
          inputUsdPerMillionTokens: 2,
          outputUsdPerMillionTokens: 4,
        },
        {
          priceCardRef: 'embedding.price.v1',
          embeddingModelRef: 'embedding/model-v1',
          billingUnit: 'CHARACTER',
          usdPerMillionUnits: 0.5,
        },
      ),
    ).toEqual({
      modelUsd: 2.4,
      embeddingUsd: 0.5,
      totalUsd: 2.9,
    });
  });

  it('refuses a model price card bound to a different release than the candidate evidence', () => {
    const result = chooseCostEfficientQualifiedCandidate(
      [
        {
          candidateId: 'baseline',
          evidence: evidence('ev.baseline', 'rel.1', 'model-one'),
          qualityScore: 1,
          priceCard: {
            priceCardRef: 'price.wrong-release.v1',
            release: release('rel.2', 'model-two'),
            inputUsdPerMillionTokens: 1,
            outputUsdPerMillionTokens: 1,
          },
        },
      ],
      { inputTokens: 100, outputTokens: 50 },
      { baselineEvaluationRef: 'ev.baseline', maxQualityDrop: 0 },
    );
    expect(result).toEqual({ ok: false, reason: 'invalid-input' });
  });

  it('refuses an embedding price card for a different embedding model', () => {
    expect(() =>
      estimateEmbeddingCostUsd(
        { embeddingModelRef: 'embedding/model-v1', requests: 1, texts: 1, characters: 100 },
        {
          priceCardRef: 'embedding.price.v2',
          embeddingModelRef: 'embedding/model-v2',
          billingUnit: 'CHARACTER',
          usdPerMillionUnits: 1,
        },
      ),
    ).toThrow('embedding-cost-input-invalid');
  });

  it('validates versioned price cards instead of guessing provider pricing', () => {
    expect(
      estimateModelCostUsd(
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        {
          priceCardRef: 'price.v1',
          release: release('rel.1', 'model-one'),
          inputUsdPerMillionTokens: 1.25,
          outputUsdPerMillionTokens: 2.5,
        },
      ),
    ).toBeCloseTo(3.75);
    expect(() =>
      estimateModelCostUsd(
        { inputTokens: 1, outputTokens: 1 },
        {
          priceCardRef: 'bad price',
          release: release('rel.1', 'model-one'),
          inputUsdPerMillionTokens: 1,
          outputUsdPerMillionTokens: 1,
        },
      ),
    ).toThrow('model-cost-input-invalid');
  });
});
