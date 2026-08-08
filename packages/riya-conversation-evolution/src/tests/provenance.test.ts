/**
 * RWC-P4A — the provenance merge (ADR-0098 §6).
 *
 * The rank order is `model_inferred (1) < server_runtime (2) < user_selected (3) == user_stated (3)
 * < user_confirmed (4)`, and these specs walk the whole truth table rather than sampling it —
 * because the one case nobody tested is the one where a model inference quietly overwrites
 * something a client checked.
 */
import type { RiyaFieldProvenance } from '@qf-jarvis/riya-conversation-continuity';
import { describe, expect, it } from 'vitest';

import { RiyaConversationEvolutionError, evolveRiyaConversation } from '../index.js';
import { batch, clear, set, stateWith, synthetic, valueOf } from './fixtures.js';

const ALL: readonly RiyaFieldProvenance[] = [
  'model_inferred',
  'server_runtime',
  'user_selected',
  'user_stated',
  'user_confirmed',
];
const RANK: Readonly<Record<RiyaFieldProvenance, number>> = {
  model_inferred: 1,
  server_runtime: 2,
  user_selected: 3,
  user_stated: 3,
  user_confirmed: 4,
};

/**
 * A SETTLED conversation: all four summary-required fields known, so the phase is already SUMMARY
 * and stays there.
 *
 * These specs isolate the MERGE. A fixture holding only `budget` would sit at phase `NEED` (no
 * service is known), so every batch would also move the phase and every "no-op" assertion would be
 * measuring the phase reducer instead of the merge rule it names.
 */
const settled = (budgetProvenance: RiyaFieldProvenance) =>
  stateWith({
    phase: 'SUMMARY',
    fields: {
      serviceInterest: 'user_stated',
      location: 'user_stated',
      budget: budgetProvenance,
      timeline: 'user_stated',
    },
  });

describe('(B1) an absent field accepts any provenance', () => {
  it.each(ALL)('initial SET with %s applies', (provenance) => {
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([set('budget', provenance)]),
    });
    expect(result.changed).toBe(true);
    expect(result.appliedFields).toEqual(['budget']);
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget'));
    expect(result.state.fieldProvenance.budget).toBe(provenance);
    expect(result.state.continuityRevision).toBe(1);
  });
});

describe('(B2) SAME value', () => {
  it.each(ALL.flatMap((existing) => ALL.map((incoming) => [existing, incoming] as const)))(
    '%s then %s on an identical value',
    (existing, incoming) => {
      const current = settled(existing);
      const result = evolveRiyaConversation({
        // Same tag ⇒ same value.
        current,
        batch: batch([set('budget', incoming, 'a')]),
      });
      expect(valueOf(result.state, 'budget')).toBe(synthetic('budget', 'a'));

      if (RANK[incoming] > RANK[existing]) {
        // Same fact, told more strongly. Worth recording -- it changes what may overwrite it later.
        expect(result.state.fieldProvenance.budget, `${existing}->${incoming}`).toBe(incoming);
        expect(result.appliedFields).toEqual(['budget']);
        expect(result.changed).toBe(true);
        expect(result.state.continuityRevision).toBe(current.continuityRevision + 1);
      } else {
        // Equal or lower on an identical value is a semantic NO-OP -- and not a rejection either,
        // because nothing was refused: the state already says exactly this.
        expect(result.state.fieldProvenance.budget, `${existing}->${incoming}`).toBe(existing);
        expect(result.appliedFields).toEqual([]);
        expect(result.rejectedFields).toEqual([]);
        expect(result.state.continuityRevision).toBe(current.continuityRevision);
      }
    },
  );
});

describe('(B3) DIFFERENT value', () => {
  it.each(ALL.flatMap((existing) => ALL.map((incoming) => [existing, incoming] as const)))(
    '%s then %s on a conflicting value',
    (existing, incoming) => {
      const current = settled(existing);
      const result = evolveRiyaConversation({
        current,
        batch: batch([set('budget', incoming, 'b')]),
      });

      if (RANK[incoming] >= RANK[existing]) {
        // Higher replaces; EQUAL rank means the LATER observation wins -- two statements of equal
        // standing are a person changing their mind, and the most recent is the one they meant.
        expect(valueOf(result.state, 'budget'), `${existing}->${incoming}`).toBe(
          synthetic('budget', 'b'),
        );
        expect(result.state.fieldProvenance.budget).toBe(incoming);
        expect(result.changed).toBe(true);
      } else {
        expect(valueOf(result.state, 'budget'), `${existing}->${incoming}`).toBe(
          synthetic('budget', 'a'),
        );
        expect(result.state.fieldProvenance.budget).toBe(existing);
        expect(result.rejectedFields).toEqual([{ field: 'budget', reason: 'lower-provenance' }]);
        expect(result.changed).toBe(false);
        expect(result.state.continuityRevision).toBe(current.continuityRevision);
      }
    },
  );

  it('user_confirmed is never overwritten from below, by ANY lower source', () => {
    for (const lower of [
      'model_inferred',
      'server_runtime',
      'user_selected',
      'user_stated',
    ] as const) {
      const result = evolveRiyaConversation({
        current: settled('user_confirmed'),
        batch: batch([set('budget', lower, 'b')]),
      });
      expect(valueOf(result.state, 'budget'), lower).toBe(synthetic('budget', 'a'));
      expect(result.state.fieldProvenance.budget, lower).toBe('user_confirmed');
      expect(result.rejectedFields, lower).toEqual([
        { field: 'budget', reason: 'lower-provenance' },
      ]);
    }
  });

  it('another user_confirmed DOES replace a confirmed value', () => {
    const result = evolveRiyaConversation({
      current: settled('user_confirmed'),
      batch: batch([set('budget', 'user_confirmed', 'b')]),
    });
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget', 'b'));
    expect(result.changed).toBe(true);
  });
});

