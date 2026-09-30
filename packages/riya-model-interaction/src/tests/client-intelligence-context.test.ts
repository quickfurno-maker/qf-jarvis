import { createClientIntelligenceSnapshotV1 } from '@qf-jarvis/client-intelligence';
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import { describe, expect, it } from 'vitest';

import { createRiyaConversationModelProfile } from '../index.js';

const current = createRiyaConversationContinuityState({
  version: 1,
  tenantId: 'tenant.a',
  conversationId: 'conv.1',
  continuityRevision: 1,
  phase: 'NEED',
  discovery: {
    completeness: 'MORE_DISCOVERY_REQUIRED',
    missingFields: ['location', 'budget', 'timeline'],
    serviceInterestRef: 'interior-design',
  },
  fieldProvenance: { serviceInterest: 'user_stated' },
  summaryConfirmed: false,
});

const availabilitySnapshot = syntheticAvailabilitySnapshot({
  cities: [{ ref: 'loc.pune', displayName: 'Pune' }],
  services: [{ ref: 'interior-design', displayName: 'Interior Design' }],
  availability: [{ serviceRef: 'interior-design', cityRefs: 'ALL' }],
});

const intelligence = createClientIntelligenceSnapshotV1({
  version: 1,
  behaviour: [{ signalType: 'URGENCY', value: 'NORMAL', confidence: 0.7 }],
  journey: {
    followUpDue: false,
    satisfactionState: 'UNKNOWN',
    serviceRecoveryNeeded: false,
    reassignmentState: 'NONE',
    lifecycleState: 'OPEN',
    vendorsReleased: 0,
    vendorNoContactCount: 0,
    allReleasedVendorsContacted: false,
  },
  opportunities: [],
  nextBestAction: {
    action: 'ASK_MISSING_FIELD',
    reasonCode: 'MATCH_REQUIRED_FIELD_MISSING',
    requiredFieldRef: 'location',
    requiresCoreDecision: false,
    businessEffect: false,
    executionAuthorized: false,
  },
});
function content(clientIntelligence?: typeof intelligence): string {
  return createRiyaConversationModelProfile({
    current,
    availabilitySnapshot,
    ...(clientIntelligence === undefined ? {} : { clientIntelligence }),
  }).buildUserContent({ normalizedText: 'hello', citations: [] } as never);
}

describe('CI-12 advisory intelligence in Riya model context', () => {
  it('keeps the pre-Client-OS payload unchanged when no intelligence is supplied', () => {
    const payload = JSON.parse(content()) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('clientIntelligence');
    expect(content()).toBe(content(undefined));
  });

  it('adds intelligence as a bounded sibling, separate from Core truth and conversation facts', () => {
    const payload = JSON.parse(content(intelligence)) as {
      known: Record<string, unknown>;
      coreAvailability: Record<string, unknown>;
      clientIntelligence: typeof intelligence;
    };
    expect(payload.clientIntelligence).toStrictEqual(intelligence);
    expect(payload.known).toHaveProperty('serviceInterest');
    expect(payload.coreAvailability).toHaveProperty('services');
    const serialized = JSON.stringify(payload.clientIntelligence);
    for (const forbidden of ['profileId', 'clientId', 'phone', 'mobile']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('refuses malformed intelligence before a model request can be built', () => {
    const malformed = {
      ...intelligence,
      nextBestAction: {
        ...intelligence.nextBestAction,
        businessEffect: true,
      },
    } as never;

    expect(() =>
      createRiyaConversationModelProfile({
        current,
        availabilitySnapshot,
        clientIntelligence: malformed,
      }).buildUserContent({ normalizedText: 'hello', citations: [] } as never),
    ).toThrow('client-intelligence-next-best-action-authority-invalid');
  });
});
