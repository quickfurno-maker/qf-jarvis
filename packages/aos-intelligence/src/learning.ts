import type {
  AosCapabilityAssessment,
  AosCapabilityEvidence,
  AosOutcomeRecord,
} from './contracts.js';
import { assessAosCapabilityMaturity, type AosMaturityPolicy } from './maturity.js';
import { validRef } from './validation.js';

export interface AosLearningObservation {
  readonly record: AosOutcomeRecord;
  readonly falsePositive: boolean;
}

export interface AosCapabilityLearningSummary {
  readonly capabilityRef: string;
  readonly evidence: AosCapabilityEvidence;
  readonly assessment: AosCapabilityAssessment;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export const AOS_POLICY_REVIEW_DIRECTIONS = [
  'KEEP_CURRENT_POLICY',
  'REVIEW_DETECTION_THRESHOLD',
  'REVIEW_RECOMMENDATION_POLICY',
  'REVIEW_COMMUNICATION_GUARDRAILS',
  'HOLD_CAPABILITY',
] as const;
export type AosPolicyReviewDirection = (typeof AOS_POLICY_REVIEW_DIRECTIONS)[number];

export interface AosPolicyReviewProposal {
  readonly protocol: 'qfj.aos.policy-review-proposal.v1';
  readonly capabilityRef: string;
  readonly direction: AosPolicyReviewDirection;
  readonly reasonCodes: readonly string[];
  readonly sampleCount: number;
  readonly simulationRequired: true;
  readonly digitalTwinRequired: true;
  readonly ownerApprovalRequired: true;
  readonly autoApplyAllowed: false;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export function summarizeAosCapabilityLearning(input: {
  readonly capabilityRef: string;
  readonly observations: readonly AosLearningObservation[];
  readonly maturityPolicy?: AosMaturityPolicy;
}): AosCapabilityLearningSummary {
  if (!validRef(input.capabilityRef) || input.observations.length > 10_000_000) {
    throw new TypeError('aos-learning-input-invalid');
  }

  const evidence: AosCapabilityEvidence = Object.freeze({
    sampleCount: input.observations.length,
    ownerDecisionCount: input.observations.filter(({ record }) => record.ownerDecision !== 'IGNORE')
      .length,
    ownerAcceptedCount: input.observations.filter(
      ({ record }) => record.ownerDecision === 'APPROVE',
    ).length,
    resolvedCount: input.observations.filter(({ record }) => record.outcome !== 'UNKNOWN').length,
    successfulOutcomeCount: input.observations.filter(
      ({ record }) => record.outcome === 'RECOVERED',
    ).length,
    falsePositiveCount: input.observations.filter(({ falsePositive }) => falsePositive).length,
    policyViolationCount: input.observations.filter(({ record }) => record.policyViolation).length,
    unsupportedReasoningCount: input.observations.filter(
      ({ record }) => record.unsupportedReasoning,
    ).length,
  });

  const assessment =
    input.maturityPolicy === undefined
      ? assessAosCapabilityMaturity(evidence)
      : assessAosCapabilityMaturity(evidence, input.maturityPolicy);

  return Object.freeze({
    capabilityRef: input.capabilityRef,
    evidence,
    assessment,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export function proposeAosPolicyReview(
  summary: AosCapabilityLearningSummary,
): AosPolicyReviewProposal {
  const reasons = [...summary.assessment.reasons];
  let direction: AosPolicyReviewDirection = 'KEEP_CURRENT_POLICY';

  if (summary.evidence.policyViolationCount > 0) {
    direction = 'HOLD_CAPABILITY';
  } else if (
    summary.evidence.falsePositiveCount > 0 &&
    (summary.assessment.falsePositiveRate ?? 0) > 0.02
  ) {
    direction = 'REVIEW_DETECTION_THRESHOLD';
  } else if (
    summary.assessment.successfulOutcomeRate !== null &&
    summary.assessment.successfulOutcomeRate < 0.85
  ) {
    direction = 'REVIEW_RECOMMENDATION_POLICY';
  } else if (
    summary.assessment.acceptanceRate !== null &&
    summary.assessment.acceptanceRate < 0.9
  ) {
    direction = 'REVIEW_COMMUNICATION_GUARDRAILS';
  }

  if (
    direction === 'KEEP_CURRENT_POLICY' &&
    summary.assessment.maturity !== 'ELIGIBLE_FOR_APPROVAL_PILOT'
  ) {
    reasons.push('MORE_EVIDENCE_REQUIRED');
  }

  return Object.freeze({
    protocol: 'qfj.aos.policy-review-proposal.v1' as const,
    capabilityRef: summary.capabilityRef,
    direction,
    reasonCodes: Object.freeze([...new Set(reasons)].sort()),
    sampleCount: summary.evidence.sampleCount,
    simulationRequired: true as const,
    digitalTwinRequired: true as const,
    ownerApprovalRequired: true as const,
    autoApplyAllowed: false as const,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}
