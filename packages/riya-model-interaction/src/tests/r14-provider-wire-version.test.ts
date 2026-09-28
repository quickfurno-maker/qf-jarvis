/** JF-5B-R30: flat provider wire; canonical semantics remain nested and versioned. */
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { createRiyaConversationModelProfile } from '../profile.js';
import { riyaProviderWireSchema, riyaStructuredOutputSchema } from '../internal/output-schema.js';

const current = createRiyaConversationContinuityState({
  version: 1,
  tenantId: 'tenant.r30',
  conversationId: 'conv.r30',
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
  observations: { sets: [], clears: [] },
  projectDetails: 'KEEP',
  questionPhase: decided.questionPlan.phase,
  questionFields: [...decided.questionPlan.questionFields],
} as const;

describe('JF-5B-R30 Riya flat provider wire', () => {
  it('accepts the flat provider representation', () => {
    expect(riyaProviderWireSchema.safeParse(wire).success).toBe(true);
  });

  it('refuses the old nested evolution object on the provider wire', () => {
    expect(
      riyaProviderWireSchema.safeParse({
        ...wire,
        evolution: {
          observations: wire.observations,
          skipProjectDetails: false,
          questionPlan: {
            phase: wire.questionPhase,
            questionFields: wire.questionFields,
          },
        },
      }).success,
    ).toBe(false);
  });

  it('canonical semantic schema remains nested and requires protocol version 1', () => {
    expect(riyaStructuredOutputSchema.safeParse(wire).success).toBe(false);
    expect(
      riyaStructuredOutputSchema.safeParse({
        reply: wire.reply,
        evolution: {
          version: 1,
          observations: wire.observations,
          skipProjectDetails: false,
          questionPlan: {
            phase: wire.questionPhase,
            questionFields: wire.questionFields,
          },
        },
      }).success,
    ).toBe(true);
  });

  it('projection reconstructs canonical version, boolean and question plan', () => {
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

  it('maps SKIP back to the canonical boolean without widening the contract', () => {
    const skippedDecision = evolveRiyaConversation({
      current,
      batch: { version: 1, observations: [], skipProjectDetails: true },
    });
    const projected = createRiyaConversationModelProfile({
      current,
      availabilitySnapshot: snapshot,
    }).projectStructuredResult({
      ...wire,
      projectDetails: 'SKIP',
      questionPhase: skippedDecision.questionPlan.phase,
      questionFields: [...skippedDecision.questionPlan.questionFields],
    });
    expect(projected?.detail).toMatchObject({
      observationBatch: { skipProjectDetails: true },
    });
  });
});
