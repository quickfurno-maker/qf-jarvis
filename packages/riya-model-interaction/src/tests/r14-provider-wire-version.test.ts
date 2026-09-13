/** JF-5B-R14: provider wire omits protocol bookkeeping; canonical semantics keep version 1. */
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { createRiyaConversationModelProfile } from '../profile.js';
import { riyaProviderWireSchema, riyaStructuredOutputSchema } from '../internal/output-schema.js';

const current = createRiyaConversationContinuityState({
  version: 1,
  tenantId: 'tenant.r14',
  conversationId: 'conv.r14',
  continuityRevision: 0,
  phase: 'INTRO',
  discovery: {
    completeness: 'MORE_DISCOVERY_REQUIRED',
    missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
  },
  summaryConfirmed: false,
});

const snapshot = syntheticAvailabilitySnapshot({
  cities: [{ ref: 'loc.pune', displayName: 'Pune' }],
  services: [{ ref: 'modular-kitchen', displayName: 'Modular Kitchen' }],
  availability: [{ serviceRef: 'modular-kitchen', cityRefs: 'ALL' }],
});

const decided = evolveRiyaConversation({
  current,
  batch: { version: 1, observations: [], skipProjectDetails: false },
});

const wire = {
  reply: { kind: 'REPLY', replyBody: 'How can I help?', reasonCode: null, citations: [] },
  evolution: {
    observations: { sets: [], clears: [] },
    skipProjectDetails: false,
    questionPlan: {
      phase: decided.questionPlan.phase,
      questionFields: [...decided.questionPlan.questionFields],
    },
  },
} as const;

describe('JF-5B-R14 Riya provider-wire protocol version repair', () => {
  it('provider wire accepts the reviewed answer without evolution.version', () => {
    expect(riyaProviderWireSchema.safeParse(wire).success).toBe(true);
  });

  it('provider wire refuses a model-minted evolution.version as an extra key', () => {
    expect(
      riyaProviderWireSchema.safeParse({
        ...wire,
        evolution: { ...wire.evolution, version: 1 },
      }).success,
    ).toBe(false);
  });

  it('canonical semantic schema still requires exactly version 1', () => {
    expect(riyaStructuredOutputSchema.safeParse(wire).success).toBe(false);
    expect(
      riyaStructuredOutputSchema.safeParse({
        ...wire,
        evolution: { version: 1, ...wire.evolution },
      }).success,
    ).toBe(true);
    expect(
      riyaStructuredOutputSchema.safeParse({
        ...wire,
        evolution: { version: 2, ...wire.evolution },
      }).success,
    ).toBe(false);
  });

  it('projection injects canonical version 1 and preserves the existing detail contract', () => {
    const projected = createRiyaConversationModelProfile({
      current,
      availabilitySnapshot: snapshot,
    }).projectStructuredResult(wire);
    expect(projected).toBeDefined();
    expect(projected?.reply.replyBody).toBe('How can I help?');
    expect(projected?.detail).toMatchObject({
      version: 1,
      observationBatch: { version: 1, observations: [], skipProjectDetails: false },
    });
  });
});
