import { describe, expect, it } from 'vitest';

import { runAosVendorSuccessShadowCycle } from '../index.js';

const at = '2026-10-01T09:30:00.000Z';

function projection(
  over: Partial<{
    inactiveDays: number;
    matchingDemandCount: number;
    packageReadinessBand: 'low' | 'medium' | 'high' | 'critical';
    rechargeOpportunity: boolean;
    retentionRisk: boolean;
    winbackCandidate: boolean;
    complaintOpen: boolean;
  }> = {},
) {
  return {
    subjectRef: 'vendor:opaque-success',
    evidenceRef: 'core:vendor-success:opaque-success',
    observedAt: at,
    inactiveDays: 0,
    matchingDemandCount: 0,
    packageReadinessBand: 'high' as const,
    rechargeOpportunity: false,
    retentionRisk: false,
    winbackCandidate: false,
    complaintOpen: false,
    ...over,
  };
}

describe('AOS vendor-success shadow cycle', () => {
  it('recommends masked-demand reactivation only from a Core-filtered inactive+matching-demand projection', async () => {
    const result = await runAosVendorSuccessShadowCycle({
      cycleId: 'aos.vendor-success.reactivation',
      generatedAt: at,
      projections: [projection({ inactiveDays: 45, matchingDemandCount: 3 })],
    });
    expect(result).toMatchObject({
      projections: 1,
      detections: 1,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.shadow.cases[0]?.recommendation).toMatchObject({
      action: 'REQUEST_VENDOR_REACTIVATION',
      requiresOwnerReview: true,
      executionAuthorized: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|balance|clientName|clientPhone/iu);
  });

  it('uses Core package-readiness bands instead of copying raw credit balances', async () => {
    const result = await runAosVendorSuccessShadowCycle({
      cycleId: 'aos.vendor-success.package',
      generatedAt: at,
      projections: [projection({ packageReadinessBand: 'critical' })],
    });
    expect(result.shadow.cases[0]?.recommendation).toMatchObject({
      action: 'REQUEST_RECHARGE_NUDGE',
      executionAuthorized: false,
    });
    expect(JSON.stringify(result)).not.toContain('vendorCredits');
  });

  it('prioritizes a vendor complaint as a satisfaction/retention case', async () => {
    const result = await runAosVendorSuccessShadowCycle({
      cycleId: 'aos.vendor-success.complaint',
      generatedAt: at,
      projections: [
        projection({
          rechargeOpportunity: true,
          complaintOpen: true,
        }),
      ],
    });
    expect(result.shadow.cases).toHaveLength(1);
    expect(result.shadow.cases[0]?.recommendation).toMatchObject({
      action: 'REQUEST_VENDOR_SUCCESS_FOLLOW_UP',
      requiresOwnerReview: true,
      executionAuthorized: false,
    });
    expect(result.shadow.cases[0]?.recommendation?.alternatives).toContain(
      'REQUEST_RECHARGE_NUDGE',
    );
  });

  it('does nothing when Core reports no vendor-success trigger', async () => {
    const result = await runAosVendorSuccessShadowCycle({
      cycleId: 'aos.vendor-success.none',
      generatedAt: at,
      projections: [projection()],
    });
    expect(result.detections).toBe(0);
    expect(result.shadow.cases).toEqual([]);
    expect(result.shadow.recommendations).toBe(0);
  });
});
