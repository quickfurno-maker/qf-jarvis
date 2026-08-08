/**
 * RWC-P4B — continuity evolution and compare-and-set (ADR-0099 §21–§24).
 *
 * RWC-P2C loaded continuity and returned it untouched. This slice makes the turn WRITE: the one
 * model call produces a canonical observation batch alongside the reply, the pure RWC-P4A reducer
 * turns it into a new state, and the service persists that state through the compare-and-set the
 * port has carried since P2C.
 *
 * Two properties carry the weight here, and every spec below exists to pin one of them:
 *
 * 1. **The write is bounded.** At most two compare-and-set attempts, exactly one reload between
 *    them, and never a third — an unbounded retry loop would hold one client's turn open while
 *    other writers keep moving the state.
 * 2. **Nothing expensive happens twice.** No reconciliation re-runs the model, the runtime or Core,
 *    and none re-extracts anything. The reducer is pure, so re-merging the SAME captured batch
 *    against a newer state is a re-computation, not a second observation. Every spec that reaches
 *    the reconciliation asserts the runtime call count is still exactly one.
 */
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';
import type { JarvisRuntimeOutcome } from '@qf-jarvis/jarvis-runtime';
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import { createRiyaWebConversationService, RiyaWebConversationError } from '../index.js';
import type { RiyaWebConversationTurnV1 } from '../index.js';
import type {
  RiyaContinuityCasOutcome,
  RiyaContinuityCreateResult,
  RiyaContinuityStoreKey,
  RiyaContinuityStorePort,
} from '../contracts/store-port.js';
import { InMemoryContinuityStore } from './fakes/in-memory-continuity-store.js';
import { SENTINEL_BODY, scriptedRuntime } from './fakes/scripted-runtime.js';

const RUNTIME_ID = 'rt.web.1';
const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

function turnInput(over: Partial<RiyaWebConversationTurnV1> = {}): RiyaWebConversationTurnV1 {
  return {
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    messageId: 'msg.1',
    receivedAt: '2026-08-07T09:00:00Z',
    webTurnRef: 'web.turn.opaque.ref',
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  };
}

const SET = (field: string, value: string): RiyaDiscoveryObservationV1 =>
  ({
    field,
    operation: 'SET',
    value,
    provenance: 'user_stated',
  }) as RiyaDiscoveryObservationV1;

/** The four summary-required fields, as one turn's worth of observations. */
const ALL_FOUR: readonly RiyaDiscoveryObservationV1[] = [
  SET('serviceInterest', 'modular-kitchen'),
  SET('location', 'loc.pune'),
  SET('budget', 'around 8 lakh'),
  SET('timeline', 'next month'),
];

/**
 * A store that behaves exactly like the real one until a spec scripts a specific answer.
 *
 * Wrapping rather than replacing matters: every unscripted call still goes through the real
 * optimistic-concurrency semantics, so a spec that scripts ONE conflict is testing the service's
 * reconciliation and not a fake that agrees with it.
 */
class ScriptedContinuityStore implements RiyaContinuityStorePort {
  readonly #inner = new InMemoryContinuityStore();

  /** Forced compare-and-set answers, consumed in order. `undefined` means "ask the real store". */
  public casScript: (RiyaContinuityCasOutcome | 'THROW' | undefined)[] = [];
  /** Forced load answers, consumed in order, applied only AFTER the first CAS attempt. */
  public loadAfterCasScript: (
    RiyaConversationContinuityStateV1 | 'ABSENT' | 'THROW' | undefined
  )[] = [];

  public readonly calls = { load: 0, createInitialIfAbsent: 0, compareAndSet: 0 };
  /** Every `expectedRevision` the service asked for, in order. */
  public readonly expectedRevisions: number[] = [];
  /** Every state the service tried to write, in order. */
  public readonly written: RiyaConversationContinuityStateV1[] = [];

  public get size(): number {
    return this.#inner.size;
  }

  public seed(state: RiyaConversationContinuityStateV1): void {
    this.#inner.seed(state);
  }

  public current(): RiyaConversationContinuityStateV1 | undefined {
    return this.#inner.peek(TENANT, CONVERSATION);
  }

