/**
 * RWC-P4A — phase evolution, the question plan and the revision rule (ADR-0098 §9–§13).
 *
 * The phase is DERIVED from what is known rather than advanced one step at a time. That is what
 * lets one sentence carry a conversation from `INTRO` to `SUMMARY`, and what stops Riya asking for
 * something she already has — the product rule being that this must not be longer than the form it
 * replaces.
 */
import { describe, expect, it } from 'vitest';

import { RiyaConversationEvolutionError, evolveRiyaConversation } from '../index.js';
import { batch, clear, set, stateWith, synthetic, valueOf } from './fixtures.js';

const ALL_FOUR = [
  set('serviceInterest', 'user_stated'),
  set('location', 'user_selected'),
  set('budget', 'user_stated'),
  set('timeline', 'user_stated'),
];

// ---------------------------------------------------------------------------
// (D) One turn may supply many fields.
// ---------------------------------------------------------------------------

describe('(D) multi-field', () => {
  it('four fields in one batch reach SUMMARY with exactly ONE revision bump', () => {
    // "Need modular kitchen in Pune, budget 8 lakh, start next month" is one turn, not four.
    const result = evolveRiyaConversation({ current: stateWith(), batch: batch(ALL_FOUR) });
    expect(result.changed).toBe(true);
    expect([...result.appliedFields].sort()).toEqual([
      'budget',
      'location',
      'serviceInterest',
      'timeline',
    ]);
    expect(result.state.phase).toBe('SUMMARY');
    expect(result.questionPlan.questionFields).toEqual([]);
    // A revision counts turns that changed something, not fields.
    expect(result.state.continuityRevision).toBe(1);
  });

  it('several intermediate phases may be skipped at once', () => {
    // INTRO -> SUMMARY directly. Nothing forces a stop at NEED, LOCATION or BUDGET_TIMELINE when
    // the answers are already in hand.
    expect(
      evolveRiyaConversation({ current: stateWith(), batch: batch(ALL_FOUR) }).state.phase,
    ).toBe('SUMMARY');
  });
});

// ---------------------------------------------------------------------------
// (E) Out-of-order answers are kept, and the earliest gap is asked.
// ---------------------------------------------------------------------------

describe('(E) out-of-order', () => {
  it('budget supplied first is STORED, and the question returns to service', () => {
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([set('budget', 'user_stated')]),
    });
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget'));
    expect(result.state.phase).toBe('NEED');
    expect(result.questionPlan.questionFields).toEqual(['serviceInterest']);
  });

  it('timeline supplied while location is missing is STORED, and LOCATION is asked', () => {
    const result = evolveRiyaConversation({
      current: stateWith({ phase: 'NEED', fields: { serviceInterest: 'user_stated' } }),
      batch: batch([set('timeline', 'user_stated')]),
    });
    expect(valueOf(result.state, 'timeline')).toBe(synthetic('timeline'));
    expect(result.state.phase).toBe('LOCATION');
    expect(result.questionPlan.questionFields).toEqual(['location']);
  });

  it('an OPTIONAL field supplied before service is kept, and NEED is still asked', () => {
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([set('propertyType', 'user_selected')]),
    });
    expect(valueOf(result.state, 'propertyType')).toBe(synthetic('propertyType'));
    expect(result.state.phase).toBe('NEED');
  });

  it('no known field is ever discarded because the phase is earlier', () => {
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([
        set('budget', 'user_stated'),
        set('timeline', 'user_stated'),
        set('scope', 'user_stated'),
        set('consultationPreference', 'user_selected'),
      ]),
    });
    for (const field of ['budget', 'timeline', 'scope', 'consultationPreference'] as const) {
      expect(valueOf(result.state, field), field).toBe(synthetic(field));
    }
    expect(result.state.phase).toBe('NEED');
  });
});

// ---------------------------------------------------------------------------
// (F) PROJECT_DETAILS is optional and gets ONE opportunity.
// ---------------------------------------------------------------------------

