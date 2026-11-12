import { describe, expect, it } from 'vitest';
import { selectAnishaVendorNextStep } from '../anisha-vendor-next-step.js';
import type { AnishaCoreVendorSnapshot } from '../anisha-core-context.js';

const BASE: AnishaCoreVendorSnapshot = {
  kind: 'vendor_profile',
  vendorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  packageReadinessBand: 'READY',
  packageExpiryBand: 'HEALTHY',
  vendorStatus: 'approved',
  locationVerificationStatus: 'verified',
  isActive: true,
  activeLeadCount: 1,
  pendingBadLeadReportCount: 0,
  unreadNotificationCount: 0,
};

describe('Anisha vendor lead advice requires fresh Core permissions', () => {
  it('never equates a positive active lead count to per-lead contact entitlement', () => {
    const msg = selectAnishaVendorNextStep('I have a client lead. Can I call?', BASE);
    expect(msg).toContain('explicit contact entitlement');
    expect(msg).not.toContain('contact the assigned clients yourself');
  });
  it('routes pending, suspended, unknown and inactive accounts to secure account review', () => {
    for (const vendorStatus of ['pending', 'rejected', 'suspended', null]) {
      const msg = selectAnishaVendorNextStep('Show my leads', { ...BASE, vendorStatus });
      expect(msg).toContain('account notice');
      expect(msg).not.toContain('Contact a client');
    }
    expect(selectAnishaVendorNextStep('lead', { ...BASE, isActive: false })).toContain(
      'account notice',
    );
  });
  it('routes an unverified office to official document verification even with active leads', () => {
    expect(
      selectAnishaVendorNextStep('client lead', {
        ...BASE,
        locationVerificationStatus: 'unverified',
      }),
    ).toContain('office-verification steps');
  });
  it('does not claim active leads, exact credit balance or approval without a snapshot', () => {
    expect(selectAnishaVendorNextStep('client lead', null)).toBeNull();
    expect(selectAnishaVendorNextStep('client lead', { ...BASE, activeLeadCount: 0 })).toBeNull();
  });
});
