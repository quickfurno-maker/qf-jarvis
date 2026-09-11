/**
 * JF-4C — deterministic three-agent routing (ADR-0150 §5).
 *
 * Matrix B9–B20.
 *
 * ### What is being pinned
 *
 * That adding a third agent did not add a decision. `assignAgent` is still a pure total function of
 * `(partyType, humanTakeover, policy)` — no model, no channel, no text, no score, no network, and no
 * "ask each agent until one answers". A router that could be influenced by any of those would let the
 * question "whose turn is this" be answered by something other than the trusted caller's statement of
 * who the party is.
 */
import { describe, expect, it } from 'vitest';

import { assignAgent } from '../router/assign-agent.js';
import { AI_AGENT_ACTORS, RUNTIME_ACTORS, RUNTIME_PARTY_TYPES } from '../contracts/vocabularies.js';
import { isActorPartyCompatible } from '../contracts/scope.js';
import type { RuntimePolicy } from '../contracts/policy.js';

const JARVIS_POLICY = { unknownRouting: 'JARVIS' } as unknown as RuntimePolicy;
const HUMAN_POLICY = { unknownRouting: 'HUMAN' } as unknown as RuntimePolicy;

describe('JF-4C vocabularies', () => {
  it('(B9,B11) AAROHI and PROSPECT are each ONE closed addition, in a fixed position', () => {
    expect([...RUNTIME_ACTORS]).toEqual(['RIYA', 'ANISHA', 'AAROHI', 'JARVIS', 'HUMAN', 'SYSTEM']);
    expect([...RUNTIME_PARTY_TYPES]).toEqual(['CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN']);
    // Closed, not open: there is no way to name a fourth business agent or a fifth party.
    expect(RUNTIME_ACTORS).toHaveLength(6);
    expect(RUNTIME_PARTY_TYPES).toHaveLength(4);
  });

  it('(B10) AAROHI is AI-agent eligible under the EXISTING semantics, and HUMAN/SYSTEM still are not', () => {
    expect(AI_AGENT_ACTORS.has('AAROHI')).toBe(true);
    expect([...RUNTIME_ACTORS].filter((a) => AI_AGENT_ACTORS.has(a))).toEqual([
      'RIYA',
      'ANISHA',
      'AAROHI',
      'JARVIS',
    ]);
    expect(AI_AGENT_ACTORS.has('HUMAN')).toBe(false);
    expect(AI_AGENT_ACTORS.has('SYSTEM')).toBe(false);
  });

  it('AAROHI is as exclusive as RIYA and ANISHA, in both directions', () => {
    // The scope rule is what stops an acquisition agent acting on a registered relationship and an
    // acquisition prospect being answered by the vendor journey.
    expect(isActorPartyCompatible('AAROHI', 'PROSPECT')).toBe(true);
    for (const party of ['CLIENT', 'VENDOR', 'UNKNOWN'] as const) {
      expect(isActorPartyCompatible('AAROHI', party)).toBe(false);
    }
    expect(isActorPartyCompatible('RIYA', 'PROSPECT')).toBe(false);
    expect(isActorPartyCompatible('ANISHA', 'PROSPECT')).toBe(false);
  });
});

describe('JF-4C deterministic assignment', () => {
  it('(B12,B13,B14) the three business party types reach their three agents', () => {
    expect(assignAgent('CLIENT', false, JARVIS_POLICY)).toBe('RIYA');
    expect(assignAgent('VENDOR', false, JARVIS_POLICY)).toBe('ANISHA');
    expect(assignAgent('PROSPECT', false, JARVIS_POLICY)).toBe('AAROHI');
  });

  it('(B15) UNKNOWN routing is byte-equivalent to the prior policy', () => {
    expect(assignAgent('UNKNOWN', false, JARVIS_POLICY)).toBe('JARVIS');
    expect(assignAgent('UNKNOWN', false, HUMAN_POLICY)).toBe('HUMAN');
  });

  it('(B16,B17,B18) human takeover forces HUMAN for EVERY party type', () => {
    // Takeover is checked before the switch, so a new party type cannot accidentally sit outside it.
    for (const party of RUNTIME_PARTY_TYPES) {
      expect(assignAgent(party, true, JARVIS_POLICY)).toBe('HUMAN');
      expect(assignAgent(party, true, HUMAN_POLICY)).toBe('HUMAN');
    }
  });

  it('(B19,B20) assignment is a pure total function of party, takeover and policy', () => {
    // No model, no channel, no message, no score, no clock, no network. The signature is the proof:
    // there is nothing else to pass. Determinism is asserted over the whole cross-product.
    for (const party of RUNTIME_PARTY_TYPES) {
      for (const takeover of [false, true]) {
        for (const policy of [JARVIS_POLICY, HUMAN_POLICY]) {
          const first = assignAgent(party, takeover, policy);
          for (let i = 0; i < 5; i += 1) {
            expect(assignAgent(party, takeover, policy)).toBe(first);
          }
          // And the assignment is always an actor the scope rule permits for that party.
          expect(isActorPartyCompatible(first, party)).toBe(true);
        }
      }
    }
  });

  it('every assignment is total: no party type falls through to an unintended actor', () => {
    const assigned = RUNTIME_PARTY_TYPES.map(
      (p) => `${p}->${assignAgent(p, false, JARVIS_POLICY)}`,
    );
    expect(assigned).toEqual([
      'CLIENT->RIYA',
      'VENDOR->ANISHA',
      'PROSPECT->AAROHI',
      'UNKNOWN->JARVIS',
    ]);
  });
});
