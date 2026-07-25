/**
 * QFJ-M4 — the existing gateway remains the routing authority (ADR-0057 §C, §K).
 *
 * Matrix 27–35: a missing invoker fails closed; an invoker exception is normalized with no raw leak;
 * the gateway is invoked at most once with no independent retry, no provider selection, and no
 * fallback; the adapter mutates no rollout/capability/evaluation; a gateway refusal remains a refusal.
 */
import { describe, expect, it } from 'vitest';

import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import type { ModelGatewayInvoker } from '../gateway/model-gateway-invoker.js';
import {
  clearReplyState,
  fixedClock,
  refusingGatewayInvoker,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticRelease,
  throwingGatewayInvoker,
} from '../testing/index.js';

function makeAdapter(invoker: ModelGatewayInvoker | undefined) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    stateReader: scriptedReplyStateReader(clearReplyState(), clearReplyState()),
    clock: fixedClock(),
    ...(invoker ? { invoker } : {}),
  };
  return createModelReplyAdapter(config);
}

describe('gateway authority', () => {
  it('(27) a missing invoker fails closed', () => {
    const result = makeAdapter(undefined).draftReplyDetailed(replyPlan());
    expect(result.reason).toBe('model-adapter-unavailable');
    expect(result.gatewayInvoked).toBe(false);
  });

  it('(28,29) an invoker exception is normalized and no raw error leaks', () => {
    const invoker = throwingGatewayInvoker();
    let result: ReturnType<ReturnType<typeof makeAdapter>['draftReplyDetailed']> | undefined;
    expect(() => {
      result = makeAdapter(invoker).draftReplyDetailed(replyPlan());
    }).not.toThrow();
    expect(result?.reason).toBe('model-gateway-transient');
    expect(result?.gatewayInvoked).toBe(true);
    expect(invoker.invoked()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic gateway fault');
  });

  it('(30,32) invokes the gateway at most once and selects no provider itself', () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const result = makeAdapter(invoker).draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(true);
    expect(invoker.invoked()).toBe(1);
    // The provider in the result is the plan's — the adapter passed it through, it did not choose one.
    expect(result.provenance?.providerId).toBe('prov.fake');
  });

  it('(31,33) performs no independent retry or fallback on a transient refusal', () => {
    const invoker = refusingGatewayInvoker(true);
    const result = makeAdapter(invoker).draftReplyDetailed(replyPlan());
    expect(result.reason).toBe('model-gateway-transient');
    expect(invoker.invoked()).toBe(1);
  });

  it('(35) a permanent gateway refusal remains a refusal', () => {
    const invoker = refusingGatewayInvoker(false);
    expect(makeAdapter(invoker).draftReplyDetailed(replyPlan()).reason).toBe(
      'model-gateway-refused',
    );
  });

  it('(34) exposes no rollout/capability/evaluation/provider-selection method', () => {
    const adapter = makeAdapter(scriptedGatewayInvoker(structuredReply()));
    expect(Object.keys(adapter).sort()).toEqual([
      'capabilityProfileRef',
      'draftReply',
      'draftReplyDetailed',
      'evaluationRef',
      'promptFamily',
      'promptVersion',
      'release',
    ]);
    const surface = adapter as unknown as Record<string, unknown>;
    for (const forbidden of [
      'selectProvider',
      'promote',
      'activate',
      'setRollout',
      'fallback',
      'retry',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });
});
