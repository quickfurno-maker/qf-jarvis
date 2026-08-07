/**
 * The persistence codec (RWC-P2B, ADR-0095). Database-free.
 *
 * These prove the exact thing the owner correction is about: the constructed runtime state is NOT its
 * own valid input, and the codec is the explicit boundary that reconciles that with a single stored
 * JSONB envelope. A naive `JSON.stringify(state)` -> parse -> construct would throw; encode -> parse ->
 * construct restores the canonical state byte-for-byte.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { describe, expect, it } from 'vitest';

import { decodeContinuityState, encodeContinuityState } from '../internal/codec.js';
import {
  fullyDiscoveredState,
  initialState,
  stateForPhase,
  summaryReadyState,
} from './fixtures.js';

/** The stored envelope is `encode(state)` after a JSONB round trip: stringify then parse. */
function throughJson(state: RiyaConversationContinuityStateV1): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(encodeContinuityState(state as unknown as Record<string, unknown>)),
  ) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('the constructor asymmetry the codec exists for', () => {
  it('(1) a constructed state carries behaviourVersion, which the strict input refuses', () => {
    const state = fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 2 });
    // The OUTPUT shape carries the artefact...
    expect(asRecord(state.discovery)['behaviourVersion']).toBe(1);

    // ...and feeding the OUTPUT straight back to the constructor is refused, which is the whole reason
    // a naive `JSON.stringify(state)` persistence contract would produce unreadable rows.
    expect(() => createRiyaConversationContinuityState(state as never)).toThrow();
  });

  it('(2) the encoder drops behaviourVersion and every undefined-valued key', () => {
    const state = initialState('tenant.a', 'conv.1');
    const encoded = throughJson(state);
    const discovery = asRecord(encoded['discovery']);

    expect(discovery['behaviourVersion']).toBeUndefined();
    // No key is present with an explicit undefined/null value: absence is how "not discovered" is said.
    for (const [, value] of Object.entries(discovery)) {
      expect(value).not.toBeUndefined();
      expect(value).not.toBeNull();
    }
  });

  it('(3) encode -> JSON -> constructor restores the canonical state exactly', () => {
    const state = fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 2 });
    const restored = createRiyaConversationContinuityState(throughJson(state) as never);
    expect(restored).toStrictEqual(state);
    // And the artefact is re-stamped on construction, so the round trip is lossless in both directions.
    expect(asRecord(restored.discovery)['behaviourVersion']).toBe(1);
  });
});

describe('every state family survives encode -> JSON -> decode', () => {
  const cases: readonly (readonly [string, RiyaConversationContinuityStateV1])[] = [
    ['INTRO', initialState('tenant.a', 'conv.intro')],
    ['SUMMARY unconfirmed', summaryReadyState('tenant.a', 'conv.su', { summaryConfirmed: false })],
    [
      'SUMMARY confirmed',
      summaryReadyState('tenant.a', 'conv.sc', { phase: 'CONTACT', summaryConfirmed: true }),
    ],
    ['CONTACT', stateForPhase('tenant.a', 'conv.contact', 'CONTACT')],
    ['CONSENT', stateForPhase('tenant.a', 'conv.consent', 'CONSENT')],
    ['COMPLETE with evidence', stateForPhase('tenant.a', 'conv.complete', 'COMPLETE')],
    ['every discovery value + provenance', fullyDiscoveredState('tenant.a', 'conv.full')],
    [
      'optional fields absent + missing fields listed',
      summaryReadyState('tenant.a', 'conv.partial'),
    ],
  ];

  for (const [label, state] of cases) {
    it(`(4) ${label} round-trips through the codec`, () => {
      const decoded = decodeContinuityState({
        stateJson: throughJson(state),
        tenantId: state.tenantId,
        conversationId: state.conversationId,
        continuityRevision: state.continuityRevision,
      });
      expect(decoded).toStrictEqual(state);
    });
  }
});

describe('decode refuses what it cannot trust', () => {
  const state = summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 3 });
  const envelope = throughJson(state);

  it('(5) refuses a non-object envelope', () => {
    for (const bad of [undefined, null, 'a string', 42, ['array']]) {
      expect(() =>
        decodeContinuityState({
          stateJson: bad,
          tenantId: 'tenant.a',
          conversationId: 'conv.1',
          continuityRevision: 3,
        }),
      ).toThrow();
    }
  });

  it('(6) refuses an envelope whose identity or revision disagrees with the columns', () => {
    // The envelope is valid, but each cross-check column is wrong in turn.
    for (const mismatch of [
      { tenantId: 'tenant.b', conversationId: 'conv.1', continuityRevision: 3 },
      { tenantId: 'tenant.a', conversationId: 'conv.2', continuityRevision: 3 },
      { tenantId: 'tenant.a', conversationId: 'conv.1', continuityRevision: 4 },
    ]) {
      expect(() => decodeContinuityState({ stateJson: envelope, ...mismatch })).toThrow();
    }
  });

  it('(7) accepts the envelope when every cross-check agrees', () => {
    expect(
      decodeContinuityState({
        stateJson: envelope,
        tenantId: 'tenant.a',
        conversationId: 'conv.1',
        continuityRevision: 3,
      }),
    ).toStrictEqual(state);
  });
});
