/**
 * The ONE canonical digest preimage for a quality result (RWC-P10 owner correction on PR #111).
 *
 * ### Why this file exists
 *
 * The evaluator computed `resultDigest` and the evidence gate checked only `caseSetDigest`. So an
 * artifact whose per-dimension rates, threshold breaches or `qualityEligible` flag had been edited
 * — while its case list stayed untouched — passed the gate, and the edited `resultDigest` was copied
 * into the evidence and into `qualityRef` as though it had been verified.
 *
 * That is the worst failure available to this package, because `qualityEligible` is the field a
 * rollout conversation actually reads. Having the preimage in one place, used by the producer and by
 * every consumer, is what makes "the digest covers the result" true rather than aspirational.
 *
 * Nothing here is cryptographic. `contentDigest` is a non-cryptographic identity hash, so this
 * detects editing and truncation, not a determined forger who can also run this code.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';

import type {
  RiyaQualityCaseResultV1,
  RiyaQualitySuiteResultV1,
  RiyaQualityThresholdBreach,
} from '../contracts/results.js';
import type { RiyaQualityCandidateBindingV1 } from '../contracts/binding.js';
import type { RiyaQualityCaseOutcome, RiyaQualityDimension } from '../contracts/vocabularies.js';

/** Everything the full result digest commits to. */
export interface RiyaQualityResultDigestParts {
  readonly binding: RiyaQualityCandidateBindingV1;
  readonly caseSetDigest: string;
  readonly countsByOutcome: Readonly<Record<RiyaQualityCaseOutcome, number>>;
  readonly objectiveFailureCount: number;
  readonly dimensionApplicableCounts: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly dimensionPassCounts: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly dimensionPassRateBps: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly thresholdBreaches: readonly RiyaQualityThresholdBreach[];
  readonly qualityEligible: boolean;
}

/**
 * The case-set digest. Codes, counts and outcomes only — never a value, a reply or a reviewer.
 *
 * `contentDigest` canonicalizes object key order for us, so the preimage is stable regardless of how
 * a case result happened to be assembled.
 */
export function riyaQualityCaseSetDigest(caseResults: readonly RiyaQualityCaseResultV1[]): string {
  return contentDigest(
    caseResults.map((one) => [
      one.scenarioId,
      one.scenarioVersion,
      one.outcome,
      [...one.objectiveFailures],
      [...one.failedQualityDimensions],
    ]),
  );
}

/**
 * The FULL result digest.
 *
 * It commits to every field a reader could act on: the binding that says which candidate this was,
 * the case-set digest, the outcome counts, the objective failure count, all three per-dimension
 * tables, the threshold breaches and the eligibility verdict. Leaving any of them out would leave an
 * artifact editable in exactly that field, and `qualityEligible` is the one somebody would edit.
 */
export function riyaQualityResultDigest(parts: RiyaQualityResultDigestParts): string {
  return contentDigest({
    binding: parts.binding,
    caseSetDigest: parts.caseSetDigest,
    countsByOutcome: parts.countsByOutcome,
    objectiveFailureCount: parts.objectiveFailureCount,
    dimensionApplicableCounts: parts.dimensionApplicableCounts,
    dimensionPassCounts: parts.dimensionPassCounts,
    dimensionPassRateBps: parts.dimensionPassRateBps,
    thresholdBreaches: parts.thresholdBreaches,
    qualityEligible: parts.qualityEligible,
  });
}

/**
 * Recompute BOTH digests and compare. `true` only if the artifact is exactly what it claims.
 *
 * The case-set digest is recomputed first and then fed into the full digest, so a case list edited
 * together with its own digest still fails the outer check.
 */
export function riyaQualityResultIntegrityHolds(result: RiyaQualitySuiteResultV1): boolean {
  if (riyaQualityCaseSetDigest(result.caseResults) !== result.caseSetDigest) {
    return false;
  }
  const recomputed = riyaQualityResultDigest({
    binding: result.binding,
    caseSetDigest: result.caseSetDigest,
    countsByOutcome: result.countsByOutcome,
    objectiveFailureCount: result.objectiveFailureCount,
    dimensionApplicableCounts: result.dimensionApplicableCounts,
    dimensionPassCounts: result.dimensionPassCounts,
    dimensionPassRateBps: result.dimensionPassRateBps,
    thresholdBreaches: result.thresholdBreaches,
    qualityEligible: result.qualityEligible,
  });
  return recomputed === result.resultDigest;
}
