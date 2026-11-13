import { describe, expect, it } from 'vitest';
import { selectAnishaVendorNextStep } from '../anisha-vendor-next-step.js';
import type { AnishaCoreVendorSnapshot } from '../anisha-core-context.js';

const BASE: AnishaCoreVendorSnapshot = {
  kind: 'vendor_profile',
  vendorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  packageReadinessBand: 'LOW_CREDITS',
  packageExpiryBand: 'HEALTHY',
  vendorStatus: 'approved',
  locationVerificationStatus: 'verified',
  isActive: true,
  activeLeadCount: 1,
  pendingBadLeadReportCount: 0,
  unreadNotificationCount: 0,
};
describe('Anisha D4 signed-Core vendor journey guards', () => {
  it('never encourages contacting clients when office verification is unknown', () => {
    for (const locationVerificationStatus of [
      null,
      'pending',
      'failed',
      'rejected',
      'unverified',
    ]) {
      const msg = selectAnishaVendorNextStep('I got a lead. Can I call client?', {
        ...BASE,
        locationVerificationStatus,
      });
      expect(msg).toContain('office-verification steps');
      expect(msg).not.toContain('Contact a client only');
    }
  });
  it('never upsells/recharges pending, inactive, suspended or ambiguous accounts', () => {
    for (const changes of [
      { vendorStatus: 'pending' },
      { vendorStatus: 'pending_approval' },
      { vendorStatus: 'suspended' },
      { vendorStatus: 'rejected' },
      { vendorStatus: 'inactive' },
      { vendorStatus: null },
      { vendorStatus: 'unknown' },
      { isActive: false },
    ]) {
      const msg = selectAnishaVendorNextStep('My credits are low, how can I recharge?', {
        ...BASE,
        ...changes,
      });
      expect(msg).toContain('account notice');
      expect(msg).not.toContain('Review package and credit readiness');
    }
  });
  it('unverified office blocks package advice even if status approved, active and credit band LOW', () => {
    const msg = selectAnishaVendorNextStep('How many credits do I have?', {
      ...BASE,
      locationVerificationStatus: null,
    });
    expect(msg).toContain('office-verification steps');
    expect(msg).not.toContain('exact balance');
  });
  it('signed, fully ready account still receives bounded package and lead guidance', () => {
    expect(selectAnishaVendorNextStep('recharge credits', BASE)).toContain(
      'official vendor dashboard',
    );
    expect(selectAnishaVendorNextStep('call client lead', BASE)).toContain(
      'explicit contact entitlement',
    );
  });
  it('general next-step request prioritizes unresolved office state before incidental low credits', () => {
    const msg = selectAnishaVendorNextStep('status update: what next?', {
      ...BASE,
      locationVerificationStatus: null,
    });
    expect(msg).toContain('office-verification steps');
    expect(msg).not.toContain('exact balance');
  });
  it('never invents an identity when signed Core context is unavailable', () => {
    expect(selectAnishaVendorNextStep('client lead', null)).toBeNull();
    expect(selectAnishaVendorNextStep('package', null)).toBeNull();
  });
});
