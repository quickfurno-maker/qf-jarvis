/**
 * RWC-P10 — result integrity, comparison attestation, and the literal one-basis-point rule
 * (owner correction on PR #111).
 *
 * ### Three holes, and why each mattered
 *
 * **The evidence gate checked only the case set.** A result whose per-dimension rates, threshold
 * breaches or `qualityEligible` flag had been edited — with its case list untouched — passed, and the
 * edited `resultDigest` was copied into the evidence and into `qualityRef` as though verified.
 * `qualityEligible` is the field a rollout conversation actually reads, which makes it the one
 * somebody would edit and the one that most needed covering.
 *
 * **The public comparator ranked whatever it was handed.** A hand-assembled object claiming perfect
 * rates could be returned as `CANDIDATE_PREFERRED` — a verdict about a measurement that never took
 * place, in exactly the shape somebody would quote.
 *
 * **A comparison named its inputs by nothing.** It can now be traced to the two verified artifacts it
 * came from, and carries a digest of its own content.
 *
 * Every result below comes from the REAL evaluator. The only hand-built values are rate maps handed
 * to the internal helper, which takes no artifact and therefore has none to forge.
 */
import { describe, expect, it } from 'vitest';

import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import type { RiyaQualitySuiteResultV1 } from '../contracts/results.js';
import { createRiyaQualityScenario } from '../contracts/scenario.js';
import { createRiyaQualitySuite } from '../contracts/suite.js';
import { createRiyaQualityThresholds } from '../contracts/thresholds.js';
import { createRiyaQualityHumanReview } from '../contracts/human-review.js';
import { createRiyaQualityObservation } from '../contracts/observation.js';
import type { RiyaQualityDimension } from '../contracts/vocabularies.js';
import { compareRiyaQualityRates } from '../internal/compare-rates.js';
import {
  riyaQualityCaseSetDigest,
  riyaQualityResultDigest,
  riyaQualityResultIntegrityHolds,
} from '../internal/result-integrity.js';
import {
  compareRiyaQualityCandidates,
  RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1,
} from '../service/compare-candidates.js';
import { createRiyaQualityEvidence } from '../service/create-evidence.js';
import { evaluateRiyaQualitySuite } from '../service/evaluate-suite.js';
import {
  buildRiyaQualityGoldenSuite,
  createSyntheticQualityBinding,
  passingGoldenObservations,
} from '../testing/builders.js';

const POLICY = RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1;

/** A genuine, eligible 72-case result. Every rate is 10000 and there are no breaches. */
const goldenResult = (): RiyaQualitySuiteResultV1 =>
  evaluateRiyaQualitySuite(buildRiyaQualityGoldenSuite(), passingGoldenObservations());

/**
 * A genuine result that is NOT perfect: five withheld `CLARITY` cases, so it has failing cases, a
 * sub-10000 rate and a threshold breach.
 *
 * The tamper matrix needs this. Against an all-passing artifact, "lift a rate to 10000" and "erase
 * the breaches" are no-ops, and a spec that edits nothing proves nothing.
 */
const flawedResult = (): RiyaQualitySuiteResultV1 =>
  evaluateRiyaQualitySuite(
    buildRiyaQualityGoldenSuite(),
    passingGoldenObservations({ withhold: ['CLARITY'], withholdCases: 5 }),
  );

