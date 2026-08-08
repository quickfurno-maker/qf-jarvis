/**
 * RWC-P4B — the Riya structured-output profile (ADR-0099 §34).
 *
 * Three questions, and this file answers all three:
 *
 * 1. **What does the model get to see?** The current conversation, minimised: present discovery
 *    values with their provenance, the phase, `summaryConfirmed`, and the message. No identity, no
 *    contact detail, no business authority, no transcript — and deterministically serialized, so the
 *    same turn produces byte-identical content every time.
 * 2. **What is the model allowed to say?** A strict reply plus bounded observations, with a
 *    provenance vocabulary NARROWER than the reducer's: prose is not a chip tap, and an inference may
 *    neither confirm a fact nor withdraw one.
 * 3. **Who decides?** The RWC-P4A reducer. The model returns a CLAIMED question plan so the one-call
 *    answer can be checked against what the reducer independently decides; a disagreement refuses the
 *    whole answer rather than trusting either side.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import {
  createRiyaConversationModelProfile,
  MAX_RIYA_REPLY_BODY_CHARS,
  MAX_RIYA_USER_CONTENT_CHARS,
  parseRiyaModelProfileDetail,
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
} from '../index.js';
import type { RiyaModelProfileDetailV1 } from '../index.js';

const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

function state(
  over: Partial<Parameters<typeof createRiyaConversationContinuityState>[0]> = {},
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: 0,
    phase: 'INTRO',
    discovery: {
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
    },
    summaryConfirmed: false,
    ...over,
  });
}

/** Evolve a fresh conversation by one batch — the shortest way to a realistic non-INTRO state. */
function after(
  observations: readonly { field: string; value: string }[],
  from: RiyaConversationContinuityStateV1 = state(),
): RiyaConversationContinuityStateV1 {
  return evolveRiyaConversation({
    current: from,
    batch: {
      version: 1,
      observations: observations.map((o) => ({
        field: o.field,
        operation: 'SET',
        value: o.value,
        provenance: 'user_stated',
      })) as never,
      skipProjectDetails: false,
    },
  }).state;
}

const profileFor = (current: RiyaConversationContinuityStateV1) =>
  createRiyaConversationModelProfile({ current });

const userContent = (
  current: RiyaConversationContinuityStateV1,
  message: string | undefined,
): string => profileFor(current).buildUserContent({ normalizedText: message } as never);

/** The reply half of a well-formed answer. */
const REPLY = {
  kind: 'REPLY',
  replyBody: 'Happy to help — could you tell me a little more?',
  citations: [],
} as const;

/**
 * A complete model answer whose claimed plan is the one the reducer actually decides.
 *
 * Computed rather than typed out: hand-written expectations here would be a second copy of the phase
 * table, and the whole point of the agreement check is that there is only one.
 */
function answerFor(
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
  over: { readonly skipProjectDetails?: boolean } = {},
): Record<string, unknown> {
  const skipProjectDetails = over.skipProjectDetails ?? false;
  const decided = evolveRiyaConversation({
    current,
    batch: { version: 1, observations: observations as never, skipProjectDetails },
  });
  return {
    reply: REPLY,
    evolution: {
      version: 1,
      observations,
      skipProjectDetails,
      questionPlan: {
        phase: decided.questionPlan.phase,
        questionFields: [...decided.questionPlan.questionFields],
      },
    },
  };
}

const SET = (
  field: string,
  value: string,
  provenance = 'user_stated',
): Record<string, unknown> => ({
  field,
  operation: 'SET',
  value,
  provenance,
});

// ---------------------------------------------------------------------------
// INPUT PROJECTION
// ---------------------------------------------------------------------------

