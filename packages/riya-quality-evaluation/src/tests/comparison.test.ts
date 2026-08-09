/**
 * RWC-P10 — candidate comparison is Pareto, and one improvement never buys a regression
 * (ADR-0106 §19).
 *
 * The specs that matter most are the two negatives. A candidate that gains 500 bps on `CTA_QUALITY`
 * and loses ONE basis point on `CONTEXT_USE` is not preferred, and a candidate that gains 100 bps and
 * loses nothing is not preferred either. Between them they close the two ways a comparator normally
 * leaks: a tolerance that lets a real regression through, and a sensitivity that reads reviewer noise
 * as progress.
 */
import { describe, expect, it } from 'vitest';

import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import { createRiyaQualityScenario } from '../contracts/scenario.js';
import { createRiyaQualitySuite } from '../contracts/suite.js';
import { createRiyaQualityThresholds } from '../contracts/thresholds.js';
import type { RiyaQualitySuiteResultV1 } from '../contracts/results.js';
import type { RiyaQualityDimension } from '../contracts/vocabularies.js';
import {
  compareRiyaQualityCandidates,
  createRiyaQualityComparisonPolicy,
  RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1,
} from '../service/compare-candidates.js';
import { evaluateRiyaQualitySuite } from '../service/evaluate-suite.js';
import { createRiyaQualityHumanReview } from '../contracts/human-review.js';
import { createRiyaQualityObservation } from '../contracts/observation.js';
import { createSyntheticQualityBinding, SYNTHETIC_INSTANT } from '../testing/builders.js';
import { createRiyaQualityCandidateBinding } from '../contracts/binding.js';
import { createSyntheticSafetyEvidence } from '../testing/builders.js';

const POLICY = RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1;

/** 200 cases per dimension, so a single case moves a rate by exactly 50 bps. */
const CASES = 200;

const DIMENSIONS: readonly RiyaQualityDimension[] = ['CLARITY', 'CONTEXT_USE', 'CTA_QUALITY'];

const thresholds = (floors: Partial<Record<RiyaQualityDimension, number>>) =>
  createRiyaQualityThresholds({
    thresholdsId: 'riya-quality-thresholds-v1',
    thresholdsVersion: 1,
    requiredHumanReviews: 2,
    minimumPassRateBpsByDimension: floors,
    maximumObjectiveFailures: 0,
    maximumInconclusiveCases: 0,
  });

const FLOORS = { CLARITY: 5000, CONTEXT_USE: 5000, CTA_QUALITY: 5000 } as const;

function scenarios() {
  return DIMENSIONS.flatMap((dimension) =>
    Array.from({ length: CASES }, (_unused, index) =>
      createRiyaQualityScenario({
        version: 1,
        scenarioId: `case.${dimension.toLowerCase()}.${String(index).padStart(3, '0')}`,
        scenarioVersion: 1,
        phase: 'NEED',
        languageMode: 'ENGLISH',
        interactionKind: 'DISCOVERY',
        expected: {
          maxReplyChars: 400,
          maxQuestions: 1,
          expectedObservations: [],
          forbiddenObservationFields: [],
          requiredCitation: false,
          allowedAskedDiscoveryFields: [],
          allowedContinuityPhasesAfter: ['NEED'],
          requiredQualityDimensions: [dimension],
        },
      }),
    ),
  );
}

/**
 * A result where each named dimension has exactly `failures[dimension]` failing cases.
 *
 * A failure is modelled as the SECOND reviewer withholding the dimension, which is what a real
 * quality difference looks like coming out of a review tool.
 */
function resultWith(
  failures: Partial<Record<RiyaQualityDimension, number>>,
  bindingOptions: Parameters<typeof createSyntheticQualityBinding>[0] = {},
  floors: Partial<Record<RiyaQualityDimension, number>> = FLOORS,
): RiyaQualitySuiteResultV1 {
  const suite = createRiyaQualitySuite({
    binding: createSyntheticQualityBinding(bindingOptions),
    scenarios: scenarios(),
    thresholds: thresholds(floors),
  });

  const remaining = new Map<RiyaQualityDimension, number>(
    DIMENSIONS.map((dimension) => [dimension, failures[dimension] ?? 0]),
  );

  const observations = suite.scenarios.map((scenario) => {
    // Every scenario in this harness requires exactly one dimension; the fallback keeps the
    // indexed read honest rather than asserted.
    const dimension = scenario.expected.requiredQualityDimensions[0] ?? 'CLARITY';
    const left = remaining.get(dimension) ?? 0;
    const fails = left > 0;
    if (fails) {
      remaining.set(dimension, left - 1);
    }
    return createRiyaQualityObservation({
      version: 1,
      scenarioId: scenario.scenarioId,
      scenarioVersion: 1,
      languageMode: 'ENGLISH',
      replyCharCount: 200,
      questionCount: 1,
      askedDiscoveryFields: [],
      observationBatch: { version: 1, observations: [], skipProjectDetails: false },
      citations: [],
      continuityPhaseAfter: 'NEED',
      humanReviews: [
        createRiyaQualityHumanReview({
          version: 1,
          reviewRef: 'reviewer.alpha',
          satisfiedDimensions: [dimension],
        }),
        createRiyaQualityHumanReview({
          version: 1,
          reviewRef: 'reviewer.beta',
          satisfiedDimensions: fails ? [] : [dimension],
        }),
      ],
    });
  });

  return evaluateRiyaQualitySuite(suite, observations);
}

