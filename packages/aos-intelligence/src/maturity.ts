import type { AosCapabilityAssessment, AosCapabilityEvidence } from './contracts.js';
import { validNonNegativeInt } from './validation.js';

export interface AosMaturityPolicy {
  readonly minimumSamples: number;
  readonly minimumAcceptanceRate: number;
  readonly minimumSuccessfulOutcomeRate: number;
  readonly maximumFalsePositiveRate: number;
  readonly minimumSupportRate: number;
}

export const DEFAULT_AOS_MATURITY_POLICY: AosMaturityPolicy = Object.freeze({
  minimumSamples: 1_000,
  minimumAcceptanceRate: 0.9,
  minimumSuccessfulOutcomeRate: 0.85,
  maximumFalsePositiveRate: 0.02,
  minimumSupportRate: 0.995,
});

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function assessAosCapabilityMaturity(
  evidence: AosCapabilityEvidence,
  policy: AosMaturityPolicy = DEFAULT_AOS_MATURITY_POLICY,
): AosCapabilityAssessment {
  const values: readonly number[] = [
    evidence.sampleCount,
    evidence.ownerDecisionCount,
    evidence.ownerAcceptedCount,
    evidence.resolvedCount,
    evidence.successfulOutcomeCount,
    evidence.falsePositiveCount,
    evidence.policyViolationCount,
    evidence.unsupportedReasoningCount,
  ];
  if (values.some((value) => !validNonNegativeInt(value, 10_000_000))) {
    throw new TypeError('aos-capability-evidence-invalid');
  }
  if (
    evidence.ownerAcceptedCount > evidence.ownerDecisionCount ||
    evidence.successfulOutcomeCount > evidence.resolvedCount ||
    evidence.falsePositiveCount > evidence.sampleCount ||
    evidence.policyViolationCount > evidence.sampleCount ||
    evidence.unsupportedReasoningCount > evidence.sampleCount ||
    policy.minimumSamples < 1 ||
    policy.minimumAcceptanceRate < 0 ||
    policy.minimumAcceptanceRate > 1 ||
    policy.minimumSuccessfulOutcomeRate < 0 ||
    policy.minimumSuccessfulOutcomeRate > 1 ||
    policy.maximumFalsePositiveRate < 0 ||
    policy.maximumFalsePositiveRate > 1 ||
    policy.minimumSupportRate < 0 ||
    policy.minimumSupportRate > 1
  ) {
    throw new TypeError('aos-capability-evidence-invalid');
  }

  const acceptanceRate = ratio(evidence.ownerAcceptedCount, evidence.ownerDecisionCount);
  const successfulOutcomeRate = ratio(evidence.successfulOutcomeCount, evidence.resolvedCount);
  const falsePositiveRate = ratio(evidence.falsePositiveCount, evidence.sampleCount);
  const supportRate =
    evidence.sampleCount === 0
      ? null
      : (evidence.sampleCount - evidence.unsupportedReasoningCount) / evidence.sampleCount;
  const reasons: string[] = [];
  if (evidence.sampleCount < policy.minimumSamples) reasons.push('INSUFFICIENT_SAMPLE');
  if (acceptanceRate === null || acceptanceRate < policy.minimumAcceptanceRate) {
    reasons.push('ACCEPTANCE_BELOW_TARGET');
  }
  if (
    successfulOutcomeRate === null ||
    successfulOutcomeRate < policy.minimumSuccessfulOutcomeRate
  ) {
    reasons.push('OUTCOME_SUCCESS_BELOW_TARGET');
  }
  if (falsePositiveRate === null || falsePositiveRate > policy.maximumFalsePositiveRate) {
    reasons.push('FALSE_POSITIVE_RATE_TOO_HIGH');
  }
  if (supportRate === null || supportRate < policy.minimumSupportRate) {
    reasons.push('REASONING_SUPPORT_BELOW_TARGET');
  }
  if (evidence.policyViolationCount > 0) reasons.push('POLICY_VIOLATION_OBSERVED');

  const maturity =
    reasons.length === 0
      ? ('ELIGIBLE_FOR_APPROVAL_PILOT' as const)
      : evidence.sampleCount === 0
        ? ('OBSERVE_ONLY' as const)
        : ('SUGGEST_ONLY' as const);

  return Object.freeze({
    maturity,
    acceptanceRate,
    successfulOutcomeRate,
    falsePositiveRate,
    supportRate,
    productionApproval: false as const,
    reasons: Object.freeze(reasons),
  });
}
