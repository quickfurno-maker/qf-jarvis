/**
 * QFJ-M4 — authority/no-send and content-free observability (ADR-0057 §G, §L, §M).
 *
 * Matrix 60–68: events and the minimized request are content-free (no inbound/reply/prompt/knowledge/
 * subject/PII/secret/CoT), carrying only safe reference ids and bounded counters; model output is a
 * draft only — never a Core `ACCEPTED`, with no authorize/execute/send/deliver/callN8n method.
 */
import { describe, expect, it } from 'vitest';

import {
  buildGatewayRequest,
  DEFAULT_GATEWAY_REQUEST_BUDGETS,
} from '../adapter/build-gateway-request.js';
import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import { MODEL_REPLY_ADAPTER_EVENT_TYPES } from '../contracts/observability.js';
import type {
  ModelReplyAdapterEvent,
  ModelReplyAdapterObservabilityHook,
} from '../contracts/observability.js';
import {
  clearReplyState,
  fixedClock,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticRelease,
} from '../testing/index.js';

function recorder(): {
  hook: ModelReplyAdapterObservabilityHook;
  events: ModelReplyAdapterEvent[];
} {
  const events: ModelReplyAdapterEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

function makeAdapter(hook?: ModelReplyAdapterObservabilityHook) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    stateReader: scriptedReplyStateReader(clearReplyState(), clearReplyState()),
    clock: fixedClock(),
    invoker: scriptedGatewayInvoker(structuredReply({ replyBody: 'SECRET-REPLY-BODY-XYZ' })),
    ...(hook ? { observability: hook } : {}),
  };
  return createModelReplyAdapter(config);
}

const SECRET_INPUT = 'SECRET-INBOUND-TEXT-XYZ';

describe('observability — content-free', () => {
  it('(60,61,62,63,64) emits only closed event types with safe ids and no content/secret', () => {
    const { hook, events } = recorder();
    makeAdapter(hook).draftReplyDetailed(replyPlan({ normalizedText: SECRET_INPUT }));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(MODEL_REPLY_ADAPTER_EVENT_TYPES).toContain(e.type);
    }
    const serialized = JSON.stringify(events);
    for (const forbidden of [SECRET_INPUT, 'SECRET-REPLY-BODY-XYZ', 'sk-', 'wamid', 'reasoning']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('rel.reply.1');
    expect(events.map((e) => e.type)).toContain('model-adapter-completed');
  });

  it('(64) usage/latency counters are bounded numbers when present', () => {
    const { hook, events } = recorder();
    makeAdapter(hook).draftReplyDetailed(replyPlan());
    const completed = events.find((e) => e.type === 'model-adapter-completed');
    expect(typeof completed?.outputTokens).toBe('number');
    expect(typeof completed?.latencyMs).toBe('number');
  });
});

describe('request — content minimization', () => {
  it('(65) the minimized request carries only the prompt + normalized input and no subject/internal note', () => {
    const req = buildGatewayRequest({
      plan: replyPlan({ normalizedText: SECRET_INPUT }),
      requestedAt: '2026-07-25T00:00:00Z',
      budgets: DEFAULT_GATEWAY_REQUEST_BUDGETS,
    });
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0]?.role).toBe('system');
    expect(req.messages[1]?.content).toBe(SECRET_INPUT);
    for (const key of Object.keys(req.metadata)) {
      expect(['subjectRef', 'internalNote', 'phone', 'apiKey', 'token']).not.toContain(key);
    }
  });
});

describe('authority — draft only, no send', () => {
  it('(66,67) the result is a draft only — no Core ACCEPTED, sent, or executed field', () => {
    const result = makeAdapter().draftReplyDetailed(replyPlan());
    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual([
      'draft',
      'gatewayInvoked',
      'kind',
      'latencyMs',
      'ok',
      'outputTokens',
      'provenance',
      'reason',
      'structuredReply',
    ]);
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of ['coreOutcome', 'accepted', 'sent', 'delivered', 'executed']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it('(68) neither the adapter nor the draft exposes authorize/execute/send/deliver/callN8n', () => {
    const adapter = makeAdapter();
    const result = adapter.draftReplyDetailed(replyPlan());
    const adapterSurface = adapter as unknown as Record<string, unknown>;
    const draftSurface = (result.draft ?? {}) as unknown as Record<string, unknown>;
    for (const forbidden of ['authorize', 'execute', 'send', 'deliver', 'callN8n']) {
      expect(adapterSurface[forbidden]).toBeUndefined();
      expect(draftSurface[forbidden]).toBeUndefined();
    }
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(result.draft)).toBe(true);
  });
});
