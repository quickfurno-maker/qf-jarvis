import { describe, expect, it } from 'vitest';
import type { AnishaCoreVendorSnapshot } from '../quickfurno-whatsapp/anisha-core-context.js';
import { composeAnishaCoreVendorFacts } from '../quickfurno-whatsapp/anisha-core-context.js';
import { selectAnishaVendorNextStep } from '../quickfurno-whatsapp/anisha-vendor-next-step.js';

function snapshot(over: Partial<AnishaCoreVendorSnapshot> = {}): AnishaCoreVendorSnapshot {
  return {
    kind: 'vendor_profile',
    vendorId: '44444444-4444-4444-8444-444444444444',
    packageReadinessBand: 'READY',
    packageExpiryBand: 'HEALTHY',
    vendorStatus: 'approved',
    locationVerificationStatus: 'verified',
    isActive: true,
    activeLeadCount: 0,
    pendingBadLeadReportCount: 0,
    unreadNotificationCount: 0,
    ...over,
  };
}

describe('Anisha proactive next step: Core-authored facts, suggestion only', () => {
  it('does not advise from missing Core data or greetings', () => {
    expect(selectAnishaVendorNextStep('what next?', null)).toBeNull();
    expect(selectAnishaVendorNextStep('hello', snapshot({ activeLeadCount: 4 }))).toBeNull();
    expect(composeAnishaCoreVendorFacts('my status?', null)).not.toContain(
      'Optional verified-context next step',
    );
  });

  it('prioritizes a dispute report over unrelated expiry or sales signals', () => {
    const s = snapshot({
      pendingBadLeadReportCount: 2,
      packageExpiryBand: 'DUE_7D',
      activeLeadCount: 3,
    });
    expect(selectAnishaVendorNextStep('bad lead report status', s)).toContain('bad-lead report');
    expect(selectAnishaVendorNextStep('what next for my account?', s)).toContain('bad-lead report');
    expect(selectAnishaVendorNextStep('my lead?', s)).toContain('active leads');
  });

  it('assists with pending verification without claiming approval', () => {
    const s = snapshot({
      vendorStatus: 'pending_approval',
      locationVerificationStatus: 'unverified',
    });
    const hint = composeAnishaCoreVendorFacts('Is office verified?', s);
    expect(hint).toContain('authenticated upload flow');
    expect(hint).not.toContain('approved now');
  });

  it('distinguishes account action, expiry and package readiness', () => {
    expect(
      selectAnishaVendorNextStep('account status?', snapshot({ vendorStatus: 'suspended' })),
    ).toContain('status review');
    expect(
      selectAnishaVendorNextStep('package expiry?', snapshot({ packageExpiryBand: 'DUE_7D' })),
    ).toContain('renewal');
    expect(
      selectAnishaVendorNextStep('credits?', snapshot({ packageReadinessBand: 'LOW_CREDITS' })),
    ).toContain('exact balance');
    expect(
      selectAnishaVendorNextStep('notifications?', snapshot({ unreadNotificationCount: 2 })),
    ).toContain('unread');
  });

  it('uses at most one suggestion and never invents external side effects', () => {
    const s = snapshot({
      activeLeadCount: 3,
      pendingBadLeadReportCount: 1,
      unreadNotificationCount: 3,
    });
    const hint = composeAnishaCoreVendorFacts('what should I check next?', s);
    expect(hint.match(/Optional verified-context next step/g)).toHaveLength(1);
    expect(hint).not.toMatch(
      /I have (?:credited|recharged|assigned|contacted|refunded|submitted)/iu,
    );
  });
});
