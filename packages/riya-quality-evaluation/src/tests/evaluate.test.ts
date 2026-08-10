/**
 * RWC-P10 — objective rules, the two-reviewer rule, and the threshold gates (ADR-0106 §13–§17).
 *
 * Each objective rule gets a boundary and a breach, because "greater than the maximum" and "equal to
 * the maximum" are the two cases an off-by-one gets wrong, and an off-by-one in a gate is a gate that
 * silently stops gating.
 *
 * The subjective specs are about disagreement. A dimension passes only when BOTH reviewers marked it
 * satisfied — one agreeing reviewer is one person's taste — and a missing second review makes the
 * case INCONCLUSIVE rather than either verdict.
 */
import { describe, expect, it } from 'vitest';

import { createRiyaQualityHumanReview } from '../contracts/human-review.js';
import { createRiyaQualityObservation } from '../contracts/observation.js';
import type { RiyaQualityObservationV1 } from '../contracts/observation.js';
import { createRiyaQualityScenario } from '../contracts/scenario.js';
import type { RiyaQualityScenarioV1 } from '../contracts/scenario.js';
import { createRiyaQualitySuite } from '../contracts/suite.js';
import { createRiyaQualityThresholds } from '../contracts/thresholds.js';
import type { RiyaQualityDimension } from '../contracts/vocabularies.js';
import { evaluateRiyaQualitySuite } from '../service/evaluate-suite.js';
import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import { createSyntheticQualityBinding } from '../testing/builders.js';

const SCENARIO_ID = 'riya.p10.en.discovery.01';

function scenarioWith(
  expected: Partial<RiyaQualityScenarioV1['expected']> = {},
  overrides: Partial<Pick<RiyaQualityScenarioV1, 'languageMode' | 'scenarioId'>> = {},
): RiyaQualityScenarioV1 {
  return createRiyaQualityScenario({
    version: 1,
    scenarioId: overrides.scenarioId ?? SCENARIO_ID,
    scenarioVersion: 1,
    phase: 'NEED',
    languageMode: overrides.languageMode ?? 'ENGLISH',
    interactionKind: 'DISCOVERY',
    expected: {
      maxReplyChars: 400,
      maxQuestions: 2,
      expectedObservations: [],
      forbiddenObservationFields: [],
      requiredCitation: false,
      allowedAskedDiscoveryFields: [],
      allowedContinuityPhasesAfter: ['NEED'],
      requiredQualityDimensions: [],
      ...expected,
    },
  });
}

function observationWith(
  overrides: Partial<Parameters<typeof createRiyaQualityObservation>[0]> = {},
): RiyaQualityObservationV1 {
  return createRiyaQualityObservation({
    version: 1,
    scenarioId: SCENARIO_ID,
    scenarioVersion: 1,
    languageMode: 'ENGLISH',
    replyCharCount: 200,
    questionCount: 1,
    askedDiscoveryFields: [],
    observationBatch: { version: 1, observations: [], skipProjectDetails: false },
    citations: [],
    continuityPhaseAfter: 'NEED',
    humanReviews: [],
    ...overrides,
  });
}

/** Thresholds that gate only what a focused spec is about. */
const focusedThresholds = (
  minimumPassRateBpsByDimension: Partial<Record<RiyaQualityDimension, number>> = {},
  limits: { readonly objective?: number; readonly inconclusive?: number } = {},
) =>
  createRiyaQualityThresholds({
    thresholdsId: 'riya-quality-thresholds-v1',
    thresholdsVersion: 1,
    requiredHumanReviews: 2,
    minimumPassRateBpsByDimension,
    maximumObjectiveFailures: limits.objective ?? 0,
    maximumInconclusiveCases: limits.inconclusive ?? 0,
  });

const runOne = (
  scenario: RiyaQualityScenarioV1,
  observation: RiyaQualityObservationV1 | undefined,
  thresholds = focusedThresholds(),
) =>
  evaluateRiyaQualitySuite(
    createRiyaQualitySuite({
      binding: createSyntheticQualityBinding(),
      scenarios: [scenario],
      thresholds,
    }),
    observation === undefined ? [] : [observation],
  );

const failuresOf = (
  scenario: RiyaQualityScenarioV1,
  observation: RiyaQualityObservationV1 | undefined,
): readonly string[] => runOne(scenario, observation).caseResults[0]?.objectiveFailures ?? [];

const outcomeOf = (
  scenario: RiyaQualityScenarioV1,
  observation: RiyaQualityObservationV1 | undefined,
): string => runOne(scenario, observation).caseResults[0]?.outcome ?? 'no-case';

