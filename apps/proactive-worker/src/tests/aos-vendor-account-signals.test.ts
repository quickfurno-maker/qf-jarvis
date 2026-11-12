import { describe, expect, it } from 'vitest';
import { runAosSupervisorShadowCycle, runAosVendorSuccessShadowCycle } from '../index.js';

const at = '2026-11-12T13:30:00.000Z';
function account(over: Record<string, unknown> = {}) {
  return {
    source: 'QUICKFURNO_CORE_SANITIZED_VENDOR_CONTEXT' as const,
    subjectRef: 'vendor:opaque-anisha-1',
    evidenceRef: 'core:signed-vendor-context:opaque-evidence',
    observedAt: at,
    packageReadinessBand: 'LOW_CREDITS' as const,
    pendingBadLeadReportCount: 1,
    ...over,
  };
}

describe('AOS vendor-success shadow handling from signed Core account bands', () => {
  it('reuses the existing case engine, placing a pending bad lead report before recharge', async () => {
    const result = await runAosVendorSuccessShadowCycle({
      cycleId: 'aos.anisha.verified-bands',
      generatedAt: at,
      projections: [],
      accountSignals: [account()],
    });
    expect(result).toMatchObject({
      projections: 0,
      accountSignals: 1,
      detections: 2,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.shadow.cases).toHaveLength(1);
    expect(result.shadow.cases[0]?.recommendation).toMatchObject({
      action: 'REQUEST_VENDOR_SUCCESS_FOLLOW_UP',
      requiresOwnerReview: true,
      executionAuthorized: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /clientPhone|matchingDemandCount|inactiveDays|walletBalance/iu,
    );
  });

  it('works through the existing AOS supervisor without starting a send or a model', async () => {
    const result = await runAosSupervisorShadowCycle({
      cycleId: 'aos.anisha.account-supervisor',
      generatedAt: at,
      vendorAccounts: [account({ packageReadinessBand: 'READY' })],
    });
    expect(result.sourceSummary).toMatchObject({ vendorProjections: 0, vendorAccountSignals: 1 });
    expect(result.vendors?.accountSignals).toBe(1);
    expect(result.vendors?.detections).toBe(1);
    expect(result).toMatchObject({
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.modelCalls).toBe(0);
  });

  it('does not create a case for a healthy account with no report', async () => {
    const result = await runAosSupervisorShadowCycle({
      cycleId: 'aos.anisha.no-contact',
      generatedAt: at,
      vendorAccounts: [account({ packageReadinessBand: 'READY', pendingBadLeadReportCount: 0 })],
    });
    expect(result.cases).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it('rejects duplicate vendor account signals rather than doubling follow-ups', async () => {
    await expect(
      runAosSupervisorShadowCycle({
        cycleId: 'aos.anisha.duplicate',
        generatedAt: at,
        vendorAccounts: [account(), account({ evidenceRef: 'core:another' })],
      }),
    ).rejects.toThrow('aos-supervisor-vendor-account-duplicate');
  });
});
