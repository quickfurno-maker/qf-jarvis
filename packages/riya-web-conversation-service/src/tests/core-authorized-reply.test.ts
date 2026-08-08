/**
 * RWC-P2D — the Core-authorized reply at the service boundary (ADR-0096).
 *
 * RWC-P2C's result deliberately carried no reply text. P2D moves exactly ONE boundary: a proposal
 * QuickFurno Core has already AUTHORIZED may now be returned to a trusted private caller. A model
 * DRAFT still may not, and neither may anything Core rejected, deferred or could not answer about.
 *
 * These specs hunt a sentinel body rather than asserting on a type, because the question is not
 * "does the field exist" but "can this string reach a caller who was not authorized to have it".
 */
import { describe, expect, it } from 'vitest';

import { createRiyaWebConversationService, RiyaWebConversationError } from '../index.js';
import type { RiyaWebConversationTurnV1 } from '../index.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
import { SENTINEL_BODY, scriptedRuntime } from './fakes/scripted-runtime.js';
import type { ScriptedRuntime, ScriptedRuntimeOptions } from './fakes/scripted-runtime.js';
import type { JarvisCoreAuthorizedReplyV1, JarvisRuntimeOutcome } from '@qf-jarvis/jarvis-runtime';
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';

const RUNTIME_ID = 'rt.web.1';

function turnInput(over: Partial<RiyaWebConversationTurnV1> = {}): RiyaWebConversationTurnV1 {
  return {
    version: 1,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    receivedAt: '2026-08-07T09:00:00Z',
    webTurnRef: 'web.turn.opaque.ref',
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  };
}

