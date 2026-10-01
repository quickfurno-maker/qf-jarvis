import { describe, expect, it } from 'vitest';

import { bridgeClientJourneyToAos } from '../index.js';

const observedAt = '2026-10-01T06:00:00.000Z';

const baseJourney = {
  followUpDue: false,
  satisfactionState: 'UNKNOWN' as const,
  serviceRecoveryNeeded: false,
  reassignmentState: 'NONE' as const,
  lifecycleState: 'OPEN' as const,
  vendorsReleased: 3,
  vendorNoContactCount: 0,
  allReleasedVendorsContacted: false,
};

describe('AOS bridge over existing Core client/vendor journey projection', () => {
  it('treats Core-reported no-contact as the lead-delivery signal, not assignment count', () => {
    const items = bridgeClientJourneyToAos({
      subjectRef: 'client:opaque-1',
      requirementRef: 'requirement:opaque-1',
      evidenceRef: 'core:client-vendor-journey:1',
      observedAt,
      journey: {
        ...baseJourney,
        vendorNoContactCount: 1,
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      behaviour: {
        trigger: 'LEAD_FIRST_CONTACT_GAP',
        context: {
          metrics: {
            successfulVendorContacts: 2,
            vendorExposureCount: 3,
          },
        },
      },
      observation: {
        input: {
          reasonCode: 'VENDOR_FIRST_CONTACT_GAP',
          subjectRef: 'client:opaque-1',
        },
      },
    });
  });

  it('does not call assignment completion a successful three-vendor handoff', () => {
    const items = bridgeClientJourneyToAos({
      subjectRef: 'client:opaque-2',
      requirementRef: 'requirement:opaque-2',
      evidenceRef: 'core:client-vendor-journey:2',
      observedAt,
      journey: baseJourney,
    });

    expect(items).toEqual([]);
  });

  it('emits handoff completion only after Core confirms all three vendor contacts', () => {
    const items = bridgeClientJourneyToAos({
      subjectRef: 'client:opaque-3',
      requirementRef: 'requirement:opaque-3',
      evidenceRef: 'core:client-vendor-journey:3',
      observedAt,
      journey: {
        ...baseJourney,
        allReleasedVendorsContacted: true,
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      behaviour: {
        trigger: 'LEAD_HANDOFF_COMPLETE',
        context: {
          metrics: {
            successfulVendorContacts: 3,
            vendorExposureCount: 3,
          },
        },
      },
      observation: { input: { reasonCode: 'LEAD_HANDOFF_COMPLETE' } },
    });
  });

  it('keeps satisfaction as a separate client-growth signal after successful contact', () => {
    const items = bridgeClientJourneyToAos({
      subjectRef: 'client:opaque-4',
      requirementRef: 'requirement:opaque-4',
      evidenceRef: 'core:client-vendor-journey:4',
      observedAt,
      journey: {
        ...baseJourney,
        allReleasedVendorsContacted: true,
        satisfactionState: 'SATISFIED',
      },
    });

    expect(items.map((one) => one.behaviour.trigger).sort()).toEqual([
      'CLIENT_SATISFACTION_POSITIVE',
      'LEAD_HANDOFF_COMPLETE',
    ]);
    expect(
      items.find((one) => one.behaviour.trigger === 'CLIENT_SATISFACTION_POSITIVE'),
    ).toMatchObject({
      behaviour: { context: { metrics: { clientSatisfactionScore: 1 } } },
    });
  });
});