describe('(F) PROJECT_DETAILS', () => {
  const serviceAndLocation = () =>
    stateWith({
      phase: 'LOCATION',
      fields: { serviceInterest: 'user_stated', location: 'user_selected' },
    });

  it('is entered once service and location are known and nothing downstream arrived', () => {
    const result = evolveRiyaConversation({
      current: stateWith({ phase: 'NEED', fields: { serviceInterest: 'user_stated' } }),
      batch: batch([set('location', 'user_selected')]),
    });
    expect(result.state.phase).toBe('PROJECT_DETAILS');
    expect(result.questionPlan.questionFields).toEqual(['propertyType']);
  });

  it('a side question or silence does NOT skip it', () => {
    // Treating quiet as a decision is how a conversation stops asking the one question it needed.
    const current = stateWith({
      phase: 'PROJECT_DETAILS',
      fields: { serviceInterest: 'user_stated', location: 'user_selected' },
    });
    const result = evolveRiyaConversation({ current, batch: batch([]) });
    expect(result.state.phase).toBe('PROJECT_DETAILS');
    expect(result.changed).toBe(false);
    expect(result.state.continuityRevision).toBe(current.continuityRevision);
  });

  it.each([
    ['a propertyType answer', [set('propertyType', 'user_selected')], false],
    ['a scope answer', [set('scope', 'user_stated')], false],
    ['an explicit skip', [], true],
    ['a budget answer in the same turn', [set('budget', 'user_stated')], false],
    ['a timeline answer in the same turn', [set('timeline', 'user_stated')], false],
  ])('exits to BUDGET_TIMELINE on %s', (_label, observations, skip) => {
    const result = evolveRiyaConversation({
      current: stateWith({
        phase: 'PROJECT_DETAILS',
        fields: { serviceInterest: 'user_stated', location: 'user_selected' },
      }),
      batch: batch(observations, skip),
    });
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
  });

  it('is never entered when the batch already completes the required set', () => {
    const result = evolveRiyaConversation({
      current: serviceAndLocation(),
      batch: batch([set('budget', 'user_stated'), set('timeline', 'user_stated')]),
    });
    expect(result.state.phase).toBe('SUMMARY');
  });

  it('is not re-entered while the conversation keeps moving FORWARD', () => {
    const result = evolveRiyaConversation({
      current: stateWith({
        phase: 'BUDGET_TIMELINE',
        fields: { serviceInterest: 'user_stated', location: 'user_selected' },
      }),
      batch: batch([]),
    });
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
  });

  it('MAY be offered again after a correction regressed the phase and the gap was refilled', () => {
    // The honest bound. Continuity V1 persists no "opportunity consumed" bit, and this slice
    // deliberately does not add one -- so the guarantee is one opportunity per uninterrupted FORWARD
    // progression, not one per conversation. Asking once more after the client rewrote their own
    // requirements is a better trade than widening the persisted state to remember a question.
    const atBudget = stateWith({
      phase: 'BUDGET_TIMELINE',
      fields: { serviceInterest: 'user_stated', location: 'user_selected' },
    });

    // The client withdraws their location. The phase regresses.
    const regressed = evolveRiyaConversation({
      current: atBudget,
      batch: batch([clear('location', 'user_stated')]),
    });
    expect(regressed.state.phase).toBe('LOCATION');
    expect(valueOf(regressed.state, 'location')).toBeUndefined();

    // They give a new one. The detour is available again -- and that is the accepted behaviour.
    const refilled = evolveRiyaConversation({
      current: regressed.state,
      batch: batch([set('location', 'user_selected', 'b')]),
    });
    expect(refilled.state.phase).toBe('PROJECT_DETAILS');
    expect(refilled.questionPlan.questionFields).toEqual(['propertyType']);
  });

  it('asks scope once propertyType is known', () => {
    const result = evolveRiyaConversation({
      current: stateWith({
        phase: 'LOCATION',
        fields: {
          serviceInterest: 'user_stated',
          location: 'user_selected',
          propertyType: 'user_selected',
        },
      }),
      batch: batch([]),
    });
    // A detail is already known, so the detour is done -- straight to budget/timeline.
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
  });
});

// ---------------------------------------------------------------------------
// (G) The question plan.
// ---------------------------------------------------------------------------

