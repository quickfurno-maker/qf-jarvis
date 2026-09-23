import { describe, expect, it } from 'vitest';

import { classifyEvaluationImpact } from '../service/change-impact.js';
import { createSyntheticBinding } from '../testing/fixtures.js';

describe('continuous evaluation impact', () => {
  it('does not require reevaluation when only createdAt changes', () => {
    const previous = createSyntheticBinding({ createdAt: '2026-01-01T00:00:00.000Z' });
    const next = createSyntheticBinding({ createdAt: '2026-01-02T00:00:00.000Z' });
    expect(classifyEvaluationImpact(previous, next)).toEqual({
      requiresReevaluation: false,
      changedDimensions: [],
    });
  });

  it('requires reevaluation for prompt, model, knowledge and policy changes', () => {
    const previous = createSyntheticBinding();
    const next = createSyntheticBinding({
      promptVersion: 2,
      promptDigest: 'b'.repeat(64),
      knowledgeRevision: 'know.rev.2',
      policyContractRevision: 'policy.rev.2',
      release: {
        releaseId: 'rel.fake.2',
        providerId: 'fake',
        modelId: 'fake-model-2',
        modelVersion: 'v2',
        configDigest: 'abcdef02',
        executionClass: 'HOSTED',
      },
    });
    expect(classifyEvaluationImpact(previous, next)).toEqual({
      requiresReevaluation: true,
      changedDimensions: ['MODEL_RELEASE', 'PROMPT', 'KNOWLEDGE', 'POLICY'],
    });
  });

  it('requires reevaluation when the evaluator or fixture suite changes', () => {
    const previous = createSyntheticBinding();
    const next = createSyntheticBinding({
      fixtureManifestVersion: 2,
      evaluatorImplVersion: 2,
      evaluationSuiteVersion: 2,
    });
    expect(classifyEvaluationImpact(previous, next)).toEqual({
      requiresReevaluation: true,
      changedDimensions: ['EVALUATION_SUITE', 'FIXTURE_MANIFEST', 'EVALUATOR'],
    });
  });
});