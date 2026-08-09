/**
 * RWC-P8 owner correction — the lease sequence is decided by ATTEMPT, not by success (ADR-0104).
 *
 * ### The distinction this file exists for
 *
 * `releaseUnstarted` asserts that nothing durable was written. A turn whose `startProcessing` THREW
 * has ATTEMPTED the write — the insert may have committed and this process simply never learned so —
 * and calling `releaseUnstarted` there would make a claim about the database that nobody can support.
 *
 * Deriving "unstarted" from "did not succeed" is the easy version of that mistake, and it is only
 * safe today because one particular adapter happens to refuse the second lease operation. An
 * application contract must not lean on that: the next adapter might accept it, and the failure would
 * be a released conversation lock over a claim that was quietly on disk.
 *
 * So the service tracks three facts — attempted, started, finalize-attempted — and every assertion
 * below is about which lease method may fire in which of them.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import { RiyaWebConversationError } from '../contracts/errors.js';
import { createRiyaWebConversationService } from '../service/create-service.js';
import type { RiyaConversationTurnV1 } from '../contracts/channel-turn.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
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

function harness(
  over: {
    readonly coordinatorOptions?: ScriptedTurnCoordinatorOptions;
    readonly storeThrows?: boolean;
    readonly availabilityRejects?: boolean;
    readonly runtimeThrows?: boolean;
  } = {},
) {
  const coordinator = scriptedTurnCoordinator(over.coordinatorOptions ?? {});
  const store =
    over.storeThrows === true
      ? (new UnavailableContinuityStore() as unknown as InMemoryContinuityStore)
      : new InMemoryContinuityStore();
  const runtime = scriptedRuntime('CORE_ACCEPTED', {
    ...(over.runtimeThrows === true ? { throws: true } : {}),
  });
  const svc = createRiyaWebConversationService({
    runtime,
    continuityStore: store,
    availabilityReader: scriptedAvailabilityReader(
      over.availabilityRejects === true ? { rejects: true } : {},
    ),
    turnCoordinator: coordinator,
    runtimeId: 'rt.1',
  });
  return { svc, coordinator, runtime, store };
}

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error: unknown) {
    return error instanceof RiyaWebConversationError ? error.code : 'not-a-service-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// A. and B. Genuinely UNATTEMPTED failures release exactly once.
// ---------------------------------------------------------------------------

describe('a failure BEFORE the start attempt releases the lease, exactly once', () => {
  it('an unprovable availability answer: start 0, release 1, runtime 0', async () => {
    const { svc, coordinator, runtime } = harness({ availabilityRejects: true });
    const outcome = await svc.handleChannelTurn(TURN);
    expect(outcome.disposition).toBe('NOT_READY');
    expect(coordinator.starts()).toBe(0);
    expect(coordinator.releases()).toBe(1);
    expect(coordinator.completes()).toBe(0);
    expect(coordinator.indeterminates()).toBe(0);
    expect(runtime.invoked()).toBe(0);
    // No claim row: the message stays retryable, which is exactly right for a turn that failed
    // before it could do anything.
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBeUndefined();
  });

  it('an unavailable store: the ORIGINAL bounded reason survives a clean release', async () => {
    const { svc, coordinator, runtime } = harness({ storeThrows: true });
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('continuity-unavailable');
    expect(coordinator.starts()).toBe(0);
    expect(coordinator.releases()).toBe(1);
    expect(runtime.invoked()).toBe(0);
  });

  it('the released conversation is immediately presentable again', async () => {
    const { svc, coordinator } = harness({ availabilityRejects: true });
    await svc.handleChannelTurn(TURN);
    // BUSY here would mean the lease leaked. The SAME coordinator answers a second presentation of
    // the same message with ACQUIRED, which it could only do if the conversation was released.
    expect(coordinator.begins()).toBe(1);
    await svc.handleChannelTurn(TURN);
    expect(coordinator.begins()).toBe(2);
    expect(coordinator.releases()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// C. An unprovable release is the outcome, not a footnote.
// ---------------------------------------------------------------------------

describe('a safe-prestart release that cannot be PROVED fails the turn closed', () => {
  it('reports turn-coordinator-unavailable, and leaks nothing', async () => {
    // The higher-order fact is that the conversation could not be proved released. Returning the
    // preflight NOT_READY instead would invite an immediate retry that BUSY would then refuse, for a
    // reason nothing in the response explains.
    const { svc, coordinator, runtime } = harness({
      availabilityRejects: true,
      coordinatorOptions: { releaseRejects: true },
    });
    let message = '';
    try {
      await svc.handleChannelTurn(TURN);
    } catch (error: unknown) {
      message = (error as Error).message;
      expect((error as RiyaWebConversationError).code).toBe('turn-coordinator-unavailable');
    }
    expect(message).not.toContain('10.0.0.5');
    expect(message).not.toContain('hunter2');
    // Still no model, no Core and no claim.
    expect(runtime.invoked()).toBe(0);
    expect(coordinator.starts()).toBe(0);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBeUndefined();
  });

  it('it replaces even a thrown preflight error, because it outranks it', async () => {
    const { svc } = harness({
      storeThrows: true,
      coordinatorOptions: { releaseRejects: true },
    });
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('turn-coordinator-unavailable');
  });
});

// ---------------------------------------------------------------------------
// D. An ATTEMPTED start is never treated as unstarted.
// ---------------------------------------------------------------------------

describe('a start that was ATTEMPTED but not proved performs NO second lease operation', () => {
  it('release 0, indeterminate 0, complete 0, runtime 0', async () => {
    const { svc, coordinator, runtime } = harness({
      coordinatorOptions: { startRejects: true },
    });
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('turn-indeterminate');

    expect(coordinator.starts()).toBe(1);
    // THE correction. `releaseUnstarted` would assert that nothing was written, and after an
    // ambiguous insert nobody can support that claim.
    expect(coordinator.releases()).toBe(0);
    // And no finalization either: finalizing a claim that may not exist is the same guess in the
    // other direction.
    expect(coordinator.indeterminates()).toBe(0);
    expect(coordinator.completes()).toBe(0);
    // No model ran, so both readings -- committed and not committed -- are safe.
    expect(runtime.invoked()).toBe(0);
  });

  it('the correctness does NOT depend on the adapter refusing a misused lease', async () => {
    // A permissive lease that accepts every method in any order. The service must still issue no
    // second operation: the sequence is the application's contract, not the adapter's defence.
    const seen: string[] = [];
    const svc = createRiyaWebConversationService({
      runtime: scriptedRuntime('CORE_ACCEPTED'),
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: {
        begin: () =>
          Promise.resolve({
            outcome: 'ACQUIRED' as const,
            lease: {
              startProcessing: () => {
                seen.push('startProcessing');
                return Promise.reject(new Error('insert ambiguous'));
              },
              complete: () => {
                seen.push('complete');
                return Promise.resolve();
              },
              indeterminate: () => {
                seen.push('indeterminate');
                return Promise.resolve();
              },
              releaseUnstarted: () => {
                seen.push('releaseUnstarted');
                return Promise.resolve();
              },
            },
          }),
      },
      runtimeId: 'rt.1',
    });
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('turn-indeterminate');
    expect(seen).toStrictEqual(['startProcessing']);
  });
});

// ---------------------------------------------------------------------------
// E. and F. Started turns finalize at most once.
// ---------------------------------------------------------------------------

describe('a started turn finalizes at most once, and never releases unstarted', () => {
  it('a runtime failure marks the claim indeterminate exactly once', async () => {
    const { svc, coordinator, runtime } = harness({ runtimeThrows: true });
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('runtime-unavailable');
    expect(coordinator.starts()).toBe(1);
    expect(coordinator.releases()).toBe(0);
    expect(coordinator.indeterminates()).toBe(1);
    expect(coordinator.completes()).toBe(0);
    expect(runtime.invoked()).toBe(1);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('INDETERMINATE');
    // And the message is spent, whatever the caller was told.
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('turn-indeterminate');
    expect(runtime.invoked()).toBe(1);
  });

  it('a failed complete performs NO second finalization and NO release', async () => {
    const { svc, coordinator, runtime } = harness({
      coordinatorOptions: { completeRejects: true },
    });
    expect(await code(() => svc.handleChannelTurn(TURN))).toBe('turn-indeterminate');
    expect(coordinator.completes()).toBe(1);
    // Finalization was ATTEMPTED, so `indeterminate` must not fire: the row is either COMPLETED or
    // still PROCESSING, and a second guarded write would be a second attempt at a decision this turn
    // has already made or lost.
    expect(coordinator.indeterminates()).toBe(0);
    expect(coordinator.releases()).toBe(0);
    expect(runtime.invoked()).toBe(1);
    // The body is withheld -- the turn threw rather than returning a result.
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('PROCESSING');
  });

  it('a normal turn completes once, releases nothing and marks nothing indeterminate', async () => {
    const { svc, coordinator } = harness();
    const outcome = await svc.handleChannelTurn(TURN);
    expect(outcome.disposition).toBe('PROCESSED');
    expect(coordinator.starts()).toBe(1);
    expect(coordinator.completes()).toBe(1);
    expect(coordinator.indeterminates()).toBe(0);
    expect(coordinator.releases()).toBe(0);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('COMPLETED');
  });
});
