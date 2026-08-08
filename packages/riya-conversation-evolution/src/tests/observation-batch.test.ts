/**
 * RWC-P4A — the observation batch contract (ADR-0098 §5).
 *
 * The batch is the only way anything reaches the reducer, so it is where a malformed, duplicated or
 * content-bearing observation has to be refused. Every case here proves a refusal at the boundary
 * rather than a repair inside it.
 */
import { describe, expect, it } from 'vitest';

import {
  RIYA_CONVERSATION_EVOLUTION_ERROR_CODES,
  RIYA_DISCOVERY_OBSERVATION_OPERATIONS,
  RiyaConversationEvolutionError,
  createRiyaConversationObservationBatch,
} from '../index.js';
import { batch, clear, set } from './fixtures.js';

const expectRefusal = (build: () => unknown): void => {
  expect(build).toThrow(RiyaConversationEvolutionError);
  try {
    build();
  } catch (error: unknown) {
    expect((error as RiyaConversationEvolutionError).code).toBe('invalid-observation-batch');
  }
};

describe('(A) the batch contract', () => {
  it('accepts an empty batch — a turn may legitimately learn nothing', () => {
    const empty = batch([]);
    expect(empty.version).toBe(1);
    expect(empty.observations).toEqual([]);
    expect(empty.skipProjectDetails).toBe(false);
  });

  it('accepts one observation, and several about DIFFERENT fields', () => {
    expect(batch([set('serviceInterest', 'user_stated')]).observations).toHaveLength(1);
    expect(
      batch([
        set('serviceInterest', 'user_stated'),
        set('location', 'user_selected'),
        set('budget', 'user_stated'),
        set('timeline', 'user_stated'),
      ]).observations,
    ).toHaveLength(4);
  });

  it('refuses a DUPLICATE field — the whole batch, not a chosen winner', () => {
    // Two observations about one field in one turn is not a merge this reducer should silently
    // resolve: whichever it picked would be a rule nobody wrote down.
    expectRefusal(() =>
      batch([set('budget', 'user_stated', 'a'), set('budget', 'user_confirmed', 'b')]),
    );
  });

  it.each([
    [
      'an unknown field',
      { field: 'favouriteColour', operation: 'SET', value: 'x', provenance: 'user_stated' },
    ],
    [
      'an unknown provenance',
      { field: 'budget', operation: 'SET', value: 'x', provenance: 'guessed' },
    ],
    ['an unknown operation', { field: 'budget', operation: 'DELETE', provenance: 'user_stated' }],
    ['SET with no value', { field: 'budget', operation: 'SET', provenance: 'user_stated' }],
    [
      'CLEAR carrying a value',
      { field: 'budget', operation: 'CLEAR', value: 'x', provenance: 'user_stated' },
    ],
    ['an empty value', { field: 'budget', operation: 'SET', value: '', provenance: 'user_stated' }],
  ])('refuses %s', (_label, observation) => {
    expectRefusal(() =>
      createRiyaConversationObservationBatch({
        version: 1,
        observations: [observation as never],
        skipProjectDetails: false,
      }),
    );
  });

  it.each([
    'evidence',
    'quote',
    'span',
    'confidence',
    'reasoning',
    'messageId',
    'channel',
    'rawText',
    'phone',
    'consent',
  ])('refuses the extra key %s — strict, never stripped', (key) => {
    // An ignored extra key is worse than a refused one: somebody would send it, nothing would
    // complain, and the next reader would assume it mattered.
    expectRefusal(() =>
      createRiyaConversationObservationBatch({
        version: 1,
        observations: [{ ...set('budget', 'user_stated'), [key]: 'x' }],
        skipProjectDetails: false,
      }),
    );
  });

  it('refuses an unknown key on the BATCH itself', () => {
    expectRefusal(() =>
      createRiyaConversationObservationBatch({
        version: 1,
        observations: [],
        skipProjectDetails: false,
        messageId: 'msg.1',
      } as never),
    );
  });

  it('refuses more observations than there are canonical fields', () => {
    expectRefusal(() =>
      createRiyaConversationObservationBatch({
        version: 1,
        observations: Array.from({ length: 8 }, () => set('budget', 'user_stated')),
        skipProjectDetails: false,
      }),
    );
  });

  it('freezes the batch and its observations, and copies the caller array', () => {
    const observations = [set('budget', 'user_stated')];
    const built = batch(observations);
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.observations)).toBe(true);
    expect(Object.isFrozen(built.observations[0])).toBe(true);
    // Mutating what the caller passed must not reach inside the batch.
    observations.push(set('timeline', 'user_stated'));
    expect(built.observations).toHaveLength(1);
  });

  it('exposes exactly the two operations and the four closed error codes', () => {
    expect([...RIYA_DISCOVERY_OBSERVATION_OPERATIONS]).toEqual(['SET', 'CLEAR']);
    expect([...RIYA_CONVERSATION_EVOLUTION_ERROR_CODES]).toEqual([
      'invalid-observation-batch',
      'invalid-state',
      'phase-out-of-scope',
      'revision-exhausted',
    ]);
    expect(Object.isFrozen(RIYA_CONVERSATION_EVOLUTION_ERROR_CODES)).toBe(true);
  });

  it('a CLEAR needs no value and keeps none', () => {
    const built = batch([clear('budget', 'user_confirmed')]);
    expect(Object.hasOwn(built.observations[0] as object, 'value')).toBe(false);
  });

  it('the error message never quotes what failed', () => {
    const secret = 'MY SECRET BUDGET IS 8 LAKH';
    let message = '';
    try {
      createRiyaConversationObservationBatch({
        version: 1,
        observations: [
          { field: 'budget', operation: 'SET', value: secret, provenance: 'nope' } as never,
        ],
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
});