const rateOf = (result: RiyaQualitySuiteResultV1, dimension: RiyaQualityDimension): number =>
  result.dimensionPassRateBps[dimension] ?? -1;

// ---------------------------------------------------------------------------
// 1. The policy.
// ---------------------------------------------------------------------------

describe('the canonical comparison policy', () => {
  it('is riya-quality-comparison-v1 at 250 basis points', () => {
    expect(POLICY.policyId).toBe('riya-quality-comparison-v1');
    expect(POLICY.policyVersion).toBe(1);
    expect(POLICY.minimumImprovementBps).toBe(250);
    expect(Object.isFrozen(POLICY)).toBe(true);
  });

  it('refuses a zero or fractional improvement threshold', () => {
    // Zero would make any movement an improvement, including reviewer noise.
    for (const bps of [0, -1, 2.5, 10_001]) {
      let code = 'no-error';
      try {
        createRiyaQualityComparisonPolicy({
          policyId: 'p',
          policyVersion: 1,
          minimumImprovementBps: bps,
        });
      } catch (error: unknown) {
        code = error instanceof RiyaQualityEvaluationError ? error.code : 'other';
      }
      expect(code).toBe('invalid-comparison-policy');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Comparability.
// ---------------------------------------------------------------------------

describe('two results are comparable only when they answered the same question', () => {
  it('a different provider, model or release IS comparable', () => {
    // This is the entire point of the feature. If varying these blocked comparison, nothing could
    // ever be compared.
    const baseline = resultWith({});
    for (const varied of [
      { releaseId: 'release.gamma' },
      { modelId: 'vendor.gamma/model-gamma' },
    ]) {
      const candidate = resultWith({}, varied);
      expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe('TIE');
    }
  });

  it('a different prompt family, version or digest IS comparable', () => {
    const baseline = resultWith({});
    for (const varied of [
      { promptFamily: 'riya.conversation.experimental' },
      { promptVersion: 9 },
      { promptDigest: 'b'.repeat(64) },
    ]) {
      const candidate = resultWith({}, varied);
      expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe('TIE');
    }
  });

  it('a different capability, knowledge or policy revision is NOT comparable', () => {
    const baseline = resultWith({});
    for (const varied of [
      { capabilityProfileRef: 'capability.other' },
      { knowledgeRevision: 'knowledge.rev.99' },
      { policyContractRevision: 'policy.rev.99' },
    ]) {
      const comparison = compareRiyaQualityCandidates(baseline, resultWith({}, varied), POLICY);
      expect(comparison.outcome).toBe('NOT_COMPARABLE');
      // No deltas published: numbers between incomparable runs would be read anyway, and they mean
      // nothing.
      expect(comparison.dimensionDeltas).toStrictEqual([]);
    }
  });

  it('a different fixture manifest or threshold set is NOT comparable', () => {
    const baseline = resultWith({});
    const otherFixtures = createRiyaQualityCandidateBinding({
      safetyEvidence: createSyntheticSafetyEvidence(),
      qualitySuiteId: 'riya-quality-v1',
      qualitySuiteVersion: 1,
      fixtureManifestId: 'riya-quality-golden-v2',
      fixtureManifestVersion: 2,
      thresholdsId: 'riya-quality-thresholds-v1',
      thresholdsVersion: 1,
      createdAt: SYNTHETIC_INSTANT,
    });
    const candidate = evaluateRiyaQualitySuite(
      createRiyaQualitySuite({
        binding: otherFixtures,
        scenarios: scenarios(),
        thresholds: thresholds(FLOORS),
      }),
      [],
    );
    expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe(
      'NOT_COMPARABLE',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The verdicts.
// ---------------------------------------------------------------------------

describe('preference requires improvement AND the absence of any regression', () => {
  it('identical results TIE', () => {
    const comparison = compareRiyaQualityCandidates(resultWith({}), resultWith({}), POLICY);
    expect(comparison.outcome).toBe('TIE');
    expect(comparison.regressedDimensions).toStrictEqual([]);
    expect(comparison.materiallyImprovedDimensions).toStrictEqual([]);
    expect(comparison.dimensionDeltas.every((delta) => delta.deltaBps === 0)).toBe(true);
  });

  it('+300 bps on one dimension with no regression: CANDIDATE_PREFERRED', () => {
    // Baseline fails 6 CLARITY cases (9700), candidate fails 0 (10000). Exactly +300.
    const baseline = resultWith({ CLARITY: 6 });
    const candidate = resultWith({});
    expect(rateOf(candidate, 'CLARITY') - rateOf(baseline, 'CLARITY')).toBe(300);

    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(comparison.outcome).toBe('CANDIDATE_PREFERRED');
    expect(comparison.materiallyImprovedDimensions).toStrictEqual(['CLARITY']);
    expect(comparison.regressedDimensions).toStrictEqual([]);
  });

  it('+500 bps on CTA_QUALITY with a ONE basis point CONTEXT_USE regression: NOT preferred', () => {
    // THE case this comparator exists for. A prompt tuned for momentum almost always buys CTA and
    // quietly costs something else, and every scheme that adds the numbers up approves it.
    //
    // 10000 cases would be needed for a literal 1 bp step, so this uses the smallest step the corpus
    // can express — one case, 50 bps — and the rule is identical: ANY negative delta blocks.
    const baseline = resultWith({ CTA_QUALITY: 10 });
    const candidate = resultWith({ CONTEXT_USE: 1 });

    expect(rateOf(candidate, 'CTA_QUALITY') - rateOf(baseline, 'CTA_QUALITY')).toBe(500);
    expect(rateOf(candidate, 'CONTEXT_USE') - rateOf(baseline, 'CONTEXT_USE')).toBe(-50);

    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(comparison.outcome).toBe('TIE');
    expect(comparison.regressedDimensions).toStrictEqual(['CONTEXT_USE']);
    // The improvement is still REPORTED. The comparator withholds preference; it does not hide what
    // moved, because a human deciding whether to accept the trade needs to see both.
    expect(comparison.materiallyImprovedDimensions).toStrictEqual(['CTA_QUALITY']);
  });

  it('the SMALLEST expressible regression is enough to block preference', () => {
    const baseline = resultWith({ CTA_QUALITY: 40 });
    const candidate = resultWith({ CONTEXT_USE: 1 });
    expect(rateOf(candidate, 'CONTEXT_USE') - rateOf(baseline, 'CONTEXT_USE')).toBeLessThan(0);
    expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe('TIE');
  });

  it('+100 bps, under the 250 minimum: TIE', () => {
    // Two cases out of 200 is inside the noise of a corpus judged by people. Preferring on it would
    // mean one reviewer changing their mind reads as a model improvement.
    const baseline = resultWith({ CLARITY: 2 });
    const candidate = resultWith({});
    expect(rateOf(candidate, 'CLARITY') - rateOf(baseline, 'CLARITY')).toBe(100);
    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(comparison.outcome).toBe('TIE');
    expect(comparison.materiallyImprovedDimensions).toStrictEqual([]);
    expect(comparison.regressedDimensions).toStrictEqual([]);
  });

  it('exactly 250 bps is enough — the minimum is inclusive', () => {
    const baseline = resultWith({ CLARITY: 5 });
    const candidate = resultWith({});
    expect(rateOf(candidate, 'CLARITY') - rateOf(baseline, 'CLARITY')).toBe(250);
    expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe(
      'CANDIDATE_PREFERRED',
    );
  });

  it('is symmetric: a clearly worse candidate makes the BASELINE preferred', () => {
    const baseline = resultWith({});
    const candidate = resultWith({ CLARITY: 6 });
    expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe(
      'BASELINE_PREFERRED',
    );
  });

  it('the eligible one wins when only one is eligible', () => {
    const baseline = resultWith({ CLARITY: 199 }, {}, { ...FLOORS, CLARITY: 9000 });
    const candidate = resultWith({}, {}, { ...FLOORS, CLARITY: 9000 });
    expect(baseline.qualityEligible).toBe(false);
    expect(candidate.qualityEligible).toBe(true);
    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(comparison.outcome).toBe('CANDIDATE_PREFERRED');
    expect(comparison.baselineEligible).toBe(false);
    expect(comparison.candidateEligible).toBe(true);

    expect(compareRiyaQualityCandidates(candidate, baseline, POLICY).outcome).toBe(
      'BASELINE_PREFERRED',
    );
  });

  it('NEITHER eligible is NOT_COMPARABLE, not a ranking of two failures', () => {
    // Ranking two failing candidates would invite shipping the less bad one.
    const floors = { ...FLOORS, CLARITY: 9900 };
    const baseline = resultWith({ CLARITY: 100 }, {}, floors);
    const candidate = resultWith({ CLARITY: 50 }, {}, floors);
    expect(baseline.qualityEligible).toBe(false);
    expect(candidate.qualityEligible).toBe(false);
    expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe(
      'NOT_COMPARABLE',
    );
  });

  it('publishes no average, no total and no weight', () => {
    const comparison = compareRiyaQualityCandidates(resultWith({}), resultWith({}), POLICY);
    expect(Object.keys(comparison).sort()).toStrictEqual([
      'baselineEligible',
      'candidateEligible',
      'dimensionDeltas',
      'materiallyImprovedDimensions',
      'outcome',
      'policyId',
      'policyVersion',
      'regressedDimensions',
      'version',
    ]);
    const serialized = JSON.stringify(comparison);
    for (const forbidden of ['average', 'overall', 'total', 'score', 'weight']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('activates nothing: no rollout, promotion or approval field exists', () => {
    const comparison = compareRiyaQualityCandidates(resultWith({}), resultWith({}), POLICY);
    const serialized = JSON.stringify(comparison).toLowerCase();
    for (const forbidden of ['rollout', 'promote', 'activate', 'productionapproval', 'deploy']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The literal one-basis-point rule.
// ---------------------------------------------------------------------------

/**
 * A rate difference of exactly ONE basis point cannot be produced by a real suite: pass rates are
 * `floor(pass * 10000 / applicable)`, so the smallest step a corpus can express is `10000 / N`, and
 * `N` is capped at 1000 cases. Reaching 1 bp would need ten thousand cases judged by two people each.
 *
 * The rule is still exactly "any negative delta blocks", so it is proved against the comparator
 * directly, with two hand-built results. These are inputs to a pure function, not evidence — nothing
 * here is digested, stored or attested, and the evidence gate would refuse them on sight.
 */
function resultLiteral(
  rates: Partial<Record<RiyaQualityDimension, number>>,
  binding = createSyntheticQualityBinding(),
): RiyaQualitySuiteResultV1 {
  return Object.freeze({
    version: 1 as const,
    binding,
    caseResults: Object.freeze([]),
    countsByOutcome: Object.freeze({ PASS: 1, FAIL: 0, INCONCLUSIVE: 0 }),
    objectiveFailureCount: 0,
    dimensionApplicableCounts: Object.freeze(
      Object.fromEntries(Object.keys(rates).map((key) => [key, 10_000])),
    ),
    dimensionPassCounts: Object.freeze(
      Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, value])),
    ),
    dimensionPassRateBps: Object.freeze({ ...rates }),
    thresholdBreaches: Object.freeze([]),
    qualityEligible: true,
    caseSetDigest: 'digest-not-used-by-comparison',
    resultDigest: 'digest-not-used-by-comparison',
  });
}

describe('a ONE basis point regression is enough to withhold preference', () => {
  it('+500 bps CTA_QUALITY with a 1 bp CONTEXT_USE regression is a TIE', () => {
    const baseline = resultLiteral({ CONTEXT_USE: 9900, CTA_QUALITY: 9000, CLARITY: 9500 });
    const candidate = resultLiteral({ CONTEXT_USE: 9899, CTA_QUALITY: 9500, CLARITY: 9500 });

    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(comparison.outcome).toBe('TIE');
    expect(comparison.regressedDimensions).toStrictEqual(['CONTEXT_USE']);
    expect(comparison.materiallyImprovedDimensions).toStrictEqual(['CTA_QUALITY']);
    expect(
      comparison.dimensionDeltas.find((delta) => delta.dimension === 'CONTEXT_USE')?.deltaBps,
    ).toBe(-1);
  });

  it('removing that single basis point makes the same candidate preferred', () => {
    // Proof that the 1 bp was the ONLY thing blocking it, rather than something else in the fixture.
    const baseline = resultLiteral({ CONTEXT_USE: 9900, CTA_QUALITY: 9000, CLARITY: 9500 });
    const candidate = resultLiteral({ CONTEXT_USE: 9900, CTA_QUALITY: 9500, CLARITY: 9500 });
    expect(compareRiyaQualityCandidates(baseline, candidate, POLICY).outcome).toBe(
      'CANDIDATE_PREFERRED',
    );
  });

  it('a dimension only ONE side measured is skipped, not read as a collapse', () => {
    // Treating an absent rate as zero would manufacture a 9500 bp regression out of a coverage
    // difference, and the verdict would be about the corpus rather than the candidate.
    const baseline = resultLiteral({ CLARITY: 9500, EMPATHY: 9500 });
    const candidate = resultLiteral({ CLARITY: 9900 });
    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(comparison.dimensionDeltas.map((delta) => delta.dimension)).toStrictEqual(['CLARITY']);
    expect(comparison.outcome).toBe('CANDIDATE_PREFERRED');
  });
});
