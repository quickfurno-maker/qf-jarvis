/**
 * RWC-P9 — concurrent and adversarial load, proved deterministically (ADR-0105).
 *
 * ### No clocks
 *
 * Every turn below is held at an explicit barrier the spec resolves (see `fakes/gated-runtime.ts`).
 * There is no sleep, no timer and no timing assumption, because a concurrency test that depends on
 * scheduling passes locally, fails on a loaded CI worker, gets marked flaky, and then stops guarding
 * the bound it was written for.
 *
 * ### What is being proved
 *
 * A burst does not become an unbounded number of PostgreSQL sessions; a hot conversation still runs
 * one turn at a time no matter how much capacity a replica has; and a flood of replays of one spent
 * message never produces a second model call. That last one is the one with a real-world cost: a
 * duplicated turn is a duplicated enquiry about somebody's home.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import type { RiyaConversationTurnV1 } from '../contracts/channel-turn.js';
import { RiyaWebConversationError } from '../contracts/errors.js';
import { createRiyaWebConversationService } from '../service/create-service.js';
import { InMemoryContinuityStore } from './fakes/in-memory-continuity-store.js';
import { gatedRuntime } from './fakes/gated-runtime.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';
import { scriptedTurnCoordinator } from './fakes/scripted-turn-coordinator.js';

const turnFor = (over: Partial<RiyaConversationTurnV1>): RiyaConversationTurnV1 =>
  Object.freeze({
    version: 1,
    channel: 'WEB',
    tenantId: 'tenant.a',
    receivedAt: '2026-08-01T09:00:00Z',
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  }) as RiyaConversationTurnV1;

/** One turn per distinct conversation — the burst that would otherwise exhaust a pool. */
const distinctTurns = (count: number): readonly RiyaConversationTurnV1[] =>
  Array.from({ length: count }, (_unused, index) =>
    turnFor({
      conversationId: `conv.${String(index)}`,
      messageId: `msg.${String(index)}`,
      channelTurnRef: `src.${String(index)}`,
    }),
  );

const settle = async (run: Promise<{ disposition: string }>): Promise<string> => {
  try {
    return (await run).disposition;
  } catch (error: unknown) {
    return error instanceof RiyaWebConversationError ? error.code : 'not-a-service-error';
  }
};

const tally = (outcomes: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const outcome of outcomes) {
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  return counts;
};

// ---------------------------------------------------------------------------
// 1. A burst across many conversations is shed at exactly the configured cap.
// ---------------------------------------------------------------------------

