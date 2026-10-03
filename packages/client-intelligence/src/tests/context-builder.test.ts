import { describe, expect, it } from 'vitest';

import {
  buildClientIntelligenceContextV1,
  createClientBehaviourSignal,
  createServiceBlueprintRegistry,
} from '../index.js';

const registry = createServiceBlueprintRegistry([
  {
    version: 1,
    serviceRef: 'INTERIOR_DESIGN',
    coreCategoryRef: 'CORE-CAT-INTERIOR',
    qualification: {
      mandatoryFieldRefs: ['NAME', 'AREA', 'CATEGORY'],
      optionalFieldRefs: ['BUDGET'],
    },
    relatedServices: [
      {
        targetServiceRef: 'PAINTING',
        relevance: 'HIGH',
        timing: { sourceState: 'ACTIVE' },
      },
    ],
  },
  {
    version: 1,
    serviceRef: 'PAINTING',
    coreCategoryRef: 'CORE-CAT-PAINTING',
    qualification: {
      mandatoryFieldRefs: ['NAME', 'AREA', 'CATEGORY'],
      optionalFieldRefs: [],
    },
    relatedServices: [],
  },
]);

function baseInput() {
  return {
    asOf: '2026-09-30T10:00:00.000Z',
    behaviourSignals: [
      createClientBehaviourSignal({
        signalType: 'ENGAGEMENT',
        value: 'HIGH',
        confidence: 0.9,
        evidenceRef: 'TURN-4',
        observedAt: '2026-09-30T09:59:00.000Z',
      }),
    ],
    blueprintRegistry: registry,
    opportunityContext: {
      sourceServiceRefs: ['INTERIOR_DESIGN'],
      activeServiceRefs: ['INTERIOR_DESIGN'],
      completedServiceRefs: [],
      declinedServiceRefs: [],
      recentNurtureServiceRefs: [],
      explicitInterestServiceRefs: [],
      hasUnresolvedServiceIssue: false,
    },
    journey: {
      followUpDue: false,
      satisfactionState: 'UNKNOWN' as const,
      serviceRecoveryNeeded: false,
      reassignmentState: 'NONE' as const,
      lifecycleState: 'OPEN' as const,
      vendorsReleased: 0,
      vendorNoContactCount: 0,
      allReleasedVendorsContacted: false,
    },
    decision: {
      clientQuestionPending: false,
      humanHandoffRequested: false,
      explicitReassignmentRequested: false,
      extraVendorReviewRequested: false,
      matchRequested: false,
      matchReady: false,
      missingMandatoryFieldRefs: [],
    },
  };
}

describe('CI-12 deterministic context builder', () => {
  it('composes behaviour, opportunity and NBA after verified handoff satisfaction', () => {
    const input = baseInput();
    const snapshot = buildClientIntelligenceContextV1({
      ...input,
      journey: {
        ...input.journey,
        satisfactionState: 'SATISFIED',
        vendorsReleased: 3,
        vendorNoContactCount: 0,
        allReleasedVendorsContacted: true,
      },
    });

    expect(snapshot.behaviour).toStrictEqual([
      { signalType: 'ENGAGEMENT', value: 'HIGH', confidence: 0.9 },
    ]);
    expect(snapshot.opportunities).toStrictEqual([
      {
        serviceRef: 'PAINTING',
        score: 75,
        relevance: 'HIGH',
        explicitInterest: false,
      },
    ]);
    expect(snapshot.nextBestAction).toMatchObject({
      action: 'SURFACE_ADDITIONAL_SERVICE',
      serviceRef: 'PAINTING',
      businessEffect: false,
      executionAuthorized: false,
    });
  });

  it('prioritizes missing mandatory match data over opportunity nurture', () => {
    const input = baseInput();
    const snapshot = buildClientIntelligenceContextV1({
      ...input,
      decision: {
        ...input.decision,
        matchRequested: true,
        missingMandatoryFieldRefs: ['AREA'],
      },
    });
    expect(snapshot.nextBestAction).toStrictEqual({
      action: 'ASK_MISSING_FIELD',
      reasonCode: 'MATCH_REQUIRED_FIELD_MISSING',
      requiredFieldRef: 'AREA',
      requiresCoreDecision: false,
      businessEffect: false,
      executionAuthorized: false,
    });
  });

  it('suppresses opportunity progression when service recovery is active', () => {
    const input = baseInput();
    const snapshot = buildClientIntelligenceContextV1({
      ...input,
      opportunityContext: {
        ...input.opportunityContext,
        hasUnresolvedServiceIssue: true,
      },
      journey: {
        ...input.journey,
        satisfactionState: 'DISSATISFIED',
        serviceRecoveryNeeded: true,
      },
    });

    expect(snapshot.opportunities).toStrictEqual([]);
    expect(snapshot.nextBestAction.action).toBe('SERVICE_RECOVERY');
  });
  it('uses current journey state as the source for vendor follow-up decisions', () => {
    const input = baseInput();
    const snapshot = buildClientIntelligenceContextV1({
      ...input,
      journey: {
        ...input.journey,
        vendorsReleased: 3,
        vendorNoContactCount: 1,
      },
    });

    expect(snapshot.nextBestAction).toMatchObject({
      action: 'CHECK_VENDOR_CONTACT',
      requiresCoreDecision: true,
    });
  });

  it('fails closed on conflicting reassignment and extra-vendor requests', () => {
    const input = baseInput();
    expect(() =>
      buildClientIntelligenceContextV1({
        ...input,
        decision: {
          ...input.decision,
          explicitReassignmentRequested: true,
          extraVendorReviewRequested: true,
        },
      }),
    ).toThrow('client-intelligence-context-conflicting-vendor-request');
  });
});