/** A small genuine result, so a spec can vary one dimension cheaply. */
function smallResult(
  failures = 0,
  bindingOptions: Parameters<typeof createSyntheticQualityBinding>[0] = {},
): RiyaQualitySuiteResultV1 {
  const scenarios = Array.from({ length: 40 }, (_unused, index) =>
    createRiyaQualityScenario({
      version: 1,
      scenarioId: `integrity.case.${String(index).padStart(3, '0')}`,
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
        requiredQualityDimensions: ['CLARITY'],
      },
    }),
  );
  const suite = createRiyaQualitySuite({
    binding: createSyntheticQualityBinding(bindingOptions),
    scenarios,
    thresholds: createRiyaQualityThresholds({
      thresholdsId: 'riya-quality-thresholds-v1',
      thresholdsVersion: 1,
      requiredHumanReviews: 2,
      minimumPassRateBpsByDimension: { CLARITY: 5000 },
      maximumObjectiveFailures: 0,
      maximumInconclusiveCases: 0,
    }),
  });

  let remaining = failures;
  const observations = suite.scenarios.map((scenario) => {
    const fails = remaining > 0;
    if (fails) {
      remaining -= 1;
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
          satisfiedDimensions: ['CLARITY'],
        }),
        createRiyaQualityHumanReview({
          version: 1,
          reviewRef: 'reviewer.beta',
          satisfiedDimensions: fails ? [] : ['CLARITY'],
        }),
      ],
    });
  });
  return evaluateRiyaQualitySuite(suite, observations);
}

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaQualityEvaluationError ? error.code : 'not-a-quality-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// 1. The full result digest covers every field a reader could act on.
// ---------------------------------------------------------------------------

