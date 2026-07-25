/**
 * QFJ-M1 — human takeover, AI pause, privacy, and data class (ADR-0054 §E, §H, §I).
 *
 * Matrix items 7–14, 21–23: human takeover / AI pause block AI before any model call; return-to-AI
 * needs an explicit authorized transition; HUMAN_ONLY never calls a model; LOCAL_ONLY cannot use a
 * hosted interface; the privacy gate runs before content/model/knowledge; proposals stay pending Core
 * validation and the runtime grants no authority.
 */
import { describe, expect, it } from 'vitest';

import { createAgentRuntime } from '../runtime/create-agent-runtime.js';
import type { CreateAgentRuntimeConfig } from '../runtime/create-agent-runtime.js';
import { processInbound } from '../runtime/process-inbound.js';
import { createConversationContext } from '../contracts/conversation-context.js';
import type { ConversationContextInput } from '../contracts/conversation-context.js';
import { createInboundEnvelope } from '../contracts/inbound-envelope.js';
import type { InboundEnvelopeInput } from '../contracts/inbound-envelope.js';
import { isValidConversationTransition } from '../contracts/conversation-state.js';
import { PROPOSAL_AUTHORITY_STATUS } from '../contracts/vocabularies.js';
import { createDeterministicPrivacyGate } from '../testing/deterministic-privacy-gate.js';
import {
  contextInput,
  envelopeInput,
  syntheticPolicy,
  throwingModelInterface,
} from '../testing/fixtures.js';

function run(
  contextOver: Partial<ConversationContextInput>,
  runtimeOver: Partial<CreateAgentRuntimeConfig> = {},
  envelopeOver: Partial<InboundEnvelopeInput> = {},
) {
  const runtime = createAgentRuntime({
    policy: syntheticPolicy(),
    modelInterface: throwingModelInterface('HOSTED'),
    ...runtimeOver,
  });
  const context = createConversationContext(contextInput(contextOver));
  const envelope = createInboundEnvelope(
    envelopeInput({ partyType: contextInput(contextOver).partyType, ...envelopeOver }),
  );
  return processInbound(runtime, context, envelope);
}

function hasKind(decision: Awaited<ReturnType<typeof run>>, kind: string): boolean {
  return decision.ok && decision.proposals.some((p) => p.kind === kind);
}

describe('human takeover and AI pause', () => {
  it('(7) HUMAN_TAKEOVER blocks AI before any model call', async () => {
    const decision = await run({ humanTakeover: true });
    expect(decision.ok && decision.aiEligible).toBe(false);
    expect(decision.ok && decision.reason).toBe('runtime-human-takeover');
    expect(hasKind(decision, 'REPLY')).toBe(false);
    expect(hasKind(decision, 'ESCALATION')).toBe(true);
  });

  it('(8) AI pause blocks AI before any model call (fail closed)', async () => {
    const decision = await run({ aiPaused: true });
    expect(decision.ok && decision.aiEligible).toBe(false);
    expect(decision.ok && decision.reason).toBe('runtime-ai-paused');
    expect(hasKind(decision, 'REPLY')).toBe(false);
  });

  it('(9) returning to AI requires an explicit authorized transition', () => {
    expect(isValidConversationTransition('HUMAN_TAKEOVER', 'ACTIVE_AI')).toBe(false);
    expect(
      isValidConversationTransition('HUMAN_TAKEOVER', 'ACTIVE_AI', { authorized: false }),
    ).toBe(false);
    expect(isValidConversationTransition('HUMAN_TAKEOVER', 'ACTIVE_AI', { authorized: true })).toBe(
      true,
    );
    expect(isValidConversationTransition('ESCALATED', 'ACTIVE_AI')).toBe(false);
    expect(isValidConversationTransition('ESCALATED', 'ACTIVE_AI', { authorized: true })).toBe(
      true,
    );
  });
});

describe('data class', () => {
  it('(10) HUMAN_ONLY never reaches a model', async () => {
    const decision = await run({ dataClass: 'HUMAN_ONLY' }, {}, { dataClass: 'HUMAN_ONLY' });
    expect(decision.ok && decision.aiEligible).toBe(false);
    expect(decision.ok && decision.reason).toBe('runtime-human-only');
    expect(hasKind(decision, 'REPLY')).toBe(false);
  });

  it('(11) LOCAL_ONLY cannot use a hosted interface but can use a local one', async () => {
    const hosted = await run(
      { dataClass: 'LOCAL_ONLY' },
      { modelInterface: throwingModelInterface('HOSTED') },
      { dataClass: 'LOCAL_ONLY' },
    );
    expect(hosted.ok && hosted.reason).toBe('runtime-data-class-unserviceable');
    expect(hasKind(hosted, 'REPLY')).toBe(false);
    const local = await run(
      { dataClass: 'LOCAL_ONLY' },
      { modelInterface: throwingModelInterface('LOCAL') },
      { dataClass: 'LOCAL_ONLY' },
    );
    expect(local.ok && local.aiEligible).toBe(true);
    expect(hasKind(local, 'REPLY')).toBe(true);
  });
});

describe('privacy gate before model/knowledge', () => {
  it('(12) a subject-linked conversation without a privacy gate fails closed', async () => {
    const decision = await run({ subjectRef: 'subject.person.1' });
    expect(decision.ok).toBe(false);
    expect(decision.ok ? '' : decision.reason).toBe('runtime-privacy-gate-missing');
  });

  it('(13) erased/tombstoned/in-progress subjects are blocked before content/model', async () => {
    for (const status of ['erased', 'tombstoned', 'in-progress', 'anonymised'] as const) {
      const gate = createDeterministicPrivacyGate({ statuses: { 'subject.person.1': status } });
      const decision = await run({ subjectRef: 'subject.person.1' }, { privacyGate: gate });
      expect(decision.ok).toBe(false);
      expect(decision.ok ? '' : decision.reason).toBe('runtime-subject-blocked');
    }
  });

  it('(14) a cleared subject passes the gate', async () => {
    const gate = createDeterministicPrivacyGate({ statuses: { 'subject.person.1': 'clear' } });
    const decision = await run({ subjectRef: 'subject.person.1' }, { privacyGate: gate });
    expect(decision.ok).toBe(true);
  });
});

describe('authority (proposals only)', () => {
  it('(21,22) proposals stay PENDING_CORE_VALIDATION and the runtime/decision grant no authority', async () => {
    const decision = await run({});
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      for (const proposal of decision.proposals) {
        expect(proposal.authorityStatus).toBe(PROPOSAL_AUTHORITY_STATUS);
      }
      const asRecord = decision as unknown as Record<string, unknown>;
      for (const method of ['authorize', 'execute', 'send', 'callN8n', 'commit']) {
        expect(asRecord[method]).toBeUndefined();
      }
    }
  });
});
