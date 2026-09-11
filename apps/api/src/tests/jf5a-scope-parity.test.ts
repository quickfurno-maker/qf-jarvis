/**
 * JF-5A — the four agent-scope vocabularies are ONE set, and the five per-agent columns agree.
 *
 * ### Why this test is here and not in one of the packages
 *
 * `model-gateway`, `prompt-registry` and `model-evaluation` each own a closed scope list and each
 * deliberately imports neither of the others: the gateway is the inference boundary, the registry is a
 * leaf mechanism, and the evaluation framework is offline. That duplication is the right trade — it
 * keeps three packages from depending on each other for a five-string list — but it is only SAFE if
 * drift fails loudly somewhere.
 *
 * `apps/api` already depends on all three, plus the runtime and governed-knowledge. So this is the one
 * place every column is visible at once, and holding the parity proof here introduces no package cycle
 * and no new dependency. `resolveAuthoritativePrompt` also checks the gateway/registry pair at RUNTIME;
 * this is the wider, compile-time-visible version of the same rule.
 *
 * ### What drift would actually cause
 *
 * A scope the gateway knows and the registry does not is a prompt that cannot be resolved for an agent
 * the gateway would happily serve — an outage shaped like a refusal. A scope the evaluation framework
 * does not know is worse and quieter: that agent cannot be named in a scenario, so it cannot be
 * evaluated, so it can never honestly earn production evidence. That was exactly Aarohi's position
 * before JF-5A.
 */
import { KNOWLEDGE_AGENT_SCOPES } from '@qf-jarvis/governed-knowledge';
import { MODEL_AGENT_SCOPES } from '@qf-jarvis/model-gateway';
import { EVALUATION_AGENT_SCOPES } from '@qf-jarvis/model-evaluation';
import { PROMPT_AGENT_SCOPES_FROZEN } from '@qf-jarvis/prompt-registry';
import { RUNTIME_ACTORS, RUNTIME_PARTY_TYPES, assignAgent } from '@qf-jarvis/agent-runtime';
import type { RuntimePolicy } from '@qf-jarvis/agent-runtime';
import { describe, expect, it } from 'vitest';

/** The one exact set, written out once. Every vocabulary below must equal this, in this order. */
const EXPECTED_SCOPES = ['CLIENT', 'VENDOR', 'PROSPECT', 'COORDINATION', 'SYSTEM'] as const;

const POLICY = { unknownRouting: 'JARVIS' } as unknown as RuntimePolicy;

describe('JF-5A (A) the scope vocabularies are one set', () => {
  it('(A1,A2,A3) model, prompt and evaluation scopes each include PROSPECT', () => {
    expect([...MODEL_AGENT_SCOPES]).toContain('PROSPECT');
    expect([...PROMPT_AGENT_SCOPES_FROZEN]).toContain('PROSPECT');
    expect([...EVALUATION_AGENT_SCOPES]).toContain('PROSPECT');
  });

  it('(A4) all four vocabularies are EXACTLY equal, order included', () => {
    // Order is contractual in this repository: every one of these is declared as an ordered `as const`
    // tuple and at least one existing lock compares it with `toEqual`. Treating order as incidental
    // here would let two of them hold the same members in a different sequence and call that parity.
    expect([...MODEL_AGENT_SCOPES]).toEqual([...EXPECTED_SCOPES]);
    expect([...PROMPT_AGENT_SCOPES_FROZEN]).toEqual([...EXPECTED_SCOPES]);
    expect([...EVALUATION_AGENT_SCOPES]).toEqual([...EXPECTED_SCOPES]);
    // The governed-knowledge scope came from JF-4 and is the ordering precedent the other three follow.
    expect([...KNOWLEDGE_AGENT_SCOPES]).toEqual([...EXPECTED_SCOPES]);
  });

  it('(A4) no vocabulary carries a duplicate, and all four have the same length', () => {
    for (const [label, scopes] of [
      ['model', MODEL_AGENT_SCOPES],
      ['prompt', PROMPT_AGENT_SCOPES_FROZEN],
      ['evaluation', EVALUATION_AGENT_SCOPES],
      ['knowledge', KNOWLEDGE_AGENT_SCOPES],
    ] as const) {
      expect(new Set(scopes).size, label).toBe(scopes.length);
      expect(scopes.length, label).toBe(EXPECTED_SCOPES.length);
    }
  });

  it('(A8) HUMAN is absent from every one of them', () => {
    // A human turn never reaches a model, a prompt, or a model evaluation. A HUMAN scope would be a
    // place for one to be represented, and the runtime actor list keeps HUMAN precisely so it is NOT.
    for (const [label, scopes] of [
      ['model', MODEL_AGENT_SCOPES],
      ['prompt', PROMPT_AGENT_SCOPES_FROZEN],
      ['evaluation', EVALUATION_AGENT_SCOPES],
      ['knowledge', KNOWLEDGE_AGENT_SCOPES],
    ] as const) {
      expect([...scopes], label).not.toContain('HUMAN');
    }
    expect([...RUNTIME_ACTORS]).toContain('HUMAN');
    // And no actor name leaked into a scope vocabulary: scopes name authority classes, not agents.
    for (const actor of ['RIYA', 'ANISHA', 'AAROHI', 'JARVIS']) {
      expect([...MODEL_AGENT_SCOPES], actor).not.toContain(actor);
      expect([...EVALUATION_AGENT_SCOPES], actor).not.toContain(actor);
    }
  });
});

