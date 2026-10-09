import { describe, expect, it } from 'vitest';

import { runAosClientJourneyShadowCycle } from '../index.js';

const at = '2026-10-01T06:15:00.000Z';

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

describe('AOS shadow cycle over the existing client/vendor journey projection', () => {
  it('detects an aggregate Core contact gap but refuses to target Anisha without a vendor identity', async () => {
    const result = await runAosClientJourneyShadowCycle({
      cycleId: 'aos.client-journey.test-1',
      generatedAt: at,
      subjectRef: 'client:opaque-1',
      requirementRef: 'requirement:opaque-1',
      evidenceRef: 'core:client-vendor-journey:1',
      journey: {
        ...baseJourney,
        vendorNoContactCount: 1,
      },
    });

    expect(result).toMatchObject({
      protocol: 'qfj.aos.client-journey-cycle.v1',
      bridgedSignals: 1,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.shadow.cases[0]).toMatchObject({
      reason: 'NO_POLICY_MATCH',
      case: {
        subjectRef: 'client:opaque-1',
      },
    });
    expect(result.shadow.cases[0]?.recommendation).toBeUndefined();
  });

  it('does not treat three assignments as a completed handoff without Core contact evidence', async () => {
    const result = await runAosClientJourneyShadowCycle({
      cycleId: 'aos.client-journey.test-2',
      generatedAt: at,
      subjectRef: 'client:opaque-2',
      requirementRef: 'requirement:opaque-2',
      evidenceRef: 'core:client-vendor-journey:2',
      journey: baseJourney,
    });

    expect(result.bridgedSignals).toBe(0);
    expect(result.shadow.recommendations).toBe(0);
  });

  it('recognizes a completed three-vendor contact handoff but still keeps business effects off', async () => {
    const result = await runAosClientJourneyShadowCycle({
      cycleId: 'aos.client-journey.test-3',
      generatedAt: at,
      subjectRef: 'client:opaque-3',
      requirementRef: 'requirement:opaque-3',
      evidenceRef: 'core:client-vendor-journey:3',
      journey: {
        ...baseJourney,
        allReleasedVendorsContacted: true,
      },
    });

    expect(result.bridgedSignals).toBe(1);
    expect(result.shadow.executionAuthority).toBe('NONE');
    expect(result.shadow.businessEffect).toBe(false);
  });
});
