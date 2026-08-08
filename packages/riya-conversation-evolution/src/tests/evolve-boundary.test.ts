/**
 * RWC-P4A — the public `evolveRiyaConversation` trust boundary (ADR-0098 §4, §5).
 *
 * `createRiyaConversationObservationBatch` proves a batch is well formed. Nothing forces a caller to
 * use it: `evolveRiyaConversation` is exported, so an untyped or JSON-fed caller can hand it a
 * forged object directly, and **a TypeScript interface is not a runtime trust boundary**.
 *
 * Every case here goes through the exported reducer with a batch that never met the constructor, and
 * proves the reducer re-proves it. The duplicate-field case is the load-bearing one: the
 * constructor's contract is that a duplicate refuses the ENTIRE batch, and a reducer that merged a
 * forged batch one observation at a time would instead silently pick a winner.
 */
import { describe, expect, it } from 'vitest';

import { RiyaConversationEvolutionError, evolveRiyaConversation } from '../index.js';
import type { RiyaConversationObservationBatchV1 } from '../index.js';
import { batch, set, stateWith, synthetic, valueOf } from './fixtures.js';

/** Invoke the exported reducer with a batch that never went through the constructor. */
const evolveForged = (forged: unknown): unknown =>
  evolveRiyaConversation({
    current: stateWith(),
    batch: forged as RiyaConversationObservationBatchV1,
  });

const expectRefusal = (forged: unknown, label: string): void => {
  expect(() => evolveForged(forged), label).toThrow(RiyaConversationEvolutionError);
  try {
    evolveForged(forged);
  } catch (error: unknown) {
    expect((error as RiyaConversationEvolutionError).code, label).toBe('invalid-observation-batch');
  }
};

describe('the exported reducer re-proves the batch it is handed', () => {
  it('refuses a forged DUPLICATE-field batch, whole, rather than picking a winner', () => {
    // The constructor refuses the entire batch on a duplicate. Merging sequentially would apply the
    // first and then let the second overwrite or lose on rank -- a resolution nobody specified.
    expectRefusal(
      {
        version: 1,
        observations: [
          {
            field: 'budget',
            operation: 'SET',
            value: 'synthetic budget a',
            provenance: 'user_stated',
          },
          {
            field: 'budget',
            operation: 'SET',
            value: 'synthetic budget b',
            provenance: 'user_confirmed',
          },
        ],
        skipProjectDetails: false,
      },
      'duplicate field',
    );
  });

  it.each([
    [
      'an extra observation key',
      {
        version: 1,
        observations: [
          {
            field: 'budget',
            operation: 'SET',
            value: 'x',
            provenance: 'user_stated',
            confidence: 0.9,
          },
        ],
        skipProjectDetails: false,
      },
    ],
    [
      'an extra batch key',
      { version: 1, observations: [], skipProjectDetails: false, messageId: 'msg.1' },
    ],
    [
      'an unknown field',
      {
        version: 1,
        observations: [
          { field: 'favouriteColour', operation: 'SET', value: 'x', provenance: 'user_stated' },
        ],
        skipProjectDetails: false,
      },
    ],
    [
      'an unknown provenance',
      {
        version: 1,
        observations: [{ field: 'budget', operation: 'SET', value: 'x', provenance: 'guessed' }],
        skipProjectDetails: false,
      },
    ],
    [
      'an unknown operation',
      {
        version: 1,
        observations: [{ field: 'budget', operation: 'DELETE', provenance: 'user_stated' }],
        skipProjectDetails: false,
      },
    ],
    [
      'a SET with no value',
      {
        version: 1,
        observations: [{ field: 'budget', operation: 'SET', provenance: 'user_stated' }],
        skipProjectDetails: false,
      },
    ],
    [
      'a CLEAR carrying a value',
      {
        version: 1,
        observations: [
          { field: 'budget', operation: 'CLEAR', value: 'x', provenance: 'user_stated' },
        ],
        skipProjectDetails: false,
      },
    ],
    [
      'a non-boolean skipProjectDetails',
      { version: 1, observations: [], skipProjectDetails: 'yes' },
    ],
    ['a wrong version', { version: 2, observations: [], skipProjectDetails: false }],
    [
      'observations that are not an array',
      { version: 1, observations: 'none', skipProjectDetails: false },
    ],
  ])('refuses a forged batch with %s', (label, forged) => {
    expectRefusal(forged, label);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'batch'],
    ['a number', 7],
    ['an array', []],
    ['an empty object', {}],
  ])('refuses %s with a BOUNDED error, never a raw TypeError', (label, forged) => {
    // A caller that gets `Cannot read properties of undefined` back has been handed an internal
    // detail; a caller that gets `invalid-observation-batch` has been told what was wrong.
    expect(() => evolveForged(forged), label).toThrow(RiyaConversationEvolutionError);
    expect(() => evolveForged(forged), label).not.toThrow(TypeError);
    expectRefusal(forged, label);
  });

  it('the refusal quotes nothing the caller sent', () => {
    const secret = 'MY SECRET BUDGET';
    let message = '';
    try {
      evolveForged({
        version: 1,
        observations: [{ field: 'budget', operation: 'SET', value: secret, provenance: 'nope' }],
        skipProjectDetails: false,
      });
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('SECRET');
    for (const forbidden of ['zod', 'expected', 'received', 'budget']) {
      expect(message.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('a legitimate constructor-produced batch is unaffected', () => {
    // Canonicalizing must be a re-proof, not a second transformation.
    const result = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([set('serviceInterest', 'user_stated')]),
    });
    expect(result.changed).toBe(true);
    expect(result.appliedFields).toEqual(['serviceInterest']);
    expect(valueOf(result.state, 'serviceInterest')).toBe(synthetic('serviceInterest'));
    expect(result.state.continuityRevision).toBe(1);
  });

  it('a well-formed FORGED batch is accepted, and gives the same answer as a built one', () => {
    // The boundary re-proves; it does not reject everything that did not come from the constructor.
    const forged = evolveRiyaConversation({
      current: stateWith(),
      batch: {
        version: 1,
        observations: [
          {
            field: 'serviceInterest',
            operation: 'SET',
            value: synthetic('serviceInterest'),
            provenance: 'user_stated',
          },
        ],
        skipProjectDetails: false,
      },
    });
    const built = evolveRiyaConversation({
      current: stateWith(),
      batch: batch([set('serviceInterest', 'user_stated')]),
    });
    expect(JSON.stringify(forged)).toBe(JSON.stringify(built));
  });

  it('an invalid STATE is still refused with its own distinct code', () => {
    // The two boundaries stay separable: a bad batch is not reported as a bad state.
    expect(() =>
      evolveRiyaConversation({
        current: { version: 1, tenantId: '' } as never,
        batch: batch([]),
      }),
    ).toThrow(RiyaConversationEvolutionError);
    try {
      evolveRiyaConversation({ current: { version: 1, tenantId: '' } as never, batch: batch([]) });
    } catch (error: unknown) {
      expect((error as RiyaConversationEvolutionError).code).toBe('invalid-state');
    }
  });
});