function service(
  over: {
    readonly runtime?: ScriptedRuntime;
    readonly store?: InMemoryContinuityStore | UnavailableContinuityStore;
  } = {},
): {
  runtime: ScriptedRuntime;
  store: InMemoryContinuityStore | UnavailableContinuityStore;
  svc: ReturnType<typeof createRiyaWebConversationService>;
} {
  const runtime = over.runtime ?? scriptedRuntime();
  const store = over.store ?? new InMemoryContinuityStore();
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

const forgedRuntime = (over: ScriptedRuntimeOptions): ScriptedRuntime =>
  scriptedRuntime('CORE_ACCEPTED', over);

// ---------------------------------------------------------------------------
// (B1, B2) The V2 result and the one case that may carry text.
// ---------------------------------------------------------------------------

describe('(B1, B2) the versioned result and what it may carry', () => {
  it('(B1) returns a V2 result with exactly one key added to V1', async () => {
    const { svc } = service();
    const result = await svc.handleTurn(turnInput());
    expect(result.version).toBe(2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual([
      'authorizedReply',
      'continuity',
      'conversationId',
      'disposition',
      'messageId',
      'reason',
      'tenantId',
      'version',
    ]);
  });

  it('(B2) exposes the EXACT authorized body for a Core-accepted text reply', async () => {
    const { svc } = service();
    const result = await svc.handleTurn(turnInput());
    expect(result.disposition).toBe('PROCESSED');
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
    expect(result.authorizedReply?.replyBody).toHaveLength(SENTINEL_BODY.length);
    expect(result.authorizedReply?.proposalKind).toBe('REPLY');
    expect(result.authorizedReply?.proposalId).toBe('prop.1');
    expect(result.authorizedReply?.boundRevision).toBe(1);
  });

  it('(B2) an accepted proposal carrying no client text yields no authorizedReply', async () => {
    const { svc } = service({ runtime: scriptedRuntime('CORE_ACCEPTED', { suppressReply: true }) });
    const result = await svc.handleTurn(turnInput());
    // PROCESSED does NOT imply a reply exists. A future ingress must check `authorizedReply`
    // itself; treating the disposition as that check is the mistake this asserts against.
    expect(result.disposition).toBe('PROCESSED');
    expect(result.authorizedReply).toBeUndefined();
  });

  it('the disposition vocabulary gained no RESPONDED/SENT/DELIVERED', async () => {
    const { svc } = service();
    const result = await svc.handleTurn(turnInput());
    for (const forbidden of ['RESPONDED', 'SENT', 'DELIVERED', 'PUBLISHED', 'DISPATCHED']) {
      expect(result.disposition).not.toBe(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// (B3, B4) Nothing unauthorized leaks.
// ---------------------------------------------------------------------------

describe('(B3, B4) an unauthorized turn never exposes the draft', () => {
  it('(B3) MODEL_DRAFTED exposes nothing, even though a model drafted', async () => {
    const { svc } = service({ runtime: scriptedRuntime('MODEL_DRAFTED') });
    const result = await svc.handleTurn(turnInput());
    expect(result.disposition).toBe('PROCESSED');
    expect(result.authorizedReply).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SENTINEL_BODY);
  });

  it.each([
    ['(B4) CORE_REJECTED', 'CORE_REJECTED', 'REFUSED'],
    ['REFUSED', 'REFUSED', 'REFUSED'],
    ['HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW_REQUIRED', 'NOT_READY'],
    ['RETRY_LATER', 'RETRY_LATER', 'NOT_READY'],
    ['STALE_REVISION', 'STALE_REVISION', 'NOT_READY'],
    ['CORE_UNAVAILABLE', 'CORE_UNAVAILABLE', 'NOT_READY'],
    ['NO_ACTION', 'NO_ACTION', 'NOT_READY'],
  ])('%s exposes nothing', async (_label, outcome, disposition) => {
    const { svc } = service({ runtime: scriptedRuntime(outcome as JarvisRuntimeOutcome) });
    const result = await svc.handleTurn(turnInput());
    expect(result.disposition).toBe(disposition);
    expect(result.authorizedReply).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SENTINEL_BODY);
  });
});

// ---------------------------------------------------------------------------
// (B5) Self-contradicting evidence fails closed.
// ---------------------------------------------------------------------------

describe('(B5) a materialization that disagrees with its run is refused', () => {
  it.each([
    ['a proposalId belonging to another proposal', { proposalId: 'prop.OTHER' }],
    ['a boundRevision the run was not bound to', { boundRevision: 99 }],
    ['a kind Core never received text for', { proposalKind: 'ESCALATE_TO_HUMAN' as never }],
    ['an empty body', { replyBody: '' }],
    ['a body beyond the M2 bound', { replyBody: 'x'.repeat(8193) }],
  ])('fails closed when the materialization has %s', async (_label, over) => {
    const forged: JarvisCoreAuthorizedReplyV1 = {
      version: 1,
      proposalId: 'prop.1',
      boundRevision: 1,
      proposalKind: 'REPLY',
      replyBody: SENTINEL_BODY,
      ...over,
    };
    const { svc } = service({ runtime: forgedRuntime({ authorizedReply: forged }) });
    // The EXISTING bounded invariant code -- not a new content-bearing one -- and never a partial
    // result with the body attached anyway.
    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'repository-invariant',
    });
  });

  it('the refusal carries neither the body nor an identifier', async () => {
    const { svc } = service({
      runtime: forgedRuntime({
        authorizedReply: {
          version: 1,
          proposalId: 'prop.OTHER',
          boundRevision: 1,
          proposalKind: 'REPLY',
          replyBody: SENTINEL_BODY,
        },
      }),
    });
    let message = '';
    try {
      await svc.handleTurn(turnInput());
    } catch (error: unknown) {
      message = (error as Error).message;
      expect(error).toBeInstanceOf(RiyaWebConversationError);
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(SENTINEL_BODY);
    expect(message).not.toContain('prop.');
  });
});

// ---------------------------------------------------------------------------
// (B6) The runtime capability is required at construction.
// ---------------------------------------------------------------------------

describe('(B6) the runtime capability is required, and checked before anything runs', () => {
  it('refuses a runtime that lacks the content-bearing capability', () => {
    const withoutCapability: Record<string, unknown> = { ...scriptedRuntime() };
    delete withoutCapability['processInboundForCoreAuthorizedReply'];
    expect(() =>
      createRiyaWebConversationService({
        runtime: withoutCapability as never,
        continuityStore: new InMemoryContinuityStore(),
        // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
        // every pre-P5 spec meaning exactly what it meant before.
        availabilityReader: scriptedAvailabilityReader(),
        runtimeId: RUNTIME_ID,
      }),
    ).toThrow(RiyaWebConversationError);
  });

  it('refuses a bare content provider duck-typed as a runtime', () => {
    // Only the new method, none of the mature surface. Accepting this would let a caller substitute
    // something that reaches no state gate at all and still be handed a client-facing string.
    expect(() =>
      createRiyaWebConversationService({
        runtime: {
          processInboundForCoreAuthorizedReply: () => Promise.reject(new Error('never')),
        } as never,
        continuityStore: new InMemoryContinuityStore(),
        // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
        // every pre-P5 spec meaning exactly what it meant before.
        availabilityReader: scriptedAvailabilityReader(),
        runtimeId: RUNTIME_ID,
      }),
    ).toThrow(RiyaWebConversationError);
  });

  it.each([
    'processInbound',
    'applyConversationControlCommand',
    'readConversationOperationsSnapshot',
  ])('refuses a runtime missing the mature method %s', (missing) => {
    const partial = Object.fromEntries(
      Object.entries({ ...scriptedRuntime() }).filter(([key]) => key !== missing),
    );
    expect(() =>
      createRiyaWebConversationService({
        runtime: partial as never,
        continuityStore: new InMemoryContinuityStore(),
        // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
        // every pre-P5 spec meaning exactly what it meant before.
        availabilityReader: scriptedAvailabilityReader(),
        runtimeId: RUNTIME_ID,
      }),
    ).toThrow(RiyaWebConversationError);
  });
});

// ---------------------------------------------------------------------------
// (B7, B8) One call, and only the right one.
// ---------------------------------------------------------------------------

describe('(B7, B8) exactly one runtime call per turn', () => {
  it('calls the capability EXACTLY once and ordinary processInbound never', async () => {
    const { svc, runtime } = service();
    await svc.handleTurn(turnInput());
    expect(runtime.invoked()).toBe(1);
    // Not "processInbound plus extra work" -- one turn, one orchestration run, one model call, one
    // Core decision.
    expect(runtime.ordinaryInvoked()).toBe(0);
  });

  it('does not retry after a runtime failure', async () => {
    const { svc, runtime } = service({
      runtime: scriptedRuntime('CORE_ACCEPTED', { throws: true }),
    });
    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'runtime-unavailable',
    });
    expect(runtime.invoked()).toBe(1);
    expect(runtime.ordinaryInvoked()).toBe(0);
  });

  it('does not leak the runtime error text', async () => {
    const { svc } = service({ runtime: scriptedRuntime('CORE_ACCEPTED', { throws: true }) });
    let message = '';
    try {
      await svc.handleTurn(turnInput());
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('password');
    expect(message).not.toContain('10.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// (B9-B13) Continuity is untouched, even on the authorizing path.
// ---------------------------------------------------------------------------

describe('(B9-B13) continuity semantics are exactly P2C/P2B', () => {
  it('loads first, initializes atomically, returns unchanged, never compare-and-sets', async () => {
    const { svc, store } = service();
    const result = await svc.handleTurn(turnInput());
    // Authorized text WAS returned on this very turn...
    expect(result.authorizedReply?.replyBody).toBe(SENTINEL_BODY);
    // ...and continuity still did not evolve. RWC-P4 owns that.
    const inMemory = store as InMemoryContinuityStore;
    expect(inMemory.calls.load).toBe(1);
    expect(inMemory.calls.createInitialIfAbsent).toBe(1);
    expect(inMemory.calls.compareAndSet).toBe(0);
    expect(result.continuity.continuityRevision).toBe(0);
    expect(result.continuity.phase).toBe('INTRO');
    expect(result.continuity.summaryConfirmed).toBe(false);
  });

  it('(B13) no reply text, transcript or history is written into the continuity state', async () => {
    const { svc } = service();
    const result = await svc.handleTurn(turnInput());
    expect(JSON.stringify(result.continuity)).not.toContain(SENTINEL_BODY);
    for (const forbidden of [
      'transcript',
      'history',
      'recentTurns',
      'rollingSummary',
      'replyBody',
      'authorizedReply',
    ]) {
      expect(Object.hasOwn(result.continuity, forbidden)).toBe(false);
    }
  });

  it('(B9) the runtime is never reached when continuity cannot be established', async () => {
    const runtime = scriptedRuntime();
    const { svc } = service({ runtime, store: new UnavailableContinuityStore() });
    await expect(svc.handleTurn(turnInput())).rejects.toMatchObject({
      code: 'continuity-unavailable',
    });
    // No model ran, so no body existed to withhold in the first place.
    expect(runtime.invoked()).toBe(0);
    expect(runtime.ordinaryInvoked()).toBe(0);
  });
});