describe('a concurrent burst is bounded at exactly maxConcurrentTextTurns', () => {
  function replica(cap: number) {
    const runtime = gatedRuntime();
    const coordinator = scriptedTurnCoordinator();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: cap,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });
    return { svc, runtime, coordinator };
  }

  it('64 simultaneous turns at capacity 16: 16 run, 48 are refused, nothing queues', async () => {
    const { svc, runtime, coordinator } = replica(16);
    const inFlight = Promise.all(
      distinctTurns(64).map((turn) => settle(svc.handleChannelTurn(turn))),
    );

    // The barrier settles the instant the 16th turn reaches the runtime -- no polling, no waiting on
    // a clock. If the gate admitted 17, this would still settle, and the counts below would fail.
    await runtime.awaitArrivals(16);
    expect(runtime.arrivals()).toBe(16);
    // Exactly 16 conversations were claimed, so exactly 16 dedicated sessions would exist. That is
    // the property the cap is FOR.
    expect(coordinator.begins()).toBe(16);
    expect(coordinator.starts()).toBe(16);

    runtime.releaseAll();
    expect(tally(await inFlight)).toStrictEqual({ PROCESSED: 16, 'turn-overloaded': 48 });

    // 48 refusals, and not one of them left a claim behind: every refused message is still first-time
    // presentable. Nothing was queued and nothing was retried on the caller's behalf.
    expect(coordinator.begins()).toBe(16);
    expect(runtime.invoked()).toBe(16);
    for (let index = 16; index < 64; index += 1) {
      expect(
        coordinator.claimState('tenant.a', `conv.${String(index)}`, `msg.${String(index)}`),
      ).toBeUndefined();
    }
  });

  it('the replica recovers its FULL capacity after the burst, wave after wave', async () => {
    const { svc, runtime } = replica(8);
    const admitted: number[] = [];

    for (let wave = 0; wave < 4; wave += 1) {
      const turns = Array.from({ length: 24 }, (_unused, index) =>
        turnFor({
          conversationId: `w${String(wave)}.conv.${String(index)}`,
          messageId: `w${String(wave)}.msg.${String(index)}`,
          channelTurnRef: `w${String(wave)}.src.${String(index)}`,
        }),
      );
      const inFlight = Promise.all(turns.map((turn) => settle(svc.handleChannelTurn(turn))));
      await runtime.awaitArrivals(8 * (wave + 1));
      runtime.releaseAll();
      admitted.push(tally(await inFlight)['PROCESSED'] ?? 0);
    }

    // Eight every time. A slot leaked on any path would show here as a shrinking replica, which is
    // exactly how this failure presents in production: gradually, and with no error anywhere.
    expect(admitted).toStrictEqual([8, 8, 8, 8]);
  });

  it('capacity one serializes a burst into strictly one turn at a time', async () => {
    const { svc, runtime, coordinator } = replica(1);
    const inFlight = Promise.all(
      distinctTurns(20).map((turn) => settle(svc.handleChannelTurn(turn))),
    );
    await runtime.awaitArrivals(1);
    expect(coordinator.begins()).toBe(1);
    runtime.releaseAll();
    expect(tally(await inFlight)).toStrictEqual({ PROCESSED: 1, 'turn-overloaded': 19 });
  });
});

// ---------------------------------------------------------------------------
// 2. A hot conversation is still serialized by the coordinator, not by the gate.
// ---------------------------------------------------------------------------

describe('a hot conversation runs one turn at a time regardless of spare capacity', () => {
  it('16 simultaneous turns for ONE conversation: one runs, fifteen are told it is in flight', async () => {
    const runtime = gatedRuntime();
    const coordinator = scriptedTurnCoordinator();
    const svc = createRiyaWebConversationService({
      // Deliberately far above the burst. The gate has room for all sixteen, so anything that
      // serializes them is the COORDINATOR -- which is the authority that has to hold across
      // replicas, not just within this process.
      maxConcurrentTextTurns: 64,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });

    const turns = Array.from({ length: 16 }, (_unused, index) =>
      turnFor({
        conversationId: 'hot.conv',
        messageId: `hot.msg.${String(index)}`,
        channelTurnRef: `hot.src.${String(index)}`,
      }),
    );
    const inFlight = Promise.all(turns.map((turn) => settle(svc.handleChannelTurn(turn))));
    await runtime.awaitArrivals(1);
    runtime.releaseAll();

    expect(tally(await inFlight)).toStrictEqual({ PROCESSED: 1, 'turn-in-flight': 15 });
    // Every one of the sixteen was ADMITTED -- the gate is deliberately conversation-blind -- and the
    // coordinator refused fifteen. Exactly one model call, for sixteen simultaneous messages.
    expect(coordinator.begins()).toBe(16);
    expect(coordinator.starts()).toBe(1);
    expect(runtime.invoked()).toBe(1);
  });

  it('admission is NOT per-conversation: one hot conversation cannot starve the others', async () => {
    // Making the gate conversation-aware would put a weaker, process-local copy of the coordinator's
    // authority in front of the real one. This asserts it was not done: turns for a conversation that
    // is already busy still get a slot, get a fast BUSY, and give the slot straight back.
    const runtime = gatedRuntime();
    const coordinator = scriptedTurnCoordinator();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 4,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });

    coordinator.holdConversation('tenant.a', 'hot.conv');
    const noisy = Array.from({ length: 50 }, (_unused, index) =>
      turnFor({
        conversationId: 'hot.conv',
        messageId: `noise.${String(index)}`,
        channelTurnRef: `noise.src.${String(index)}`,
      }),
    );
    // Presented one after another, so the CAP is never the thing refusing them -- a burst of 50 at
    // capacity 4 would be shed by admission, and this spec is about the gate NOT being the authority
    // that serializes a conversation.
    const refused: string[] = [];
    for (const turn of noisy) {
      refused.push(await settle(svc.handleChannelTurn(turn)));
    }
    expect(tally(refused)).toStrictEqual({ 'turn-in-flight': 50 });

    // Fifty refusals later, an unrelated conversation is served normally on a full-capacity replica.
    const quiet = svc.handleChannelTurn(
      turnFor({
        conversationId: 'quiet.conv',
        messageId: 'quiet.1',
        channelTurnRef: 'quiet.src.1',
      }),
    );
    await runtime.awaitArrivals(1);
    runtime.releaseAll();
    expect((await quiet).disposition).toBe('PROCESSED');
  });
});