  public async load(
    key: RiyaContinuityStoreKey,
  ): Promise<RiyaConversationContinuityStateV1 | undefined> {
    this.calls.load += 1;
    if (this.calls.compareAndSet > 0) {
      const scripted = this.loadAfterCasScript.shift();
      if (scripted === 'THROW') {
        throw new Error('store host 10.0.0.9 — token=abc123');
      }
      if (scripted === 'ABSENT') {
        return undefined;
      }
      if (scripted !== undefined) {
        return scripted;
      }
    }
    return this.#inner.load(key);
  }

  public createInitialIfAbsent(input: {
    readonly state: RiyaConversationContinuityStateV1;
  }): Promise<RiyaContinuityCreateResult> {
    this.calls.createInitialIfAbsent += 1;
    return this.#inner.createInitialIfAbsent(input);
  }

  public async compareAndSet(input: {
    readonly expectedRevision: number;
    readonly nextState: RiyaConversationContinuityStateV1;
  }): Promise<RiyaContinuityCasOutcome> {
    this.calls.compareAndSet += 1;
    this.expectedRevisions.push(input.expectedRevision);
    this.written.push(input.nextState);
    const scripted = this.casScript.shift();
    if (scripted === 'THROW') {
      throw new Error('store host 10.0.0.9 — token=abc123');
    }
    if (scripted !== undefined) {
      return scripted;
    }
    return this.#inner.compareAndSet(input);
  }
}

function initial(revision = 0): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    continuityRevision: revision,
    phase: 'INTRO',
    discovery: {
      completeness: 'MORE_DISCOVERY_REQUIRED',
      missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
    },
    summaryConfirmed: false,
  });
}

function harness(
  over: {
    readonly observations?: readonly RiyaDiscoveryObservationV1[];
    readonly outcome?: JarvisRuntimeOutcome;
    readonly seed?: RiyaConversationContinuityStateV1;
  } = {},
): {
  runtime: ReturnType<typeof scriptedRuntime>;
  store: ScriptedContinuityStore;
  svc: ReturnType<typeof createRiyaWebConversationService>;
} {
  const runtime = scriptedRuntime(
    over.outcome ?? 'CORE_ACCEPTED',
    over.observations === undefined ? {} : { observations: over.observations },
  );
  const store = new ScriptedContinuityStore();
  if (over.seed !== undefined) {
    store.seed(over.seed);
  }
  return {
    runtime,
    store,
    svc: createRiyaWebConversationService({
      runtime,
      continuityStore: store,
      // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
      // every pre-P5 spec meaning exactly what it meant before.
      availabilityReader: scriptedAvailabilityReader(),
      runtimeId: RUNTIME_ID,
    }),
  };
}

// ---------------------------------------------------------------------------
// A. Initial continuity (§20).
// ---------------------------------------------------------------------------

describe('A. the initial state a brand-new conversation starts from', () => {
  it('creates revision 0 with exactly the four summary-blocking fields missing', async () => {
    const { svc, store } = harness();
    const result = await svc.handleTurn(turnInput());
    expect(result.continuity.continuityRevision).toBe(0);
    expect([...result.continuity.discovery.missingFields]).toStrictEqual([
      'serviceInterest',
      'location',
      'budget',
      'timeline',
    ]);
    expect(store.size).toBe(1);
  });

  it('the optional fields never block: they are absent from the initial missing set', async () => {
    const { svc } = harness();
    const result = await svc.handleTurn(turnInput());
    for (const optional of ['propertyType', 'scope', 'consultationPreference']) {
      expect(result.continuity.discovery.missingFields, optional).not.toContain(optional);
    }
  });

  it('the initial state is a FIXED POINT of the reducer, so the two lists cannot drift', () => {
    // The service restates the blocking-field list because the reducer keeps its own copy internal.
    // This is what keeps the restatement honest: merging an EMPTY batch recomputes completeness and
    // `missingFields` from scratch, and the reducer reports no change only if it agrees exactly —
    // same fields, same order.
    const evolved = evolveRiyaConversation({
      current: initial(),
      batch: { version: 1, observations: [], skipProjectDetails: false },
    });
    expect(evolved.changed).toBe(false);
    expect([...evolved.state.discovery.missingFields]).toStrictEqual([
      'serviceInterest',
      'location',
      'budget',
      'timeline',
    ]);
  });
});

