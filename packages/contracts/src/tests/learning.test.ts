/**
 * Learning, provenance, and the refusal to train by default.
 *
 * The single sentence these tests defend: **no data becomes training data
 * automatically.** Everything else here — model provenance, prompt provenance, human
 * corrections, outcome feedback — exists so that the decision to train on something can
 * actually be made by a person who knows what they are agreeing to.
 */

import { describe, expect, it } from 'vitest';

import {
  MODEL_PROVIDERS,
  safeParseAgentRunRecord,
  safeParseDatasetExampleProvenance,
  safeParseHumanCorrection,
  safeParseOutcomeFeedback,
  safeParseRecommendationEvaluation,
  safeParseTrainingEligibilityDecision,
} from '../index.js';
import {
  cloneFixture,
  validAgentRunDeterministic,
  validAgentRunWithModel,
  validDatasetExampleProvenance,
  validHumanCorrection,
  validOutcomeFeedbackPositive,
  validOutcomeFeedbackUnknown,
  validRecommendationEvaluation,
  validTrainingEligibilityApproved,
  validTrainingEligibilityRefused,
} from '../fixtures/index.js';

describe('model and prompt provenance', () => {
  it('Claude and ChatGPT are the initial providers, as a closed set', () => {
    // Closed for the same reason the event registry is closed: adding a party we send
    // reasoning to must be a diff a human reviews, not a string a caller invents.
    expect([...MODEL_PROVIDERS]).toStrictEqual(['anthropic', 'openai']);
  });

  it('accepts a run that used no model at all — the best kind of run', () => {
    const result = safeParseAgentRunRecord(cloneFixture(validAgentRunDeterministic));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBeUndefined();
      expect(result.data.deterministicRulesEvaluated).toBeGreaterThan(0);
    }
  });

  it('accepts a run that used a model and recorded its prompt provenance', () => {
    expect(safeParseAgentRunRecord(cloneFixture(validAgentRunWithModel)).success).toBe(true);
  });

  it('refuses a model invocation with no prompt provenance', () => {
    // Model provenance without prompt provenance is not provenance: the run cannot be
    // reproduced, regression-tested, or explained when it goes wrong.
    const run = cloneFixture(validAgentRunWithModel);
    const { promptConfiguration: _removed, ...withoutPrompt } = run;

    expect(safeParseAgentRunRecord(withoutPrompt).success).toBe(false);
  });

  it('refuses a prompt configuration with no model — a prompt that never ran', () => {
    const run = cloneFixture(validAgentRunWithModel);
    const { model: _removed, ...withoutModel } = run;

    expect(safeParseAgentRunRecord(withoutModel).success).toBe(false);
  });

  it('refuses a prompt configuration carrying the prompt text', () => {
    const run = cloneFixture(validAgentRunWithModel);
    const promptConfiguration = {
      ...run.promptConfiguration,
      promptText: 'You are Kabir...',
    };

    expect(safeParseAgentRunRecord({ ...run, promptConfiguration }).success).toBe(false);
  });

  it('refuses a model reference carrying a credential', () => {
    const run = cloneFixture(validAgentRunWithModel);
    const model = { ...run.model, apiKey: 'sk-ant-SYNTHETIC' };

    expect(safeParseAgentRunRecord({ ...run, model }).success).toBe(false);
  });

  it('refuses a run that produced recommendations while claiming it produced none', () => {
    const run = {
      ...cloneFixture(validAgentRunDeterministic),
      outcome: 'completed-no-recommendation',
    };
    expect(safeParseAgentRunRecord(run).success).toBe(false);
  });

  it('refuses a failed run that nonetheless recommended something', () => {
    const run = { ...cloneFixture(validAgentRunDeterministic), outcome: 'failed' };
    expect(safeParseAgentRunRecord(run).success).toBe(false);
  });
});

describe('human corrections are new records, never edits', () => {
  it('accepts a correction', () => {
    expect(safeParseHumanCorrection(cloneFixture(validHumanCorrection)).success).toBe(true);
  });

  it('points at the recommendation rather than modifying it', () => {
    const result = safeParseHumanCorrection(cloneFixture(validHumanCorrection));

    expect(result.success).toBe(true);
    if (result.success) {
      // The correction references the recommendation. It has no field with which to
      // change it — the wrong recommendation stays exactly as wrong as it was.
      expect(result.data.recommendationId).toBeDefined();
      expect(result.data).not.toHaveProperty('correctedRecommendation');
    }
  });

  it('refuses a correction made by a policy rather than a human', () => {
    // A policy cannot judge that the rule got it wrong. An agent correcting an agent is a
    // feedback loop with no ground truth in it.
    const correction = {
      ...cloneFixture(validHumanCorrection),
      correctedBy: { actorType: 'policy', policyId: 'auto.correct', policyVersion: 1 },
    };
    expect(safeParseHumanCorrection(correction).success).toBe(false);
  });

  it('refuses a correction attributed to an agent', () => {
    const correction = {
      ...cloneFixture(validHumanCorrection),
      correctedBy: { actorType: 'agent', agent: 'jarvis' },
    };
    expect(safeParseHumanCorrection(correction).success).toBe(false);
  });
});

