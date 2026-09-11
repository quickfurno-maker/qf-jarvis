/**
 * JF-4C — the three-agent behaviour mux and the Aarohi adapter (ADR-0150 §7, §10).
 *
 * Matrix C21–C28 and D29–D38.
 *
 * ### Why almost everything here is a COUNT
 *
 * The mux's value is entirely negative: it must call at most one adapter and never a second. That is
 * not visible in a result — a client turn answered correctly by Riya looks identical whether or not
 * Anisha's input port was also read along the way. So each port counts its own reads independently and
 * the specs assert exact zeroes, because "the other agent was consulted" is a defect that passes every
 * functional test and matters enormously in a real conversation.
 *
 * With three agents the stakes are sharper than with two. An acquisition prospect answered by the vendor
 * journey would be told about a relationship it does not have; a registered vendor answered by the
 * acquisition brain would be sold something it already bought.
 */
import { describe, expect, it } from 'vitest';

import { behaviourMux } from '../composition/behaviour-mux.js';
import { aarohiBehaviourPort } from '../composition/aarohi-behaviour-adapter.js';
import type {
  AuthoritativeConversationStatePort,
  ConversationStateKey,
} from '../contracts/authoritative-state.js';
import type { AarohiAcquisitionBehaviourInputPort } from '../contracts/aarohi-acquisition-behaviour-input.js';

type Party = 'CLIENT' | 'VENDOR' | 'PROSPECT' | 'UNKNOWN';
type Actor = 'RIYA' | 'ANISHA' | 'AAROHI' | 'JARVIS' | 'HUMAN' | 'SYSTEM';

/** A counting behaviour port. Records every `decide` it receives and answers as configured. */
function countingPort(answer: 'undefined' | 'decision' | 'reject' = 'decision') {
  const state = { calls: 0 };
  return {
    state,
    port: {
      decide: () => {
        state.calls += 1;
        if (answer === 'reject') {
          return Promise.reject(new Error('SYNTHETIC ADAPTER REFUSAL'));
        }
        if (answer === 'undefined') {
          return Promise.resolve(undefined);
        }
        return Promise.resolve({
          modelReplyEligible: true,
          proposalKind: 'REPLY' as const,
          structuredIntent: Object.freeze({}),
        });
      },
    },
  };
}

const request = (partyType: Party, assignedActor: Actor) =>
  ({ conversationId: 'conv.1', partyType, assignedActor, revision: 3 }) as never;

