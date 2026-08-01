/**
 * QFJ-M5 — authority gates and stale-state interleavings (ADR-0059 §D, §E, §I).
 *
 * Pre-model authority (UNKNOWN→Jarvis/Human, HUMAN_ONLY, LOCAL_ONLY, tombstone) blocks before the
 * model; a change landing WHILE the model or Core Promise is pending is seen by the awaited post-read
 * and fails closed (blocking the proposal/Core or the acceptance); the composition reconciles no
 * business state — it only fails closed.
 */
import { describe, expect, it } from 'vitest';

import { createRuntimePolicy } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { ConversationControlState } from '../contracts/authoritative-state.js';
import {
  clearControlState,
  mutableAuthoritativeState,
  scriptedAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
  syntheticPromptDefinition,
  syntheticPromptRegistry,
} from '../testing/deterministic-runtime-fixture.js';

describe('pre-model authority gates', () => {
  it('UNKNOWN routes to Jarvis and still drafts; UNKNOWN under a HUMAN policy is refused before the model', async () => {
    const invoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const jarvis = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'UNKNOWN' })),
        // JARVIS maps to the COORDINATION prompt scope (ADR-0073).
        promptFamily: 'reply.coordination',
        promptRegistry: syntheticPromptRegistry('reply.coordination', 'COORDINATION'),
        evaluationPromptDigest: syntheticPromptDefinition('reply.coordination', 'COORDINATION')
          .contentDigest,
        gatewayInvoker: invoker,
      }),
    ).processInbound(syntheticInboundEnvelope({ partyType: 'UNKNOWN' }));
    expect(jarvis.outcome).toBe('CORE_ACCEPTED');
    expect(jarvis.assignedActor).toBe('JARVIS');

    const humanInvoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const human = await createJarvisRuntime(
      syntheticRuntimeConfig({
        policy: createRuntimePolicy({ policyRevision: 'policy.rev.1', unknownRouting: 'HUMAN' }),
        authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'UNKNOWN' })),
        // JARVIS maps to the COORDINATION prompt scope (ADR-0073).
        promptFamily: 'reply.coordination',
        promptRegistry: syntheticPromptRegistry('reply.coordination', 'COORDINATION'),
        evaluationPromptDigest: syntheticPromptDefinition('reply.coordination', 'COORDINATION')
          .contentDigest,
        gatewayInvoker: humanInvoker,
      }),
    ).processInbound(syntheticInboundEnvelope({ partyType: 'UNKNOWN' }));
    expect(human.outcome).toBe('REFUSED');
    expect(human.refusalReason).toBe('orchestration-human-takeover');
    expect(humanInvoker.invoked()).toBe(0);
  });

  it('HUMAN_ONLY reaches no model, LOCAL_ONLY never reaches a hosted release, tombstone blocks before the model', async () => {
    for (const [over, reason] of [
      [{ dataClass: 'HUMAN_ONLY' as const }, 'orchestration-human-only'],
      [{ dataClass: 'LOCAL_ONLY' as const }, 'orchestration-data-class-unserviceable'],
      [
        { subjectRef: 'subject.1', subjectStatus: 'tombstoned' as const },
        'orchestration-subject-blocked',
      ],
    ] as const) {
      const invoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
      const result = await createJarvisRuntime(
        syntheticRuntimeConfig({
          authoritativeState: scriptedAuthoritativeState(clearControlState(over)),
          gatewayInvoker: invoker,
        }),
      ).processInbound(syntheticInboundEnvelope());
      expect(result.outcome).toBe('REFUSED');
      expect(result.refusalReason).toBe(reason);
      expect(invoker.invoked()).toBe(0);
    }
  });
});

describe('a change while the model Promise is pending fails closed', () => {
  it('a revision bump landing during the awaited gateway invocation blocks the proposal and Core', async () => {
    let cell = clearControlState({ revision: 1 });
    const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const transport = scriptedCoreTransport('ACCEPTED');
    // The gateway resolves a valid reply, but a revision change lands during the awaited round-trip.
    const mutatingInvoker: ModelGatewayInvoker = {
      invoke: (request) => {
        cell = clearControlState({ revision: 2 });
        return inner.invoke(request);
      },
    };
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: mutableAuthoritativeState(() => cell),
        gatewayInvoker: mutatingInvoker,
        coreTransport: transport,
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-draft-invalid');
    expect(transport.invoked()).toBe(0);
  });

  it('a human takeover landing during the awaited gateway invocation blocks the proposal and Core', async () => {
    let cell = clearControlState();
    const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const transport = scriptedCoreTransport('ACCEPTED');
    const mutatingInvoker: ModelGatewayInvoker = {
      invoke: (request) => {
        cell = clearControlState({ humanTakeover: true });
        return inner.invoke(request);
      },
    };
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: mutableAuthoritativeState(() => cell),
        gatewayInvoker: mutatingInvoker,
        coreTransport: transport,
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(transport.invoked()).toBe(0);
  });
});

describe('a change while the Core Promise is pending blocks acceptance', () => {
  it('a cancellation landing during the awaited transport send blocks ACCEPTED (STALE_REVISION)', async () => {
    let cell: ConversationControlState = clearControlState();
    const inner = scriptedCoreTransport('ACCEPTED');
    // Model + double gate all see rev1; the cancellation lands only during the Core round-trip.
    const mutatingTransport: CoreDecisionTransport = {
      send: (serialized) => {
        cell = clearControlState({ cancelled: true });
        return inner.send(serialized);
      },
    };
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: mutableAuthoritativeState(() => cell),
        coreTransport: mutatingTransport,
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('STALE_REVISION');
  });
});
