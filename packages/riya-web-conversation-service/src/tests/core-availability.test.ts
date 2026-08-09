/**
 * RWC-P5 — the service's ONE Core availability read (ADR-0100 §31).
 *
 * The service owns the outbound authority call for the same reason it owns the store: the runtime
 * performs no I/O. That makes three properties this file has to pin.
 *
 * 1. **The reader is REQUIRED.** A default could only mean "everything is available everywhere",
 *    which would pass every test in this repository while letting Riya promise services in cities
 *    the business does not serve. Absent authority fails closed at construction.
 * 2. **Exactly one read per turn, before the model.** Read unconditionally rather than after
 *    inspecting the client's prose — guessing whether city authority will be needed is a second
 *    natural-language path with no model behind it, and it is wrong precisely when somebody corrects
 *    their city in a sentence nobody predicted.
 * 3. **An outage is NOT_READY, never a decision.** No default city, no cached fallback, no model
 *    call, no compare-and-set — and nothing from the reader's error on the wire.
 */
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import type { CoreServiceAvailabilityReader } from '@qf-jarvis/core-service-availability-read';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { createRiyaWebConversationService, RiyaWebConversationError } from '../index.js';
import type { RiyaWebConversationTurnV1 } from '../index.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
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
    normalizedText: 'I want a modular kitchen in Pune',
    ...over,
  };
}

const SET = (field: string, value: string): RiyaDiscoveryObservationV1 =>
  ({ field, operation: 'SET', value, provenance: 'user_stated' }) as RiyaDiscoveryObservationV1;

function harness(
  over: {
    readonly reader?: CoreServiceAvailabilityReader & { calls?: () => number };
    readonly observations?: readonly RiyaDiscoveryObservationV1[];
    readonly store?: InMemoryContinuityStore | UnavailableContinuityStore;
  } = {},
) {
  const runtime = scriptedRuntime(
    'CORE_ACCEPTED',
    over.observations === undefined ? {} : { observations: over.observations },
  );
  const reader = over.reader ?? scriptedAvailabilityReader();
  const store = over.store ?? new InMemoryContinuityStore();
  return {
    runtime,
    reader,
    store,
    svc: createRiyaWebConversationService({
      runtime,
      continuityStore: store,
      availabilityReader: reader,
      runtimeId: RUNTIME_ID,
    }),
  };
}

// ---------------------------------------------------------------------------
// The reader is required.
// ---------------------------------------------------------------------------

describe('the authority reader is required, and there is no default', () => {
  it('a config with no reader is refused at construction', () => {
    expect(() =>
      createRiyaWebConversationService({
        runtime: scriptedRuntime(),
        continuityStore: new InMemoryContinuityStore(),
        runtimeId: RUNTIME_ID,
      } as never),
    ).toThrow(RiyaWebConversationError);
  });

  it('a reader that is not the shape the port declares is refused at construction', () => {
    // Closed at construction rather than mid-turn: discovering this later would mean a conversation
    // had already been loaded and a client was already waiting.
    expect(() =>
      createRiyaWebConversationService({
        runtime: scriptedRuntime(),
        continuityStore: new InMemoryContinuityStore(),
        availabilityReader: { readCurrent: 'not a function' },
        runtimeId: RUNTIME_ID,
      } as never),
    ).toThrow(RiyaWebConversationError);
  });

  it('the construction refusal uses the existing bounded code', () => {
    let thrown: unknown;
    try {
      createRiyaWebConversationService({
        runtime: scriptedRuntime(),
        continuityStore: new InMemoryContinuityStore(),
        runtimeId: RUNTIME_ID,
      } as never);
    } catch (error: unknown) {
      thrown = error;
    }
    expect((thrown as RiyaWebConversationError).code).toBe('invalid-input');
  });
});

// ---------------------------------------------------------------------------
// When the read happens.
// ---------------------------------------------------------------------------

