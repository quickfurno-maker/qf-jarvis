/**
 * Candidate comparison: Pareto, no-regression, no average (RWC-P10, ADR-0106 §19).
 *
 * ### The rule that does the work
 *
 * A candidate is preferred only if NO dimension is lower than the baseline, and at least one improves
 * by the policy minimum. A one basis point regression in any single dimension is enough to withhold
 * preference — not because one basis point matters on its own, but because the alternative is a
 * tolerance, and a tolerance is where "slightly pushier, much clearer" gets approved.
 *
 * That trade is the specific thing this function exists to refuse. A prompt tuned for momentum will
 * almost always improve `SALES_MOMENTUM` and `CTA_QUALITY` while quietly costing `EMPATHY` or
 * `TRUST_BUILDING`, and any scheme that adds the numbers up will approve it. This one returns TIE and
 * makes a human look at what moved.
 *
 * ### Comparable means the same question was asked
 *
 * Same suite, same fixtures, same thresholds, same evaluator, same capability, knowledge and policy.
 * Provider, model, release and prompt MAY differ — those are what a comparison is for. Anything else
 * differing means the two runs answered different questions, and the honest answer is
 * `NOT_COMPARABLE` rather than a verdict nobody should act on.
 */
import { z } from 'zod';

import { riyaQualityParityKey } from '../contracts/binding.js';
import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import type {
  RiyaQualityComparisonResultV1,
  RiyaQualityDimensionDelta,
  RiyaQualitySuiteResultV1,
} from '../contracts/results.js';
import { RIYA_QUALITY_DIMENSIONS } from '../contracts/vocabularies.js';
import type { RiyaQualityDimension } from '../contracts/vocabularies.js';

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

const notComparable = (
  policy: RiyaQualityComparisonPolicyV1,
  baseline: RiyaQualitySuiteResultV1,
  candidate: RiyaQualitySuiteResultV1,
): RiyaQualityComparisonResultV1 =>
  Object.freeze({
    version: 1 as const,
    outcome: 'NOT_COMPARABLE' as const,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    // Deliberately empty. Publishing deltas between incomparable runs would invite somebody to read
    // them anyway, and the numbers would be meaningless.
    dimensionDeltas: Object.freeze([]),
    regressedDimensions: Object.freeze([]),
    materiallyImprovedDimensions: Object.freeze([]),
    baselineEligible: baseline.qualityEligible,
    candidateEligible: candidate.qualityEligible,
  });

/**
 * Compare two quality results under a policy.
 *
 * Deltas are computed only over dimensions BOTH results measured. A dimension one side never
 * exercised has no comparable rate, and treating an absent rate as zero would manufacture a
 * catastrophic regression out of a coverage difference.
 */
export function compareRiyaQualityCandidates(
  baseline: RiyaQualitySuiteResultV1,
  candidate: RiyaQualitySuiteResultV1,
  policy: RiyaQualityComparisonPolicyV1,
): RiyaQualityComparisonResultV1 {
  if (riyaQualityParityKey(baseline.binding) !== riyaQualityParityKey(candidate.binding)) {
    return notComparable(policy, baseline, candidate);
  }

  // One eligible and one not is decided by eligibility alone. A suite that breached a threshold has
  // already failed a gate somebody set deliberately, and no amount of per-dimension movement should
  // be able to argue past it.
  if (baseline.qualityEligible !== candidate.qualityEligible) {
    return Object.freeze({
      version: 1 as const,
      outcome: candidate.qualityEligible
        ? ('CANDIDATE_PREFERRED' as const)
        : ('BASELINE_PREFERRED' as const),
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      dimensionDeltas: Object.freeze(deltasOf(baseline, candidate)),
      regressedDimensions: Object.freeze([]),
      materiallyImprovedDimensions: Object.freeze([]),
      baselineEligible: baseline.qualityEligible,
      candidateEligible: candidate.qualityEligible,
    });
  }

  // Neither eligible: there is no preference to express. Ranking two failing candidates would invite
  // shipping the less bad one.
  if (!baseline.qualityEligible) {
    return notComparable(policy, baseline, candidate);
  }

  const deltas = deltasOf(baseline, candidate);
  const candidateRegressed: RiyaQualityDimension[] = [];
  const baselineRegressed: RiyaQualityDimension[] = [];
  const candidateImproved: RiyaQualityDimension[] = [];
  const baselineImproved: RiyaQualityDimension[] = [];

  for (const delta of deltas) {
    if (delta.deltaBps < 0) {
      candidateRegressed.push(delta.dimension);
    }
    if (delta.deltaBps > 0) {
      baselineRegressed.push(delta.dimension);
    }
    if (delta.deltaBps >= policy.minimumImprovementBps) {
      candidateImproved.push(delta.dimension);
    }
    if (-delta.deltaBps >= policy.minimumImprovementBps) {
      baselineImproved.push(delta.dimension);
    }
  }

  const candidatePreferred = candidateRegressed.length === 0 && candidateImproved.length > 0;
  const baselinePreferred = baselineRegressed.length === 0 && baselineImproved.length > 0;

  const outcome = candidatePreferred
    ? ('CANDIDATE_PREFERRED' as const)
    : baselinePreferred
      ? ('BASELINE_PREFERRED' as const)
      : ('TIE' as const);

  return Object.freeze({
    version: 1 as const,
    outcome,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    dimensionDeltas: Object.freeze(deltas),
    regressedDimensions: Object.freeze([...candidateRegressed].sort()),
    materiallyImprovedDimensions: Object.freeze([...candidateImproved].sort()),
    baselineEligible: baseline.qualityEligible,
    candidateEligible: candidate.qualityEligible,
  });
}

function deltasOf(
  baseline: RiyaQualitySuiteResultV1,
  candidate: RiyaQualitySuiteResultV1,
): RiyaQualityDimensionDelta[] {
  const deltas: RiyaQualityDimensionDelta[] = [];
  for (const dimension of RIYA_QUALITY_DIMENSIONS) {
    const baselineBps = baseline.dimensionPassRateBps[dimension];
    const candidateBps = candidate.dimensionPassRateBps[dimension];
    if (baselineBps === undefined || candidateBps === undefined) {
      continue;
    }
    deltas.push(
      Object.freeze({
        dimension,
        baselineBps,
        candidateBps,
        deltaBps: candidateBps - baselineBps,
      }),
    );
  }
  return deltas;
}
