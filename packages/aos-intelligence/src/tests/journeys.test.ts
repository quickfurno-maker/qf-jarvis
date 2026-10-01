import { describe, expect, it } from 'vitest';

import { behaviourActionForVendor, planAosVendorNextBestAction } from '../index.js';

const baseVendor = {
  assignedLeadAwaitingFirstContact: false,
  firstContactSlaBreached: false,
  vendorInactiveDays: 0,
  matchingDemandAvailable: false,
  lowBalance: false,
  depletionPredicted: false,
  communicationCooldownActive: false,
  unresolvedSupportIssue: false,
};

describe('AOS vendor next-best-action precedence', () => {
  it('puts an active lead first-contact problem ahead of monetization', () => {
    expect(
      planAosVendorNextBestAction({
        ...baseVendor,
        assignedLeadAwaitingFirstContact: true,
        firstContactSlaBreached: true,
        lowBalance: true,
        retentionRisk: true,
      }),
    ).toBe('ASK_FIRST_CONTACT_STATUS');
  });

  it('puts vendor success/retention support ahead of recharge nudges', () => {
    const action = planAosVendorNextBestAction({
      ...baseVendor,
      retentionRisk: true,
      rechargeOpportunity: true,
      lowBalance: true,
    });
    expect(action).toBe('VENDOR_SUCCESS_CHECK');
    expect(behaviourActionForVendor(action)).toBe('RECOMMEND_ANISHA_VENDOR_SUCCESS_CHECK');
  });

  it('uses Core-derived recharge opportunity without requiring a guessed raw balance', () => {
    expect(
      planAosVendorNextBestAction({
        ...baseVendor,
        rechargeOpportunity: true,
      }),
    ).toBe('RECHARGE_NUDGE');
  });

  it('reactivates only when win-back/inactivity overlaps relevant matching demand', () => {
    expect(
      planAosVendorNextBestAction({
        ...baseVendor,
        winbackCandidate: true,
        matchingDemandAvailable: false,
      }),
    ).toBe('NO_CONTACT');

    expect(
      planAosVendorNextBestAction({
        ...baseVendor,
        winbackCandidate: true,
        matchingDemandAvailable: true,
      }),
    ).toBe('REACTIVATE_WITH_MASKED_DEMAND');
  });

  it('respects communication cooldown as a no-contact decision', () => {
    expect(
      planAosVendorNextBestAction({
        ...baseVendor,
        retentionRisk: true,
        communicationCooldownActive: true,
      }),
    ).toBe('NO_CONTACT');
  });
});
