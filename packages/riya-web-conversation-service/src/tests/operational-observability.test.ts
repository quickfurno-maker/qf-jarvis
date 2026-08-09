/**
 * RWC-P9 — the service tells an operator what happened, and nothing about whom (ADR-0105).
 *
 * ### Three properties, in order of how badly they fail
 *
 * **It can never change an outcome.** The whole matrix below runs twice — once with a recording hook
 * and once with a hook that throws on every single event — and the outcomes must be identical. A
 * metrics failure is not a conversation failure, and a client waiting for an answer must never learn
 * that a counter broke.
 *
 * **It is content-free.** Every turn in the leak spec carries unique sentinels in its tenant,
 * conversation, message, source reference, subject and text, and no sentinel may appear anywhere in
 * the serialized event stream. This is the strongest lock in the slice: a telemetry stream fans out to
 * sinks nobody reviewed and is retained longer than anything else, and RWC-P8 went to real trouble not
 * to store a message or a digest of one. Emitting the identifiers it declined to store would hand them
 * to that pipeline instead.
 *
 * **It is honest about durability.** `text-turn-processing-started` is emitted only once the claim is
 * written, so an operator counting it is counting messages that can never be re-run.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import type { RiyaConversationTurnV1 } from '../contracts/channel-turn.js';
import { RiyaWebConversationError } from '../contracts/errors.js';
import {
  NOOP_RIYA_CONVERSATION_OPERATIONAL_OBSERVABILITY,
  RIYA_CONVERSATION_OPERATIONAL_EVENT_TYPES,
} from '../contracts/operational-observability.js';
import type {
  RiyaConversationOperationalEvent,
  RiyaConversationOperationalObservabilityHook,
} from '../contracts/operational-observability.js';
import { createRiyaWebConversationService } from '../service/create-service.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
import { gatedRuntime } from './fakes/gated-runtime.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';
import type { ScriptedTurnCoordinatorOptions } from './fakes/scripted-turn-coordinator.js';
import { scriptedTurnCoordinator } from './fakes/scripted-turn-coordinator.js';

const TURN: RiyaConversationTurnV1 = Object.freeze({
  version: 1,
  channel: 'WEB',
  tenantId: 'tenant.a',
  conversationId: 'conv.1',
  messageId: 'msg.1',
  receivedAt: '2026-08-01T09:00:00Z',
  channelTurnRef: 'src.msg.1',
  dataClass: 'HOSTED_ALLOWED',
});

/** Every key any event is permitted to carry. Anything else is a leak by definition. */
const ALLOWED_KEYS: readonly string[] = [
  'activeTurns',
  'beginOutcome',
  'channel',
  'disposition',
  'errorCode',
  'maxConcurrentTurns',
  'phase',
  'type',
];

interface Recorder extends RiyaConversationOperationalObservabilityHook {
  events(): readonly RiyaConversationOperationalEvent[];
  types(): readonly string[];
}

function recorder(): Recorder {
  const events: RiyaConversationOperationalEvent[] = [];
  return {
    record: (event) => {
      events.push(event);
    },
    events: () => events,
    types: () => events.map((event) => event.type),
  };
}

/** A hook that fails at every opportunity. */
const hostileHook: RiyaConversationOperationalObservabilityHook = {
  record: () => {
    throw new Error('metrics sink at 10.0.0.9 — token=abc123 is down');
  },
};

function harness(
  over: {
    readonly observability?: RiyaConversationOperationalObservabilityHook;
    readonly capacity?: number;
    readonly coordinatorOptions?: ScriptedTurnCoordinatorOptions;
    readonly storeThrows?: boolean;
    readonly availabilityRejects?: boolean;
    readonly runtimeThrows?: boolean;
  } = {},
) {
  const coordinator = scriptedTurnCoordinator(over.coordinatorOptions ?? {});
  const svc = createRiyaWebConversationService({
    maxConcurrentTextTurns: over.capacity ?? 8,
    runtime: scriptedRuntime('CORE_ACCEPTED', {
      ...(over.runtimeThrows === true ? { throws: true } : {}),
    }),
    continuityStore:
      over.storeThrows === true ? new UnavailableContinuityStore() : new InMemoryContinuityStore(),
    availabilityReader: scriptedAvailabilityReader(
      over.availabilityRejects === true ? { rejects: true } : {},
    ),
    turnCoordinator: coordinator,
    runtimeId: 'rt.1',
    ...(over.observability === undefined ? {} : { observability: over.observability }),
  });
  return { svc, coordinator };
}