// ---------------------------------------------------------------------------
// 3. An adversarial replay flood.
// ---------------------------------------------------------------------------

describe('a flood of replays of one spent message produces no second turn', () => {
  it('256 simultaneous replays: 256 refusals, one model call, one claim', async () => {
    const runtime = scriptedRuntime('CORE_ACCEPTED');
    const coordinator = scriptedTurnCoordinator();
    const svc = createRiyaWebConversationService({
      // Capacity above the flood ON PURPOSE. If the gate were doing the work here, the proof would be
      // about capacity rather than about idempotency -- and capacity is not what stops a duplicate.
      maxConcurrentTextTurns: 256,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });

    const spent = turnFor({
      conversationId: 'flood.conv',
      messageId: 'flood.msg',
      channelTurnRef: 'flood.src',
    });
    expect((await svc.handleChannelTurn(spent)).disposition).toBe('PROCESSED');
    expect(runtime.invoked()).toBe(1);

    const flood = await Promise.all(
      Array.from({ length: 256 }, () => settle(svc.handleChannelTurn(spent))),
    );

    expect(tally(flood)).toStrictEqual({ 'turn-replayed': 256 });
    // ONE model call and ONE durable claim, for 257 presentations of the same message.
    expect(runtime.invoked()).toBe(1);
    expect(coordinator.starts()).toBe(1);
    expect(coordinator.completes()).toBe(1);
    expect(coordinator.claimState('tenant.a', 'flood.conv', 'flood.msg')).toBe('COMPLETED');
  });

  it('a flood of FRESH message ids for one spent source reference is all conflict', async () => {
    // The redelivery-with-a-new-id shape. Transport replay protection cannot see it -- each request is
    // legitimately new -- and admission is not asked to: the coordinator recognises the source
    // reference.
    const runtime = scriptedRuntime('CORE_ACCEPTED');
    const coordinator = scriptedTurnCoordinator();
    const svc = createRiyaWebConversationService({
      maxConcurrentTextTurns: 128,
      runtime,
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });

    await svc.handleChannelTurn(
      turnFor({ conversationId: 'dup.conv', messageId: 'dup.msg.0', channelTurnRef: 'dup.src' }),
    );
    const reissued = await Promise.all(
      Array.from({ length: 100 }, (_unused, index) =>
        settle(
          svc.handleChannelTurn(
            turnFor({
              conversationId: 'dup.conv',
              messageId: `dup.msg.${String(index + 1)}`,
              channelTurnRef: 'dup.src',
            }),
          ),
        ),
      ),
    );
    expect(tally(reissued)).toStrictEqual({ 'turn-conflict': 100 });
    expect(runtime.invoked()).toBe(1);
  });
});