describe('(B4) CLEAR requires a user origin', () => {
  it.each(['model_inferred', 'server_runtime'] as const)(
    'a %s CLEAR is refused as clear-not-user-origin',
    (provenance) => {
      // Withdrawing a fact is an act only the person who could have stated it may perform. A model
      // that inferred a budget must not be able to delete one.
      const result = evolveRiyaConversation({
        current: settled('user_stated'),
        batch: batch([clear('budget', provenance)]),
      });
      expect(valueOf(result.state, 'budget')).toBe(synthetic('budget'));
      expect(result.rejectedFields).toEqual([{ field: 'budget', reason: 'clear-not-user-origin' }]);
      expect(result.changed).toBe(false);
    },
  );

  it.each(['user_selected', 'user_stated', 'user_confirmed'] as const)(
    'a %s CLEAR removes the value AND its provenance',
    (provenance) => {
      const result = evolveRiyaConversation({
        current: settled('user_selected'),
        batch: batch([clear('budget', provenance)]),
      });
      expect(valueOf(result.state, 'budget')).toBeUndefined();
      // Provenance for a value that is gone would describe nothing, and the contract refuses it.
      expect(result.state.fieldProvenance.budget).toBeUndefined();
      expect(result.changed).toBe(true);
    },
  );

  it('the rank rule still applies to a CLEAR: user_stated cannot clear a confirmed value', () => {
    const result = evolveRiyaConversation({
      current: settled('user_confirmed'),
      batch: batch([clear('budget', 'user_stated')]),
    });
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget'));
    expect(result.rejectedFields).toEqual([{ field: 'budget', reason: 'lower-provenance' }]);
  });

  it('user_confirmed CAN clear a confirmed value', () => {
    const result = evolveRiyaConversation({
      current: settled('user_confirmed'),
      batch: batch([clear('budget', 'user_confirmed')]),
    });
    expect(valueOf(result.state, 'budget')).toBeUndefined();
    expect(result.changed).toBe(true);
  });

  it('clearing an already-absent field is a no-op, not a rejection', () => {
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([clear('budget', 'user_stated')]),
    });
    expect(result.changed).toBe(false);
    expect(result.rejectedFields).toEqual([]);
    expect(result.appliedFields).toEqual([]);
  });
});

describe('(C) origin semantics, and what this package refuses to know', () => {
  it('provenance is taken from the observation and never re-derived', () => {
    // The producer decides the ORIGIN. A model that parsed the literal words "budget is 8 lakh" has
    // not inferred anything -- the client stated it -- so a caller may legitimately label a
    // model-produced observation `user_stated`, and this package must honour it at rank 3.
    const result = evolveRiyaConversation({
      current: settled('server_runtime'),
      batch: batch([set('budget', 'user_stated', 'b')]),
    });
    expect(result.state.fieldProvenance.budget).toBe('user_stated');
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget', 'b'));
  });

  it('the result carries no field VALUE anywhere', () => {
    const result = evolveRiyaConversation({
      current: settled('user_confirmed'),
      batch: batch([set('budget', 'model_inferred', 'b')]),
    });
    // The rejected update's value must not travel with the rejection.
    expect(JSON.stringify(result.rejectedFields)).not.toContain(synthetic('budget', 'b'));
    expect(Object.keys(result.rejectedFields[0] as object).sort()).toEqual(['field', 'reason']);
  });

  it('neither input is mutated, and the result is frozen', () => {
    const current = settled('user_stated');
    const before = JSON.stringify(current);
    const input = batch([set('timeline', 'user_stated')]);
    const beforeBatch = JSON.stringify(input);
    const result = evolveRiyaConversation({ current, batch: input });
    expect(JSON.stringify(current)).toBe(before);
    expect(JSON.stringify(input)).toBe(beforeBatch);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.questionPlan)).toBe(true);
  });

  it('a rejected field does not corrupt the rest of the batch', () => {
    const result = evolveRiyaConversation({
      current: settled('user_confirmed'),
      batch: batch([
        set('budget', 'model_inferred', 'b'),
        // A DIFFERENT tag, so this is a genuine change rather than a restatement of what the
        // settled fixture already holds.
        set('timeline', 'user_stated', 'b'),
      ]),
    });
    expect(result.rejectedFields).toEqual([{ field: 'budget', reason: 'lower-provenance' }]);
    expect(result.appliedFields).toEqual(['timeline']);
    expect(valueOf(result.state, 'budget')).toBe(synthetic('budget', 'a'));
    expect(valueOf(result.state, 'timeline')).toBe(synthetic('timeline', 'b'));
  });

  it('an oversized value is refused by the CANONICAL bound, as an invalid batch', () => {
    // The batch's own bound is deliberately loose; the authoritative per-field bounds stay in
    // `riya-agent` and are applied when the merged discovery is rebuilt.
    expect(() =>
      evolveRiyaConversation({
        current: stateWith(),
        batch: batch([
          { field: 'scope', operation: 'SET', value: 'x'.repeat(2048), provenance: 'user_stated' },
        ]),
      }),
    ).toThrow(RiyaConversationEvolutionError);
  });
});
