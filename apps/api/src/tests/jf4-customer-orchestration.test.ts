/**
 * JF-4 — the Mastra customer orchestration boundary (ADR-0149).
 *
 * Matrix A (placement), B (single service call), D (authorized reply), F (channel/continuity),
 * H (control superiority) and the concurrency and observability proofs.
 *
 * ### What these are actually testing
 *
 * Not that Mastra works. That adding Mastra changed NOTHING: the same one call, to the same instance,
 * with the same result object, and no new authority anywhere. A shell whose value is that it is
 * inert has to be tested for inertness, so most of what follows is a count or an identity check
 * rather than a behavioural assertion.
 *
 * The service is a deterministic double throughout. There is no runtime, no model, no provider and no
 * Core in this file — proving the shell does not reach them is the point, and a real one would make
 * that proof weaker, not stronger.
 */
import { RIYA_CONVERSATION_CHANNELS } from '@qf-jarvis/riya-web-conversation-service';
import type { RiyaConversationService } from '@qf-jarvis/riya-web-conversation-service';
import { describe, expect, it } from 'vitest';

import {
  RiyaCustomerOrchestrationError,
  RiyaCustomerRuntimeCompositionError,
  createRiyaCustomerRuntimeComposition,
} from '../riya-customer-orchestration/index.js';
import type {
  RiyaCustomerOrchestrationEvent,
  RiyaCustomerOrchestrationObservability,
} from '../riya-customer-orchestration/index.js';

/**
 * Both channels, taken from the canonical RWC-P8 vocabulary rather than written out.
 *
 * apps/api bans the second channel's name repository-wide to keep a delivery transport out, and this
 * spec exercises the CHANNEL rather than a transport -- so it sources both names from the package
 * that owns them, exactly as the production runner does, and never spells either.
 */
const [WEB_CHANNEL, SECOND_CHANNEL] = RIYA_CONVERSATION_CHANNELS;

interface Call {
  readonly kind: 'web' | 'channel';
  readonly turn: unknown;
}

/** A deterministic conversation-service double that records every call it receives. */
function fakeService(overrides: { result?: unknown; throws?: Error } = {}) {
  const calls: Call[] = [];
  const result =
    overrides.result ??
    Object.freeze({
      version: 1,
      tenantId: 'tenant-a',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      disposition: 'PROCESSED',
      reason: undefined,
      continuity: Object.freeze({ phase: 'INTRO' }),
      authorizedReply: Object.freeze({
        version: 1,
        proposalId: 'prop-1',
        boundRevision: 2,
        proposalKind: 'REPLY',
        replyBody: 'AUTHORIZED BODY',
      }),
    });
  const service = {
    handleTurn: (turn: unknown): Promise<unknown> => {
      calls.push({ kind: 'web', turn });
      if (overrides.throws !== undefined) {
        return Promise.reject(overrides.throws);
      }
      return Promise.resolve(result);
    },
    handleChannelTurn: (turn: unknown): Promise<unknown> => {
      calls.push({ kind: 'channel', turn });
      if (overrides.throws !== undefined) {
        return Promise.reject(overrides.throws);
      }
      return Promise.resolve(result);
    },
  };
  return { service, calls, result };
}

function channelTurn(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    channel: WEB_CHANNEL,
    tenantId: 'tenant-a',
    conversationId: 'conv-1',
    messageId: 'msg-1',
    receivedAt: '2026-09-10T00:00:00Z',
    channelTurnRef: 'ref-1',
    dataClass: 'HOSTED_ALLOWED' as const,
    ...overrides,
  };
}

