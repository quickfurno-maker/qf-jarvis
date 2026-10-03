import { describe, expect, it } from 'vitest';

import { bridgeCanonicalCoreEvent } from '../index.js';

const BASE = {
  eventVersion: 2,
  occurredAt: '2026-10-01T05:00:00.000Z',
  emittedAt: '2026-10-01T05:00:01.000Z',
  source: 'quickfurno-core',
  correlationId: '11111111-1111-4111-8111-111111111111',
} as const;

describe('AOS canonical Core event bridge', () => {
  it('bridges Core recharge opportunity as a band-derived Anisha trigger with no balance', () => {
    const result = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '22222222-2222-4222-8222-222222222222',
      eventType: 'qf.vendor.recharge-opportunity-detected',
      subject: { entityType: 'vendor', entityId: 'vendor-opaque-1' },
      payload: {
        reasonCode: 'recharge-opportunity',
        opportunityBand: 'high',
      },
    });
    expect(result).toMatchObject({
      outcome: 'BRIDGED',
      eventType: 'qf.vendor.recharge-opportunity-detected',
      observation: {
        kind: 'BUSINESS_EVENT',
        input: {
          detectorType: 'OPPORTUNITY',
          subjectRef: 'vendor:vendor-opaque-1',
          reasonCode: 'CORE_VENDOR_RECHARGE_OPPORTUNITY',
        },
      },
      behaviour: {
        trigger: 'VENDOR_RECHARGE_OPPORTUNITY',
        context: { metrics: {} },
      },
    });
    expect(JSON.stringify(result)).not.toContain('balance');
  });

  it('bridges satisfaction as client context without any direct contact data', () => {
    const result = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'qf.client.satisfaction-recorded',
      subject: { entityType: 'client', entityId: 'client-opaque-1' },
      payload: {
        reasonCode: 'client-satisfied',
        lead: { entityType: 'lead', entityId: 'lead-opaque-1' },
        category: { entityType: 'category', entityId: 'interior' },
      },
    });
    expect(result).toMatchObject({
      outcome: 'BRIDGED',
      behaviour: {
        trigger: 'CLIENT_SATISFACTION_POSITIVE',
        context: { metrics: { clientSatisfactionScore: 1 } },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/phone|email|name/iu);
  });

  it('does not mistake an assignment batch completing for successful client-vendor contact', () => {
    const result = bridgeCanonicalCoreEvent({
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
    });
    expect(result).toEqual({
      outcome: 'IGNORED',
      eventType: 'qf.assignment.batch-completed',
      reason: 'ASSIGNMENT_IS_NOT_CONTACT',
    });
  });

  it('fails closed on an event that is not a valid canonical Core event', () => {
    expect(
      bridgeCanonicalCoreEvent({
        eventType: 'qf.vendor.recharge-opportunity-detected',
        phone: '+919999999999',
      }),
    ).toEqual({
      outcome: 'INVALID',
      reason: 'CANONICAL_EVENT_INVALID',
    });
  });
});

describe('AOS client-growth case identity', () => {
  it('does not combine satisfaction from one lead with another lead for the same client', () => {
    const first = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '55555555-5555-4555-8555-555555555551',
      eventType: 'qf.client.satisfaction-recorded',
      subject: { entityType: 'client', entityId: 'client-opaque-shared' },
      payload: {
        reasonCode: 'client-satisfied',
        lead: { entityType: 'lead', entityId: 'lead-opaque-a' },
        category: { entityType: 'category', entityId: 'interior' },
      },
    });
    const second = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '55555555-5555-4555-8555-555555555552',
      eventType: 'qf.client.satisfaction-recorded',
      subject: { entityType: 'client', entityId: 'client-opaque-shared' },
      payload: {
        reasonCode: 'client-satisfied',
        lead: { entityType: 'lead', entityId: 'lead-opaque-b' },
        category: { entityType: 'category', entityId: 'interior' },
      },
    });

    expect(first.outcome).toBe('BRIDGED');
    expect(second.outcome).toBe('BRIDGED');
    if (first.outcome !== 'BRIDGED' || second.outcome !== 'BRIDGED') {
      throw new Error('fixture-invalid');
    }
    expect(first.observation.input.caseKey).not.toBe(second.observation.input.caseKey);
    expect(first.observation.input.caseKey).toContain('lead:lead-opaque-a');
    expect(second.observation.input.caseKey).toContain('lead:lead-opaque-b');
  });
});

describe('AOS vendor-success Core event coverage', () => {
  it('bridges only low/critical package-readiness bands into recharge guidance', () => {
    const low = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '66666666-6666-4666-8666-666666666661',
      eventType: 'qf.vendor.package-readiness-changed',
      subject: { entityType: 'vendor', entityId: 'vendor-opaque-low' },
      payload: {
        reasonCode: 'package-readiness-low',
        readinessBand: 'low',
      },
    });
    expect(low).toMatchObject({
      outcome: 'BRIDGED',
      behaviour: { trigger: 'VENDOR_PACKAGE_READINESS_LOW' },
    });

    const healthy = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '66666666-6666-4666-8666-666666666662',
      eventType: 'qf.vendor.package-readiness-changed',
      subject: { entityType: 'vendor', entityId: 'vendor-opaque-high' },
      payload: {
        reasonCode: 'package-readiness-high',
        readinessBand: 'high',
      },
    });
    expect(healthy).toEqual({
      outcome: 'IGNORED',
      eventType: 'qf.vendor.package-readiness-changed',
      reason: 'NOT_AN_AOS_INPUT',
    });
  });

  it('routes a recorded vendor complaint into a governed vendor-success case', () => {
    const result = bridgeCanonicalCoreEvent({
      ...BASE,
      eventId: '77777777-7777-4777-8777-777777777777',
      eventType: 'qf.vendor.complaint-recorded',
      subject: { entityType: 'vendor', entityId: 'vendor-opaque-complaint' },
      payload: {
        reasonCode: 'vendor-complaint',
        severity: 'high',
      },
    });
    expect(result).toMatchObject({
      outcome: 'BRIDGED',
      observation: {
        input: {
          priority: 'P1',
          reasonCode: 'CORE_VENDOR_COMPLAINT',
        },
      },
      behaviour: {
        trigger: 'VENDOR_COMPLAINT_RECORDED',
      },
    });
  });
});