const settle = async (run: () => Promise<{ disposition: string }>): Promise<string> => {
  try {
    return (await run()).disposition;
  } catch (error: unknown) {
    return error instanceof RiyaWebConversationError ? error.code : 'not-a-service-error';
  }
};

// ---------------------------------------------------------------------------
// 1. The vocabulary is closed, and the default is silence.
// ---------------------------------------------------------------------------

describe('the operational vocabulary is closed and frozen', () => {
  it('is exactly six event types', () => {
    expect([...RIYA_CONVERSATION_OPERATIONAL_EVENT_TYPES]).toStrictEqual([
      'text-turn-admitted',
      'text-turn-overloaded',
      'text-turn-coordinator-outcome',
      'text-turn-processing-started',
      'text-turn-completed',
      'text-turn-failed',
    ]);
    expect(Object.isFrozen(RIYA_CONVERSATION_OPERATIONAL_EVENT_TYPES)).toBe(true);
  });

  it('absent configuration means silence, not a hidden logger', async () => {
    // The default must be a no-op the deployment chose implicitly, not a console writer that starts
    // printing a production conversation's shape to stdout.
    expect(Object.isFrozen(NOOP_RIYA_CONVERSATION_OPERATIONAL_OBSERVABILITY)).toBe(true);
    NOOP_RIYA_CONVERSATION_OPERATIONAL_OBSERVABILITY.record({ type: 'text-turn-admitted' });
    const { svc } = harness();
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('PROCESSED');
  });
});

// ---------------------------------------------------------------------------
// 2. What each path emits.
// ---------------------------------------------------------------------------