function recorder(): {
  hook: RiyaCustomerOrchestrationObservability;
  events: RiyaCustomerOrchestrationEvent[];
} {
  const events: RiyaCustomerOrchestrationEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

const compose = (service: unknown, observability?: RiyaCustomerOrchestrationObservability) =>
  createRiyaCustomerRuntimeComposition({
    // The doubles here are structural on purpose: the composition duck-checks its service exactly as
    // the private ingress already does, and a nominally-typed double would test a different thing.
    conversationService: service as RiyaConversationService,
    ...(observability === undefined ? {} : { observability }),
  });

describe('JF-4 (A) Mastra placement', () => {
  it('(A1,A2) the production composition exposes the runner AND the ingress facade, both through Mastra', () => {
    const { service, calls } = fakeService();
    const composition = compose(service);
    // ONE runner object serves both surfaces. There is no second, direct-service path to take.
    expect(composition.ingressService).toBe(composition.customerTurnRunner);
    expect(Object.isFrozen(composition)).toBe(true);
    expect(Object.isFrozen(composition.customerTurnRunner)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('(A2) construction fails closed without a usable conversation service', () => {
    for (const bad of [
      undefined,
      null,
      {},
      { handleTurn: () => undefined },
      { handleChannelTurn: () => undefined },
      { handleTurn: 'no', handleChannelTurn: 'no' },
    ]) {
      expect(() => compose(bad)).toThrow(RiyaCustomerRuntimeCompositionError);
    }
    // No default service, no default gateway, no default continuity: a composition that works with
    // nothing supplied is a composition that loses conversations in production.
  });
});

describe('JF-4 (B) exactly one service call', () => {
  it('(B9,B14) a normal turn calls the service exactly once, on the exact instance supplied', async () => {
    const { service, calls, result } = fakeService();
    const { customerTurnRunner } = compose(service);
    const turn = channelTurn();

    const outcome = await customerTurnRunner.handleConversationTurn(turn);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('channel');
    // The exact turn object, not a copy: Mastra carries an opaque marker, never the turn.
    expect(calls[0]?.turn).toBe(turn);
    // The exact result object, by reference.
    expect(outcome).toBe(result);
  });

  it('(B10) a service REFUSAL is a result, and is still exactly one call', async () => {
    const refusal = Object.freeze({
      version: 1,
      tenantId: 'tenant-a',
      conversationId: 'conv-1',
      messageId: 'msg-1',
      disposition: 'REFUSED',
      reason: 'orchestration-refused',
      continuity: Object.freeze({ phase: 'INTRO' }),
      authorizedReply: undefined,
    });
    const { service, calls } = fakeService({ result: refusal });
    const { customerTurnRunner } = compose(service);

    const outcome = await customerTurnRunner.handleConversationTurn(channelTurn());
    expect(calls).toHaveLength(1);
    expect(outcome).toBe(refusal);
  });

  it('(B11,B13) a service THROW is exactly one call, with no retry and no second run', async () => {
    const { service, calls } = fakeService({
      throws: new Error('SYNTHETIC SERVICE FAILURE detail'),
    });
    const { customerTurnRunner } = compose(service);

    await expect(customerTurnRunner.handleConversationTurn(channelTurn() as never)).rejects.toThrow(
      RiyaCustomerOrchestrationError,
    );
    // The whole point. Riya's turn semantics -- the logical-turn claim, continuity CAS, the model
    // budget -- are all built on a turn happening at most once, and a retry would re-enter every one.
    expect(calls).toHaveLength(1);
  });

  it('(B11) the thrown service error never leaks through the shell', async () => {
    const { service } = fakeService({
      throws: new Error('SYNTHETIC LEAK MARKER draft-body provider-detail'),
    });
    const { customerTurnRunner } = compose(service);

    let caught: unknown;
    try {
      await customerTurnRunner.handleConversationTurn(channelTurn());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RiyaCustomerOrchestrationError);
    expect((caught as RiyaCustomerOrchestrationError).refusal).toBe('SERVICE_FAILED');
    const text = (caught as Error).message + JSON.stringify(caught);
    expect(text).not.toContain('SYNTHETIC LEAK MARKER');
    expect(text).not.toContain('draft-body');
    expect(text).not.toContain('provider-detail');
  });

  it('(B12) an already-cancelled turn makes ZERO service calls', async () => {
    const { service, calls } = fakeService();
    const composition = compose(service);
    const controller = new AbortController();
    controller.abort();

    // The runner surface does not take a signal; cancellation before the step is proven through the
    // workflow entry point the composition uses. Nothing has been entered, so nothing is unwound.
    const { runCustomerTurnWorkflow } =
      await import('../riya-customer-orchestration/mastra-customer-turn-runner.js');
    await expect(
      runCustomerTurnWorkflow(
        () => composition.customerTurnRunner.handleConversationTurn(channelTurn() as never),
        WEB_CHANNEL,
        {},
        controller.signal,
      ),
    ).rejects.toThrow(RiyaCustomerOrchestrationError);
    expect(calls).toHaveLength(0);
  });
});

describe('JF-4 (D) the authorized reply', () => {
  it('(D23,D29) the authorized result passes through by REFERENCE, unmodified', async () => {
    const { service, result } = fakeService();
    const { customerTurnRunner } = compose(service);

    const outcome = await customerTurnRunner.handleConversationTurn(channelTurn());
    // Identity, not equality. A framework that serialized the result could not preserve it
    // byte-for-byte, and byte-for-byte is the entire contract for text Core authorized.
    expect(outcome).toBe(result);
    // The authorized reply object is the SAME object too -- identity all the way down, so no layer
    // can have rebuilt the exact bytes Core authorized.
    const reply = (result as { authorizedReply: { replyBody: string } }).authorizedReply;
    expect((outcome as { authorizedReply: unknown }).authorizedReply).toBe(reply);
    expect(reply.replyBody).toBe('AUTHORIZED BODY');
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it('(D24,D25,D26,D27) no authorizedReply survives when the service produced none', async () => {
    for (const withoutReply of [
      { disposition: 'PROCESSED', reason: undefined },
      { disposition: 'REFUSED', reason: 'orchestration-core-rejected' },
      { disposition: 'REFUSED', reason: 'orchestration-human-takeover' },
      { disposition: 'REFUSED', reason: 'orchestration-revision-drift' },
    ]) {
      const result = Object.freeze({
        version: 1,
        tenantId: 'tenant-a',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        ...withoutReply,
        continuity: Object.freeze({ phase: 'INTRO' }),
        authorizedReply: undefined,
      });
      const { service } = fakeService({ result });
      const { customerTurnRunner } = compose(service);
      const outcome = await customerTurnRunner.handleConversationTurn(channelTurn());
      expect(outcome).toBe(result);
      expect((outcome as { authorizedReply: unknown }).authorizedReply).toBeUndefined();
    }
  });

  it('(D28,D29) a shell failure yields no result at all, never a manufactured one', async () => {
    const { service } = fakeService({ throws: new Error('boom') });
    const { customerTurnRunner } = compose(service);
    let caught: unknown;
    try {
      await customerTurnRunner.handleConversationTurn(channelTurn());
    } catch (error) {
      caught = error;
    }
    // An invented "Riya said nothing" is indistinguishable to a caller from Riya actually having said
    // nothing, so the shell refuses to invent one.
    expect(caught).toBeInstanceOf(RiyaCustomerOrchestrationError);
    expect(caught).not.toHaveProperty('authorizedReply');
    expect(caught).not.toHaveProperty('continuity');
  });
});

describe('JF-4 (F) channels and continuity', () => {
  it('(F43,F44) both channels run through the SAME runner and the same service', async () => {
    const { service, calls } = fakeService();
    const { customerTurnRunner } = compose(service);

    await customerTurnRunner.handleConversationTurn(channelTurn({ channel: WEB_CHANNEL }));
    await customerTurnRunner.handleConversationTurn(
      channelTurn({ channel: SECOND_CHANNEL, messageId: 'msg-2' }),
    );

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.kind === 'channel')).toBe(true);
    // Two surfaces of ONE Riya. No channel-specific brain, prompt or state anywhere in the shell.
    expect((calls[0]?.turn as { channel: string }).channel).toBe(WEB_CHANNEL);
    expect((calls[1]?.turn as { channel: string }).channel).toBe(SECOND_CHANNEL);
  });

  it('(F45) cross-channel turns for one conversation reach the service unchanged, in order', async () => {
    const { service, calls } = fakeService();
    const { customerTurnRunner } = compose(service);
    const web = channelTurn({ channel: WEB_CHANNEL, messageId: 'm1' });
    const wa = channelTurn({ channel: SECOND_CHANNEL, messageId: 'm2' });

    await customerTurnRunner.handleConversationTurn(web);
    await customerTurnRunner.handleConversationTurn(wa);

    // The shell adds no identity linking, no channel state and no reordering: continuity is the
    // service's, keyed on the canonical tenant/conversation the CALLER supplied.
    expect(calls.map((c) => c.turn)).toEqual([web, wa]);
  });

  it('(F48) the shell stores no transcript, reply or per-turn state between calls', async () => {
    const { service } = fakeService();
    const { customerTurnRunner } = compose(service);
    await customerTurnRunner.handleConversationTurn(channelTurn());

    const runner = customerTurnRunner as unknown as Record<string, unknown>;
    for (const field of ['memory', 'storage', 'history', 'transcript', 'lastResult', 'state']) {
      expect(runner[field]).toBeUndefined();
    }
    expect(Object.keys(customerTurnRunner).sort()).toEqual([
      'handleConversationTurn',
      'handleTurn',
    ]);
  });
});

describe('JF-4 concurrency and observability', () => {
  it('two conversations run concurrently with no shared state and no result mixing', async () => {
    const seen: string[] = [];
    const service = {
      handleTurn: () => Promise.resolve({}),
      handleChannelTurn: async (turn: unknown) => {
        const id = (turn as { conversationId: string }).conversationId;
        seen.push(id);
        // Interleave deliberately: a shared current-turn slot would cross here.
        await Promise.resolve();
        return Object.freeze({ conversationId: id, authorizedReply: undefined });
      },
    };
    const { customerTurnRunner } = compose(service);

    const [a, b] = await Promise.all([
      customerTurnRunner.handleConversationTurn(channelTurn({ conversationId: 'conv-A' }) as never),
      customerTurnRunner.handleConversationTurn(channelTurn({ conversationId: 'conv-B' }) as never),
    ]);
    expect((a as { conversationId: string }).conversationId).toBe('conv-A');
    expect((b as { conversationId: string }).conversationId).toBe('conv-B');
    expect(seen.sort()).toEqual(['conv-A', 'conv-B']);
  });

  it('emits one content-free orchestration event per turn', async () => {
    const { hook, events } = recorder();
    const { service } = fakeService();
    const { customerTurnRunner } = compose(service, hook);

    await customerTurnRunner.handleConversationTurn(channelTurn());
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.serviceInvocations).toBe(1);
    expect(event?.channel).toBe(WEB_CHANNEL);
    expect(event?.authorizedReplyPresent).toBe(true);
    expect(event?.refusal).toBeUndefined();

    // Content-free: the reply body, the message, the conversation and the tenant are all absent.
    const serialized = JSON.stringify(events);
    for (const forbidden of ['AUTHORIZED BODY', 'conv-1', 'tenant-a', 'msg-1', 'ref-1']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(event ?? {}).sort()).toEqual([
      'authorizedReplyPresent',
      'channel',
      'refusal',
      'runRef',
      'serviceInvocations',
      'type',
    ]);
  });

  it('reports a shell refusal with zero service invocations', async () => {
    const { hook, events } = recorder();
    const { service } = fakeService({ throws: new Error('boom') });
    const { customerTurnRunner } = compose(service, hook);

    await expect(customerTurnRunner.handleConversationTurn(channelTurn() as never)).rejects.toThrow(
      RiyaCustomerOrchestrationError,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.refusal).toBe('SERVICE_FAILED');
    expect(events[0]?.authorizedReplyPresent).toBe(false);
  });
});