describe('JF-5A (A) the five columns agree, per agent', () => {
  /**
   * The full per-agent row: the party the router reads, the actor it assigns, and the four scopes that
   * actor then acts under. Written as data so a missing column is a missing field rather than a missing
   * assertion nobody notices.
   */
  const ROWS = [
    { party: 'CLIENT', actor: 'RIYA', scope: 'CLIENT' },
    { party: 'VENDOR', actor: 'ANISHA', scope: 'VENDOR' },
    { party: 'PROSPECT', actor: 'AAROHI', scope: 'PROSPECT' },
  ] as const;

  it('Riya=CLIENT, Anisha=VENDOR, Aarohi=PROSPECT across runtime, knowledge, model, prompt, evaluation', () => {
    for (const row of ROWS) {
      // The router, from the trusted party type. Nothing in this test chooses the actor.
      expect(assignAgent(row.party, false, POLICY), row.party).toBe(row.actor);
      // And that actor's scope exists, by the same name, in every one of the four vocabularies.
      for (const [label, scopes] of [
        ['knowledge', KNOWLEDGE_AGENT_SCOPES],
        ['model', MODEL_AGENT_SCOPES],
        ['prompt', PROMPT_AGENT_SCOPES_FROZEN],
        ['evaluation', EVALUATION_AGENT_SCOPES],
      ] as const) {
        expect([...scopes], `${row.actor}/${label}`).toContain(row.scope);
      }
    }
  });

  it('JARVIS stays COORDINATION and SYSTEM stays SYSTEM, unchanged', () => {
    expect(assignAgent('UNKNOWN', false, POLICY)).toBe('JARVIS');
    for (const scopes of [
      KNOWLEDGE_AGENT_SCOPES,
      MODEL_AGENT_SCOPES,
      PROMPT_AGENT_SCOPES_FROZEN,
      EVALUATION_AGENT_SCOPES,
    ]) {
      expect([...scopes]).toContain('COORDINATION');
      expect([...scopes]).toContain('SYSTEM');
    }
  });

  it('every party type the router accepts maps to an actor with a scope, or to a non-model actor', () => {
    // Totality, so a future party type cannot be added without either a scope or a deliberate decision
    // that it never reaches a model. `UNKNOWN` is the second case: JARVIS serves it under COORDINATION.
    for (const party of RUNTIME_PARTY_TYPES) {
      const actor = assignAgent(party, false, POLICY);
      const row = ROWS.find((candidate) => candidate.actor === actor);
      if (row === undefined) {
        expect([actor], party).toEqual(['JARVIS']);
      } else {
        expect([...MODEL_AGENT_SCOPES], party).toContain(row.scope);
      }
    }
  });
});
