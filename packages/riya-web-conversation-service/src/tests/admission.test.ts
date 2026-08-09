/**
 * RWC-P9 — the process-local admission gate, on its own (ADR-0105).
 *
 * The gate is small enough that its whole risk is in edge cases: a capacity that should have been
 * refused at construction, a slot that is not given back, a slot given back twice. Each of those
 * fails silently in production — a replica quietly admitting more or fewer turns than it was
 * configured for — so each one is asserted directly here rather than only through the service.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import { RiyaWebConversationError } from '../contracts/errors.js';
import {
  createTextTurnAdmission,
  isValidTextTurnCapacity,
  MAX_CONCURRENT_TEXT_TURNS,
  MIN_CONCURRENT_TEXT_TURNS,
} from '../internal/text-turn-admission.js';
import { createRiyaWebConversationService } from '../service/create-service.js';
import { InMemoryContinuityStore } from './fakes/in-memory-continuity-store.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';
import { scriptedTurnCoordinator } from './fakes/scripted-turn-coordinator.js';

// ---------------------------------------------------------------------------
// 1. The gate itself.
// ---------------------------------------------------------------------------

describe('the gate admits exactly its capacity and never waits', () => {
  it('hands out one slot at a time at capacity one', () => {
    const gate = createTextTurnAdmission(1);
    expect(gate.max()).toBe(1);
    expect(gate.active()).toBe(0);

    const first = gate.tryAcquire();
    expect(first).toBeTypeOf('function');
    expect(gate.active()).toBe(1);

    // `undefined`, immediately. Not a promise, not a waiter, not a retry-after: a caller that had to
    // await a refusal would be holding a turn this process never undertook to serve.
    expect(gate.tryAcquire()).toBeUndefined();
    expect(gate.active()).toBe(1);
  });

  it('a released slot is immediately reusable', () => {
    const gate = createTextTurnAdmission(1);
    const first = gate.tryAcquire();
    expect(first).toBeDefined();
    first?.();
    expect(gate.active()).toBe(0);
    expect(gate.tryAcquire()).toBeDefined();
  });

  it('fills to capacity, refuses beyond it, and recovers exactly as many slots as it frees', () => {
    const gate = createTextTurnAdmission(4);
    const held = [gate.tryAcquire(), gate.tryAcquire(), gate.tryAcquire(), gate.tryAcquire()];
    expect(held.every((slot) => slot !== undefined)).toBe(true);
    expect(gate.active()).toBe(4);
    expect(gate.tryAcquire()).toBeUndefined();

    held[0]?.();
    held[1]?.();
    expect(gate.active()).toBe(2);
    expect(gate.tryAcquire()).toBeDefined();
    expect(gate.tryAcquire()).toBeDefined();
    expect(gate.tryAcquire()).toBeUndefined();
  });

  it('refuses a SECOND release rather than inventing capacity', () => {
    // A double release would permanently over-count this replica's headroom, silently, until the
    // process restarted -- the gate would simply start admitting more turns than it was configured
    // for and nothing would say so. Throwing is the only version of this that surfaces.
    const gate = createTextTurnAdmission(2);
    const slot = gate.tryAcquire();
    slot?.();
    expect(() => slot?.()).toThrow('riya-text-turn-slot-released-twice');
    expect(gate.active()).toBe(1 - 1 + 0);
  });

  it('is frozen, so a caller cannot swap the acquisition rule', () => {
    const gate = createTextTurnAdmission(1);
    expect(Object.isFrozen(gate)).toBe(true);
  });

  it('does not share a counter between instances', () => {
    const one = createTextTurnAdmission(1);
    const two = createTextTurnAdmission(1);
    expect(one.tryAcquire()).toBeDefined();
    // Per-instance state. A module-level counter would make two services in one process contend for
    // capacity neither of them configured.
    expect(two.tryAcquire()).toBeDefined();
    expect(one.active()).toBe(1);
    expect(two.active()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. What counts as a capacity.
// ---------------------------------------------------------------------------

describe('capacity validation is closed at both ends', () => {
  it('accepts the whole legal integer range and nothing outside it', () => {
    expect(MIN_CONCURRENT_TEXT_TURNS).toBe(1);
    expect(MAX_CONCURRENT_TEXT_TURNS).toBe(1024);
    for (const good of [1, 2, 16, 1023, 1024]) {
      expect(isValidTextTurnCapacity(good)).toBe(true);
    }
    // Zero is refused rather than read as "closed": a service configured to admit nothing is a
    // deployment mistake, and it must fail at construction rather than look like a total outage.
    for (const bad of [0, -1, -1024, 1025, 4096, 1.5, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidTextTurnCapacity(bad)).toBe(false);
    }
  });

  it('refuses anything that is not a number, including one that looks like one', () => {
    for (const bad of ['16', '', true, false, null, undefined, {}, [], [16], 16n, () => 16]) {
      expect(isValidTextTurnCapacity(bad)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Construction refuses a service that has not been given a capacity.
// ---------------------------------------------------------------------------

const dependencies = () => ({
  runtime: scriptedRuntime('CORE_ACCEPTED'),
  continuityStore: new InMemoryContinuityStore(),
  availabilityReader: scriptedAvailabilityReader(),
  turnCoordinator: scriptedTurnCoordinator(),
  runtimeId: 'rt.1',
});

describe('capacity is REQUIRED configuration, with no default', () => {
  it('refuses construction when it is missing entirely', () => {
    // No fallback. This number and the coordinator's pool capacity are the same decision made twice,
    // and a default would let a deployment make it by accident -- against a pool it never saw.
    expect(() => createRiyaWebConversationService(dependencies() as never)).toThrow(
      RiyaWebConversationError,
    );
    try {
      createRiyaWebConversationService(dependencies() as never);
    } catch (error: unknown) {
      expect((error as RiyaWebConversationError).code).toBe('invalid-input');
    }
  });

  it('refuses every invalid capacity at construction, not at the first turn', () => {
    // Discovering this mid-turn would mean a client was already waiting on a service that should
    // never have started.
    for (const bad of [0, -1, 1025, 2.5, Number.NaN, '64', null]) {
      expect(() =>
        createRiyaWebConversationService({
          ...dependencies(),
          maxConcurrentTextTurns: bad,
        } as never),
      ).toThrow(RiyaWebConversationError);
    }
  });

  it('accepts both ends of the range', () => {
    for (const good of [MIN_CONCURRENT_TEXT_TURNS, MAX_CONCURRENT_TEXT_TURNS]) {
      const svc = createRiyaWebConversationService({
        ...dependencies(),
        maxConcurrentTextTurns: good,
      });
      expect(typeof svc.handleChannelTurn).toBe('function');
    }
  });

  it('does not expose the gate, its counter or a way to change the ceiling', () => {
    const svc = createRiyaWebConversationService({
      ...dependencies(),
      maxConcurrentTextTurns: 4,
    });
    // Capacity is configuration and stays configuration. A reachable gate would let a caller hand
    // this process headroom it does not have, which is the entire failure the gate exists to prevent.
    expect(Object.keys(svc).sort()).toStrictEqual(['handleChannelTurn', 'handleTurn']);
    expect(Object.isFrozen(svc)).toBe(true);
  });
});