describe('each turn emits the sequence an operator needs, and no more', () => {
  it('a normal turn: admitted, classified, started, completed', async () => {
    const hook = recorder();
    const { svc } = harness({ observability: hook });
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('PROCESSED');

    expect(hook.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-processing-started',
      'text-turn-completed',
    ]);
    expect(hook.events()[0]).toStrictEqual({
      type: 'text-turn-admitted',
      channel: 'WEB',
      activeTurns: 1,
      maxConcurrentTurns: 8,
    });
    expect(hook.events()[1]).toStrictEqual({
      type: 'text-turn-coordinator-outcome',
      channel: 'WEB',
      beginOutcome: 'ACQUIRED',
    });
    expect(hook.events()[3]).toStrictEqual({
      type: 'text-turn-completed',
      channel: 'WEB',
      phase: 'INTRO',
      disposition: 'PROCESSED',
    });
  });

  it('an overload: refused, with the gauge, and nothing else at all', async () => {
    const hook = recorder();
    const runtime = gatedRuntime();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 1,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: scriptedTurnCoordinator(),
      runtimeId: 'rt.1',
      observability: hook,
    });
    const held = svc.handleChannelTurn(TURN);
    await runtime.awaitArrivals(1);
    expect(await settle(() => svc.handleChannelTurn({ ...TURN, conversationId: 'conv.2' }))).toBe(
      'turn-overloaded',
    );

    // No coordinator outcome for the refused turn, because there was no coordinator call.
    expect(hook.events().filter((event) => event.type === 'text-turn-overloaded')).toStrictEqual([
      {
        type: 'text-turn-overloaded',
        channel: 'WEB',
        activeTurns: 1,
        maxConcurrentTurns: 1,
      },
    ]);
    runtime.releaseAll();
    await held;
  });

  it('the gauge on an overload reports saturation, which is the earliest honest warning', async () => {
    const hook = recorder();
    const runtime = gatedRuntime();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 3,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: scriptedTurnCoordinator(),
      runtimeId: 'rt.1',
      observability: hook,
    });
    const held = Array.from({ length: 3 }, (_unused, index) =>
      svc.handleChannelTurn({
        ...TURN,
        conversationId: `c.${String(index)}`,
        messageId: `m.${String(index)}`,
        channelTurnRef: `s.${String(index)}`,
      }),
    );
    await runtime.awaitArrivals(3);

    // Admissions count up as slots are taken, and the refusal reports a full replica.
    expect(
      hook
        .events()
        .filter((event) => event.type === 'text-turn-admitted')
        .map((event) => event.activeTurns),
    ).toStrictEqual([1, 2, 3]);

    expect(await settle(() => svc.handleChannelTurn({ ...TURN, conversationId: 'c.9' }))).toBe(
      'turn-overloaded',
    );
    const refusal = hook.events().find((event) => event.type === 'text-turn-overloaded');
    expect(refusal?.activeTurns).toBe(3);
    expect(refusal?.maxConcurrentTurns).toBe(3);

    runtime.releaseAll();
    await Promise.all(held);
  });

  it.each([
    ['BUSY', 'turn-in-flight'],
    ['REPLAYED', 'turn-replayed'],
    ['CONFLICT', 'turn-conflict'],
    ['INDETERMINATE', 'turn-indeterminate'],
  ] as const)(
    'a %s classification is reported once, and no claim is ever started',
    async (outcome, errorCode) => {
      const hook = recorder();
      const { svc, coordinator } = harness({ observability: hook });

      if (outcome === 'BUSY') {
        coordinator.holdConversation('tenant.a', 'conv.1');
        expect(await settle(() => svc.handleChannelTurn(TURN))).toBe(errorCode);
      } else if (outcome === 'REPLAYED') {
        await svc.handleChannelTurn(TURN);
        expect(await settle(() => svc.handleChannelTurn(TURN))).toBe(errorCode);
      } else if (outcome === 'CONFLICT') {
        await svc.handleChannelTurn(TURN);
        expect(await settle(() => svc.handleChannelTurn({ ...TURN, messageId: 'msg.9' }))).toBe(
          errorCode,
        );
      } else {
        const failing = harness({ observability: hook, runtimeThrows: true });
        await settle(() => failing.svc.handleChannelTurn(TURN));
        expect(await settle(() => failing.svc.handleChannelTurn(TURN))).toBe(errorCode);
      }

      const last = hook.events().slice(-3);
      expect(last.map((event) => event.type)).toStrictEqual([
        'text-turn-admitted',
        'text-turn-coordinator-outcome',
        'text-turn-failed',
      ]);
      expect(last[1]?.beginOutcome).toBe(outcome);
      expect(last[2]?.errorCode).toBe(errorCode);
      // A refused classification never reaches the claim, so it never reports one.
      expect(
        hook.events().filter((event) => event.type === 'text-turn-processing-started').length,
      ).toBeLessThanOrEqual(1);
    },
  );

  it('an unavailable coordinator is reported as a failure with no classification', async () => {
    const hook = recorder();
    const { svc } = harness({ observability: hook, coordinatorOptions: { beginRejects: true } });
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('turn-coordinator-unavailable');
    expect(hook.types()).toStrictEqual(['text-turn-admitted', 'text-turn-failed']);
    // No `beginOutcome`: nothing classified this message, which is precisely the operator's problem.
    expect(hook.events()[1]).toStrictEqual({
      type: 'text-turn-failed',
      channel: 'WEB',
      errorCode: 'turn-coordinator-unavailable',
    });
  });

  it('processing-started is emitted ONLY once the claim exists', async () => {
    // An ambiguous insert must not produce a "started" count. An operator reading that column is
    // reading how many messages can never be re-run, and inflating it inflates duplicate risk.
    const hook = recorder();
    const { svc } = harness({ observability: hook, coordinatorOptions: { startRejects: true } });
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('turn-indeterminate');
    expect(hook.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-failed',
    ]);
  });

  it('a failure after the claim reports the BOUNDED code, never the cause', async () => {
    const hook = recorder();
    const { svc } = harness({ observability: hook, runtimeThrows: true });
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('runtime-unavailable');
    expect(hook.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-processing-started',
      'text-turn-failed',
    ]);
    const serialized = JSON.stringify(hook.events());
    expect(serialized).not.toContain('10.0.0.1');
    expect(serialized).not.toContain('hunter2');
  });

  it('a preflight failure before the claim reports the reason and no start', async () => {
    const hook = recorder();
    const { svc } = harness({ observability: hook, storeThrows: true });
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('continuity-unavailable');
    expect(hook.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-failed',
    ]);
    expect(hook.events()[2]?.errorCode).toBe('continuity-unavailable');
  });

  it('a NOT_READY answer is a completion, not a failure', async () => {
    // It is a bounded, intended result -- the service declined to run a turn it could not prove was
    // authorized. Counting it as a failure would make an availability outage look like a defect here.
    const hook = recorder();
    const { svc } = harness({ observability: hook, availabilityRejects: true });
    expect(await settle(() => svc.handleChannelTurn(TURN))).toBe('NOT_READY');
    expect(hook.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-completed',
    ]);
    expect(hook.events()[2]?.disposition).toBe('NOT_READY');
  });
});

