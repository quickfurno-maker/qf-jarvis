/**
 * Candidate comparison: Pareto, no-regression, no average (RWC-P10, ADR-0106 §19).
 *
 * ### The rule that does the work
 *
 * A candidate is preferred only if NO dimension is lower than the baseline, and at least one improves
 * by the policy minimum. A one basis point regression in any single dimension is enough to withhold
 * preference — not because one basis point matters on its own, but because the alternative is a
 * tolerance, and a tolerance is where the bad trade lives.
 *
 * That trade is the specific thing this function exists to refuse. A prompt tuned for momentum will
 * almost always improve `SALES_MOMENTUM` and `CTA_QUALITY` while quietly costing `EMPATHY` or
 * `TRUST_BUILDING`, and any scheme that adds the numbers up will approve it. This one returns TIE and
 * makes a human look at what moved.
 *
 * ### It refuses to rank an unproved artifact (owner correction on PR #111)
 *
 * Both inputs have their case-set digest and their FULL result digest recomputed before anything else
 * happens. The first version compared whatever it was handed, so a hand-assembled object claiming
 * perfect rates could be returned as `CANDIDATE_PREFERRED` — a verdict about a measurement that never
 * took place, in the exact shape somebody would quote in a rollout discussion.
 *
 * A comparison is an assertion about two runs. Making it about two artifacts nobody verified would
 * make the whole comparator decorative.
 *
 * ### Every valid comparison is content-bound
 *
 * The result carries both candidate references and a deterministic `comparisonDigest` over the
 * policy, the refs, the parity identity and every verdict field. Two runs of the same comparison
 * produce the same digest; changing anything that mattered changes it. It is an identity, not a
 * signature, and it authorizes nothing.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';
import { z } from 'zod';

import { riyaQualityParityKey } from '../contracts/binding.js';
import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import type {
  RiyaQualityComparisonResultV1,
  RiyaQualitySuiteResultV1,
} from '../contracts/results.js';
import { compareRiyaQualityRates } from '../internal/compare-rates.js';
import { riyaQualityResultIntegrityHolds } from '../internal/result-integrity.js';

export interface RiyaQualityComparisonPolicyV1 {
  readonly version: 1;
  readonly policyId: string;
  readonly policyVersion: number;
  /** How much a dimension must move to count as an improvement, in basis points. */
  readonly minimumImprovementBps: number;
}

export interface RiyaQualityComparisonPolicyInput {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly minimumImprovementBps: number;
}

const policySchema = z
  .object({
    policyId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    policyVersion: z.int().min(1).max(1_000_000),
    minimumImprovementBps: z.int().min(1).max(10_000),
  })
  .strict();

/** Validate and freeze a comparison policy. Throws `invalid-comparison-policy`. */
export function createRiyaQualityComparisonPolicy(
  input: RiyaQualityComparisonPolicyInput,
): RiyaQualityComparisonPolicyV1 {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaQualityEvaluationError('invalid-comparison-policy');
  }
  return Object.freeze({
    version: 1 as const,
    policyId: parsed.data.policyId,
    policyVersion: parsed.data.policyVersion,
    minimumImprovementBps: parsed.data.minimumImprovementBps,
  });
}

/**
 * The canonical V1 policy.
 *
 * 250 basis points — 2.5 percentage points — because anything smaller is inside the noise of a
 * 72-case corpus judged by people. On 24 applicable cases one case is 417 bps, so a threshold much
 * below this would let a single reviewer changing their mind read as a model improvement.
 */
export const RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1: RiyaQualityComparisonPolicyV1 =
  createRiyaQualityComparisonPolicy({
    policyId: 'riya-quality-comparison-v1',
    policyVersion: 1,
    minimumImprovementBps: 250,
  });

/** A stable, content-bound reference to one evaluated candidate. */
const candidateRefOf = (result: RiyaQualitySuiteResultV1): string => `rqr.${result.resultDigest}`;

/**
 * Build the frozen comparison result, with its refs and its digest.
 *
 * The digest commits to the policy, both refs, the parity identity and every verdict field — so two
 * comparisons that agree on all of those are the same comparison, and one that differs anywhere a
 * reader could act on is a different one.
 */
