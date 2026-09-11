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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assignAgent } from '../router/assign-agent.js';
import { createOrchestrationContext } from '../orchestration/contracts.js';
import { RUNTIME_DATA_CLASSES } from '../contracts/vocabularies.js';
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

// ---------------------------------------------------------------------------
// The orchestration context must accept every party the router can assign.
// ---------------------------------------------------------------------------

/** Comments stripped, so a scan cannot match this file's own prose or a doc comment. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const CONTEXT_CONTRACTS = fileURLToPath(new URL('../orchestration/contracts.ts', import.meta.url));

const contextInput = (partyType: string) => ({
  conversationId: 'conv.1',
  tenantId: 'tenant.a',
  partyType: partyType as never,
  dataClass: 'HOSTED_ALLOWED' as const,
  revision: 1,
  humanTakeover: false,
  aiPaused: false,
  cancelled: false,
  subjectRef: undefined,
});

describe('JF-4 correction: the orchestration context and the router share ONE party vocabulary', () => {
  it('accepts every party type the router can assign, PROSPECT included', () => {
    // The gap this closes: `assignAgent` returned AAROHI for PROSPECT while this schema carried its
    // own three-value list, so a real acquisition turn threw `invalid-context` at the second gate and
    // Aarohi was never reached. Every isolated spec passed; no spec ran a whole turn.
    for (const party of RUNTIME_PARTY_TYPES) {
      const context = createOrchestrationContext(contextInput(party));
      expect(context.partyType, party).toBe(party);
      // And the actor the router picks for it is one the scope rule permits.
      expect(isActorPartyCompatible(assignAgent(party, false, JARVIS_POLICY), party), party).toBe(
        true,
      );
    }
  });

  it('accepts every data class, and still refuses an unknown token in either vocabulary', () => {
    for (const dataClass of RUNTIME_DATA_CLASSES) {
      expect(createOrchestrationContext({ ...contextInput('CLIENT'), dataClass }).dataClass).toBe(
        dataClass,
      );
    }
    // Widening the enum to the shared vocabulary did not open it: a token in neither list is refused.
    for (const bad of ['ACQUISITION', 'prospect', 'PROSPECT ', 'LEAD', '']) {
      expect(() => createOrchestrationContext(contextInput(bad)), bad).toThrow();
    }
    expect(() =>
      createOrchestrationContext({
        ...contextInput('CLIENT'),
        dataClass: 'HOSTED' as never,
      }),
    ).toThrow();
  });

  it('respells neither vocabulary as a literal list anywhere in the orchestration contracts', () => {
    // A second list is a vocabulary that drifts, and this is exactly how it drifted. The scan looks
    // for a re-spelled party or data-class enum in CODE, with comments stripped so this file's own
    // explanation cannot satisfy it.
    const code = codeOnly(readFileSync(CONTEXT_CONTRACTS, 'utf8'));
    expect(code).toContain('z.enum(RUNTIME_PARTY_TYPES)');
    expect(code).toContain('z.enum(RUNTIME_DATA_CLASSES)');
    for (const respelled of [
      ['CLIENT', 'VENDOR', 'UNKNOWN'],
      ['CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN'],
      ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'],
    ]) {
      const literal = respelled.map((value) => `'${value}'`).join(', ');
      expect(code, literal).not.toContain(`[${literal}]`);
    }
  });
});
