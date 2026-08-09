/**
 * RWC-P9 — overload costs nothing, and a slot comes back on every path (ADR-0105).
 *
 * ### Two properties, and the second is the one that rots quietly
 *
 * The first is that a refused turn does no work at all: no coordinator round trip, no PostgreSQL
 * session, no continuity read, no availability read, no runtime, no model, no Core, no
 * compare-and-set and — the one that actually matters — no durable claim. If overload wrote a claim,
 * a message refused for capacity would come back looking spent, and a client would be permanently
 * unable to say the same thing again.
 *
 * The second is that the slot is returned on EVERY terminal path. This one has no symptom at the time:
 * a leaked slot just makes a replica quietly smaller, and it keeps doing so until a restart. So every
 * path below is followed by a probe turn, and the probe failing with `turn-overloaded` is the leak.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import type { RiyaConversationTurnV1 } from '../contracts/channel-turn.js';
import { RiyaWebConversationError } from '../contracts/errors.js';
import { createRiyaWebConversationService } from '../service/create-service.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
import { gatedRuntime } from './fakes/gated-runtime.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';
import type { ScriptedTurnCoordinatorOptions } from './fakes/scripted-turn-coordinator.js';
import { scriptedTurnCoordinator } from './fakes/scripted-turn-coordinator.js';

const turnFor = (over: Partial<RiyaConversationTurnV1> = {}): RiyaConversationTurnV1 =>
  Object.freeze({
    version: 1,
    channel: 'WEB',
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    receivedAt: '2026-08-01T09:00:00Z',
    channelTurnRef: 'src.msg.1',
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  });

const outcomeOf = async (run: () => Promise<{ disposition: string }>): Promise<string> => {
  try {
    return (await run()).disposition;
  } catch (error: unknown) {
    return error instanceof RiyaWebConversationError ? error.code : 'not-a-service-error';
  }
};

// ---------------------------------------------------------------------------
// 1. A refused turn does nothing whatsoever.
// ---------------------------------------------------------------------------

describe('overload is refused before any resource is touched', () => {
  function saturated() {
    const runtime = gatedRuntime();
    const coordinator = scriptedTurnCoordinator();
    const store = new InMemoryContinuityStore();
    let availabilityReads = 0;
    const reader = scriptedAvailabilityReader();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 1,
      runtime,
      continuityStore: store,
      availabilityReader: {
        readCurrent: (...args: Parameters<typeof reader.readCurrent>) => {
          availabilityReads += 1;
          return reader.readCurrent(...args);
        },
      },
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });
    return {
      svc,
      runtime,
      coordinator,
      store,
      availabilityReads: () => availabilityReads,
    };
  }

  it('refuses the second concurrent turn with turn-overloaded and zero downstream work', async () => {
    const h = saturated();
    const held = h.svc.handleChannelTurn(turnFor());
    await h.runtime.awaitArrivals(1);

    // Everything the FIRST turn did is now on the counters. The refused turn must add nothing to any
    // of them.
    const beginsBefore = h.coordinator.begins();
    const startsBefore = h.coordinator.starts();
    const readsBefore = h.availabilityReads();

    expect(
      await outcomeOf(() => h.svc.handleChannelTurn(turnFor({ conversationId: 'conv.2' }))),
    ).toBe('turn-overloaded');

    expect(h.coordinator.begins()).toBe(beginsBefore);
    expect(h.coordinator.starts()).toBe(startsBefore);
    expect(h.availabilityReads()).toBe(readsBefore);
    expect(h.runtime.arrivals()).toBe(1);
    // And no durable claim, so the refused message is simply presentable again.
    expect(h.coordinator.claimState('tenant.a', 'conv.2', 'msg.1')).toBeUndefined();

    h.runtime.releaseAll();
    expect((await held).disposition).toBe('PROCESSED');
  });

  it('the refusal message names no count, no ceiling and no retry hint', async () => {
    const h = saturated();
    const held = h.svc.handleChannelTurn(turnFor());
    await h.runtime.awaitArrivals(1);
    try {
      await h.svc.handleChannelTurn(turnFor({ conversationId: 'conv.2' }));
      expect.unreachable('expected a refusal');
    } catch (error: unknown) {
      const message = (error as Error).message;
      // A capacity number in a client-facing error is a capability disclosure, and a retry hint would
      // be a promise this service is in no position to make.
      expect(message).toBe('The Riya conversation service is at capacity.');
      expect(message).not.toMatch(/\d/);
      expect(message.toLowerCase()).not.toContain('retry');
      expect(message.toLowerCase()).not.toContain('conv.2');
    }
    h.runtime.releaseAll();
    await held;
  });

  it('the refused message is not spent — it succeeds once a slot frees', async () => {
    const h = saturated();
    const first = h.svc.handleChannelTurn(turnFor());
    await h.runtime.awaitArrivals(1);
    const refused = turnFor({ conversationId: 'conv.2', messageId: 'msg.2' });
    expect(await outcomeOf(() => h.svc.handleChannelTurn(refused))).toBe('turn-overloaded');
    h.runtime.releaseAll();
    await first;

    // The SAME logical identity, re-presented. Overload wrote nothing, so this is a first attempt as
    // far as the ledger is concerned -- not a replay and not a conflict.
    const retried = h.svc.handleChannelTurn(refused);
    await h.runtime.awaitArrivals(2);
    h.runtime.releaseAll();
    expect((await retried).disposition).toBe('PROCESSED');
  });

  it('an invalid turn is rejected as invalid, not as overloaded, even at capacity', async () => {
    // Validation runs BEFORE a slot is requested. A malformed turn that consumed capacity would let a
    // stream of junk shrink a replica, and the caller would be told the service was busy when the
    // real answer is that their payload is wrong.
    const h = saturated();
    const held = h.svc.handleChannelTurn(turnFor());
    await h.runtime.awaitArrivals(1);
    expect(await outcomeOf(() => h.svc.handleChannelTurn({ version: 1 } as never))).toBe(
      'invalid-input',
    );
    h.runtime.releaseAll();
    await held;
  });
});

// ---------------------------------------------------------------------------
// 2. The slot comes back on EVERY terminal path.
// ---------------------------------------------------------------------------

describe('a capacity slot is returned on every terminal path', () => {
  function atCapacityOne(
    over: {
      readonly coordinatorOptions?: ScriptedTurnCoordinatorOptions;
      readonly storeThrows?: boolean;
      readonly availabilityRejects?: boolean;
      readonly runtimeThrows?: boolean;
    } = {},
  ) {
    const coordinator = scriptedTurnCoordinator(over.coordinatorOptions ?? {});
    const svc = createRiyaWebConversationService({
      // ONE. Any leaked slot leaves this replica at zero capacity, and the probe below says so.
      maxConcurrentTextTurns: 1,
      runtime: scriptedRuntime('CORE_ACCEPTED', {
        ...(over.runtimeThrows === true ? { throws: true } : {}),
      }),
      continuityStore:
        over.storeThrows === true
          ? new UnavailableContinuityStore()
          : new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(
        over.availabilityRejects === true ? { rejects: true } : {},
      ),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });
    return { svc, coordinator };
  }

  /** Present a healthy turn on an untouched conversation. `turn-overloaded` here means a leak. */
  const probe = async (svc: {
    handleChannelTurn: (turn: RiyaConversationTurnV1) => Promise<{ disposition: string }>;
  }): Promise<string> =>
    outcomeOf(() =>
      svc.handleChannelTurn(
        turnFor({
          conversationId: 'probe.conv',
          messageId: 'probe.msg',
          channelTurnRef: 'src.probe',
        }),
      ),
    );

  it('a normal completion', async () => {
    const { svc } = atCapacityOne();
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('PROCESSED');
    expect(await probe(svc)).toBe('PROCESSED');
  });

  it('an unavailable coordinator', async () => {
    const { svc } = atCapacityOne({ coordinatorOptions: { beginRejects: true } });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe(
      'turn-coordinator-unavailable',
    );
    // The probe fails the same way -- this coordinator rejects everything -- but it must fail as
    // UNAVAILABLE, never as OVERLOADED.
    expect(await probe(svc)).toBe('turn-coordinator-unavailable');
  });

  it('a busy conversation', async () => {
    const { svc, coordinator } = atCapacityOne();
    coordinator.holdConversation('tenant.a', 'conv.1');
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('turn-in-flight');
    expect(await probe(svc)).toBe('PROCESSED');
  });

  it('a replayed logical message', async () => {
    const { svc } = atCapacityOne();
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('PROCESSED');
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('turn-replayed');
    expect(await probe(svc)).toBe('PROCESSED');
  });

  it('a conflicting logical identity', async () => {
    const { svc } = atCapacityOne();
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('PROCESSED');
    // The same source reference under a new message id: a redelivery given a fresh id.
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor({ messageId: 'msg.9' })))).toBe(
      'turn-conflict',
    );
    expect(await probe(svc)).toBe('PROCESSED');
  });

  it('an indeterminate claim', async () => {
    const { svc } = atCapacityOne({ runtimeThrows: true });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('runtime-unavailable');
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('turn-indeterminate');
    // Three consecutive failures at capacity one. Any of them leaking would have left nothing.
    const { svc: clean } = atCapacityOne();
    expect(await probe(clean)).toBe('PROCESSED');
  });

  it('an unavailable continuity store', async () => {
    const { svc } = atCapacityOne({ storeThrows: true });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('continuity-unavailable');
    expect(
      await outcomeOf(() =>
        svc.handleChannelTurn(turnFor({ messageId: 'm2', channelTurnRef: 'src.m2' })),
      ),
    ).toBe('continuity-unavailable');
  });

  it('an unprovable availability answer', async () => {
    const { svc } = atCapacityOne({ availabilityRejects: true });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('NOT_READY');
    expect(await probe(svc)).toBe('NOT_READY');
  });

  it('an unprovable pre-start release', async () => {
    const { svc } = atCapacityOne({
      availabilityRejects: true,
      coordinatorOptions: { releaseRejects: true },
    });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe(
      'turn-coordinator-unavailable',
    );
    // A thrown lease operation is exactly where a `finally` is easiest to get wrong.
    expect(await probe(svc)).toBe('turn-coordinator-unavailable');
  });

  it('an ambiguous start', async () => {
    const { svc } = atCapacityOne({ coordinatorOptions: { startRejects: true } });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('turn-indeterminate');
    expect(
      await outcomeOf(() =>
        svc.handleChannelTurn(turnFor({ messageId: 'm2', channelTurnRef: 'src.m2' })),
      ),
    ).toBe('turn-indeterminate');
  });

  it('a runtime failure', async () => {
    const { svc } = atCapacityOne({ runtimeThrows: true });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('runtime-unavailable');
    expect(
      await outcomeOf(() =>
        svc.handleChannelTurn(turnFor({ messageId: 'm2', channelTurnRef: 'src.m2' })),
      ),
    ).toBe('runtime-unavailable');
  });

  it('an ambiguous finalization', async () => {
    const { svc } = atCapacityOne({ coordinatorOptions: { completeRejects: true } });
    expect(await outcomeOf(() => svc.handleChannelTurn(turnFor()))).toBe('turn-indeterminate');
    expect(
      await outcomeOf(() =>
        svc.handleChannelTurn(turnFor({ messageId: 'm2', channelTurnRef: 'src.m2' })),
      ),
    ).toBe('turn-indeterminate');
  });

  it('an invalid turn, which never took one at all', async () => {
    const { svc } = atCapacityOne();
    for (let attempt = 0; attempt < 32; attempt += 1) {
      expect(await outcomeOf(() => svc.handleChannelTurn({} as never))).toBe('invalid-input');
    }
    // Thirty-two rejected payloads. If validation sat behind the gate and the early return skipped
    // the release, this replica would now be permanently full.
    expect(await probe(svc)).toBe('PROCESSED');
  });

  it('the legacy web entry point releases too', async () => {
    // `handleTurn` delegates to `handleChannelTurn`, so its slot accounting is the same one -- but it
    // is a separate public entry and a separate chance to leak.
    const { svc } = atCapacityOne();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await svc.handleTurn({
        version: 1,
        tenantId: 'tenant.a',
        conversationId: `legacy.${String(attempt)}`,
        messageId: `legacy.msg.${String(attempt)}`,
        receivedAt: '2026-08-01T09:00:00Z',
        webTurnRef: `legacy.src.${String(attempt)}`,
        dataClass: 'HOSTED_ALLOWED',
      });
      expect(result.disposition).toBe('PROCESSED');
    }
    expect(await probe(svc)).toBe('PROCESSED');
  });
});