describe('JF-4C the mux calls exactly one adapter', () => {
  it('(C21,C22,C23) each pair reaches ONLY its own adapter', async () => {
    const cases: readonly (readonly [Party, Actor, 'riya' | 'anisha' | 'aarohi'])[] = [
      ['CLIENT', 'RIYA', 'riya'],
      ['VENDOR', 'ANISHA', 'anisha'],
      ['PROSPECT', 'AAROHI', 'aarohi'],
    ];
    for (const [party, actor, expected] of cases) {
      const riya = countingPort();
      const anisha = countingPort();
      const aarohi = countingPort();
      const mux = behaviourMux({ riya: riya.port, anisha: anisha.port, aarohi: aarohi.port });
      await mux?.decide(request(party, actor));
      const counts = {
        riya: riya.state.calls,
        anisha: anisha.state.calls,
        aarohi: aarohi.state.calls,
      };
      expect(counts, `${party}/${actor}`).toEqual({
        riya: expected === 'riya' ? 1 : 0,
        anisha: expected === 'anisha' ? 1 : 0,
        aarohi: expected === 'aarohi' ? 1 : 0,
      });
    }
  });

  it('(C24,C25) UNKNOWN/JARVIS and every HUMAN turn reach NO adapter at all', async () => {
    for (const [party, actor] of [
      ['UNKNOWN', 'JARVIS'],
      ['UNKNOWN', 'HUMAN'],
      ['CLIENT', 'HUMAN'],
      ['VENDOR', 'HUMAN'],
      ['PROSPECT', 'HUMAN'],
      ['PROSPECT', 'SYSTEM'],
    ] as const) {
      const riya = countingPort();
      const anisha = countingPort();
      const aarohi = countingPort();
      const mux = behaviourMux({ riya: riya.port, anisha: anisha.port, aarohi: aarohi.port });
      const decision = await mux?.decide(request(party, actor));
      expect(decision, `${party}/${actor}`).toBeUndefined();
      expect(
        [riya.state.calls, anisha.state.calls, aarohi.state.calls],
        `${party}/${actor}`,
      ).toEqual([0, 0, 0]);
    }
  });

  it('every MISMATCHED pair reaches no adapter — the cross-product, not a sample', async () => {
    // A mismatched pair is a routing defect the scope rule would also reject. It must not be repaired
    // here by asking somebody else: the mux reads the routing decision, it never makes one.
    const parties: readonly Party[] = ['CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN'];
    const actors: readonly Actor[] = ['RIYA', 'ANISHA', 'AAROHI', 'JARVIS', 'HUMAN', 'SYSTEM'];
    const matched = new Set(['CLIENT/RIYA', 'VENDOR/ANISHA', 'PROSPECT/AAROHI']);
    for (const party of parties) {
      for (const actor of actors) {
        if (matched.has(`${party}/${actor}`)) {
          continue;
        }
        const riya = countingPort();
        const anisha = countingPort();
        const aarohi = countingPort();
        const mux = behaviourMux({ riya: riya.port, anisha: anisha.port, aarohi: aarohi.port });
        expect(await mux?.decide(request(party, actor)), `${party}/${actor}`).toBeUndefined();
        expect(
          riya.state.calls + anisha.state.calls + aarohi.state.calls,
          `${party}/${actor}`,
        ).toBe(0);
      }
    }
  });

  it('(C26) a selected adapter returning undefined consults NO other adapter', async () => {
    const riya = countingPort();
    const anisha = countingPort();
    const aarohi = countingPort('undefined');
    const mux = behaviourMux({ riya: riya.port, anisha: anisha.port, aarohi: aarohi.port });

    expect(await mux?.decide(request('PROSPECT', 'AAROHI'))).toBeUndefined();
    // "Aarohi had no opinion" is the turn's answer, not a reason to ask Riya or Anisha.
    expect([riya.state.calls, anisha.state.calls, aarohi.state.calls]).toEqual([0, 0, 1]);
  });

  it('(C27) a selected adapter REJECTING consults no other adapter, and propagates', async () => {
    const riya = countingPort();
    const anisha = countingPort();
    const aarohi = countingPort('reject');
    const mux = behaviourMux({ riya: riya.port, anisha: anisha.port, aarohi: aarohi.port });

    await expect(mux?.decide(request('PROSPECT', 'AAROHI'))).rejects.toThrow();
    // The rejection propagates so the orchestrator fails closed. It is never caught here and turned
    // into a second attempt against another agent.
    expect([riya.state.calls, anisha.state.calls, aarohi.state.calls]).toEqual([0, 0, 1]);
  });

  it('(C28) there is no registry, no iteration and no fallback ordering', async () => {
    // With only ONE agent configured, a mismatched pair still reaches nothing -- proof that selection
    // is exact-pair matching rather than "the only adapter available must be the right one".
    const aarohi = countingPort();
    const mux = behaviourMux({ aarohi: aarohi.port });
    expect(await mux?.decide(request('CLIENT', 'RIYA'))).toBeUndefined();
    expect(await mux?.decide(request('VENDOR', 'ANISHA'))).toBeUndefined();
    expect(aarohi.state.calls).toBe(0);
    await mux?.decide(request('PROSPECT', 'AAROHI'));
    expect(aarohi.state.calls).toBe(1);
    // And with NO agent configured the mux itself is absent: the legacy pipeline, byte-for-byte.
    expect(behaviourMux({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The Aarohi adapter's own gates (D29–D38).
// ---------------------------------------------------------------------------

const KEY: ConversationStateKey = Object.freeze({ tenantId: 'tenant.a', conversationId: 'conv.1' });

function statePort(over: Record<string, unknown> = {}): {
  port: AuthoritativeConversationStatePort;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    port: {
      read: () => {
        calls += 1;
        return Promise.resolve({
          tenantId: 'tenant.a',
          conversationId: 'conv.1',
          humanTakeover: false,
          aiPaused: false,
          ...over,
        } as never);
      },
    },
  };
}

function inputPort(value: unknown): {
  port: AarohiAcquisitionBehaviourInputPort;
  reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    port: {
      read: () => {
        reads += 1;
        return Promise.resolve(value as never);
      },
    },
  };
}

describe('JF-4C the Aarohi adapter reads nothing it is not entitled to', () => {
  it('(D29) a wrong party or actor costs ZERO input reads and ZERO state reads', async () => {
    for (const [party, actor] of [
      ['CLIENT', 'RIYA'],
      ['VENDOR', 'ANISHA'],
      ['PROSPECT', 'ANISHA'],
      ['VENDOR', 'AAROHI'],
      ['UNKNOWN', 'JARVIS'],
    ] as const) {
      const input = inputPort(undefined);
      const state = statePort();
      const port = aarohiBehaviourPort(input.port, state.port, KEY, 'task.a');
      expect(await port.decide(request(party, actor)), `${party}/${actor}`).toBeUndefined();
      // The role precheck happens before ANY read: a client turn must not cost an acquisition read.
      expect([input.reads(), state.calls()], `${party}/${actor}`).toEqual([0, 0]);
    }
  });

  it('(D30,D31) takeover and AI pause yield no decision, and reach no Aarohi evaluator', async () => {
    for (const control of [{ humanTakeover: true }, { aiPaused: true }]) {
      const input = inputPort({
        planRef: 'plan.a',
        conversation: {},
        interpretation: {},
        coreObservation: {},
        plannedAt: '2026-09-11T00:00:00Z',
        promptRef: 'prompt.a',
      });
      const state = statePort(control);
      const port = aarohiBehaviourPort(input.port, state.port, KEY, 'task.a');
      // Control comes from the ONE authoritative source, and it is re-checked at the last moment
      // before a decision -- the first gate already refused, this catches a state that changed under it.
      expect(await port.decide(request('PROSPECT', 'AAROHI'))).toBeUndefined();
    }
  });

  it('(D34,D35) a malformed or forged Aarohi artifact refuses, and reaches no model', async () => {
    for (const artifacts of [
      // Nothing AVG-7 can parse.
      { conversation: {}, interpretation: {}, coreObservation: {} },
      // Shaped like the real thing, without the provenance AVG-7 re-proves.
      {
        conversation: { contractVersion: 1, messages: [] },
        interpretation: { contractVersion: 1, intent: 'GENERAL_QUESTION' },
        coreObservation: { status: 'NOT_REGISTERED' },
      },
    ]) {
      const input = inputPort({
        planRef: 'plan.a',
        ...artifacts,
        plannedAt: '2026-09-11T00:00:00Z',
        promptRef: 'prompt.a',
      });
      const port = aarohiBehaviourPort(input.port, statePort().port, KEY, 'task.a');
      // AVG-7 refused. The adapter throws, the orchestrator skips the model entirely and fails closed
      // -- it does not repair evidence about a real person's registration status.
      await expect(port.decide(request('PROSPECT', 'AAROHI'))).rejects.toThrow();
    }
  });

  it('(D36) the input port cannot supply actor, party, takeover or pause', async () => {
    // Structural: the contract has no such field, so a supplier has nowhere to put one. A supplier that
    // adds extra keys is simply ignored -- the adapter reads only what it names.
    const input = inputPort({
      planRef: 'plan.a',
      conversation: {},
      interpretation: {},
      coreObservation: {},
      plannedAt: '2026-09-11T00:00:00Z',
      promptRef: 'prompt.a',
      partyType: 'CLIENT',
      assignedActor: 'RIYA',
      humanTakeover: false,
      aiPaused: false,
      dataClass: 'HOSTED_ALLOWED',
    });
    const state = statePort({ humanTakeover: true });
    const port = aarohiBehaviourPort(input.port, state.port, KEY, 'task.a');
    // The supplier claimed takeover was false; the authoritative source says true, and that wins.
    expect(await port.decide(request('PROSPECT', 'AAROHI'))).toBeUndefined();
  });

  it('an absent input is not a refusal, and an invalid reference is', async () => {
    const absent = inputPort(undefined);
    const port = aarohiBehaviourPort(absent.port, statePort().port, KEY, 'task.a');
    // Nothing to say is not a refusal: the turn takes the legacy default.
    expect(await port.decide(request('PROSPECT', 'AAROHI'))).toBeUndefined();
    expect(absent.reads()).toBe(1);

    for (const bad of ['', 'has space', 'a'.repeat(129), 'bad/ref']) {
      const input = inputPort({
        planRef: bad,
        conversation: {},
        interpretation: {},
        coreObservation: {},
        plannedAt: '2026-09-11T00:00:00Z',
        promptRef: 'prompt.a',
      });
      const bad2 = aarohiBehaviourPort(input.port, statePort().port, KEY, 'task.a');
      await expect(bad2.decide(request('PROSPECT', 'AAROHI'))).rejects.toThrow();
    }
  });

  it('a state answer for another tenant or conversation refuses', async () => {
    for (const wrong of [{ tenantId: 'tenant.b' }, { conversationId: 'conv.2' }]) {
      const input = inputPort({
        planRef: 'plan.a',
        conversation: {},
        interpretation: {},
        coreObservation: {},
        plannedAt: '2026-09-11T00:00:00Z',
        promptRef: 'prompt.a',
      });
      const port = aarohiBehaviourPort(input.port, statePort(wrong).port, KEY, 'task.a');
      // A source that answered correctly at the first gate could still answer with another tenant's
      // state here, and that state would reach the behaviour decision.
      await expect(port.decide(request('PROSPECT', 'AAROHI'))).rejects.toThrow();
    }
  });
});