// ---------------------------------------------------------------------------
// B, C. When nothing is written at all.
// ---------------------------------------------------------------------------

describe('B. a run that observed nothing writes nothing', () => {
  it('no observationBatch means no compare-and-set and an unchanged continuity', async () => {
    const seeded = initial(3);
    const { svc, store, runtime } = harness({ seed: seeded });
    const result = await svc.handleTurn(turnInput());
    expect(runtime.invoked()).toBe(1);
    expect(store.calls.compareAndSet).toBe(0);
    expect(result.continuity).toStrictEqual(seeded);
    expect(result.continuity.continuityRevision).toBe(3);
  });

  it('an empty batch is never fabricated for a no-model path', async () => {
    // A run that never reached a model returns NO batch. Manufacturing an empty one would look
    // harmless and would bump nothing — but it would put a write on a path where nothing happened.
    const { svc, store } = harness({ outcome: 'REFUSED' });
    await svc.handleTurn(turnInput());
    expect(store.calls.compareAndSet).toBe(0);
  });
});

describe('C. a batch that changes nothing writes nothing', () => {
  it('a re-stated fact leaves the revision alone and skips the compare-and-set entirely', async () => {
    // Seed a state that already knows the service interest, then observe the same value again.
    const base = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('serviceInterest', 'modular-kitchen')],
        skipProjectDetails: false,
      },
    }).state;
    const { svc, store, runtime } = harness({
      seed: base,
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });

    const result = await svc.handleTurn(turnInput());
    expect(runtime.invoked()).toBe(1);
    // Spending a durable write on what is already stored would also bump a revision whose entire
    // meaning is "this conversation changed".
    expect(store.calls.compareAndSet).toBe(0);
    expect(result.continuity).toStrictEqual(base);
  });
});

// ---------------------------------------------------------------------------
// D, E. The ordinary write.
// ---------------------------------------------------------------------------