// ---------------------------------------------------------------------------
// 3. Adversarial content leakage.
// ---------------------------------------------------------------------------

describe('no identifier, digest or word a client wrote reaches an event', () => {
  const SENTINELS = [
    'SENT-TENANT-3f9a',
    'SENT-CONV-8c11',
    'SENT-MSG-42be',
    'SENT-SRC-77dd',
    'SENT-SUBJ-91ff',
    'SENT-TEXT-a5e2',
  ] as const;

  const marked = (over: Partial<RiyaConversationTurnV1> = {}): RiyaConversationTurnV1 =>
    Object.freeze({
      version: 1,
      channel: 'WEB',
      tenantId: SENTINELS[0],
      conversationId: SENTINELS[1],
      messageId: SENTINELS[2],
      receivedAt: '2026-08-01T09:00:00Z',
      channelTurnRef: SENTINELS[3],
      subjectRef: SENTINELS[4],
      dataClass: 'HOSTED_ALLOWED',
      normalizedText: `my budget is 12 lakh and my name is ${SENTINELS[5]}`,
      ...over,
    });

  it('drives every path with marked input and finds no sentinel anywhere', async () => {
    const hook = recorder();

    // Overload.
    const gated = gatedRuntime();
    const tight = createRiyaWebConversationService({
      maxConcurrentTextTurns: 1,
      runtime: gated,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: scriptedTurnCoordinator(),
      runtimeId: 'rt.1',
      observability: hook,
    });
    const held = tight.handleChannelTurn(marked());
    await gated.awaitArrivals(1);
    await settle(() => tight.handleChannelTurn(marked({ conversationId: 'SENT-CONV-8c11-b' })));
    gated.releaseAll();
    await held;

    // Success, replay, conflict, busy, indeterminate, and each bounded failure.
    const normal = harness({ observability: hook });
    await settle(() => normal.svc.handleChannelTurn(marked()));
    await settle(() => normal.svc.handleChannelTurn(marked()));
    await settle(() => normal.svc.handleChannelTurn(marked({ messageId: 'SENT-MSG-42be-b' })));
    normal.coordinator.holdConversation(SENTINELS[0], `${SENTINELS[1]}.busy`);
    await settle(() =>
      normal.svc.handleChannelTurn(marked({ conversationId: `${SENTINELS[1]}.busy` })),
    );

    for (const broken of [
      harness({ observability: hook, coordinatorOptions: { beginRejects: true } }),
      harness({ observability: hook, coordinatorOptions: { startRejects: true } }),
      harness({ observability: hook, coordinatorOptions: { completeRejects: true } }),
      harness({ observability: hook, storeThrows: true }),
      harness({ observability: hook, availabilityRejects: true }),
      harness({ observability: hook, runtimeThrows: true }),
    ]) {
      await settle(() => broken.svc.handleChannelTurn(marked()));
    }

    expect(hook.events().length).toBeGreaterThan(20);
    const serialized = JSON.stringify(hook.events());
    for (const sentinel of SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
    // Nor a digest OF one: a stream of correlatable fingerprints is the same disclosure wearing a
    // hash. Every field is a closed enum or a count, so a 32-character hex run cannot occur.
    expect(serialized).not.toMatch(/[0-9a-f]{32,}/i);
    expect(serialized).not.toContain('rt.1');
    expect(serialized).not.toContain('lakh');
  });

  it('every event carries only approved keys and a known type', async () => {
    const hook = recorder();
    const { svc, coordinator } = harness({ observability: hook });
    await settle(() => svc.handleChannelTurn(marked()));
    await settle(() => svc.handleChannelTurn(marked()));
    coordinator.holdConversation(SENTINELS[0], 'held');
    await settle(() => svc.handleChannelTurn(marked({ conversationId: 'held' })));

    for (const event of hook.events()) {
      expect(RIYA_CONVERSATION_OPERATIONAL_EVENT_TYPES).toContain(event.type);
      for (const key of Object.keys(event)) {
        expect(ALLOWED_KEYS).toContain(key);
      }
      // Frozen on the way out, so one sink cannot mutate an event another sink will read.
      expect(Object.isFrozen(event)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Observability is never an authority.
// ---------------------------------------------------------------------------

describe('a hook that throws on every event changes nothing', () => {
  const scenarios = [
    ['a normal turn', {}, 'PROCESSED'],
    [
      'an unavailable coordinator',
      { coordinatorOptions: { beginRejects: true } },
      'turn-coordinator-unavailable',
    ],
    ['an ambiguous start', { coordinatorOptions: { startRejects: true } }, 'turn-indeterminate'],
    [
      'an ambiguous finalization',
      { coordinatorOptions: { completeRejects: true } },
      'turn-indeterminate',
    ],
    [
      'an unprovable release',
      { availabilityRejects: true, coordinatorOptions: { releaseRejects: true } },
      'turn-coordinator-unavailable',
    ],
    ['an unavailable store', { storeThrows: true }, 'continuity-unavailable'],
    ['an unprovable availability answer', { availabilityRejects: true }, 'NOT_READY'],
    ['a runtime failure', { runtimeThrows: true }, 'runtime-unavailable'],
  ] as const;

  it.each(scenarios)(
    '%s settles identically with and without a hostile hook',
    async (_name, options, expected) => {
      const quiet = harness(options);
      const hostile = harness({ ...options, observability: hostileHook });

      const quietOutcome = await settle(() => quiet.svc.handleChannelTurn(TURN));
      const hostileOutcome = await settle(() => hostile.svc.handleChannelTurn(TURN));

      expect(quietOutcome).toBe(expected);
      expect(hostileOutcome).toBe(expected);
      // Structurally identical, not merely equally-failed: the same lease operations in the same counts.
      expect({
        begins: hostile.coordinator.begins(),
        starts: hostile.coordinator.starts(),
        completes: hostile.coordinator.completes(),
        indeterminates: hostile.coordinator.indeterminates(),
        releases: hostile.coordinator.releases(),
      }).toStrictEqual({
        begins: quiet.coordinator.begins(),
        starts: quiet.coordinator.starts(),
        completes: quiet.coordinator.completes(),
        indeterminates: quiet.coordinator.indeterminates(),
        releases: quiet.coordinator.releases(),
      });
    },
  );

  it('a hostile hook does not leak a capacity slot', async () => {
    // The refusal path emits BEFORE it throws the bounded error, and the admitted path emits inside
    // the region the `finally` protects. A hook throwing in either place must not eat a slot.
    const runtime = gatedRuntime();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 1,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: scriptedTurnCoordinator(),
      runtimeId: 'rt.1',
      observability: hostileHook,
    });
    const held = svc.handleChannelTurn(TURN);
    await runtime.awaitArrivals(1);
    expect(await settle(() => svc.handleChannelTurn({ ...TURN, conversationId: 'c2' }))).toBe(
      'turn-overloaded',
    );
    runtime.releaseAll();
    expect((await held).disposition).toBe('PROCESSED');

    const after = svc.handleChannelTurn({ ...TURN, conversationId: 'c3', messageId: 'm3' });
    await runtime.awaitArrivals(2);
    runtime.releaseAll();
    expect((await after).disposition).toBe('PROCESSED');
  });

  it('the hook is called SYNCHRONOUSLY, so nothing is ever awaited on a client turn', async () => {
    // An awaited hook would put a metrics sink on the critical path of a client's answer; a
    // fire-and-forget one would surface its rejection as an unhandled rejection somewhere unrelated.
    // A synchronous, `void`-returning contract is the only shape with neither failure.
    //
    // The proof is ordering: a hook that runs LATER than the statement following it would show up as
    // an event recorded after the turn had already settled.
    const seen: string[] = [];
    const { svc } = harness({
      observability: {
        record: (event) => {
          seen.push(event.type);
        },
      },
    });
    const running = svc.handleChannelTurn(TURN);
    // Recorded before a single microtask has been yielded to: `text-turn-admitted` is emitted inside
    // the synchronous prologue of `handleChannelTurn`, before its first `await`.
    expect(seen).toStrictEqual(['text-turn-admitted']);
    seen.push('AFTER-SETTLED');
    expect((await running).disposition).toBe('PROCESSED');
    expect(seen.indexOf('AFTER-SETTLED')).toBe(1);
    expect(seen).toStrictEqual([
      'text-turn-admitted',
      'AFTER-SETTLED',
      'text-turn-coordinator-outcome',
      'text-turn-processing-started',
      'text-turn-completed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. Terminal events describe the FINAL surfaced outcome (owner correction, PR #110).
// ---------------------------------------------------------------------------

/**
 * RWC-P8 deliberately lets lease cleanup REPLACE an outcome.
 *
 * A safe pre-start result -- a `NOT_READY`, or a thrown `continuity-unavailable` -- is not final
 * until the conversation lease has been PROVED released. If `releaseUnstarted` fails, the surfaced
 * answer becomes `turn-coordinator-unavailable`, because a conversation that may still be locked is
 * the higher-order fact: a `NOT_READY` returned there would invite an immediate retry that BUSY
 * would then refuse, for a reason nothing in the response explains.
 *
 * Observing the terminal outcome inside the claimed-turn pipeline therefore recorded a PROVISIONAL
 * one. Two concrete lies came out of it: a `text-turn-completed` for a turn whose caller received an
 * error, and a `text-turn-failed / continuity-unavailable` for a turn whose caller was told
 * `turn-coordinator-unavailable`. The second is the worse kind -- operations and the caller
 * disagreeing about the same turn, during the phase whose entire purpose is operational readiness.
 *
 * The terminal observations now live in the admission wrapper, outside that cleanup.
 */
function wired(
  over: {
    readonly coordinatorOptions?: ScriptedTurnCoordinatorOptions;
    readonly storeThrows?: boolean;
    readonly availabilityRejects?: boolean;
    readonly runtimeThrows?: boolean;
    readonly completeRejects?: boolean;
  } = {},
) {
  const coordinator = scriptedTurnCoordinator(over.coordinatorOptions ?? {});
  const runtime = scriptedRuntime('CORE_ACCEPTED', {
    ...(over.runtimeThrows === true ? { throws: true } : {}),
  });
  const events: RiyaConversationOperationalEvent[] = [];
  /** One shared ordering log: lease operations and events interleaved as they actually happened. */
  const sequence: string[] = [];

  const svc = createRiyaWebConversationService({
    maxConcurrentTextTurns: 8,
    runtime,
    continuityStore:
      over.storeThrows === true ? new UnavailableContinuityStore() : new InMemoryContinuityStore(),
    availabilityReader: scriptedAvailabilityReader(
      over.availabilityRejects === true ? { rejects: true } : {},
    ),
    turnCoordinator: coordinator,
    runtimeId: 'rt.1',
    observability: {
      record: (event) => {
        events.push(event);
        // Sampled AT EMISSION. Asserting counters after the turn settles would prove nothing about
        // ORDER -- the whole defect was an event emitted at the right count but the wrong moment.
        sequence.push(
          `${event.type}|releases=${String(coordinator.releases())}|completes=${String(
            coordinator.completes(),
          )}`,
        );
      },
    },
  });

  return {
    svc,
    coordinator,
    runtime,
    events: () => events,
    types: () => events.map((event) => event.type),
    sequence: () => sequence,
    terminals: () =>
      events.filter(
        (event) => event.type === 'text-turn-completed' || event.type === 'text-turn-failed',
      ),
  };
}

describe('a terminal event reports what the CALLER received, not what was provisionally decided', () => {
  it('NOT_READY whose release cannot be proved: one failure, and NO completion', async () => {
    // THE primary correction proof. Before the fix this recorded `text-turn-completed / NOT_READY`
    // for a turn whose caller got `turn-coordinator-unavailable`.
    const h = wired({
      availabilityRejects: true,
      coordinatorOptions: { releaseRejects: true },
    });

    expect(await settle(() => h.svc.handleChannelTurn(TURN))).toBe('turn-coordinator-unavailable');

    expect(h.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-failed',
    ]);
    expect(h.events().filter((event) => event.type === 'text-turn-completed')).toStrictEqual([]);
    expect(h.terminals()).toHaveLength(1);
    expect(h.terminals()[0]?.errorCode).toBe('turn-coordinator-unavailable');
    // Nothing ran and nothing was claimed, which is why the message stays retryable.
    expect(h.runtime.invoked()).toBe(0);
    expect(h.coordinator.starts()).toBe(0);
  });

  it('a preflight error whose release fails reports the REPLACEMENT code, not the original', async () => {
    const h = wired({ storeThrows: true, coordinatorOptions: { releaseRejects: true } });

    expect(await settle(() => h.svc.handleChannelTurn(TURN))).toBe('turn-coordinator-unavailable');

    expect(h.terminals()).toHaveLength(1);
    expect(h.terminals()[0]?.errorCode).toBe('turn-coordinator-unavailable');
    // The store DID fail, and that condition really existed -- but it is not the outcome the caller
    // received, so it must not be the outcome operations sees. A dashboard pointing at continuity
    // during a coordinator incident sends an operator to the wrong system.
    expect(
      h.events().some((event) => event.errorCode === 'continuity-unavailable'),
      'no terminal event may carry the provisional reason',
    ).toBe(false);
    expect(JSON.stringify(h.events())).not.toContain('continuity-unavailable');
  });

  it('a clean NOT_READY is observed only AFTER the lease is proved released', async () => {
    // Order, not count. `releaseUnstarted` is what makes this result final, so the event has to come
    // after it -- and the shared sequence log shows the release had already happened.
    const h = wired({ availabilityRejects: true });

    expect(await settle(() => h.svc.handleChannelTurn(TURN))).toBe('NOT_READY');

    expect(h.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-completed',
    ]);
    expect(h.sequence()).toStrictEqual([
      'text-turn-admitted|releases=0|completes=0',
      'text-turn-coordinator-outcome|releases=0|completes=0',
      // The release is already recorded when the completion is observed.
      'text-turn-completed|releases=1|completes=0',
    ]);
    expect(h.coordinator.releases()).toBe(1);
  });

  it('a processed turn is observed only AFTER the claim is proved COMPLETED', async () => {
    // The RWC-P8 complete-before-body rule, restated in telemetry: an operator must never see a
    // completion the ledger does not have.
    const h = wired();

    expect(await settle(() => h.svc.handleChannelTurn(TURN))).toBe('PROCESSED');

    expect(h.sequence().at(-1)).toBe('text-turn-completed|releases=0|completes=1');
    expect(h.coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('COMPLETED');
  });

  it('processing-started stays where it was: an intermediate fact, not an outcome', async () => {
    // It is not revisable by cleanup -- the claim is on disk -- so it is correct at the moment the
    // write is proved, and moving it would make it a weaker signal, not a stronger one.
    const h = wired();
    await settle(() => h.svc.handleChannelTurn(TURN));
    expect(h.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-processing-started',
      'text-turn-completed',
    ]);

    // And an ambiguous start still produces NO started event and exactly one terminal failure.
    const ambiguous = wired({ coordinatorOptions: { startRejects: true } });
    expect(await settle(() => ambiguous.svc.handleChannelTurn(TURN))).toBe('turn-indeterminate');
    expect(ambiguous.types()).toStrictEqual([
      'text-turn-admitted',
      'text-turn-coordinator-outcome',
      'text-turn-failed',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. Exactly one terminal event per settled turn.
// ---------------------------------------------------------------------------

describe('every admitted turn that settles produces EXACTLY ONE terminal event', () => {
  const scenarios = [
    ['a processed turn', {}, 'PROCESSED'],
    ['a safe NOT_READY', { availabilityRejects: true }, 'NOT_READY'],
    ['a busy conversation', { hold: true }, 'turn-in-flight'],
    ['a replayed message', { replay: true }, 'turn-replayed'],
    ['a conflicting identity', { conflict: true }, 'turn-conflict'],
    ['an indeterminate claim', { indeterminate: true }, 'turn-indeterminate'],
    [
      'an unavailable coordinator',
      { coordinatorOptions: { beginRejects: true } },
      'turn-coordinator-unavailable',
    ],
    ['an unavailable store', { storeThrows: true }, 'continuity-unavailable'],
    ['an ambiguous start', { coordinatorOptions: { startRejects: true } }, 'turn-indeterminate'],
    ['a runtime failure', { runtimeThrows: true }, 'runtime-unavailable'],
    [
      'an ambiguous finalization',
      { coordinatorOptions: { completeRejects: true } },
      'turn-indeterminate',
    ],
    [
      'a safe result whose release fails',
      { availabilityRejects: true, coordinatorOptions: { releaseRejects: true } },
      'turn-coordinator-unavailable',
    ],
  ] as const;

  it.each(scenarios)('%s', async (_name, options, expected) => {
    const h = wired({
      ...('coordinatorOptions' in options
        ? { coordinatorOptions: options.coordinatorOptions }
        : {}),
      ...('storeThrows' in options ? { storeThrows: options.storeThrows } : {}),
      ...('availabilityRejects' in options
        ? { availabilityRejects: options.availabilityRejects }
        : {}),
      ...('runtimeThrows' in options ? { runtimeThrows: options.runtimeThrows } : {}),
    });

    if ('hold' in options) {
      h.coordinator.holdConversation('tenant.a', 'conv.1');
    }
    if ('replay' in options || 'conflict' in options || 'indeterminate' in options) {
      // Reach the terminal state under test, then clear the events so the assertion is about the
      // ONE turn that follows rather than about the setup turn.
      if ('indeterminate' in options) {
        const broken = wired({ runtimeThrows: true });
        await settle(() => broken.svc.handleChannelTurn(TURN));
        expect(await settle(() => broken.svc.handleChannelTurn(TURN))).toBe(expected);
        expect(
          broken.terminals().filter((event) => event.type === 'text-turn-failed'),
        ).toHaveLength(2);
        return;
      }
      await settle(() => h.svc.handleChannelTurn(TURN));
    }

    const before = h.terminals().length;
    const outcome = await settle(() =>
      h.svc.handleChannelTurn('conflict' in options ? { ...TURN, messageId: 'msg.9' } : TURN),
    );
    expect(outcome).toBe(expected);

    const produced = h.terminals().slice(before);
    expect(produced, 'exactly one terminal event').toHaveLength(1);
    // And it is the RIGHT kind: a returned result is a completion, a thrown one is a failure.
    const isResult = expected === 'PROCESSED' || expected === 'NOT_READY';
    expect(produced[0]?.type).toBe(isResult ? 'text-turn-completed' : 'text-turn-failed');
    if (!isResult) {
      expect(produced[0]?.errorCode).toBe(expected);
    } else {
      expect(produced[0]?.disposition).toBe(expected);
    }
  });

  it('an overload produces its own event and NO terminal event', async () => {
    // A refused turn never entered the pipeline, so it has no outcome to report. Emitting a
    // `text-turn-failed` alongside would double-count capacity refusals as service failures.
    const runtime = gatedRuntime();
    const events: RiyaConversationOperationalEvent[] = [];
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 1,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: scriptedTurnCoordinator(),
      runtimeId: 'rt.1',
      observability: {
        record: (event) => {
          events.push(event);
        },
      },
    });

    const held = svc.handleChannelTurn(TURN);
    await runtime.awaitArrivals(1);
    expect(await settle(() => svc.handleChannelTurn({ ...TURN, conversationId: 'conv.2' }))).toBe(
      'turn-overloaded',
    );

    expect(events.filter((event) => event.type === 'text-turn-overloaded')).toHaveLength(1);
    expect(
      events.some((event) => event.errorCode === 'turn-overloaded'),
      'overload is never also a terminal failure',
    ).toBe(false);

    runtime.releaseAll();
    await held;
    // The ADMITTED turn still produces exactly one terminal event of its own.
    expect(
      events.filter(
        (event) => event.type === 'text-turn-completed' || event.type === 'text-turn-failed',
      ),
    ).toHaveLength(1);
  });

  it('an invalid turn produces no events at all', async () => {
    // Rejected before admission, so it is neither admitted, refused, nor settled.
    const h = wired();
    expect(await settle(() => h.svc.handleChannelTurn({} as never))).toBe('invalid-input');
    expect(h.events()).toStrictEqual([]);
  });
});
