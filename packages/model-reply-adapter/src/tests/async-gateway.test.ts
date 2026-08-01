/**
 * QFJ-M4 async-compatibility correction — genuinely asynchronous model gateway (ADR-0058).
 *
 * Async matrix (model scope): draftReplyDetailed returns a Promise; the gateway is awaited and invoked
 * at most once with no adapter-owned retry, fallback, or provider selection; a rejected invocation is
 * normalized to a fail-closed reason without an unhandled rejection or a raw error; a state change that
 * lands WHILE the gateway Promise is pending is observed by the awaited post-gateway read and blocks the
 * draft; a delivered valid result is a draft only.
 */
import { describe, expect, it } from 'vitest';

import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import { syntheticPromptDefinition } from '../testing/fixtures.js';

import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import type { ReplyState, ReplyStateReader } from '../contracts/state.js';
import type { ModelGatewayInvoker } from '../gateway/model-gateway-invoker.js';
import {
  clearReplyState,
  fixedClock,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticRelease,
  throwingGatewayInvoker,
} from '../testing/index.js';

/** A state reader over a mutable cell — lets an external change land between the awaited gate reads. */
function mutableStateReader(get: () => ReplyState): ReplyStateReader & { reads: () => number } {
  let n = 0;
  return {
    read: () => {
      n += 1;
      return Promise.resolve(get());
    },
    reads: () => n,
  };
}

function makeAdapter(stateReader: ReplyStateReader, invoker: ModelGatewayInvoker | undefined) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    promptRegistry: createPromptRegistry([M4_PROMPT]),
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    evaluationPromptDigest: M4_PROMPT.contentDigest,
    stateReader,
    clock: fixedClock(),
    ...(invoker ? { invoker } : {}),
  };
  return createModelReplyAdapter(config);
}

/** The one synthetic CLIENT prompt every adapter in this spec resolves (ADR-0073). */
const M4_PROMPT = syntheticPromptDefinition();

describe('async model gateway — shape, at most once, rejection normalized', () => {
  it('draftReplyDetailed returns a Promise', async () => {
    const adapter = makeAdapter(
      scriptedReplyStateReader(clearReplyState(), clearReplyState()),
      scriptedGatewayInvoker(structuredReply()),
    );
    const pending = adapter.draftReplyDetailed(replyPlan());
    expect(pending).toBeInstanceOf(Promise);
    await pending;
  });

  it('awaits the gateway and invokes it exactly once on a valid result', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const adapter = makeAdapter(
      scriptedReplyStateReader(clearReplyState(), clearReplyState()),
      invoker,
    );
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(true);
    expect(result.draft?.structured).toBe(true);
    expect(invoker.invoked()).toBe(1);
  });

  it('normalizes a rejected invocation to a fail-closed reason with no retry or raw error', async () => {
    const invoker = throwingGatewayInvoker();
    const adapter = makeAdapter(
      scriptedReplyStateReader(clearReplyState(), clearReplyState()),
      invoker,
    );
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-gateway-transient');
    expect(invoker.invoked()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic gateway fault');
  });
});

describe('async model gateway — a change while the gateway is pending blocks the draft', () => {
  it('sees a revision bump that lands during the awaited invocation and blocks the draft', async () => {
    let cell = clearReplyState({ revision: 1 });
    const inner = scriptedGatewayInvoker(structuredReply());
    // The gateway resolves a valid reply, but a revision change lands during the awaited round-trip;
    // the adapter's awaited post-gateway read observes it and blocks the draft.
    const mutatingInvoker: ModelGatewayInvoker & { invoked: () => number } = {
      invoke: (request) => {
        cell = clearReplyState({ revision: 2 });
        return inner.invoke(request);
      },
      invoked: () => inner.invoked(),
    };
    const reader = mutableStateReader(() => cell);
    const adapter = makeAdapter(reader, mutatingInvoker);
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-state-blocked');
    expect(result.gatewayInvoked).toBe(true);
    expect(result.draft).toBeUndefined();
    expect(mutatingInvoker.invoked()).toBe(1);
    expect(reader.reads()).toBe(2);
  });

  it('sees a cancellation that lands during the awaited invocation and blocks the draft', async () => {
    let cell = clearReplyState();
    const inner = scriptedGatewayInvoker(structuredReply());
    const mutatingInvoker: ModelGatewayInvoker = {
      invoke: (request) => {
        cell = clearReplyState({ cancelled: true });
        return inner.invoke(request);
      },
    };
    const adapter = makeAdapter(
      mutableStateReader(() => cell),
      mutatingInvoker,
    );
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-cancelled');
    expect(result.draft).toBeUndefined();
  });
});