describe('evaluation: acceptance and outcome are different questions', () => {
  it('accepts an evaluation', () => {
    expect(
      safeParseRecommendationEvaluation(cloneFixture(validRecommendationEvaluation)).success,
    ).toBe(true);
  });

  it('records the stale-recommendation case, which is the adoption canary', () => {
    const evaluation = {
      ...cloneFixture(validRecommendationEvaluation),
      acceptanceOutcome: 'expired-unread',
    };

    // A system that only records the recommendations people engaged with cannot see
    // adoption failing.
    expect(safeParseRecommendationEvaluation(evaluation).success).toBe(true);
  });

  it('outcome feedback is a separate contract from acceptance', () => {
    // If they shared a shape, "we have evaluation data" would be true of a system that had
    // never once checked whether anything got better.
    const result = safeParseOutcomeFeedback(cloneFixture(validOutcomeFeedbackPositive));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.movedInExpectedDirection).toBe(true);
      expect(result.data).not.toHaveProperty('acceptanceOutcome');
    }
  });

  it('accepts an honest "we do not know"', () => {
    expect(safeParseOutcomeFeedback(cloneFixture(validOutcomeFeedbackUnknown)).success).toBe(true);
  });

  it('refuses a known outcome that never says whether the prediction held', () => {
    const feedback = cloneFixture(validOutcomeFeedbackPositive);
    const { movedInExpectedDirection: _removed, ...withoutVerdict } = feedback;

    expect(safeParseOutcomeFeedback(withoutVerdict).success).toBe(false);
  });

  it('refuses an "unknown" outcome that is nonetheless certain', () => {
    const feedback = { ...cloneFixture(validOutcomeFeedbackPositive), outcomeClass: 'unknown' };
    expect(safeParseOutcomeFeedback(feedback).success).toBe(false);
  });

  it('refuses a known outcome with no evidence', () => {
    const feedback = { ...cloneFixture(validOutcomeFeedbackPositive), evidence: [] };
    expect(safeParseOutcomeFeedback(feedback).success).toBe(false);
  });
});

describe('no data becomes training data automatically', () => {
  it('eligibility exists only as an explicit decision by a named actor', () => {
    const result = safeParseTrainingEligibilityDecision(
      cloneFixture(validTrainingEligibilityApproved),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eligible).toBe(true);
      expect(result.data.decidedBy).toBeDefined();
      expect(result.data.purposeLimitation).toBeDefined();
    }
  });

  it('refuses eligibility when the data was never minimised', () => {
    const decision = {
      ...cloneFixture(validTrainingEligibilityApproved),
      minimisationStatus: 'not-minimised',
    };
    expect(safeParseTrainingEligibilityDecision(decision).success).toBe(false);
  });

  it('refuses eligibility when provenance is incomplete', () => {
    // If we cannot say where it came from, we cannot honour a deletion request against it.
    const decision = {
      ...cloneFixture(validTrainingEligibilityApproved),
      provenanceComplete: false,
    };
    expect(safeParseTrainingEligibilityDecision(decision).success).toBe(false);
  });

  it('refuses sensitive personal data under any approval whatsoever', () => {
    const decision = {
      ...cloneFixture(validTrainingEligibilityApproved),
      dataClassification: 'sensitive-personal',
    };
    expect(safeParseTrainingEligibilityDecision(decision).success).toBe(false);
  });

  it('requires a refusal to say why', () => {
    const decision = cloneFixture(validTrainingEligibilityRefused);
    const { rejectionReasonCode: _removed, ...withoutReason } = decision;

    expect(safeParseTrainingEligibilityDecision(withoutReason).success).toBe(false);
  });

  it('accepts a refusal that says why', () => {
    expect(
      safeParseTrainingEligibilityDecision(cloneFixture(validTrainingEligibilityRefused)).success,
    ).toBe(true);
  });
});

describe('dataset provenance', () => {
  it('accepts a fully-sourced example', () => {
    expect(
      safeParseDatasetExampleProvenance(cloneFixture(validDatasetExampleProvenance)).success,
    ).toBe(true);
  });

  it('refuses an example that cannot name its sources', () => {
    // Not low-quality. Ungovernable: you cannot honour a deletion request against data
    // whose origin you do not know.
    const example = { ...cloneFixture(validDatasetExampleProvenance), sourceReferences: [] };
    expect(safeParseDatasetExampleProvenance(example).success).toBe(false);
  });

  it('requires an erasure state, so a missed deletion is detectable', () => {
    // `dataset-examples` is an erasable scope. Without this field, a deleted client's
    // data could survive inside a training set forever, invisibly.
    const example = cloneFixture(validDatasetExampleProvenance);
    const { erasureState: _removed, ...withoutErasureState } = example;

    expect(safeParseDatasetExampleProvenance(withoutErasureState).success).toBe(false);
  });

  it('has no source kind for a model’s own prior output', () => {
    // Training a model on its own output is how a system drifts away from reality while
    // its internal metrics keep improving.
    const example = {
      ...cloneFixture(validDatasetExampleProvenance),
      sourceReferences: [
        { sourceKind: 'model-output', eventId: '00000000-0000-4000-8000-000000000000' },
      ],
    };
    expect(safeParseDatasetExampleProvenance(example).success).toBe(false);
  });
});