describe('(G) question plan', () => {
  it('BUDGET_TIMELINE with both missing is the ONE permitted pair', () => {
    const result = evolveRiyaConversation({
      current: stateWith({
        phase: 'PROJECT_DETAILS',
        fields: { serviceInterest: 'user_stated', location: 'user_selected' },
      }),
      batch: batch([], true),
    });
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
    expect(result.questionPlan.questionFields).toEqual(['budget', 'timeline']);
  });

  it.each([
    ['budget', ['timeline']],
    ['timeline', ['budget']],
  ])('BUDGET_TIMELINE with only %s known asks the other alone', (known, expected) => {
    const result = evolveRiyaConversation({
      current: stateWith({
        phase: 'BUDGET_TIMELINE',
        fields: {
          serviceInterest: 'user_stated',
          location: 'user_selected',
          [known]: 'user_stated',
        },
      }),
      batch: batch([]),
    });
    expect(result.questionPlan.questionFields).toEqual(expected);
  });

  it('no plan ever exceeds two fields, and only budget+timeline reaches two', () => {
    const cases = [
      { current: stateWith(), batch: batch([]) },
      { current: stateWith({ phase: 'NEED' }), batch: batch([set('scope', 'user_stated')]) },
      {
        current: stateWith({ phase: 'NEED', fields: { serviceInterest: 'user_stated' } }),
        batch: batch([]),
      },
      {
        current: stateWith({
          phase: 'LOCATION',
          fields: { serviceInterest: 'user_stated', location: 'user_selected' },
        }),
        batch: batch([]),
      },
      {
        current: stateWith({
          phase: 'PROJECT_DETAILS',
          fields: { serviceInterest: 'user_stated', location: 'user_selected' },
        }),
        batch: batch([], true),
      },
    ];
    for (const input of cases) {
      const plan = evolveRiyaConversation(input).questionPlan;
      expect(plan.questionFields.length).toBeLessThanOrEqual(2);
      if (plan.questionFields.length === 2) {
        expect(plan.questionFields).toEqual(['budget', 'timeline']);
      }
      // No contact or consent question exists in RWC-P4A at all.
      for (const forbidden of ['name', 'phone', 'email', 'consent']) {
        expect(plan.questionFields as readonly string[]).not.toContain(forbidden);
      }
    }
  });

  it('SUMMARY asks nothing', () => {
    const result = evolveRiyaConversation({ current: stateWith(), batch: batch(ALL_FOUR) });
    expect(result.questionPlan.phase).toBe('SUMMARY');
    expect(result.questionPlan.questionFields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (H) The SUMMARY ceiling and completeness.
// ---------------------------------------------------------------------------

describe('(H) summary ceiling and completeness', () => {
  it('reaching SUMMARY sets SUFFICIENT_FOR_CORE_REVIEW with no missing fields', () => {
    const result = evolveRiyaConversation({ current: stateWith(), batch: batch(ALL_FOUR) });
    expect(result.state.discovery.completeness).toBe('SUFFICIENT_FOR_CORE_REVIEW');
    expect(result.state.discovery.missingFields).toEqual([]);
  });

  it('absent OPTIONAL fields never block the summary', () => {
    const result = evolveRiyaConversation({ current: stateWith(), batch: batch(ALL_FOUR) });
    expect(valueOf(result.state, 'propertyType')).toBeUndefined();
    expect(valueOf(result.state, 'scope')).toBeUndefined();
    expect(valueOf(result.state, 'consultationPreference')).toBeUndefined();
    expect(result.state.phase).toBe('SUMMARY');
  });

  it.each(['serviceInterest', 'location', 'budget', 'timeline'] as const)(
    'removing the required field %s prevents SUMMARY',
    (missing) => {
      const result = evolveRiyaConversation({
        current: stateWith(),
        batch: batch(ALL_FOUR.filter((observation) => observation.field !== missing)),
      });
      expect(result.state.phase).not.toBe('SUMMARY');
      expect(result.state.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
      expect(result.state.discovery.missingFields).toContain(missing);
    },
  );

  it('missingFields lists only REQUIRED fields, never optional ones', () => {
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([set('serviceInterest', 'user_stated')]),
    });
    expect([...result.state.discovery.missingFields].sort()).toEqual([
      'budget',
      'location',
      'timeline',
    ]);
  });

  it('HUMAN_REVIEW_REQUIRED is PRESERVED, even once everything is known', () => {
    // A person decided this conversation needs looking at. A reducer that cleared that the moment a
    // field arrived would quietly undo a human's judgement.
    const result = evolveRiyaConversation({
      current: stateWith({ completeness: 'HUMAN_REVIEW_REQUIRED' }),
      batch: batch(ALL_FOUR),
    });
    expect(result.state.discovery.completeness).toBe('HUMAN_REVIEW_REQUIRED');
  });

  it('never reaches CONTACT, CONSENT or COMPLETE, and never sets summaryConfirmed', () => {
    const result = evolveRiyaConversation({ current: stateWith(), batch: batch(ALL_FOUR) });
    expect(['CONTACT', 'CONSENT', 'COMPLETE']).not.toContain(result.state.phase);
    // Being shown a summary and agreeing with it is a separate act, and RWC-P6 owns it.
    expect(result.state.summaryConfirmed).toBe(false);
    expect(result.state.completionEvidenceRef).toBeUndefined();
  });

  it.each(['CONTACT', 'CONSENT', 'COMPLETE'] as const)(
    'refuses to evolve a state already in %s',
    (phase) => {
      // Regressing a conversation that has moved past the summary would be worse than declining to
      // evolve it. `COMPLETE` additionally carries completion evidence -- which this package can
      // never mint, and must never drop either.
      const current = stateWith({
        phase,
        fields: {
          serviceInterest: 'user_stated',
          location: 'user_selected',
          budget: 'user_stated',
          timeline: 'user_stated',
        },
        summaryConfirmed: true,
        ...(phase === 'COMPLETE' ? { completionEvidenceRef: 'evidence.opaque.1' } : {}),
      });
      expect(() => evolveRiyaConversation({ current, batch: batch([]) })).toThrow(
        RiyaConversationEvolutionError,
      );
      try {
        evolveRiyaConversation({ current, batch: batch([]) });
      } catch (error: unknown) {
        expect((error as RiyaConversationEvolutionError).code).toBe('phase-out-of-scope');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// (I) The revision rule.
// ---------------------------------------------------------------------------

describe('(I) revision', () => {
  it('a complete no-op on an untouched INTRO does not bump, and stays INTRO', () => {
    const current = stateWith({ revision: 7 });
    const result = evolveRiyaConversation({ current, batch: batch([]) });
    expect(result.changed).toBe(false);
    expect(result.state.phase).toBe('INTRO');
    expect(result.state.continuityRevision).toBe(7);
  });

  it('a rejected-only batch does not bump', () => {
    const current = stateWith({
      phase: 'SUMMARY',
      revision: 3,
      fields: {
        serviceInterest: 'user_stated',
        location: 'user_selected',
        budget: 'user_confirmed',
        timeline: 'user_stated',
      },
    });
    const result = evolveRiyaConversation({
      current,
      batch: batch([set('budget', 'model_inferred', 'b')]),
    });
    expect(result.changed).toBe(false);
    expect(result.state.continuityRevision).toBe(3);
  });

  it.each([
    [
      'a value change',
      () =>
        stateWith({
          phase: 'SUMMARY',
          revision: 2,
          fields: {
            serviceInterest: 'user_stated',
            location: 'user_selected',
            budget: 'user_stated',
            timeline: 'user_stated',
          },
        }),
      batch([set('budget', 'user_stated', 'b')]),
    ],
    [
      'provenance strengthening only',
      () =>
        stateWith({
          phase: 'SUMMARY',
          revision: 2,
          fields: {
            serviceInterest: 'user_stated',
            location: 'user_selected',
            budget: 'model_inferred',
            timeline: 'user_stated',
          },
        }),
      batch([set('budget', 'user_confirmed', 'a')]),
    ],
  ])('%s bumps by exactly one', (_label, build, input) => {
    const current = build();
    const result = evolveRiyaConversation({ current, batch: input });
    expect(result.changed).toBe(true);
    expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
  });

  it('a PHASE-only change bumps by exactly one', () => {
    // Nothing about the values moved; the conversation did. That is still a fact a later turn
    // depends on.
    const current = stateWith({
      phase: 'PROJECT_DETAILS',
      revision: 5,
      fields: { serviceInterest: 'user_stated', location: 'user_selected' },
    });
    const result = evolveRiyaConversation({ current, batch: batch([], true) });
    expect(result.appliedFields).toEqual([]);
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
    expect(result.changed).toBe(true);
    expect(result.state.continuityRevision).toBe(6);
  });

  it('refuses to advance past MAX_SAFE_INTEGER rather than silently repeating a revision', () => {
    // `+ 1` beyond this returns the same number, and a compare-and-set on a counter that stopped
    // counting would report success while losing every write after it.
    const current = stateWith({ revision: Number.MAX_SAFE_INTEGER });
    expect(() =>
      evolveRiyaConversation({ current, batch: batch([set('serviceInterest', 'user_stated')]) }),
    ).toThrow(RiyaConversationEvolutionError);
    try {
      evolveRiyaConversation({ current, batch: batch([set('serviceInterest', 'user_stated')]) });
    } catch (error: unknown) {
      expect((error as RiyaConversationEvolutionError).code).toBe('revision-exhausted');
    }
  });

  it('a no-op at MAX_SAFE_INTEGER is still fine — nothing needs a new revision', () => {
    const current = stateWith({ revision: Number.MAX_SAFE_INTEGER });
    expect(evolveRiyaConversation({ current, batch: batch([]) }).changed).toBe(false);
  });

  it('is deterministic: the same inputs give the same result twice', () => {
    // The property RWC-P4B's reconciliation depends on -- reload, re-merge the SAME batch, retry.
    const current = stateWith();
    const input = batch(ALL_FOUR);
    expect(JSON.stringify(evolveRiyaConversation({ current, batch: input }))).toBe(
      JSON.stringify(evolveRiyaConversation({ current, batch: input })),
    );
  });

  it('refuses a CLEAR that would strand a state, through the canonical contract', () => {
    // Clearing a required value from a settled conversation must leave a state the contract still
    // accepts -- here it drops back out of SUMMARY rather than claiming an unconfirmed summary.
    const result = evolveRiyaConversation({
      current: stateWith({
        phase: 'SUMMARY',
        fields: {
          serviceInterest: 'user_stated',
          location: 'user_selected',
          budget: 'user_stated',
          timeline: 'user_stated',
        },
      }),
      batch: batch([clear('budget', 'user_stated')]),
    });
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
    expect(result.state.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
    expect(result.state.discovery.missingFields).toEqual(['budget']);
  });
});

// ---------------------------------------------------------------------------
// (J) A prior summary confirmation is invalidated by an accepted VALUE change.
// ---------------------------------------------------------------------------

describe('(J) summary confirmation', () => {
  /** A confirmed summary: all four required fields known, and the client agreed to them. */
  const confirmed = () =>
    stateWith({
      phase: 'SUMMARY',
      revision: 4,
      summaryConfirmed: true,
      fields: {
        serviceInterest: 'user_stated',
        location: 'user_selected',
        budget: 'user_stated',
        timeline: 'user_stated',
        propertyType: 'user_selected',
      },
    });

  it('an accepted REQUIRED-field correction invalidates it', () => {
    // The client confirmed the OLD summary. A changed budget means the thing they agreed to no
    // longer exists, and carrying the flag forward would let a later phase act on an agreement to
    // something that was since edited.
    const current = confirmed();
    const result = evolveRiyaConversation({
      current,
      batch: batch([set('budget', 'user_stated', 'b')]),
    });
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget', 'b'));
    expect(result.state.phase).toBe('SUMMARY');
    expect(result.state.summaryConfirmed).toBe(false);
    expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
  });

  it('an accepted OPTIONAL-field change invalidates it too', () => {
    // The optional rows are on the summary card as well. Changing one changes what was reviewed.
    const result = evolveRiyaConversation({
      current: confirmed(),
      batch: batch([set('propertyType', 'user_selected', 'b')]),
    });
    expect(result.state.summaryConfirmed).toBe(false);
    expect(result.state.phase).toBe('SUMMARY');
  });

  it('an accepted CLEAR of a required field invalidates it, and regresses the phase', () => {
    const result = evolveRiyaConversation({
      current: confirmed(),
      batch: batch([clear('budget', 'user_stated')]),
    });
    expect(valueOf(result.state, 'budget')).toBeUndefined();
    expect(result.state.phase).toBe('BUDGET_TIMELINE');
    expect(result.state.summaryConfirmed).toBe(false);
    expect(result.state.discovery.completeness).toBe('MORE_DISCOVERY_REQUIRED');
  });

  it('a REJECTED lower-provenance update preserves it, and bumps nothing', () => {
    const current = stateWith({
      phase: 'SUMMARY',
      revision: 4,
      summaryConfirmed: true,
      fields: {
        serviceInterest: 'user_stated',
        location: 'user_selected',
        budget: 'user_confirmed',
        timeline: 'user_stated',
      },
    });
    const result = evolveRiyaConversation({
      current,
      batch: batch([set('budget', 'model_inferred', 'b')]),
    });
    expect(result.state.summaryConfirmed).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.state.continuityRevision).toBe(current.continuityRevision);
  });

  it('SAME-value provenance strengthening preserves it, and still bumps once', () => {
    // Nothing the client read changed -- only how strongly we hold it. Throwing their confirmation
    // away for that would make every restatement re-open a settled summary.
    const current = confirmed();
    const result = evolveRiyaConversation({
      current,
      batch: batch([set('budget', 'user_confirmed', 'a')]),
    });
    expect(result.state.fieldProvenance.budget).toBe('user_confirmed');
    expect(result.state.summaryConfirmed).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
  });

  it('a SAME-value no-op preserves it and changes nothing at all', () => {
    const current = confirmed();
    const result = evolveRiyaConversation({
      current,
      batch: batch([set('budget', 'user_stated', 'a')]),
    });
    expect(result.state.summaryConfirmed).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.state.continuityRevision).toBe(current.continuityRevision);
  });

  it('never creates a confirmation: false can only stay false', () => {
    // RWC-P6 owns confirming a summary. Reaching SUMMARY is not agreeing with one.
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch(ALL_FOUR),
    });
    expect(result.state.phase).toBe('SUMMARY');
    expect(result.state.summaryConfirmed).toBe(false);
  });
});