describe('D. one changed field is one compare-and-set', () => {
  it('writes once, against the loaded revision, and returns the evolved state', async () => {
    const { svc, store, runtime } = harness({
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    const result = await svc.handleTurn(turnInput());

    expect(runtime.invoked()).toBe(1);
    expect(store.calls.compareAndSet).toBe(1);
    expect(store.expectedRevisions).toStrictEqual([0]);
    expect(result.continuity.continuityRevision).toBe(1);
    expect(result.continuity.discovery.serviceInterestRef).toBe('modular-kitchen');
    expect(result.continuity.fieldProvenance.serviceInterest).toBe('user_stated');
    // The RETURNED state is the one that was durably stored, not a parallel copy.
    expect(store.current()).toStrictEqual(result.continuity);
  });
});

describe('E. four fields in one turn is still one revision', () => {
  it('a multi-field batch is atomic: one compare-and-set, one revision, summary reachable', async () => {
    const { svc, store, runtime } = harness({ observations: ALL_FOUR });
    const result = await svc.handleTurn(turnInput());

    expect(runtime.invoked()).toBe(1);
    expect(store.calls.compareAndSet).toBe(1);
    // One turn, one semantic revision — not four.
    expect(result.continuity.continuityRevision).toBe(1);
    expect(result.continuity.discovery.completeness).toBe('SUFFICIENT_FOR_CORE_REVIEW');
    expect(result.continuity.discovery.missingFields).toStrictEqual([]);
    expect(result.continuity.phase).toBe('SUMMARY');
  });
});

// ---------------------------------------------------------------------------
// F. Persistence is independent of what Core decided (§21).
// ---------------------------------------------------------------------------

describe('F. what a client said does not depend on whether Core approved the reply', () => {
  for (const outcome of [
    'CORE_REJECTED',
    'CORE_UNAVAILABLE',
    'RETRY_LATER',
    'HUMAN_REVIEW_REQUIRED',
  ] as const) {
    it(`persists the evolution on ${outcome}`, async () => {
      const { svc, store } = harness({
        outcome,
        observations: [SET('location', 'loc.pune')],
      });
      const result = await svc.handleTurn(turnInput());

      // The extraction passed its own gates, which is what the presence of a batch means. Core
      // declining to send a reply does not unsay the sentence the client typed.
      expect(store.calls.compareAndSet).toBe(1);
      expect(result.continuity.continuityRevision).toBe(1);
      expect(result.continuity.discovery.locationRef).toBe('loc.pune');
      // And no text is invented to go with it.
      expect(result.authorizedReply).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// G, H, I. The one bounded reconciliation (§23).
// ---------------------------------------------------------------------------

describe('G. a conflict whose re-merge turns out to be a no-op', () => {
  it('reloads once, re-merges, and writes nothing more', async () => {
    // The winner of the race already recorded the very fact this turn observed.
    const winner = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('serviceInterest', 'modular-kitchen')],
        skipProjectDetails: false,
      },
    }).state;

    const { svc, store, runtime } = harness({
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    store.casScript = ['REVISION_CONFLICT'];
    store.loadAfterCasScript = [winner];

    const result = await svc.handleTurn(turnInput());

    expect(store.calls.compareAndSet).toBe(1);
    expect(result.continuity).toStrictEqual(winner);
    // Nothing expensive ran twice.
    expect(runtime.invoked()).toBe(1);
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
  });
});

describe('H. a conflict whose re-merge still has something to say', () => {
  it('reloads once, re-merges against the winner, and the second attempt succeeds', async () => {
    // The winner recorded a DIFFERENT field, so this turn's observation still applies.
    const winner = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('location', 'loc.pune')],
        skipProjectDetails: false,
      },
    }).state;

    const { svc, store, runtime } = harness({
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    store.casScript = ['REVISION_CONFLICT', 'UPDATED'];
    store.loadAfterCasScript = [winner];

    const result = await svc.handleTurn(turnInput());

    expect(store.calls.compareAndSet).toBe(2);
    // The second attempt is against the RELOADED revision, never the stale one.
    expect(store.expectedRevisions).toStrictEqual([0, winner.continuityRevision]);
    // Both facts survive: the reducer merged this turn's observation into the winner's state.
    expect(result.continuity.discovery.locationRef).toBe('loc.pune');
    expect(result.continuity.discovery.serviceInterestRef).toBe('modular-kitchen');
    expect(result.continuity.continuityRevision).toBe(winner.continuityRevision + 1);
    expect(runtime.invoked()).toBe(1);
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
  });
});

describe('I. losing twice is a refusal, not a third attempt', () => {
  it('two attempts, one reload, then continuity-conflict — and no model or Core retry', async () => {
    const winner = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('location', 'loc.pune')],
        skipProjectDetails: false,
      },
    }).state;

    const { svc, store, runtime } = harness({
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    store.casScript = ['REVISION_CONFLICT', 'REVISION_CONFLICT'];
    store.loadAfterCasScript = [winner];

    let thrown: unknown;
    try {
      await svc.handleTurn(turnInput());
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RiyaWebConversationError);
    expect((thrown as RiyaWebConversationError).code).toBe('continuity-conflict');
    // Exactly two attempts, exactly one reload after the first conflict.
    expect(store.calls.compareAndSet).toBe(2);
    expect(store.calls.load).toBe(2);
    expect(runtime.invoked()).toBe(1);
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
  });

  it('the conflict message names no tenant, conversation, revision or client text', async () => {
    const { svc, store } = harness({ observations: [SET('serviceInterest', 'modular-kitchen')] });
    store.casScript = ['REVISION_CONFLICT', 'REVISION_CONFLICT'];
    store.loadAfterCasScript = [initial(9)];

    let message = '';
    try {
      await svc.handleTurn(turnInput({ normalizedText: 'MY SECRET HOME ADDRESS' }));
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message.length).toBeGreaterThan(0);
    for (const forbidden of [TENANT, CONVERSATION, 'modular-kitchen', 'SECRET', '9']) {
      expect(message, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// I2. A reply is bound to the snapshot the model saw (owner correction).
// ---------------------------------------------------------------------------

describe('I2. a losing first attempt withholds the reply it produced', () => {
  /**
   * The failure this closes is concrete, and it is a wrong ANSWER rather than a crash.
   *
   * Base is missing a location. The model asks which area the client is in, and Core authorizes
   * that. A concurrent turn records the location. This turn's compare-and-set loses, reconciles
   * successfully, and the final continuity now knows the location -- so returning the old body means
   * asking a client for something they told us moments ago.
   *
   * Re-checking the question plan would not be enough: the body is free text and may restate ANY
   * fact from the old snapshot.
   */
  const winnerKnowingLocation = (): RiyaConversationContinuityStateV1 =>
    evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('location', 'loc.pune')],
        skipProjectDetails: false,
      },
    }).state;

  it('no conflict: the authorized reply is preserved exactly', async () => {
    const { svc, store, runtime } = harness({
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    const result = await svc.handleTurn(turnInput());

    expect(store.calls.compareAndSet).toBe(1);
    expect(result.disposition).toBe('PROCESSED');
    // Byte-identical to what the runtime materialized. Nothing about the suppression path touches
    // the ordinary case.
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
    expect(result.authorizedReply?.proposalId).toBe('prop.1');
    expect(result.authorizedReply?.boundRevision).toBe(1);
    expect(runtime.invoked()).toBe(1);
  });

  it('conflict then a no-op re-merge: the reply is withheld, the winner state is returned', async () => {
    const winner = winnerKnowingLocation();
    const { svc, store, runtime } = harness({ observations: [SET('location', 'loc.pune')] });
    store.casScript = ['REVISION_CONFLICT'];
    store.loadAfterCasScript = [winner];

    const result = await svc.handleTurn(turnInput());

    // The batch turning out to be redundant says nothing about the reply -- if anything it is the
    // case where the winning turn most likely recorded the very fact the reply is about to ask for.
    expect(result.authorizedReply).toBeUndefined();
    expect(result.continuity).toStrictEqual(winner);
    // A disposition is NOT invented for this. The V2 contract has always permitted PROCESSED with
    // no body, and the ingress already treats the body's presence as the sole text gate.
    expect(result.disposition).toBe('PROCESSED');
    // And nothing was re-run to replace the withheld text.
    expect(runtime.invoked()).toBe(1);
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('conflict then a successful second attempt: the reply is still withheld', async () => {
    const winner = winnerKnowingLocation();
    const { svc, store, runtime } = harness({
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    store.casScript = ['REVISION_CONFLICT', 'UPDATED'];
    store.loadAfterCasScript = [winner];

    const result = await svc.handleTurn(turnInput());

    // The observations DID persist -- a fact is a fact, and the reducer re-merged it against the
    // winner. Only the text capability is withheld.
    expect(result.continuity.discovery.locationRef).toBe('loc.pune');
    expect(result.continuity.discovery.serviceInterestRef).toBe('modular-kitchen');
    expect(result.continuity.continuityRevision).toBe(winner.continuityRevision + 1);
    expect(result.authorizedReply).toBeUndefined();
    expect(result.disposition).toBe('PROCESSED');
    expect(runtime.invoked()).toBe(1);
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
    expect(store.calls.compareAndSet).toBe(2);
    expect(store.calls.load).toBe(2);
  });

  it('a Core REJECTION plus a conflict: still no reply, and the state still reconciles', async () => {
    const winner = winnerKnowingLocation();
    const { svc, store, runtime } = harness({
      outcome: 'CORE_REJECTED',
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    store.casScript = ['REVISION_CONFLICT', 'UPDATED'];
    store.loadAfterCasScript = [winner];

    const result = await svc.handleTurn(turnInput());

    // There was never a body to withhold here, and the reconciliation is unaffected by that.
    expect(result.authorizedReply).toBeUndefined();
    expect(result.disposition).toBe('REFUSED');
    expect(result.continuity.discovery.serviceInterestRef).toBe('modular-kitchen');
    expect(result.continuity.discovery.locationRef).toBe('loc.pune');
    expect(runtime.invoked()).toBe(1);
  });

  it('no batch at all: a reply is never withheld, because no CAS could have lost', async () => {
    // The suppression is bound to a LOST compare-and-set, not to the existence of a conflict
    // somewhere in the world. A turn that wrote nothing has nothing to lose.
    const { svc, store } = harness();
    const result = await svc.handleTurn(turnInput());
    expect(store.calls.compareAndSet).toBe(0);
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
  });

  it('a no-op batch: the reply survives, because the first attempt never happened', async () => {
    const base = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('serviceInterest', 'modular-kitchen')],
        skipProjectDetails: false,
      },
    }).state;
    const { svc, store } = harness({
      seed: base,
      observations: [SET('serviceInterest', 'modular-kitchen')],
    });
    const result = await svc.handleTurn(turnInput());
    expect(store.calls.compareAndSet).toBe(0);
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
  });
});

// ---------------------------------------------------------------------------
// J. A record that contradicts itself (§22, §23).
// ---------------------------------------------------------------------------

describe('J. a row that vanishes mid-turn is never recreated', () => {
  it('a first-attempt NOT_FOUND is repository-invariant, and no fresh row is written', async () => {
    const { svc, store } = harness({ observations: [SET('location', 'loc.pune')] });
    store.casScript = ['NOT_FOUND'];

    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'repository-invariant',
    });
    expect(store.calls.compareAndSet).toBe(1);
    // No restart: creating a row here would silently begin a conversation somebody is mid-way
    // through having.
    expect(store.calls.createInitialIfAbsent).toBe(1);
  });

  it('a reload that finds nothing after a conflict is repository-invariant', async () => {
    const { svc, store } = harness({ observations: [SET('location', 'loc.pune')] });
    store.casScript = ['REVISION_CONFLICT'];
    store.loadAfterCasScript = ['ABSENT'];

    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'repository-invariant',
    });
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('a second-attempt NOT_FOUND is repository-invariant', async () => {
    const winner = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('location', 'loc.pune')],
        skipProjectDetails: false,
      },
    }).state;
    const { svc, store } = harness({ observations: [SET('serviceInterest', 'modular-kitchen')] });
    store.casScript = ['REVISION_CONFLICT', 'NOT_FOUND'];
    store.loadAfterCasScript = [winner];

    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'repository-invariant',
    });
    expect(store.calls.compareAndSet).toBe(2);
  });

  it('a reload answering about a DIFFERENT conversation is repository-invariant', async () => {
    const other = createRiyaConversationContinuityState({
      version: 1,
      tenantId: 'tenant.b',
      conversationId: CONVERSATION,
      continuityRevision: 4,
      phase: 'INTRO',
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
      },
      summaryConfirmed: false,
    });
    const { svc, store } = harness({ observations: [SET('location', 'loc.pune')] });
    store.casScript = ['REVISION_CONFLICT'];
    store.loadAfterCasScript = [other];

    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'repository-invariant',
    });
    expect(store.calls.compareAndSet).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// K. An unavailable store (§22, §23).
