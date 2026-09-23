export const JAO_MATURITY_DECISIONS = Object.freeze([
  'KEEP_DEFAULT_OFF',
  'SHADOW_EVIDENCE_SUFFICIENT',
  'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
] as const);

export type JaoMaturityDecision = (typeof JAO_MATURITY_DECISIONS)[number];

export const JAO_MATURITY_BLOCKERS = Object.freeze([
  'INSUFFICIENT_OBSERVATION_HOURS',
  'INSUFFICIENT_SHADOW_RUNS',
  'AUTHORITY_CORRELATION_FAILURE',
  'UNSAFE_BUSINESS_EFFECT',
  'ROLLBACK_FAILURE',
  'CRITICAL_FINDING_OPEN',
  'OWNER_APPROVAL_MISSING',
] as const);

export type JaoMaturityBlocker = (typeof JAO_MATURITY_BLOCKERS)[number];

export interface JaoMaturityPolicy {
  readonly policyRef: string;
  readonly minObservationHours: number;
  readonly minCompletedShadowRuns: number;
}

export interface JaoMaturityEvidence {
  readonly observationHours: number;
  readonly completedShadowRuns: number;
  readonly authorityCorrelationFailures: number;
  readonly unsafeBusinessEffects: number;
  readonly rollbackFailures: number;
  readonly unresolvedCriticalFindings: number;
  readonly ownerApprovalRef?: string;
}

export interface JaoMaturityAssessment {
  readonly policyRef: string;
  readonly decision: JaoMaturityDecision;
  readonly blockers: readonly JaoMaturityBlocker[];
}

const REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export function createJaoMaturityPolicy(policy: JaoMaturityPolicy): JaoMaturityPolicy {
  if (
    !REF.test(policy.policyRef) ||
    !Number.isFinite(policy.minObservationHours) ||
    policy.minObservationHours < 1 ||
    policy.minObservationHours > 100_000 ||
    !Number.isInteger(policy.minCompletedShadowRuns) ||
    policy.minCompletedShadowRuns < 1 ||
    policy.minCompletedShadowRuns > 1_000_000
  ) {
    throw new TypeError('jao-maturity-policy-invalid');
  }
  return Object.freeze({ ...policy });
}

export const JAO_MATURITY_ENGINEERING_POLICY_V1 = createJaoMaturityPolicy({
  policyRef: 'qfj.jao-maturity.engineering.v1',
  minObservationHours: 168,
  minCompletedShadowRuns: 100,
});

function validCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000_000;
}

/**
 * Assess whether JAO has enough clean evidence to justify the NEXT governance review.
 *
 * This function has no activation surface. Even the strongest decision means only that an owner may
 * review a separately proposed bounded-autonomy change. It never changes a mission availability,
 * never issues Core authority, never runs a mission and never mutates production.
 */
export function assessJaoMaturity(
  evidence: JaoMaturityEvidence,
  policy: JaoMaturityPolicy = JAO_MATURITY_ENGINEERING_POLICY_V1,
): JaoMaturityAssessment {
  if (
    !Number.isFinite(evidence.observationHours) ||
    evidence.observationHours < 0 ||
    evidence.observationHours > 100_000 ||
    !validCount(evidence.completedShadowRuns) ||
    !validCount(evidence.authorityCorrelationFailures) ||
    !validCount(evidence.unsafeBusinessEffects) ||
    !validCount(evidence.rollbackFailures) ||
    !validCount(evidence.unresolvedCriticalFindings) ||
    (evidence.ownerApprovalRef !== undefined && !REF.test(evidence.ownerApprovalRef))
  ) {
    throw new TypeError('jao-maturity-evidence-invalid');
  }

  const blockers: JaoMaturityBlocker[] = [];
  if (evidence.observationHours < policy.minObservationHours) {
    blockers.push('INSUFFICIENT_OBSERVATION_HOURS');
  }
  if (evidence.completedShadowRuns < policy.minCompletedShadowRuns) {
    blockers.push('INSUFFICIENT_SHADOW_RUNS');
  }
  if (evidence.authorityCorrelationFailures > 0) {
    blockers.push('AUTHORITY_CORRELATION_FAILURE');
  }
  if (evidence.unsafeBusinessEffects > 0) {
    blockers.push('UNSAFE_BUSINESS_EFFECT');
  }
  if (evidence.rollbackFailures > 0) {
    blockers.push('ROLLBACK_FAILURE');
  }
  if (evidence.unresolvedCriticalFindings > 0) {
    blockers.push('CRITICAL_FINDING_OPEN');
  }

  const evidenceBlockers = blockers.length;
  if (evidenceBlockers > 0) {
    return Object.freeze({
      policyRef: policy.policyRef,
      decision: 'KEEP_DEFAULT_OFF' as const,
      blockers: Object.freeze(blockers),
    });
  }

  if (evidence.ownerApprovalRef === undefined) {
    return Object.freeze({
      policyRef: policy.policyRef,
      decision: 'SHADOW_EVIDENCE_SUFFICIENT' as const,
      blockers: Object.freeze(['OWNER_APPROVAL_MISSING'] as JaoMaturityBlocker[]),
    });
  }

  return Object.freeze({
    policyRef: policy.policyRef,
    decision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE' as const,
    blockers: Object.freeze([] as JaoMaturityBlocker[]),
  });
}
