import { describe, expect, it } from 'vitest';

import { runAosCanonicalEventShadowCycle } from '../index.js';

const BASE = {
  eventVersion: 2,
  occurredAt: '2026-10-01T05:00:00.000Z',
  emittedAt: '2026-10-01T05:00:01.000Z',
  source: 'quickfurno-core',
  correlationId: '11111111-1111-4111-8111-111111111111',
} as const;

function rechargeEvent() {
  return {
    ...BASE,
    eventId: '22222222-2222-4222-8222-222222222222',
    eventType: 'qf.vendor.recharge-opportunity-detected',
    subject: { entityType: 'vendor', entityId: 'vendor-opaque-1' },
    payload: {
      reasonCode: 'recharge-opportunity',
      opportunityBand: 'high',
    },
  };
}

function dissatisfactionEvent() {
  return {
    ...BASE,
    eventId: '33333333-3333-4333-8333-333333333333',
    eventType: 'qf.client.dissatisfaction-recorded',
    subject: { entityType: 'client', entityId: 'client-opaque-1' },
    payload: {
      reasonCode: 'client-dissatisfied',
      lead: { entityType: 'lead', entityId: 'lead-opaque-1' },
      category: { entityType: 'category', entityId: 'interior' },
      severity: 'severe',
    },
  };
}

describe('AOS canonical-event shadow composition', () => {
  it('uses existing Core recharge events to create a zero-AI Anisha suggestion', async () => {
    const result = await runAosCanonicalEventShadowCycle({
      cycleId: 'aos.canonical.test-1',
      generatedAt: '2026-10-01T05:01:00.000Z',
      events: [rechargeEvent()],
    });
    expect(result).toMatchObject({
      protocol: 'qfj.aos.canonical-event-cycle.v1',
      receivedEvents: 1,
      bridgedEvents: 1,
      invalidEvents: 0,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.shadow.cases[0]).toMatchObject({
      route: 'NO_MODEL',
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_RECHARGE_NUDGE',
        requiresOwnerReview: false,
        executionAuthorized: false,
      },
    });
  });

  it('routes client dissatisfaction to governed Riya follow-up review', async () => {
    const result = await runAosCanonicalEventShadowCycle({
      cycleId: 'aos.canonical.test-2',
      generatedAt: '2026-10-01T05:01:00.000Z',
      events: [dissatisfactionEvent()],
    });
    expect(result.shadow.cases[0]?.recommendation).toMatchObject({
      action: 'REQUEST_CLIENT_FOLLOW_UP',
      requiresOwnerReview: true,
      executionAuthorized: false,
    });
  });

  it('never treats assignment completion as successful client-vendor contact', async () => {
    const assignment = {
      ...BASE,
      eventId: '44444444-4444-4444-8444-444444444444',
      eventType: 'qf.assignment.batch-completed',
      subject: { entityType: 'lead', entityId: 'lead-opaque-2' },
      payload: {
        reasonCode: 'assignment-complete',
        lead: { entityType: 'lead', entityId: 'lead-opaque-2' },
        category: { entityType: 'category', entityId: 'interior' },
        assignmentBatchId: '55555555-5555-4555-8555-555555555555',
        batchNumber: 1,
      },
    };
    const result = await runAosCanonicalEventShadowCycle({
      cycleId: 'aos.canonical.test-3',
      generatedAt: '2026-10-01T05:01:00.000Z',
      events: [assignment],
    });
    expect(result.ignoredEvents).toBe(1);
    expect(result.shadow.recommendations).toBe(0);
    expect(result.shadow.cases).toEqual([]);
  });

  it('counts invalid canonical events without turning them into findings', async () => {
    const result = await runAosCanonicalEventShadowCycle({
      cycleId: 'aos.canonical.test-4',
      generatedAt: '2026-10-01T05:01:00.000Z',
      events: [{ eventType: 'fake', phone: '+919999999999' }],
    });
    expect(result.invalidEvents).toBe(1);
    expect(result.shadow.signals).toBe(0);
    expect(result.shadow.recommendations).toBe(0);
  });
});