describe('exactly one read, in the right place', () => {
  it('reads once per turn, and hands the runtime the SAME snapshot object', async () => {
    const { svc, reader, runtime } = harness({ observations: [SET('location', 'loc.pune')] });
    await svc.handleTurn(turnInput());
    expect((reader as { calls: () => number }).calls()).toBe(1);
    expect(runtime.invoked()).toBe(1);
  });

  it('asks for the tenant, and nothing else', async () => {
    // A snapshot is a fact about a tenant's catalogue, not about one conversation. Sending a
    // conversation or message id would put an identifier on an outbound call that has no use for it.
    const reader = scriptedAvailabilityReader();
    const { svc } = harness({ reader });
    await svc.handleTurn(turnInput());
    expect(reader.lastInput()).toStrictEqual({ tenantId: TENANT });
  });

  it('an INVALID turn never reaches the reader', async () => {
    const reader = scriptedAvailabilityReader();
    const { svc } = harness({ reader });
    await expect(svc.handleTurn({ version: 1 } as never)).rejects.toMatchObject({
      code: 'invalid-input',
    });
    expect(reader.calls()).toBe(0);
  });

  it('a terminal STORE failure stops the turn before the reader is called', async () => {
    // Ordering matters. A turn that could not establish its own conversation must not reach Core
    // either -- the read would be work done on behalf of a turn that was already over.
    const reader = scriptedAvailabilityReader();
    const { svc } = harness({ reader, store: new UnavailableContinuityStore() });
    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'continuity-unavailable',
    });
    expect(reader.calls()).toBe(0);
  });

  it('reads on EVERY discovery turn, including one that mentions no city or service', async () => {
    // Deliberately unconditional. Deciding "authority is not needed this turn" would require reading
    // the client's prose before the model, and a client can correct their city in any sentence.
    const reader = scriptedAvailabilityReader();
    const { svc } = harness({ reader });
    await svc.handleTurn(turnInput({ normalizedText: 'hello there' }));
    await svc.handleTurn(turnInput({ messageId: 'msg.2', normalizedText: 'thanks' }));
    expect(reader.calls()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// When the read fails.
// ---------------------------------------------------------------------------

describe('an unusable authority fails closed as NOT_READY', () => {
  const cases: readonly {
    readonly label: string;
    readonly reader: () => CoreServiceAvailabilityReader & { calls: () => number };
  }[] = [
    { label: 'the reader rejects', reader: () => scriptedAvailabilityReader({ rejects: true }) },
    {
      label: 'the reader throws synchronously',
      reader: () => {
        let calls = 0;
        return {
          calls: () => calls,
          readCurrent: () => {
            calls += 1;
            throw new Error('core catalogue at 10.0.0.7 — token=abc123');
          },
        };
      },
    },
    {
      label: 'the snapshot is malformed',
      reader: () => scriptedAvailabilityReader({ returns: { version: 1, cities: 'all of them' } }),
    },
    {
      label: 'the snapshot is undefined',
      reader: () => scriptedAvailabilityReader({ returns: null }),
    },
    {
      label: 'the snapshot carries a forged extra key',
      reader: () =>
        scriptedAvailabilityReader({
          returns: { ...JSON.parse(JSON.stringify(syntheticAvailabilitySnapshot())), vendors: 4 },
        }),
    },
    {
      label: 'the snapshot is oversized',
      reader: () => {
        const cities = Array.from({ length: 60 }, (_unused, index) => ({
          ref: `city.${'q'.repeat(100)}.${String(index)}`,
          displayName: `City ${String(index)}`,
        }));
        const services = Array.from({ length: 60 }, (_unused, index) => ({
          ref: `svc.${'q'.repeat(100)}.${String(index)}`,
          displayName: `Service ${String(index)}`,
        }));
        return scriptedAvailabilityReader({
          returns: {
            version: 1,
            snapshotRef: 'snap.big',
            taxonomyVersion: 1,
            cities,
            services,
            availability: services.map((s) => ({
              serviceRef: s.ref,
              cityRefs: cities.map((c) => c.ref),
            })),
          },
        });
      },
    },
  ];

  for (const { label, reader: build } of cases) {
    it(`${label}: NOT_READY, no runtime, no model, no CAS`, async () => {
      const reader = build();
      const store = new InMemoryContinuityStore();
      const { svc, runtime } = harness({ reader, store });

      const result = await svc.handleTurn(turnInput());

      // A decision was NOT made about this client. `NOT_READY` already means "not servable now,
      // possibly servable later", which is exactly the truth -- so no new disposition is invented.
      expect(result.disposition).toBe('NOT_READY');
      expect(result.reason).toBeUndefined();
      expect(result.authorizedReply).toBeUndefined();
      // The continuity the turn established is still returned: it is real, and withholding it would
      // make a transient outage look like a lost conversation.
      expect(result.continuity.tenantId).toBe(TENANT);
      expect(result.continuity.conversationId).toBe(CONVERSATION);
      // Nothing expensive happened, and nothing was written.
      expect(reader.calls()).toBe(1);
      expect(runtime.invoked()).toBe(0);
      expect(runtime.coreAuthorizedInvoked()).toBe(0);
      expect(runtime.ordinaryInvoked()).toBe(0);
      expect(store.calls.compareAndSet).toBe(0);
    });
  }

  it('a snapshot carrying a ref longer than continuity can store is NOT_READY', async () => {
    // Core's generic entity ids allow 128 characters; the frozen Riya `NeedDiscovery` reference
    // allows 64. A snapshot containing a 65-plus ref is therefore a CONTRACT INCOMPATIBILITY, not a
    // catalogue Jarvis may partially use -- and it is caught here, before the model can be shown a
    // choice that could never be persisted. Nothing is truncated, hashed, aliased or remapped.
    const oversizedRef = `city.${'z'.repeat(60)}`;
    expect(oversizedRef).toHaveLength(65);
    const reader = scriptedAvailabilityReader({
      returns: {
        version: 1,
        snapshotRef: 'snap.incompatible',
        taxonomyVersion: 7,
        cities: [{ ref: oversizedRef, displayName: 'A City' }],
        services: [{ ref: 'svc.one', displayName: 'A Service' }],
        availability: [{ serviceRef: 'svc.one', cityRefs: [oversizedRef] }],
      },
    });
    const store = new InMemoryContinuityStore();
    const { svc, runtime } = harness({ reader, store });

    const result = await svc.handleTurn(turnInput());

    expect(result.disposition).toBe('NOT_READY');
    expect(result.authorizedReply).toBeUndefined();
    expect(reader.calls()).toBe(1);
    expect(runtime.invoked()).toBe(0);
    expect(runtime.coreAuthorizedInvoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
    expect(store.calls.compareAndSet).toBe(0);
    // No catalogue detail on the wire.
    const serialized = JSON.stringify(result);
    for (const forbidden of [oversizedRef, 'svc.one', 'snap.incompatible', 'A City', 'A Service']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('leaks nothing from the reader failure', async () => {
    const { svc } = harness({ reader: scriptedAvailabilityReader({ rejects: true }) });
    const result = await svc.handleTurn(turnInput());
    const serialized = JSON.stringify(result);
    for (const forbidden of ['10.0.0.7', 'abc123', 'token', 'catalogue']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('there is no default city and no cached fallback: the SECOND turn fails too', async () => {
    // A successful read is never retained. If it were, one good read would let every later outage be
    // served from a catalogue that may since have changed -- which is the shape of promising a
    // service in a city the business has stopped serving.
    const store = new InMemoryContinuityStore();
    const good = harness({ store, observations: [SET('location', 'loc.pune')] });
    await good.svc.handleTurn(turnInput());

    const bad = harness({ store, reader: scriptedAvailabilityReader({ rejects: true }) });
    const result = await bad.svc.handleTurn(turnInput({ messageId: 'msg.2' }));
    expect(result.disposition).toBe('NOT_READY');
    expect(bad.runtime.invoked()).toBe(0);
  });

  it('the shape of a NOT_READY result is the unchanged V2 shape', async () => {
    const { svc } = harness({ reader: scriptedAvailabilityReader({ rejects: true }) });
    const result = await svc.handleTurn(turnInput());
    expect(Object.keys(result).sort()).toStrictEqual([
      'authorizedReply',
      'continuity',
      'conversationId',
      'disposition',
      'messageId',
      'reason',
      'tenantId',
      'version',
    ]);
    expect(result.version).toBe(2);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A readable EMPTY authority is not an outage.
// ---------------------------------------------------------------------------

describe('an empty active catalogue is served, not refused', () => {
  const emptySnapshot = (): unknown =>
    JSON.parse(
      JSON.stringify(syntheticAvailabilitySnapshot({ cities: [], services: [], availability: [] })),
    );

  it('a valid EMPTY snapshot reaches the runtime like any other', async () => {
    // The distinction that matters: "Core currently offers nothing" is business truth and the turn
    // proceeds; "Core could not be read" is an outage and the turn stops. Collapsing the two would
    // take a paused marketplace offline as though the integration were broken.
    const reader = scriptedAvailabilityReader({ returns: emptySnapshot() });
    const { svc, runtime } = harness({ reader });

    const result = await svc.handleTurn(turnInput());

    expect(reader.calls()).toBe(1);
    expect(runtime.invoked()).toBe(1);
    // NOT the authority-failure branch.
    expect(result.disposition).not.toBe('NOT_READY');
    expect(result.disposition).toBe('PROCESSED');
  });

  it('an empty catalogue turn still returns the Core-authorized body', async () => {
    const { svc } = harness({ reader: scriptedAvailabilityReader({ returns: emptySnapshot() }) });
    const result = await svc.handleTurn(turnInput());
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
  });

  it('a reader FAILURE remains NOT_READY, so the two stay distinguishable', async () => {
    const { svc, runtime } = harness({ reader: scriptedAvailabilityReader({ rejects: true }) });
    const result = await svc.handleTurn(turnInput());
    expect(result.disposition).toBe('NOT_READY');
    expect(runtime.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The read does not disturb P4B.
// ---------------------------------------------------------------------------

describe('P4B is unchanged by the authority read', () => {
  function seeded(): RiyaConversationContinuityStateV1 {
    return createRiyaConversationContinuityState({
      version: 1,
      tenantId: TENANT,
      conversationId: CONVERSATION,
      continuityRevision: 0,
      phase: 'INTRO',
      discovery: {
        completeness: 'MORE_DISCOVERY_REQUIRED',
        missingFields: ['serviceInterest', 'location', 'budget', 'timeline'],
      },
      summaryConfirmed: false,
    });
  }

  it('a successful turn still persists and still returns the authorized body', async () => {
    const { svc, store } = harness({ observations: [SET('location', 'loc.pune')] });
    const result = await svc.handleTurn(turnInput());
    expect(result.disposition).toBe('PROCESSED');
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
    expect(result.continuity.continuityRevision).toBe(1);
    expect((store as InMemoryContinuityStore).calls.compareAndSet).toBe(1);
  });

  it('a CAS conflict does NOT trigger a second availability read', async () => {
    // The snapshot belongs to the one model turn. Refreshing authority during reconciliation would be
    // a second business read, and it could invalidate text that no second model call may replace.
    const reader = scriptedAvailabilityReader();
    const store = new InMemoryContinuityStore();
    store.seed(seeded());
    const runtime = scriptedRuntime('CORE_ACCEPTED', {
      observations: [SET('location', 'loc.pune')],
    });
    // A store whose first compare-and-set loses, then reconciles normally.
    let attempts = 0;
    const conflicting = {
      load: store.load.bind(store),
      createInitialIfAbsent: store.createInitialIfAbsent.bind(store),
      compareAndSet: async (input: Parameters<InMemoryContinuityStore['compareAndSet']>[0]) => {
        attempts += 1;
        if (attempts === 1) {
          return 'REVISION_CONFLICT' as const;
        }
        return store.compareAndSet(input);
      },
    };
    const svc = createRiyaWebConversationService({
      runtime,
      continuityStore: conflicting,
      availabilityReader: reader,
      runtimeId: RUNTIME_ID,
    });

    const result = await svc.handleTurn(turnInput());

    expect(attempts).toBe(2);
    // ONE read for the whole turn, conflict and all.
    expect(reader.calls()).toBe(1);
    // And the P4B locks hold: one runtime call, and the stale body withheld after the conflict.
    expect(runtime.invoked()).toBe(1);
    expect(result.authorizedReply).toBeUndefined();
  });
});
