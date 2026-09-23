import { describe, expect, it } from 'vitest';

import {
  JAO_MATURITY_ENGINEERING_POLICY_V1,
  assessJaoMaturity,
} from '../jao/maturity-gate.js';

describe('JAO maturity gate', () => {
  it('keeps JAO default-off while production evidence is insufficient', () => {
    expect(
      assessJaoMaturity({
        observationHours: 24,
        completedShadowRuns: 10,
        authorityCorrelationFailures: 0,
        unsafeBusinessEffects: 0,
        rollbackFailures: 0,
        unresolvedCriticalFindings: 0,
      }),
    ).toEqual({
      policyRef: JAO_MATURITY_ENGINEERING_POLICY_V1.policyRef,
      decision: 'KEEP_DEFAULT_OFF',
      blockers: ['INSUFFICIENT_OBSERVATION_HOURS', 'INSUFFICIENT_SHADOW_RUNS'],
    });
  });

  it('does not advance past shadow evidence when owner approval is absent', () => {
    expect(
      assessJaoMaturity({
        observationHours: 168,
        completedShadowRuns: 100,
        authorityCorrelationFailures: 0,
        unsafeBusinessEffects: 0,
        rollbackFailures: 0,
        unresolvedCriticalFindings: 0,
      }),
    ).toEqual({
      policyRef: JAO_MATURITY_ENGINEERING_POLICY_V1.policyRef,
      decision: 'SHADOW_EVIDENCE_SUFFICIENT',
      blockers: ['OWNER_APPROVAL_MISSING'],
    });
  });

  it('treats any authority, unsafe-effect, rollback or critical finding as a hard blocker', () => {
    const result = assessJaoMaturity({
      observationHours: 500,
      completedShadowRuns: 1000,
      authorityCorrelationFailures: 1,
      unsafeBusinessEffects: 1,
      rollbackFailures: 1,
      unresolvedCriticalFindings: 1,
      ownerApprovalRef: 'owner.jao.review.1',
    });
    expect(result.decision).toBe('KEEP_DEFAULT_OFF');
    expect(result.blockers).toEqual([
      'AUTHORITY_CORRELATION_FAILURE',
      'UNSAFE_BUSINESS_EFFECT',
      'ROLLBACK_FAILURE',
      'CRITICAL_FINDING_OPEN',
    ]);
  });

  it('only marks a separately reviewed autonomy change eligible after clean evidence and owner approval', () => {
    expect(
      assessJaoMaturity({
        observationHours: 500,
        completedShadowRuns: 1000,
        authorityCorrelationFailures: 0,
        unsafeBusinessEffects: 0,
        rollbackFailures: 0,
        unresolvedCriticalFindings: 0,
        ownerApprovalRef: 'owner.jao.review.1',
      }),
    ).toEqual({
      policyRef: JAO_MATURITY_ENGINEERING_POLICY_V1.policyRef,
      decision: 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE',
      blockers: [],
    });
  });
});