// ---------------------------------------------------------------------------

describe('K. an unavailable store never becomes a served write', () => {
  it('a throwing first compare-and-set is continuity-unavailable, and leaks no host or token', async () => {
    const { svc, store } = harness({ observations: [SET('location', 'loc.pune')] });
    store.casScript = ['THROW'];

    let thrown: unknown;
    try {
      await svc.handleTurn(turnInput());
    } catch (error: unknown) {
      thrown = error;
    }
    expect((thrown as RiyaWebConversationError).code).toBe('continuity-unavailable');
    expect((thrown as Error).message).not.toContain('10.0.0.9');
    expect((thrown as Error).message).not.toContain('abc123');
  });

  it('a throwing reload after a conflict is continuity-unavailable', async () => {
    const { svc, store } = harness({ observations: [SET('location', 'loc.pune')] });
    store.casScript = ['REVISION_CONFLICT'];
    store.loadAfterCasScript = ['THROW'];

    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'continuity-unavailable',
    });
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('a throwing second compare-and-set is continuity-unavailable', async () => {
    const winner = evolveRiyaConversation({
      current: initial(),
      batch: {
        version: 1,
        observations: [SET('location', 'loc.pune')],
        skipProjectDetails: false,
      },
    }).state;
    const { svc, store } = harness({ observations: [SET('serviceInterest', 'modular-kitchen')] });
    store.casScript = ['REVISION_CONFLICT', 'THROW'];
    store.loadAfterCasScript = [winner];

    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'continuity-unavailable',
    });
    expect(store.calls.compareAndSet).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// L. Summary confirmation (RWC-P4A owner correction).
// ---------------------------------------------------------------------------

describe('L. a correction to a confirmed summary invalidates the confirmation', () => {
  it('the service stores exactly what the reducer decided, confirmation included', async () => {
    // A settled conversation: all four facts known, summary shown and agreed to.
    const settled = evolveRiyaConversation({
      current: initial(),
      batch: { version: 1, observations: ALL_FOUR, skipProjectDetails: false },
    }).state;
    // The same conversation with the summary now agreed to. Spelled out rather than spread: under
    // `exactOptionalPropertyTypes` a state's `string | undefined` values are not assignable to the
    // constructor's input, and widening the input to accept them would weaken a real contract for a
    // test's convenience.
    const confirmed = createRiyaConversationContinuityState({
      version: 1,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      continuityRevision: settled.continuityRevision,
      phase: 'SUMMARY',
      discovery: {
        completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
        missingFields: [],
        serviceInterestRef: 'modular-kitchen',
        locationRef: 'loc.pune',
        budgetNote: 'around 8 lakh',
        timelineNote: 'next month',
      },
      fieldProvenance: { ...settled.fieldProvenance },
      summaryConfirmed: true,
    });

    const { svc, store } = harness({
      seed: confirmed,
      observations: [SET('budget', 'actually closer to 12 lakh')],
    });
    const result = await svc.handleTurn(turnInput());

    // The client changed one of the facts they had agreed to, so the agreement no longer refers to
    // anything they saw. The reducer decides that; the service only stores it.
    expect(result.continuity.summaryConfirmed).toBe(false);
    expect(result.continuity.discovery.budgetNote).toBe('actually closer to 12 lakh');
    expect(store.calls.compareAndSet).toBe(1);
    expect(store.current()).toStrictEqual(result.continuity);

    // And it stored the reducer's own answer, byte for byte — not a state the service assembled.
    const expected = evolveRiyaConversation({
      current: confirmed,
      batch: {
        version: 1,
        observations: [SET('budget', 'actually closer to 12 lakh')],
        skipProjectDetails: false,
      },
    });
    expect(result.continuity).toStrictEqual(expected.state);
  });
});

// ---------------------------------------------------------------------------
// M. One runtime call (§19).
// ---------------------------------------------------------------------------

describe('M. exactly one runtime call per turn', () => {
  it('calls the Riya-aware capability once and neither older inbound method at all', async () => {
    const { svc, runtime } = harness({ observations: ALL_FOUR });
    await svc.handleTurn(turnInput());
    expect(runtime.invoked()).toBe(1);
    // Calling either of these IN ADDITION would be a second orchestration run, a second model call,
    // a second Core decision, and two independent extractions of one sentence that could disagree.
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
  });

  it('hands the runtime the continuity it LOADED, not a freshly built one', async () => {
    const seeded = initial(5);
    const { svc, runtime } = harness({ seed: seeded, observations: ALL_FOUR });
    await svc.handleTurn(turnInput());
    // The model has to see where the conversation actually is; a fresh INTRO state would make one
    // inference behave like a first turn every time.
    expect(runtime.lastContinuity()).toStrictEqual(seeded);
  });

  it('a runtime without the capability is refused at construction, before any model could run', () => {
    const withoutIt = scriptedRuntime() as unknown as Record<string, unknown>;
    const stripped = { ...withoutIt };
    delete stripped['processInboundForRiyaConversationEvolution'];

    expect(() =>
      createRiyaWebConversationService({
        runtime: stripped as never,
        continuityStore: new ScriptedContinuityStore(),
        // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
        // every pre-P5 spec meaning exactly what it meant before.
        availabilityReader: scriptedAvailabilityReader(),
        runtimeId: RUNTIME_ID,
      }),
    ).toThrow(RiyaWebConversationError);
  });
});