function comparisonResult(
  policy: RiyaQualityComparisonPolicyV1,
  baseline: RiyaQualitySuiteResultV1,
  candidate: RiyaQualitySuiteResultV1,
  verdict: Omit<
    RiyaQualityComparisonResultV1,
    | 'version'
    | 'policyId'
    | 'policyVersion'
    | 'baselineCandidateRef'
    | 'candidateRef'
    | 'comparisonDigest'
  >,
): RiyaQualityComparisonResultV1 {
  const baselineCandidateRef = candidateRefOf(baseline);
  const candidateRef = candidateRefOf(candidate);
  const comparisonDigest = contentDigest({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    minimumImprovementBps: policy.minimumImprovementBps,
    baselineCandidateRef,
    candidateRef,
    // The parity identity of BOTH sides. A `NOT_COMPARABLE` verdict is about exactly this
    // disagreement, so a digest that omitted it could not distinguish two different mismatches.
    baselineParityKey: riyaQualityParityKey(baseline.binding),
    candidateParityKey: riyaQualityParityKey(candidate.binding),
    outcome: verdict.outcome,
    dimensionDeltas: verdict.dimensionDeltas,
    regressedDimensions: verdict.regressedDimensions,
    materiallyImprovedDimensions: verdict.materiallyImprovedDimensions,
    baselineEligible: verdict.baselineEligible,
    candidateEligible: verdict.candidateEligible,
  });

  return Object.freeze({
    version: 1 as const,
    outcome: verdict.outcome,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    baselineCandidateRef,
    candidateRef,
    comparisonDigest,
    dimensionDeltas: verdict.dimensionDeltas,
    regressedDimensions: verdict.regressedDimensions,
    materiallyImprovedDimensions: verdict.materiallyImprovedDimensions,
    baselineEligible: verdict.baselineEligible,
    candidateEligible: verdict.candidateEligible,
  });
}

/**
 * Compare two quality results under a policy.
 *
 * Throws `quality-digest-invalid` if EITHER input fails its integrity re-proof. No comparison result
 * is returned in that case: an unproved artifact is not ranked, not partially ranked, and not
 * reported as `NOT_COMPARABLE` — the last would look like a verdict about two real runs.
 */
export function compareRiyaQualityCandidates(
  baseline: RiyaQualitySuiteResultV1,
  candidate: RiyaQualitySuiteResultV1,
  policy: RiyaQualityComparisonPolicyV1,
): RiyaQualityComparisonResultV1 {
  if (!riyaQualityResultIntegrityHolds(baseline) || !riyaQualityResultIntegrityHolds(candidate)) {
    throw new RiyaQualityEvaluationError('quality-digest-invalid');
  }

  const comparable =
    riyaQualityParityKey(baseline.binding) === riyaQualityParityKey(candidate.binding);

  if (!comparable) {
    return comparisonResult(policy, baseline, candidate, {
      outcome: 'NOT_COMPARABLE',
      // Deliberately empty. Publishing deltas between incomparable runs would invite somebody to
      // read them anyway, and the numbers would be meaningless.
      dimensionDeltas: Object.freeze([]),
      regressedDimensions: Object.freeze([]),
      materiallyImprovedDimensions: Object.freeze([]),
      baselineEligible: baseline.qualityEligible,
      candidateEligible: candidate.qualityEligible,
    });
  }

  const rates = compareRiyaQualityRates(
    baseline.dimensionPassRateBps,
    candidate.dimensionPassRateBps,
    policy.minimumImprovementBps,
  );

  // One eligible and one not is decided by eligibility alone. A suite that breached a threshold has
  // already failed a gate somebody set deliberately, and no amount of per-dimension movement should
  // be able to argue past it.
  if (baseline.qualityEligible !== candidate.qualityEligible) {
    return comparisonResult(policy, baseline, candidate, {
      outcome: candidate.qualityEligible
        ? ('CANDIDATE_PREFERRED' as const)
        : ('BASELINE_PREFERRED' as const),
      dimensionDeltas: rates.deltas,
      regressedDimensions: Object.freeze([]),
      materiallyImprovedDimensions: Object.freeze([]),
      baselineEligible: baseline.qualityEligible,
      candidateEligible: candidate.qualityEligible,
    });
  }

  // Neither eligible: there is no preference to express. Ranking two failing candidates would invite
  // shipping the less bad one.
  if (!baseline.qualityEligible) {
    return comparisonResult(policy, baseline, candidate, {
      outcome: 'NOT_COMPARABLE',
      dimensionDeltas: Object.freeze([]),
      regressedDimensions: Object.freeze([]),
      materiallyImprovedDimensions: Object.freeze([]),
      baselineEligible: false,
      candidateEligible: false,
    });
  }

  const candidatePreferred =
    rates.candidateRegressed.length === 0 && rates.candidateImproved.length > 0;
  const baselinePreferred =
    rates.baselineRegressed.length === 0 && rates.baselineImproved.length > 0;

  return comparisonResult(policy, baseline, candidate, {
    outcome: candidatePreferred
      ? ('CANDIDATE_PREFERRED' as const)
      : baselinePreferred
        ? ('BASELINE_PREFERRED' as const)
        : ('TIE' as const),
    dimensionDeltas: rates.deltas,
    regressedDimensions: rates.candidateRegressed,
    // The improvement is still REPORTED even when preference is withheld: a human deciding whether
    // to accept a trade needs to see both sides of it.
    materiallyImprovedDimensions: rates.candidateImproved,
    baselineEligible: true,
    candidateEligible: true,
  });
}
