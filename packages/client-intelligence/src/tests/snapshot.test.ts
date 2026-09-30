import { describe, expect, it } from 'vitest';

import { createClientIntelligenceSnapshotV1, parseClientIntelligenceSnapshotV1 } from '../index.js';

function validSnapshot() {
  return {
    version: 1 as const,
    behaviour: [
      { signalType: 'URGENCY' as const, value: 'URGENT' as const, confidence: 0.9 },
      { signalType: 'ENGAGEMENT' as const, value: 'HIGH' as const, confidence: 0.8 },
    ],
    journey: {
      followUpDue: true,
      satisfactionState: 'UNKNOWN' as const,
      serviceRecoveryNeeded: false,
      reassignmentState: 'NONE' as const,
      lifecycleState: 'OPEN' as const,
      vendorsReleased: 3,
      vendorNoContactCount: 0,
      allReleasedVendorsContacted: true,
    },
    opportunities: [
      {
        serviceRef: 'PAINTING',
        score: 82,
        relevance: 'HIGH' as const,
        explicitInterest: false,
      },
      {
        serviceRef: 'SOFA',
        score: 60,
        relevance: 'MEDIUM' as const,
        explicitInterest: false,
      },
    ],
    nextBestAction: {
      action: 'SURFACE_ADDITIONAL_SERVICE' as const,
      reasonCode: 'NURTURE_OPPORTUNITY_READY',
      serviceRef: 'PAINTING',
      requiresCoreDecision: false,
      businessEffect: false as const,
      executionAuthorized: false as const,
    },
  };
}

describe('CI-12 client intelligence snapshot', () => {
  it('creates a deterministic immutable snapshot with stable ordering', () => {
    const snapshot = createClientIntelligenceSnapshotV1(validSnapshot());

    expect(snapshot.behaviour.map((entry) => entry.signalType)).toStrictEqual([
      'ENGAGEMENT',
      'URGENCY',
    ]);
    expect(snapshot.opportunities.map((entry) => entry.serviceRef)).toStrictEqual([
      'PAINTING',
      'SOFA',
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.journey)).toBe(true);
    expect(Object.isFrozen(snapshot.behaviour)).toBe(true);
    expect(Object.isFrozen(snapshot.opportunities)).toBe(true);
  });

  it('fails closed if a snapshot tries to claim business effect or execution authority', () => {
    const candidate = validSnapshot() as Record<string, unknown>;
    candidate['nextBestAction'] = {
      ...(candidate['nextBestAction'] as Record<string, unknown>),
      businessEffect: true,
    };

    expect(() => parseClientIntelligenceSnapshotV1(candidate)).toThrow(
      'client-intelligence-next-best-action-authority-invalid',
    );
  });
  it('rejects contradictory vendor-contact state', () => {
    const candidate = validSnapshot() as Record<string, unknown>;
    candidate['journey'] = {
      ...(candidate['journey'] as Record<string, unknown>),
      vendorNoContactCount: 1,
      allReleasedVendorsContacted: true,
    };

    expect(() => parseClientIntelligenceSnapshotV1(candidate)).toThrow(
      'client-intelligence-journey-invalid',
    );
  });

  it('rejects duplicate behaviour and opportunity entries', () => {
    const duplicateBehaviour = validSnapshot() as Record<string, unknown>;
    duplicateBehaviour['behaviour'] = [
      { signalType: 'ENGAGEMENT', value: 'HIGH', confidence: 0.9 },
      { signalType: 'ENGAGEMENT', value: 'LOW', confidence: 0.6 },
    ];
    expect(() => parseClientIntelligenceSnapshotV1(duplicateBehaviour)).toThrow(
      'client-intelligence-behaviour-invalid',
    );

    const duplicateOpportunity = validSnapshot() as Record<string, unknown>;
    duplicateOpportunity['opportunities'] = [
      { serviceRef: 'PAINTING', score: 80, relevance: 'HIGH', explicitInterest: false },
      { serviceRef: 'PAINTING', score: 70, relevance: 'MEDIUM', explicitInterest: true },
    ];
    expect(() => parseClientIntelligenceSnapshotV1(duplicateOpportunity)).toThrow(
      'client-intelligence-opportunity-duplicate',
    );
  });

  it('rejects unsupported versions and malformed confidence values', () => {
    expect(() => parseClientIntelligenceSnapshotV1({ ...validSnapshot(), version: 2 })).toThrow(
      'client-intelligence-snapshot-version-invalid',
    );

    const candidate = validSnapshot() as Record<string, unknown>;
    candidate['behaviour'] = [{ signalType: 'ENGAGEMENT', value: 'HIGH', confidence: 1.1 }];
    expect(() => parseClientIntelligenceSnapshotV1(candidate)).toThrow(
      'client-intelligence-behaviour-invalid',
    );
  });
});
