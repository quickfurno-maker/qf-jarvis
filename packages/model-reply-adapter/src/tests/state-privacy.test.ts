/**
 * QFJ-M4 — data-class, privacy, and state gates (ADR-0057 §E, §J).
 *
 * Matrix 17–26: HUMAN_ONLY reaches no gateway; LOCAL_ONLY cannot use a hosted release; a privacy/
 * tombstone status, a human takeover, an AI pause, a cancellation, or a party/assignment mismatch
 * blocks before the gateway; a revision or privacy change AFTER the gateway result blocks the draft.
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
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticRelease,
  type RecordingReplyStateReader,
} from '../testing/index.js';

function makeAdapter(
  stateReader: RecordingReplyStateReader,
  invoker: (ModelGatewayInvoker & { invoked: () => number }) | undefined,
) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    stateReader,
    clock: fixedClock(),
    ...(invoker ? { invoker } : {}),
  };
  return createModelReplyAdapter(config);
}

describe('data class', () => {
  it('(17) HUMAN_ONLY reaches no gateway', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const adapter = makeAdapter(scriptedReplyStateReader(clearReplyState()), invoker);
    const result = await adapter.draftReplyDetailed(replyPlan({ dataClass: 'HUMAN_ONLY' }));
    expect(result.reason).toBe('model-state-blocked');
    expect(result.gatewayInvoked).toBe(false);
    expect(invoker.invoked()).toBe(0);
  });

  it('(18) LOCAL_ONLY cannot use a hosted release', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const adapter = makeAdapter(
      scriptedReplyStateReader(clearReplyState({ dataClass: 'LOCAL_ONLY' })),
      invoker,
    );
    const result = await adapter.draftReplyDetailed(replyPlan({ dataClass: 'LOCAL_ONLY' }));
    expect(result.reason).toBe('model-plan-invalid');
    expect(invoker.invoked()).toBe(0);
  });
});

describe('pre-gateway state gate', () => {
  const cases = [
    {
      label: '(19) privacy/tombstone',
      over: { subjectStatus: 'tombstoned' as const },
      reason: 'model-state-blocked',
    },
    { label: '(20) human takeover', over: { humanTakeover: true }, reason: 'model-state-blocked' },
    { label: '(21) AI pause', over: { aiPaused: true }, reason: 'model-state-blocked' },
    { label: '(22) cancellation', over: { cancelled: true }, reason: 'model-cancelled' },
    {
      label: '(23) stale party',
      over: { partyType: 'VENDOR' as const },
      reason: 'model-state-blocked',
    },
    {
      label: '(24) assignment mismatch',
      over: { assignedActor: 'ANISHA' as const },
      reason: 'model-state-blocked',
    },
  ];
  for (const { label, over, reason } of cases) {
    it(`${label} invokes no gateway`, async () => {
      const invoker = scriptedGatewayInvoker(structuredReply());
      const adapter = makeAdapter(scriptedReplyStateReader(clearReplyState(over)), invoker);
      const result = await adapter.draftReplyDetailed(replyPlan());
      expect(result.reason).toBe(reason);
      expect(result.gatewayInvoked).toBe(false);
      expect(invoker.invoked()).toBe(0);
    });
  }
});

describe('post-gateway state gate', () => {
  it('(25) a revision change after the result blocks the draft', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const reader = scriptedReplyStateReader(clearReplyState(), clearReplyState({ revision: 2 }));
    const adapter = makeAdapter(reader, invoker);
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(result.reason).toBe('model-state-blocked');
    expect(result.gatewayInvoked).toBe(true);
    expect(result.draft).toBeUndefined();
    expect(reader.reads()).toBe(2);
  });

  it('(26) a privacy/tombstone change after the result blocks the draft', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const reader = scriptedReplyStateReader(
      clearReplyState(),
      clearReplyState({ subjectStatus: 'erased' }),
    );
    const adapter = makeAdapter(reader, invoker);
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(result.reason).toBe('model-state-blocked');
    expect(result.gatewayInvoked).toBe(true);
    expect(result.draft).toBeUndefined();
  });

  it('(25) a cancellation after the result blocks the draft as cancelled', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply());
    const reader = scriptedReplyStateReader(
      clearReplyState(),
      clearReplyState({ cancelled: true }),
    );
    const adapter = makeAdapter(reader, invoker);
    expect((await adapter.draftReplyDetailed(replyPlan())).reason).toBe('model-cancelled');
  });
});
