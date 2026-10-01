import { describe, expect, it } from 'vitest';

import { createAosOwnerAttentionObservation, parseAosOwnerAttentionObservation } from '../index.js';

const emittedAt = '2026-10-01T10:00:00.000Z';

function validObservation() {
  return createAosOwnerAttentionObservation({
    cycleId: 'aos.proactive.cycle.1',
    emittedAt,
    items: [
      {
        caseId: 'case.owner-attention.1',
        priority: 'P1',
        lane: 'SOON',
        attentionScore: 64,
        reasonCodes: ['PRIORITY_P1', 'OWNER_REVIEW_REQUIRED'],
        requiresOwnerReview: true,
        recommendationAction: 'REQUEST_REPLACEMENT_BATCH',
        executionAuthority: 'NONE',
        businessEffect: false,
      },
    ],
  });
}

describe('AOS owner-attention observation', () => {
  it('creates a content-minimized SHADOW snapshot with no outbound authority', () => {
    const observation = validObservation();
    expect(observation).toMatchObject({
      protocol: 'qfj.aos.owner-attention-observation.v1',
      mode: 'SHADOW',
      outboundNotificationAuthorized: false,
      executionAuthority: 'NONE',
      businessEffect: false,
    });
    expect(observation.items[0]).toMatchObject({
      caseId: 'case.owner-attention.1',
      recommendationAction: 'REQUEST_REPLACEMENT_BATCH',
    });
    expect(JSON.stringify(observation)).not.toMatch(/phone|email|messageBody|destination/iu);
  });

  it('rejects extra destination/content fields and any attempt to authorize outbound effects', () => {
    const observation = validObservation();
    expect(() =>
      parseAosOwnerAttentionObservation({
        ...observation,
        ownerPhone: 'redacted',
      }),
    ).toThrow('aos-owner-attention-observation-invalid');
    expect(() =>
      parseAosOwnerAttentionObservation({
        ...observation,
        outboundNotificationAuthorized: true,
      }),
    ).toThrow('aos-owner-attention-observation-invalid');
    expect(() =>
      parseAosOwnerAttentionObservation({
        ...observation,
        items: [{ ...observation.items[0], businessEffect: true }],
      }),
    ).toThrow('aos-owner-attention-observation-item-invalid');
    expect(() =>
      parseAosOwnerAttentionObservation({
        ...observation,
        items: [{ ...observation.items[0], caseId: 'case.9876543210' }],
      }),
    ).toThrow('aos-owner-attention-observation-item-invalid');
  });
});