describe('the result digest commits to the whole result, not just the case list', () => {
  it('an untouched genuine result verifies', () => {
    const result = goldenResult();
    expect(riyaQualityResultIntegrityHolds(result)).toBe(true);
    expect(riyaQualityCaseSetDigest(result.caseResults)).toBe(result.caseSetDigest);
    expect(
      riyaQualityResultDigest({
        binding: result.binding,
        caseSetDigest: result.caseSetDigest,
        countsByOutcome: result.countsByOutcome,
        objectiveFailureCount: result.objectiveFailureCount,
        dimensionApplicableCounts: result.dimensionApplicableCounts,
        dimensionPassCounts: result.dimensionPassCounts,
        dimensionPassRateBps: result.dimensionPassRateBps,
        thresholdBreaches: result.thresholdBreaches,
        qualityEligible: result.qualityEligible,
      }),
    ).toBe(result.resultDigest);
  });

  const tampers: readonly (readonly [
    string,
    (r: RiyaQualitySuiteResultV1) => RiyaQualitySuiteResultV1,
  ])[] = [
    ['the resultDigest alone', (r) => ({ ...r, resultDigest: 'deadbeef'.repeat(4) })],
    [
      'a per-dimension pass rate lifted to perfect',
      (r) => ({ ...r, dimensionPassRateBps: { ...r.dimensionPassRateBps, CLARITY: 10_000 } }),
    ],
    ['the eligibility verdict', (r) => ({ ...r, qualityEligible: !r.qualityEligible })],
    ['the threshold breaches erased', (r) => ({ ...r, thresholdBreaches: [] })],
    ['the outcome counts', (r) => ({ ...r, countsByOutcome: { ...r.countsByOutcome, FAIL: 0 } })],
    [
      'the objective failure count',
      (r) => ({ ...r, objectiveFailureCount: r.objectiveFailureCount + 1 }),
    ],
    [
      'a dimension applicable count',
      (r) => ({
        ...r,
        dimensionApplicableCounts: { ...r.dimensionApplicableCounts, CLARITY: 999 },
      }),
    ],
    [
      'a dimension pass count',
      (r) => ({ ...r, dimensionPassCounts: { ...r.dimensionPassCounts, CLARITY: 999 } }),
    ],
    ['the case set digest', (r) => ({ ...r, caseSetDigest: 'deadbeef'.repeat(4) })],
    [
      'a case outcome, leaving both digests alone',
      (r) => ({
        ...r,
        caseResults: r.caseResults.map((one, index) =>
          index === 0 ? { ...one, outcome: 'INCONCLUSIVE' as const } : one,
        ),
      }),
    ],
    [
      'the binding it claims to be about',
      (r) => ({ ...r, binding: { ...r.binding, promptVersion: 99 } }),
    ],
  ];

  it.each(tampers)('%s is detected', (_name, tamper) => {
    // Applied to the FLAWED result, so each edit genuinely changes a value.
    expect(riyaQualityResultIntegrityHolds(tamper(flawedResult()))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The evidence gate.
// ---------------------------------------------------------------------------

describe('quality evidence requires BOTH digests to recompute', () => {
  it('an untouched eligible result yields evidence', () => {
    const created = createRiyaQualityEvidence(goldenResult());
    expect(created.ok).toBe(true);
  });

  it.each(tampersForEvidence())('%s is refused as quality-digest-invalid', (_name, tamper) => {
    // Every one of these previously produced EVIDENCE, because only the case-set digest was checked
    // and the edited `resultDigest` was copied verbatim into the artifact. The base is an ELIGIBLE
    // result, so integrity is genuinely the only thing standing in the way.
    expect(createRiyaQualityEvidence(tamper(goldenResult()))).toStrictEqual({
      ok: false,
      code: 'quality-digest-invalid',
    });
  });

  it('a FLAWED result laundered into an eligible-looking one is refused', () => {
    // The whole point. Lift the failing rate, erase the breach, flip the flag -- the shape somebody
    // would produce to make a failing candidate look approvable.
    const laundered = {
      ...flawedResult(),
      dimensionPassRateBps: { ...flawedResult().dimensionPassRateBps, CLARITY: 10_000 },
      thresholdBreaches: [],
      qualityEligible: true,
    };
    expect(createRiyaQualityEvidence(laundered)).toStrictEqual({
      ok: false,
      code: 'quality-digest-invalid',
    });
  });

  it('an INELIGIBLE but intact result is refused for eligibility, not integrity', () => {
    // The two gates stay distinguishable: a caller should be able to tell "this run failed" from
    // "this artifact was edited".
    const result = evaluateRiyaQualitySuite(
      buildRiyaQualityGoldenSuite(),
      passingGoldenObservations({ withhold: ['CONTEXT_USE'], withholdCases: 1 }),
    );
    expect(riyaQualityResultIntegrityHolds(result)).toBe(true);
    expect(createRiyaQualityEvidence(result)).toStrictEqual({
      ok: false,
      code: 'quality-not-eligible',
    });
  });
});

function tampersForEvidence(): readonly (readonly [
  string,
  (r: RiyaQualitySuiteResultV1) => RiyaQualitySuiteResultV1,
])[] {
  return [
    ['a rewritten resultDigest', (r) => ({ ...r, resultDigest: 'deadbeef'.repeat(4) })],
    [
      'an altered pass rate',
      (r) => ({ ...r, dimensionPassRateBps: { ...r.dimensionPassRateBps, EMPATHY: 9000 } }),
    ],
    ['a flipped eligibility flag', (r) => ({ ...r, qualityEligible: false })],
    [
      'an injected threshold breach',
      (r) => ({
        ...r,
        thresholdBreaches: [
          {
            kind: 'DIMENSION_PASS_RATE' as const,
            dimension: 'EMPATHY' as const,
            observed: 1,
            limit: 2,
          },
        ],
      }),
    ],
    ['a rewritten caseSetDigest', (r) => ({ ...r, caseSetDigest: 'deadbeef'.repeat(4) })],
  ];
}

// ---------------------------------------------------------------------------
// 3. The comparator refuses to rank an unproved artifact.
// ---------------------------------------------------------------------------

describe('the comparator will not rank what it cannot verify', () => {
  it('a tampered BASELINE result is refused', () => {
    const baseline = { ...goldenResult(), resultDigest: 'deadbeef'.repeat(4) };
    expect(codeOf(() => compareRiyaQualityCandidates(baseline, goldenResult(), POLICY))).toBe(
      'quality-digest-invalid',
    );
  });

  it('a tampered CANDIDATE result is refused', () => {
    const candidate = { ...goldenResult(), qualityEligible: true, resultDigest: 'x'.repeat(32) };
    expect(codeOf(() => compareRiyaQualityCandidates(goldenResult(), candidate, POLICY))).toBe(
      'quality-digest-invalid',
    );
  });

  it('a tampered case-set digest is refused', () => {
    const candidate = { ...goldenResult(), caseSetDigest: 'deadbeef'.repeat(4) };
    expect(codeOf(() => compareRiyaQualityCandidates(goldenResult(), candidate, POLICY))).toBe(
      'quality-digest-invalid',
    );
  });

  it('a wholly FABRICATED result is refused, and returns no verdict at all', () => {
    // THE hole. Before this, an object claiming perfect rates could come back as
    // CANDIDATE_PREFERRED -- a verdict about a measurement that never happened.
    const fabricated = {
      ...goldenResult(),
      dimensionPassRateBps: { CLARITY: 10_000, EMPATHY: 10_000 },
      qualityEligible: true,
      caseSetDigest: 'digest-not-used-by-comparison',
      resultDigest: 'digest-not-used-by-comparison',
    };
    expect(codeOf(() => compareRiyaQualityCandidates(goldenResult(), fabricated, POLICY))).toBe(
      'quality-digest-invalid',
    );
    // Not NOT_COMPARABLE either: that would read as a verdict about two real runs.
    expect(() => compareRiyaQualityCandidates(goldenResult(), fabricated, POLICY)).toThrow(
      RiyaQualityEvaluationError,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Comparison attestation.
// ---------------------------------------------------------------------------

describe('every valid comparison is bound to the two artifacts it came from', () => {
  it('identical genuine results TIE, with both refs and a digest', () => {
    const comparison = compareRiyaQualityCandidates(goldenResult(), goldenResult(), POLICY);
    expect(comparison.outcome).toBe('TIE');
    expect(comparison.baselineCandidateRef).toBe(`rqr.${goldenResult().resultDigest}`);
    expect(comparison.candidateRef).toBe(comparison.baselineCandidateRef);
    expect(comparison.comparisonDigest).toMatch(/^[0-9a-f]{32}$/u);
  });

  it('the same two results twice produce the same digest', () => {
    const baseline = smallResult(4);
    const candidate = smallResult(0);
    const first = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    const second = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    expect(second.comparisonDigest).toBe(first.comparisonDigest);
    expect(second).toStrictEqual(first);
  });

  it('swapping baseline and candidate swaps the refs and changes the digest', () => {
    const baseline = smallResult(4);
    const candidate = smallResult(0);
    const forward = compareRiyaQualityCandidates(baseline, candidate, POLICY);
    const reversed = compareRiyaQualityCandidates(candidate, baseline, POLICY);

    expect(reversed.baselineCandidateRef).toBe(forward.candidateRef);
    expect(reversed.candidateRef).toBe(forward.baselineCandidateRef);
    expect(forward.outcome).toBe('CANDIDATE_PREFERRED');
    expect(reversed.outcome).toBe('BASELINE_PREFERRED');
    expect(reversed.comparisonDigest).not.toBe(forward.comparisonDigest);
  });

  it('a parity mismatch is still content-bound', () => {
    // A NOT_COMPARABLE verdict is a real statement about two real runs, so it gets the same
    // traceability as any other. Publishing it without refs would make it unquotable.
    const baseline = smallResult(0);
    const candidate = smallResult(0, { knowledgeRevision: 'knowledge.rev.99' });
    const comparison = compareRiyaQualityCandidates(baseline, candidate, POLICY);

    expect(comparison.outcome).toBe('NOT_COMPARABLE');
    expect(comparison.baselineCandidateRef).toBe(`rqr.${baseline.resultDigest}`);
    expect(comparison.candidateRef).toBe(`rqr.${candidate.resultDigest}`);
    expect(comparison.comparisonDigest).toMatch(/^[0-9a-f]{32}$/u);
    expect(comparison.dimensionDeltas).toStrictEqual([]);
  });

  it('two different mismatches produce different digests', () => {
    const baseline = smallResult(0);
    const one = compareRiyaQualityCandidates(
      baseline,
      smallResult(0, { knowledgeRevision: 'knowledge.rev.98' }),
      POLICY,
    );
    const two = compareRiyaQualityCandidates(
      baseline,
      smallResult(0, { policyContractRevision: 'policy.rev.98' }),
      POLICY,
    );
    expect(one.outcome).toBe('NOT_COMPARABLE');
    expect(two.outcome).toBe('NOT_COMPARABLE');
    expect(two.comparisonDigest).not.toBe(one.comparisonDigest);
  });

  it('a different provider, model or prompt stays comparable and content-bound', () => {
    const baseline = smallResult(0);
    for (const varied of [
      { releaseId: 'release.gamma' },
      { modelId: 'vendor.gamma/model-gamma' },
      { promptVersion: 12 },
      { promptDigest: 'c'.repeat(64) },
    ]) {
      const comparison = compareRiyaQualityCandidates(baseline, smallResult(0, varied), POLICY);
      expect(comparison.outcome, JSON.stringify(varied)).toBe('TIE');
      expect(comparison.comparisonDigest).toMatch(/^[0-9a-f]{32}$/u);
    }
  });

  it('carries no rollout, promotion or approval field', () => {
    const serialized = JSON.stringify(
      compareRiyaQualityCandidates(smallResult(0), smallResult(0), POLICY),
    ).toLowerCase();
    for (const forbidden of ['rollout', 'promote', 'activate', 'productionapproval', 'deploy']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The literal one-basis-point rule, against the internal helper.
// ---------------------------------------------------------------------------

/**
 * A 1 bp difference is unreachable through a real suite: rates are
 * `floor(pass * 10000 / applicable)`, so the smallest expressible step is `10000 / N` and `N` is
 * capped at 1000 cases. Proving the rule therefore belongs to the pure arithmetic, which takes rate
 * maps rather than artifacts — and has nothing to forge.
 */
describe('the rate comparison blocks on ANY negative delta', () => {
  const rate = (values: Partial<Record<RiyaQualityDimension, number>>) => values;

  it('a one basis point regression is a regression', () => {
    const compared = compareRiyaQualityRates(
      rate({ CONTEXT_USE: 9900, CTA_QUALITY: 9000 }),
      rate({ CONTEXT_USE: 9899, CTA_QUALITY: 9500 }),
      POLICY.minimumImprovementBps,
    );
    expect(compared.candidateRegressed).toStrictEqual(['CONTEXT_USE']);
    expect(compared.candidateImproved).toStrictEqual(['CTA_QUALITY']);
    expect(compared.deltas.find((delta) => delta.dimension === 'CONTEXT_USE')?.deltaBps).toBe(-1);
    // Preferred requires zero regressions, so this candidate is not preferred.
    expect(compared.candidateRegressed.length === 0 && compared.candidateImproved.length > 0).toBe(
      false,
    );
  });

  it('removing that single basis point is the ONLY thing that changes the verdict', () => {
    const compared = compareRiyaQualityRates(
      rate({ CONTEXT_USE: 9900, CTA_QUALITY: 9000 }),
      rate({ CONTEXT_USE: 9900, CTA_QUALITY: 9500 }),
      POLICY.minimumImprovementBps,
    );
    expect(compared.candidateRegressed).toStrictEqual([]);
    expect(compared.candidateImproved).toStrictEqual(['CTA_QUALITY']);
  });

  it('exactly 250 counts as an improvement and 249 does not', () => {
    const at = compareRiyaQualityRates(rate({ CLARITY: 9000 }), rate({ CLARITY: 9250 }), 250);
    expect(at.candidateImproved).toStrictEqual(['CLARITY']);
    const under = compareRiyaQualityRates(rate({ CLARITY: 9000 }), rate({ CLARITY: 9249 }), 250);
    expect(under.candidateImproved).toStrictEqual([]);
    expect(under.candidateRegressed).toStrictEqual([]);
  });

  it('is symmetric', () => {
    const compared = compareRiyaQualityRates(rate({ CLARITY: 9500 }), rate({ CLARITY: 9000 }), 250);
    expect(compared.baselineImproved).toStrictEqual(['CLARITY']);
    expect(compared.baselineRegressed).toStrictEqual([]);
    expect(compared.candidateRegressed).toStrictEqual(['CLARITY']);
  });

  it('skips a dimension only ONE side measured', () => {
    // Treating an absent rate as zero would manufacture a 9500 bp regression out of a coverage
    // difference, and the verdict would be about the corpus rather than the candidate.
    const compared = compareRiyaQualityRates(
      rate({ CLARITY: 9500, EMPATHY: 9500 }),
      rate({ CLARITY: 9900 }),
      250,
    );
    expect(compared.deltas.map((delta) => delta.dimension)).toStrictEqual(['CLARITY']);
    expect(compared.candidateRegressed).toStrictEqual([]);
  });
});
