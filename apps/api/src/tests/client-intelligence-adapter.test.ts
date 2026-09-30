import { describe, expect, it } from 'vitest';

import { createServiceBlueprintRegistry } from '@qf-jarvis/client-intelligence';

import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import { buildWhatsAppClientIntelligence } from '../quickfurno-whatsapp/client-intelligence-adapter.js';

function material(
  over: Partial<QuickFurnoWhatsAppTurnMaterialV2> = {},
): QuickFurnoWhatsAppTurnMaterialV2 {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 2,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'quickfurno',
    conversationId: '22222222-2222-4222-8222-222222222222',
    revision: 9,
    assignedActor: 'RIYA',
    subjectType: 'client',
    partyType: 'CLIENT',
    conversationState: 'OPEN',
    jarvisAllowed: true,
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-09-30T06:30:00.000Z',
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: '2026-09-30T06:30:00.000Z',
    inbound: { version: 1, messageType: 'text', normalizedText: 'Hello' },
    normalizedText: 'Hello',
    clientJourney: {
      version: 1,
      profileId: 'profile.rahul',
      profileRevision: 4,
      profileStatus: 'known',
      isFirstContact: false,
      name: 'Rahul',
      preferredLanguage: 'hinglish',
      missing: [],
      activeRequirement: {
        requirementId: 'requirement.1',
        revision: 7,
        status: 'discovering',
        phase: 'NEED',
        summaryConfirmed: false,
        provenance: {},
      },
    },
    ...over,
  };
}
describe('QuickFurno WhatsApp Client OS adapter', () => {
  it('stays neutral for ordinary conversation', () => {
    const snapshot = buildWhatsAppClientIntelligence(material());
    expect(snapshot?.nextBestAction).toMatchObject({
      action: 'ANSWER_CLIENT',
      reasonCode: 'NO_HIGHER_PRIORITY_ACTION',
      requiresCoreDecision: false,
    });
    expect(snapshot?.opportunities).toStrictEqual([]);
    expect(snapshot?.behaviour).toStrictEqual([]);
  });

  it('asks the first Core-reported missing field when the client explicitly asks for vendors', () => {
    const snapshot = buildWhatsAppClientIntelligence(
      material({
        normalizedText: 'Please send me 3 vendors nearby',
        clientJourney: {
          ...material().clientJourney!,
          missing: ['location', 'budget'],
        },
      }),
    );

    expect(snapshot?.nextBestAction).toMatchObject({
      action: 'ASK_MISSING_FIELD',
      reasonCode: 'MATCH_REQUIRED_FIELD_MISSING',
      requiredFieldRef: 'location',
      requiresCoreDecision: false,
    });
  });
  it('requests only a Core eligibility check when fields are complete but match authority is absent', () => {
    const snapshot = buildWhatsAppClientIntelligence(
      material({
        normalizedText: 'I need three vendors',
        clientJourney: {
          ...material().clientJourney!,
          missing: [],
          activeRequirement: {
            ...material().clientJourney!.activeRequirement,
            serviceInterest: 'INTERIOR_DESIGN',
            location: 'BANER',
            budget: '8 lakh',
            timeline: 'next month',
          },
        },
      }),
    );

    expect(snapshot?.nextBestAction).toMatchObject({
      action: 'CHECK_CORE_ELIGIBILITY',
      reasonCode: 'MATCH_CORE_ELIGIBILITY_REQUIRED',
      requiresCoreDecision: true,
      businessEffect: false,
      executionAuthorized: false,
    });
  });


  it('requests matching immediately when Core says the requirement is READY', () => {
    const snapshot = buildWhatsAppClientIntelligence(
      material({
        normalizedText: 'Please send me 3 vendors nearby',
        clientMatchDecision: {
          version: 1,
          state: 'READY',
          requirementId: 'requirement.1',
          requirementRevision: 7,
          leadId: 'lead.1',
          assignmentCount: 0,
          missingFields: [],
          reasonCode: 'MATCH_READY',
          coreReady: true,
          executionAuthorized: false,
        },
      }),
    );

    expect(snapshot?.nextBestAction).toMatchObject({
      action: 'REQUEST_MATCH',
      reasonCode: 'CLIENT_MATCH_REQUEST_READY',
      requiresCoreDecision: true,
      businessEffect: false,
      executionAuthorized: false,
    });
  });

  it('asks Core-reported enrichment fields before requesting matching', () => {
    const snapshot = buildWhatsAppClientIntelligence(
      material({
        normalizedText: 'Connect me with three vendors',
        clientJourney: {
          ...material().clientJourney!,
          missing: [],
        },
        clientMatchDecision: {
          version: 1,
          state: 'NEEDS_ENRICHMENT',
          requirementId: 'requirement.1',
          requirementRevision: 7,
          assignmentCount: 0,
          missingFields: ['location'],
          reasonCode: 'MATCH_LOCATION_REQUIRED',
          coreReady: false,
          executionAuthorized: false,
        },
      }),
    );

    expect(snapshot?.nextBestAction).toMatchObject({
      action: 'ASK_MISSING_FIELD',
      reasonCode: 'MATCH_REQUIRED_FIELD_MISSING',
      requiredFieldRef: 'location',
      requiresCoreDecision: false,
    });
  });


  it('evaluates configured related-service opportunities without hardcoding category knowledge in Riya', () => {
    const registry = createServiceBlueprintRegistry([
      {
        version: 1,
        serviceRef: 'INTERIOR_DESIGN',
        coreCategoryRef: 'INTERIOR_DESIGN',
        qualification: { mandatoryFieldRefs: [], optionalFieldRefs: [] },
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
        coreCategoryRef: 'PAINTING',
        qualification: { mandatoryFieldRefs: [], optionalFieldRefs: [] },
        relatedServices: [],
      },
    ]);
    const snapshot = buildWhatsAppClientIntelligence(
      material({
        clientJourney: {
          ...material().clientJourney!,
          activeRequirement: {
            ...material().clientJourney!.activeRequirement,
            serviceInterest: 'INTERIOR_DESIGN',
          },
        },
      }),
      { serviceBlueprintRegistry: registry },
    );

    expect(snapshot?.opportunities).toStrictEqual([
      {
        serviceRef: 'PAINTING',
        score: 75,
        relevance: 'HIGH',
        explicitInterest: false,
      },
    ]);
    expect(snapshot?.nextBestAction).toMatchObject({
      action: 'SURFACE_ADDITIONAL_SERVICE',
      serviceRef: 'PAINTING',
      reasonCode: 'NURTURE_OPPORTUNITY_READY',
    });
  });

  it('does not create Client OS context when Core supplies no client journey', () => {
    expect(buildWhatsAppClientIntelligence(material({ clientJourney: undefined }))).toBeUndefined();
  });
});