describe('what the model is shown', () => {
  it('is deterministic JSON: the same turn produces byte-identical content', () => {
    const current = after([
      { field: 'serviceInterest', value: 'modular-kitchen' },
      { field: 'location', value: 'loc.pune' },
    ]);
    expect(userContent(current, 'hello')).toBe(userContent(current, 'hello'));
    // Parseable, and versioned.
    expect(JSON.parse(userContent(current, 'hello'))).toMatchObject({ version: 1 });
  });

  it('carries only fields the conversation actually knows', () => {
    const current = after([{ field: 'serviceInterest', value: 'modular-kitchen' }]);
    const payload = JSON.parse(userContent(current, 'hi')) as {
      known: Record<string, unknown>;
    };
    expect(Object.keys(payload.known)).toStrictEqual(['serviceInterest']);
  });

  it('sends each value WITH its provenance, never a bare value', () => {
    const current = after([{ field: 'budget', value: 'around 8 lakh' }]);
    const payload = JSON.parse(userContent(current, 'hi')) as {
      known: Record<string, { value: string; provenance: string }>;
    };
    // A value without its origin would invite the model to overwrite something a person confirmed as
    // though it were its own earlier guess.
    expect(payload.known['budget']).toStrictEqual({
      value: 'around 8 lakh',
      provenance: 'user_stated',
    });
  });

  it('carries the phase, the summary confirmation and the current message', () => {
    const current = after([
      { field: 'serviceInterest', value: 'modular-kitchen' },
      { field: 'location', value: 'loc.pune' },
    ]);
    const payload = JSON.parse(userContent(current, 'and my budget is 8 lakh')) as {
      phase: string;
      summaryConfirmed: boolean;
      message: string;
    };
    expect(payload.phase).toBe(current.phase);
    expect(payload.summaryConfirmed).toBe(false);
    expect(payload.message).toBe('and my budget is 8 lakh');
  });

  it('an absent message is the empty string, never a fabricated one', () => {
    const payload = JSON.parse(userContent(state(), undefined)) as { message: string };
    expect(payload.message).toBe('');
  });

  it('omits the derived values, so the model cannot reason from a stale copy', () => {
    // `missingFields` and `completeness` are computable from what IS sent. Sending them would give
    // the model a second, possibly disagreeing, account of the same thing.
    const content = userContent(after([{ field: 'location', value: 'loc.pune' }]), 'hi');
    expect(content).not.toContain('missingFields');
    expect(content).not.toContain('completeness');
  });

  it('carries no identity, contact detail, business authority or transcript', () => {
    const current = after([
      { field: 'serviceInterest', value: 'modular-kitchen' },
      { field: 'location', value: 'loc.pune' },
      { field: 'budget', value: 'around 8 lakh' },
      { field: 'timeline', value: 'next month' },
    ]);
    const content = userContent(current, 'hi').toLowerCase();
    for (const forbidden of [
      TENANT,
      CONVERSATION,
      'tenantid',
      'conversationid',
      'messageid',
      'subjectref',
      'phone',
      'email',
      'consent',
      'cansubmit',
      'lead',
      'vendor',
      'package',
      'price',
      'payment',
      'completionevidence',
      'transcript',
      'history',
      'continuityrevision',
    ]) {
      expect({ forbidden, present: content.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('refuses to send more than the hard bound, rather than truncating', () => {
    // Truncation would send the model a silently DIFFERENT conversation from the one the reducer is
    // about to judge its answer against.
    const huge = 'x'.repeat(MAX_RIYA_USER_CONTENT_CHARS + 1);
    expect(() => userContent(state(), huge)).toThrow();
  });

  it('a payload at the bound is still sent', () => {
    const current = state();
    const overhead = userContent(current, '').length;
    const fits = 'y'.repeat(MAX_RIYA_USER_CONTENT_CHARS - overhead);
    expect(userContent(current, fits).length).toBe(MAX_RIYA_USER_CONTENT_CHARS);
  });
});

// ---------------------------------------------------------------------------
// OUTPUT SCHEMA
// ---------------------------------------------------------------------------

describe('what the model is allowed to say', () => {
  const current = state();
  const project = (value: unknown): unknown => profileFor(current).projectStructuredResult(value);

  it('accepts a well-formed answer', () => {
    const answer = answerFor(current, [SET('serviceInterest', 'modular-kitchen')]);
    expect(project(answer)).toBeDefined();
  });

  const refused: Record<string, unknown> = {
    'a non-object': 'nope',
    'an unknown outer key': {
      ...answerFor(current, [SET('location', 'loc.pune')]),
      confidence: 0.9,
    },
    'a reasoning / chain-of-thought key': {
      ...answerFor(current, [SET('location', 'loc.pune')]),
      reasoning: 'first I considered',
    },
    'a contact key': {
      ...answerFor(current, [SET('location', 'loc.pune')]),
      contact: { phone: '99999' },
    },
    'a consent key': {
      ...answerFor(current, [SET('location', 'loc.pune')]),
      consent: true,
    },
    'a business-authority key': {
      ...answerFor(current, [SET('location', 'loc.pune')]),
      canSubmit: true,
    },
    'a summary confirmation the model tried to mint': {
      ...answerFor(current, [SET('location', 'loc.pune')]),
      summaryConfirmed: true,
    },
  };
  for (const [label, value] of Object.entries(refused)) {
    it(`refuses ${label}`, () => {
      expect(project(value)).toBeUndefined();
    });
  }

  it('refuses an unknown key nested inside the reply', () => {
    const answer = answerFor(current, [SET('location', 'loc.pune')]);
    expect(project({ ...answer, reply: { ...REPLY, sendNow: true } })).toBeUndefined();
  });

  it('refuses an unknown key nested inside the evolution', () => {
    const answer = answerFor(current, [SET('location', 'loc.pune')]) as {
      evolution: Record<string, unknown>;
    };
    expect(
      project({ ...answer, evolution: { ...answer.evolution, confidence: 0.5 } }),
    ).toBeUndefined();
  });

  it('refuses two observations about the SAME field', () => {
    // The producer is the only party that knows which of the two it meant, so the whole batch goes.
    const answer = answerFor(current, [SET('location', 'loc.pune')]) as {
      evolution: Record<string, unknown>;
    };
    expect(
      project({
        ...answer,
        evolution: {
          ...answer.evolution,
          observations: [SET('location', 'loc.pune'), SET('location', 'loc.mumbai')],
        },
      }),
    ).toBeUndefined();
  });

  it('refuses an invalid field and an invalid operation', () => {
    const base = answerFor(current, [SET('location', 'loc.pune')]) as {
      evolution: Record<string, unknown>;
    };
    for (const observation of [
      { field: 'astrologicalSign', operation: 'SET', value: 'leo', provenance: 'user_stated' },
      { field: 'location', operation: 'DELETE', value: 'loc.pune', provenance: 'user_stated' },
    ]) {
      expect(
        project({
          ...base,
          evolution: { ...base.evolution, observations: [observation] },
        }),
      ).toBeUndefined();
    }
  });

  for (const forbidden of ['user_selected', 'server_runtime', 'user_confirmed']) {
    it(`refuses ${forbidden}: a model may not claim that origin`, () => {
      // The reducer accepts five origins because many producers may exist. A MODEL may emit two.
      const base = answerFor(current, [SET('location', 'loc.pune')]) as {
        evolution: Record<string, unknown>;
      };
      expect(
        project({
          ...base,
          evolution: {
            ...base.evolution,
            observations: [SET('location', 'loc.pune', forbidden)],
          },
        }),
      ).toBeUndefined();
    });
  }

  it('refuses a CLEAR that claims model_inferred: an inference may not withdraw a fact', () => {
    const known = after([{ field: 'budget', value: 'around 8 lakh' }]);
    const base = answerFor(known, []) as { evolution: Record<string, unknown> };
    expect(
      createRiyaConversationModelProfile({ current: known }).projectStructuredResult({
        ...base,
        evolution: {
          ...base.evolution,
          observations: [{ field: 'budget', operation: 'CLEAR', provenance: 'model_inferred' }],
        },
      }),
    ).toBeUndefined();
  });

  it('accepts a CLEAR the client themselves stated', () => {
    const known = after([{ field: 'budget', value: 'around 8 lakh' }]);
    const observations = [{ field: 'budget', operation: 'CLEAR', provenance: 'user_stated' }];
    const answer = answerFor(known, observations);
    expect(
      createRiyaConversationModelProfile({ current: known }).projectStructuredResult(answer),
    ).toBeDefined();
  });

  it('bounds the Riya reply body below the generic budget', () => {
    const answer = answerFor(current, [SET('location', 'loc.pune')]);
    const oversize = {
      ...answer,
      reply: { ...REPLY, replyBody: 'x'.repeat(MAX_RIYA_REPLY_BODY_CHARS + 1) },
    };
    expect(project(oversize)).toBeUndefined();
    // The whole answer now carries observations and a plan beside the reply; shrinking Riya's body
    // is the right side to give rather than widening the budget for every agent.
    expect(MAX_RIYA_REPLY_BODY_CHARS).toBeLessThan(8192);
  });
});

// ---------------------------------------------------------------------------
// AGREEMENT WITH THE RWC-P4A REDUCER
// ---------------------------------------------------------------------------

describe('the reducer decides; the model only claims', () => {
  const current = state();

  it('accepts a claim that matches exactly', () => {
    expect(
      profileFor(current).projectStructuredResult(
        answerFor(current, [SET('serviceInterest', 'modular-kitchen')]),
      ),
    ).toBeDefined();
  });

  it('refuses a wrong phase', () => {
    const answer = answerFor(current, [SET('serviceInterest', 'modular-kitchen')]) as {
      evolution: { questionPlan: { phase: string; questionFields: string[] } };
    };
    const wrong = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: { ...answer.evolution.questionPlan, phase: 'SUMMARY' },
      },
    };
    expect(profileFor(current).projectStructuredResult(wrong)).toBeUndefined();
  });

  it('refuses a wrong question field', () => {
    const answer = answerFor(current, [SET('serviceInterest', 'modular-kitchen')]) as {
      evolution: { questionPlan: { phase: string; questionFields: string[] } };
    };
    const wrong = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: { ...answer.evolution.questionPlan, questionFields: ['propertyType'] },
      },
    };
    expect(profileFor(current).projectStructuredResult(wrong)).toBeUndefined();
  });

  it('refuses an EXTRA question beside the right one', () => {
    const answer = answerFor(current, [SET('serviceInterest', 'modular-kitchen')]) as {
      evolution: { questionPlan: { phase: string; questionFields: string[] } };
    };
    const wrong = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: {
          ...answer.evolution.questionPlan,
          questionFields: [...answer.evolution.questionPlan.questionFields, 'scope'],
        },
      },
    };
    expect(profileFor(current).projectStructuredResult(wrong)).toBeUndefined();
  });

  it('refuses the RIGHT questions in the WRONG order', () => {
    // Reach a state whose plan is the one permitted pair, then swap it.
    const known = after([
      { field: 'serviceInterest', value: 'modular-kitchen' },
      { field: 'location', value: 'loc.pune' },
    ]);
    const answer = answerFor(known, [], { skipProjectDetails: true }) as {
      evolution: { questionPlan: { phase: string; questionFields: string[] } };
    };
    const fields = answer.evolution.questionPlan.questionFields;
    expect(fields).toStrictEqual(['budget', 'timeline']);
    const swapped = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: { ...answer.evolution.questionPlan, questionFields: [...fields].reverse() },
      },
    };
    // `['budget','timeline']` and `['timeline','budget']` are different questions to ask, and
    // accepting either would make the plan advisory rather than checkable.
    expect(
      createRiyaConversationModelProfile({ current: known }).projectStructuredResult(swapped),
    ).toBeUndefined();
  });

  it('a summary-ready turn claims no further question', () => {
    const answer = answerFor(current, [
      SET('serviceInterest', 'modular-kitchen'),
      SET('location', 'loc.pune'),
      SET('budget', 'around 8 lakh'),
      SET('timeline', 'next month'),
    ]) as { evolution: { questionPlan: { phase: string; questionFields: string[] } } };

    // One message supplying all four facts reaches SUMMARY in ONE turn, and nothing is left to ask.
    expect(answer.evolution.questionPlan.phase).toBe('SUMMARY');
    expect(answer.evolution.questionPlan.questionFields).toStrictEqual([]);
    expect(profileFor(current).projectStructuredResult(answer)).toBeDefined();

    // And a claim that SUMMARY still has a question is refused by the same comparison.
    const wrong = {
      ...answer,
      evolution: {
        ...answer.evolution,
        questionPlan: { phase: 'SUMMARY', questionFields: ['scope'] },
      },
    };
    expect(profileFor(current).projectStructuredResult(wrong)).toBeUndefined();
  });

  it('an out-of-order observation still matches the earliest missing question', () => {
    // The client volunteered a budget before anyone asked what they wanted built.
    const answer = answerFor(current, [SET('budget', 'around 8 lakh')]) as {
      evolution: { questionPlan: { questionFields: string[] } };
    };
    expect(answer.evolution.questionPlan.questionFields).toStrictEqual(['serviceInterest']);
    expect(profileFor(current).projectStructuredResult(answer)).toBeDefined();
  });

  it('the PROJECT_DETAILS decision is the reducer’s, and the claim must match it', () => {
    const known = after([
      { field: 'serviceInterest', value: 'modular-kitchen' },
      { field: 'location', value: 'loc.pune' },
    ]);
    const asked = answerFor(known, []) as { evolution: { questionPlan: { phase: string } } };
    const skipped = answerFor(known, [], { skipProjectDetails: true }) as {
      evolution: { questionPlan: { phase: string } };
    };
    // An explicit decline changes what comes next; silence does not.
    expect(asked.evolution.questionPlan.phase).not.toBe(skipped.evolution.questionPlan.phase);
    const p = createRiyaConversationModelProfile({ current: known });
    expect(p.projectStructuredResult(asked)).toBeDefined();
    expect(p.projectStructuredResult(skipped)).toBeDefined();
  });

  it('a state past the RWC-P4A ceiling produces no batch at all', () => {
    // The runtime refuses CONTACT/CONSENT/COMPLETE before a model is ever reached. This is the
    // second line: even if one were somehow projected, the reducer refuses and the answer dies here.
    const beyond = createRiyaConversationContinuityState({
      version: 1,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      continuityRevision: 4,
      phase: 'CONTACT',
      discovery: {
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        missingFields: [],
        serviceInterestRef: 'modular-kitchen',
        locationRef: 'loc.pune',
        budgetNote: 'around 8 lakh',
        timelineNote: 'next month',
      },
      // A value must carry its origin; the state contract refuses a discovery whose provenance map
      // disagrees with it.
      fieldProvenance: {
        serviceInterest: 'user_stated',
        location: 'user_stated',
        budget: 'user_stated',
        timeline: 'user_stated',
      },
      summaryConfirmed: true,
    });
    const answer = {
      reply: REPLY,
      evolution: {
        version: 1,
        observations: [SET('budget', 'more like 12 lakh')],
        skipProjectDetails: false,
        questionPlan: { phase: 'SUMMARY', questionFields: [] },
      },
    };
    expect(
      createRiyaConversationModelProfile({ current: beyond }).projectStructuredResult(answer),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// THE DETAIL
// ---------------------------------------------------------------------------

describe('the detail that crosses back through the generic seam', () => {
  const current = state();

  it('is exactly a version and a canonical observation batch', () => {
    const projected = profileFor(current).projectStructuredResult(
      answerFor(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    const detail = projected?.detail as RiyaModelProfileDetailV1;
    expect(Object.keys(detail).sort()).toStrictEqual(['observationBatch', 'version']);
    expect(detail.version).toBe(1);
    expect(Object.keys(detail.observationBatch).sort()).toStrictEqual([
      'observations',
      'skipProjectDetails',
      'version',
    ]);
  });

  it('is frozen, batch and observations included', () => {
    const projected = profileFor(current).projectStructuredResult(
      answerFor(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    const detail = projected?.detail as RiyaModelProfileDetailV1;
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.observationBatch)).toBe(true);
    expect(Object.isFrozen(detail.observationBatch.observations)).toBe(true);
    expect(Object.isFrozen(detail.observationBatch.observations[0])).toBe(true);
  });

  it('carries no reply body, raw result, continuity or message', () => {
    const projected = profileFor(current).projectStructuredResult(
      answerFor(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    const serialized = JSON.stringify(projected?.detail);
    for (const forbidden of [
      REPLY.replyBody,
      'reply',
      'citations',
      'phase',
      'summaryConfirmed',
      'questionPlan',
      TENANT,
      CONVERSATION,
    ]) {
      expect({ forbidden, present: serialized.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the parser re-proves a detail rather than trusting one', () => {
    const projected = profileFor(current).projectStructuredResult(
      answerFor(current, [SET('serviceInterest', 'modular-kitchen')]),
    );
    expect(parseRiyaModelProfileDetail(projected?.detail)).toBeDefined();

    for (const forged of [
      undefined,
      null,
      'nope',
      { version: 2, observationBatch: { version: 1, observations: [], skipProjectDetails: false } },
      { version: 1 },
      { version: 1, observationBatch: 'nope' },
      // A forged batch with a duplicate field: the constructor refuses the whole thing.
      {
        version: 1,
        observationBatch: {
          version: 1,
          observations: [SET('location', 'loc.pune'), SET('location', 'loc.mumbai')],
          skipProjectDetails: false,
        },
      },
      // A forged batch claiming an origin no model may claim.
      {
        version: 1,
        observationBatch: {
          version: 1,
          observations: [SET('location', 'loc.pune', 'not-a-provenance')],
          skipProjectDetails: false,
        },
      },
    ]) {
      expect(parseRiyaModelProfileDetail(forged)).toBeUndefined();
    }
  });
});

describe('the dedicated task class', () => {
  it('is its own value, distinct from ordinary response generation', () => {
    expect(RIYA_CONVERSATION_EVOLUTION_TASK_CLASS).toBe('RIYA_CONVERSATION_EVOLUTION');
    // A prompt is resolved by task class among other things, so sharing one with the ordinary reply
    // path would let this slice silently reuse a prompt nobody evaluated for it.
    expect(RIYA_CONVERSATION_EVOLUTION_TASK_CLASS).not.toBe('RESPONSE_GENERATION');
  });
});