// ---------------------------------------------------------------------------
// 1. Objective rules, each at its boundary.
// ---------------------------------------------------------------------------

describe('every objective rule fires exactly at its boundary', () => {
  it('language mismatch', () => {
    expect(outcomeOf(scenarioWith(), observationWith())).toBe('PASS');
    // Answering a Hinglish client in English reads as a system that did not understand them.
    expect(failuresOf(scenarioWith(), observationWith({ languageMode: 'HINGLISH' }))).toStrictEqual(
      ['LANGUAGE_MISMATCH'],
    );
  });

  it('reply length: at the maximum passes, one over fails', () => {
    expect(outcomeOf(scenarioWith(), observationWith({ replyCharCount: 400 }))).toBe('PASS');
    expect(failuresOf(scenarioWith(), observationWith({ replyCharCount: 401 }))).toStrictEqual([
      'REPLY_TOO_LONG',
    ]);
  });

  it('question count: at the maximum passes, one over fails', () => {
    expect(outcomeOf(scenarioWith(), observationWith({ questionCount: 2 }))).toBe('PASS');
    expect(failuresOf(scenarioWith(), observationWith({ questionCount: 3 }))).toStrictEqual([
      'TOO_MANY_QUESTIONS',
    ]);
  });

  it('a required observation that never arrived', () => {
    const scenario = scenarioWith({
      expectedObservations: [{ field: 'location', operation: 'SET', value: 'city.alpha' }],
    });
    expect(failuresOf(scenario, observationWith())).toStrictEqual(['REQUIRED_OBSERVATION_MISSING']);
  });

  it('a required observation with the wrong operation or value', () => {
    const scenario = scenarioWith({
      expectedObservations: [{ field: 'location', operation: 'SET', value: 'city.alpha' }],
    });
    const withBatch = (observations: readonly unknown[]) =>
      observationWith({
        observationBatch: {
          version: 1,
          observations: observations as never,
          skipProjectDetails: false,
        },
      });
    expect(
      failuresOf(
        scenario,
        withBatch([{ field: 'location', operation: 'CLEAR', provenance: 'user_stated' }]),
      ),
    ).toStrictEqual(['OBSERVATION_VALUE_MISMATCH']);
    expect(
      failuresOf(
        scenario,
        withBatch([
          { field: 'location', operation: 'SET', value: 'city.beta', provenance: 'user_stated' },
        ]),
      ),
    ).toStrictEqual(['OBSERVATION_VALUE_MISMATCH']);
    expect(
      failuresOf(
        scenario,
        withBatch([
          { field: 'location', operation: 'SET', value: 'city.alpha', provenance: 'user_stated' },
        ]),
      ),
    ).toStrictEqual([]);
  });

  it('a CLEAR expectation is satisfied only by a CLEAR', () => {
    const scenario = scenarioWith({
      expectedObservations: [{ field: 'budget', operation: 'CLEAR' }],
    });
    expect(
      failuresOf(
        scenario,
        observationWith({
          observationBatch: {
            version: 1,
            observations: [{ field: 'budget', operation: 'CLEAR', provenance: 'user_stated' }],
            skipProjectDetails: false,
          },
        }),
      ),
    ).toStrictEqual([]);
  });

  it('a fact the client STATED must not be satisfied by a guess', () => {
    // A candidate that produced the right value as `model_inferred` guessed correctly. That is a
    // different skill, and it fails differently in front of a client who never said it.
    const scenario = scenarioWith({
      expectedObservations: [
        {
          field: 'location',
          operation: 'SET',
          value: 'city.alpha',
          allowedProvenance: ['user_stated'],
        },
      ],
    });
    expect(
      failuresOf(
        scenario,
        observationWith({
          observationBatch: {
            version: 1,
            observations: [
              {
                field: 'location',
                operation: 'SET',
                value: 'city.alpha',
                provenance: 'model_inferred',
              },
            ],
            skipProjectDetails: false,
          },
        }),
      ),
    ).toStrictEqual(['OBSERVATION_VALUE_MISMATCH']);
  });

  it('a forbidden observation that appeared', () => {
    const scenario = scenarioWith({ forbiddenObservationFields: ['budget'] });
    expect(
      failuresOf(
        scenario,
        observationWith({
          observationBatch: {
            version: 1,
            observations: [
              {
                field: 'budget',
                operation: 'SET',
                value: 'budget.mid',
                provenance: 'model_inferred',
              },
            ],
            skipProjectDetails: false,
          },
        }),
      ),
    ).toStrictEqual(['FORBIDDEN_OBSERVATION_PRESENT']);
  });

  it('a discovery field the scenario did not allow being asked about', () => {
    const scenario = scenarioWith({ allowedAskedDiscoveryFields: ['budget'] });
    expect(outcomeOf(scenario, observationWith({ askedDiscoveryFields: ['budget'] }))).toBe('PASS');
    // Re-asking something already answered is the most common way a discovery conversation loses
    // somebody.
    expect(
      failuresOf(scenario, observationWith({ askedDiscoveryFields: ['location'] })),
    ).toStrictEqual(['ASKED_FIELD_NOT_ALLOWED']);
  });

  it('a required citation that is absent', () => {
    const scenario = scenarioWith({ requiredCitation: true });
    expect(failuresOf(scenario, observationWith())).toStrictEqual(['CITATION_REQUIRED']);
    expect(
      outcomeOf(scenario, observationWith({ citations: [{ knowledgeId: 'k.a', version: 1 }] })),
    ).toBe('PASS');
  });

  it('a continuity phase outside the allowed set', () => {
    const scenario = scenarioWith({ allowedContinuityPhasesAfter: ['NEED', 'LOCATION'] });
    expect(outcomeOf(scenario, observationWith({ continuityPhaseAfter: 'LOCATION' }))).toBe('PASS');
    expect(
      failuresOf(scenario, observationWith({ continuityPhaseAfter: 'SUMMARY' })),
    ).toStrictEqual(['PHASE_NOT_ALLOWED']);
  });

  it('several failures are all reported, sorted, from one case', () => {
    const scenario = scenarioWith({ requiredCitation: true, allowedAskedDiscoveryFields: [] });
    expect(
      failuresOf(
        scenario,
        observationWith({
          languageMode: 'HINDI',
          replyCharCount: 900,
          questionCount: 9,
          askedDiscoveryFields: ['budget'],
        }),
      ),
    ).toStrictEqual([
      'ASKED_FIELD_NOT_ALLOWED',
      'CITATION_REQUIRED',
      'LANGUAGE_MISMATCH',
      'REPLY_TOO_LONG',
      'TOO_MANY_QUESTIONS',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. The two-reviewer rule.
// ---------------------------------------------------------------------------

const review = (ref: string, satisfied: readonly RiyaQualityDimension[]) =>
  createRiyaQualityHumanReview({ version: 1, reviewRef: ref, satisfiedDimensions: satisfied });

describe('a subjective dimension needs two people to agree', () => {
  const scenario = scenarioWith({ requiredQualityDimensions: ['CLARITY', 'EMPATHY'] });

  it('two distinct reviewers who both agree: PASS', () => {
    const result = runOne(
      scenario,
      observationWith({
        humanReviews: [review('a', ['CLARITY', 'EMPATHY']), review('b', ['CLARITY', 'EMPATHY'])],
      }),
      focusedThresholds({ CLARITY: 10_000, EMPATHY: 10_000 }),
    );
    expect(result.caseResults[0]?.outcome).toBe('PASS');
    expect(result.qualityEligible).toBe(true);
  });

  it('only one review: INCONCLUSIVE, not a pass and not a fail', () => {
    // One agreeing reviewer is one person's taste. Recording it either way would be inventing a
    // measurement that was never made.
    const result = runOne(
      scenario,
      observationWith({ humanReviews: [review('a', ['CLARITY', 'EMPATHY'])] }),
    );
    expect(result.caseResults[0]?.outcome).toBe('INCONCLUSIVE');
    expect(result.caseResults[0]?.objectiveFailures).toStrictEqual(['HUMAN_REVIEW_MISSING']);
    expect(result.objectiveFailureCount).toBe(0);
    expect(result.countsByOutcome.INCONCLUSIVE).toBe(1);
    // And it contributes to NO dimension: an unmeasured case must not move a pass rate either way.
    expect(result.dimensionApplicableCounts).toStrictEqual({});
  });

  it('reviewers who disagree: the dimension FAILS', () => {
    // If two trained reviewers reading the same rubric cannot agree the reply was empathetic, the
    // reply was not clearly empathetic. A tie-break would manufacture a verdict from a disagreement.
    const result = runOne(
      scenario,
      observationWith({
        humanReviews: [review('a', ['CLARITY', 'EMPATHY']), review('b', ['CLARITY'])],
      }),
      focusedThresholds({ CLARITY: 10_000, EMPATHY: 10_000 }),
    );
    expect(result.caseResults[0]?.outcome).toBe('FAIL');
    expect(result.caseResults[0]?.failedQualityDimensions).toStrictEqual(['EMPATHY']);
    // Objective checks all passed: a subjective disagreement is not a contract violation.
    expect(result.caseResults[0]?.objectiveFailures).toStrictEqual([]);
    expect(result.objectiveFailureCount).toBe(0);
    expect(result.dimensionPassRateBps).toStrictEqual({ CLARITY: 10_000, EMPATHY: 0 });
  });

  it('a required dimension neither reviewer marked: FAILS', () => {
    const result = runOne(
      scenario,
      observationWith({ humanReviews: [review('a', ['CLARITY']), review('b', ['CLARITY'])] }),
      focusedThresholds({ CLARITY: 10_000, EMPATHY: 10_000 }),
    );
    expect(result.caseResults[0]?.failedQualityDimensions).toStrictEqual(['EMPATHY']);
  });

  it('a scenario requiring NO dimension needs no review at all', () => {
    expect(outcomeOf(scenarioWith(), observationWith({ humanReviews: [] }))).toBe('PASS');
  });

  it('no observation at all: INCONCLUSIVE', () => {
    const result = runOne(scenario, undefined);
    expect(result.caseResults[0]?.outcome).toBe('INCONCLUSIVE');
    expect(result.caseResults[0]?.objectiveFailures).toStrictEqual(['OBSERVATION_MISSING']);
  });

  it('a case result carries no reviewer reference', () => {
    // Across a full corpus, recording which reviewer failed which case would be a performance record
    // of named people, assembled as a side effect of measuring a model.
    const result = runOne(
      scenario,
      observationWith({
        humanReviews: [review('reviewer.alpha', ['CLARITY']), review('reviewer.beta', ['CLARITY'])],
      }),
      focusedThresholds({ CLARITY: 10_000 }),
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('reviewer.alpha');
    expect(serialized).not.toContain('reviewer.beta');
    expect(Object.keys(result.caseResults[0] ?? {}).sort()).toStrictEqual([
      'failedQualityDimensions',
      'objectiveFailures',
      'outcome',
      'scenarioId',
      'scenarioVersion',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. Threshold gates.
// ---------------------------------------------------------------------------

describe('the gates refuse independently, and none can be averaged away', () => {
  const clarityScenario = (id: string) =>
    scenarioWith({ requiredQualityDimensions: ['CLARITY'] }, { scenarioId: id });

  const clarityObservation = (id: string, satisfied: boolean) =>
    observationWith({
      scenarioId: id,
      humanReviews: [
        review('a', satisfied ? ['CLARITY'] : []),
        review('b', satisfied ? ['CLARITY'] : []),
      ],
    });

  const runMany = (
    pairs: readonly (readonly [string, boolean])[],
    thresholds = focusedThresholds({ CLARITY: 9000 }),
  ) =>
    evaluateRiyaQualitySuite(
      createRiyaQualitySuite({
        binding: createSyntheticQualityBinding(),
        scenarios: pairs.map(([id]) => clarityScenario(id)),
        thresholds,
      }),
      pairs.map(([id, satisfied]) => clarityObservation(id, satisfied)),
    );

  it('one objective failure blocks, at a limit of zero', () => {
    const result = runOne(
      scenarioWith({ requiredCitation: true }),
      observationWith(),
      focusedThresholds(),
    );
    expect(result.objectiveFailureCount).toBe(1);
    expect(result.qualityEligible).toBe(false);
    expect(result.thresholdBreaches.map((b) => b.kind)).toStrictEqual(['OBJECTIVE_FAILURES']);
  });

  it('one inconclusive case blocks', () => {
    const result = runOne(
      scenarioWith({ requiredQualityDimensions: ['CLARITY'] }),
      undefined,
      focusedThresholds({ CLARITY: 9000 }),
    );
    expect(result.qualityEligible).toBe(false);
    // Two independent reasons: the case was not measured, AND the gated dimension has no coverage.
    expect(result.thresholdBreaches.map((b) => b.kind).sort()).toStrictEqual([
      'DIMENSION_NOT_COVERED',
      'INCONCLUSIVE_CASES',
    ]);
  });

  it('a dimension one basis point under its floor blocks', () => {
    // 19 of 20 is 9500 bps. A floor of 9501 refuses it, and nothing about the other nine dimensions
    // can argue past that.
    const pairs = Array.from(
      { length: 20 },
      (_unused, index) => [`s.${String(index)}`, index > 0] as const,
    );
    const passing = runMany(pairs, focusedThresholds({ CLARITY: 9500 }));
    expect(passing.dimensionPassRateBps.CLARITY).toBe(9500);
    expect(passing.qualityEligible).toBe(true);

    const blocked = runMany(pairs, focusedThresholds({ CLARITY: 9501 }));
    expect(blocked.qualityEligible).toBe(false);
    expect(blocked.thresholdBreaches).toStrictEqual([
      { kind: 'DIMENSION_PASS_RATE', dimension: 'CLARITY', observed: 9500, limit: 9501 },
    ]);
  });

  it('a GATED dimension nothing measured is a hole, not a pass', () => {
    // Otherwise the easiest way to clear a floor would be to delete every case that exercised it.
    const result = runMany([['s.0', true]], focusedThresholds({ CLARITY: 9000, EMPATHY: 9000 }));
    expect(result.qualityEligible).toBe(false);
    expect(result.thresholdBreaches).toStrictEqual([
      { kind: 'DIMENSION_NOT_COVERED', dimension: 'EMPATHY', observed: 0, limit: 9000 },
    ]);
  });

  it('everything passing is eligible, with no breaches', () => {
    const result = runMany([
      ['s.0', true],
      ['s.1', true],
    ]);
    expect(result.qualityEligible).toBe(true);
    expect(result.thresholdBreaches).toStrictEqual([]);
    expect(result.countsByOutcome).toStrictEqual({ PASS: 2, FAIL: 0, INCONCLUSIVE: 0 });
  });

  it('is deterministic, and independent of the order anything was supplied in', () => {
    const ids = ['s.2', 's.0', 's.1'] as const;
    const scenarios = ids.map(clarityScenario);
    const observations = ids.map((id) => clarityObservation(id, true));
    const thresholds = focusedThresholds({ CLARITY: 9000 });
    const binding = createSyntheticQualityBinding();

    const forward = evaluateRiyaQualitySuite(
      createRiyaQualitySuite({ binding, scenarios, thresholds }),
      observations,
    );
    const reversed = evaluateRiyaQualitySuite(
      createRiyaQualitySuite({ binding, scenarios: [...scenarios].reverse(), thresholds }),
      [...observations].reverse(),
    );

    expect(reversed.caseResults.map((one) => one.scenarioId)).toStrictEqual(['s.0', 's.1', 's.2']);
    expect(reversed.caseSetDigest).toBe(forward.caseSetDigest);
    expect(reversed.resultDigest).toBe(forward.resultDigest);
    expect(reversed).toStrictEqual(forward);
  });
});

// ---------------------------------------------------------------------------
// 4. Suite construction.
// ---------------------------------------------------------------------------

describe('a suite refuses what would make its result meaningless', () => {
  const thresholds = focusedThresholds();
  const binding = createSyntheticQualityBinding();

  const codeOf = (run: () => unknown): string => {
    try {
      run();
    } catch (error: unknown) {
      return error instanceof RiyaQualityEvaluationError ? error.code : 'not-a-quality-error';
    }
    return 'no-error';
  };

  it('refuses an EMPTY suite', () => {
    // "Zero cases, zero failures, therefore approved" is the most dangerous result this package
    // could produce, and a mistake in corpus assembly is exactly how it would arise.
    expect(codeOf(() => createRiyaQualitySuite({ binding, scenarios: [], thresholds }))).toBe(
      'invalid-suite',
    );
  });

  it('refuses a duplicate scenario', () => {
    const scenario = scenarioWith();
    expect(
      codeOf(() =>
        createRiyaQualitySuite({ binding, scenarios: [scenario, scenario], thresholds }),
      ),
    ).toBe('duplicate-scenario');
  });

  it('refuses thresholds the binding does not name', () => {
    // The binding NAMES the gate evidence will attest. A suite carrying a different one would make
    // the evidence a claim about a threshold set that never ran.
    const other = createRiyaQualityThresholds({
      thresholdsId: 'some-other-thresholds',
      thresholdsVersion: 1,
      requiredHumanReviews: 2,
      minimumPassRateBpsByDimension: {},
      maximumObjectiveFailures: 0,
      maximumInconclusiveCases: 0,
    });
    expect(
      codeOf(() =>
        createRiyaQualitySuite({ binding, scenarios: [scenarioWith()], thresholds: other }),
      ),
    ).toBe('invalid-suite');
  });

  it('sorts scenarios deterministically', () => {
    const suite = createRiyaQualitySuite({
      binding,
      scenarios: [
        scenarioWith({}, { scenarioId: 'z.case' }),
        scenarioWith({}, { scenarioId: 'a.case' }),
      ],
      thresholds,
    });
    expect(suite.scenarios.map((one) => one.scenarioId)).toStrictEqual(['a.case', 'z.case']);
  });
});
