/**
 * Deterministic full-runtime fixtures for tests (QFJ-M5, ADR-0059).
 *
 * Shipped under `./testing`. All synthetic — no real provider, Core, gateway, message, key, or token.
 * Builds a ready-to-run `JarvisRuntimeConfig` (one authoritative source + the M4 gateway invoker and M3
 * transport fakes) and a matching inbound envelope, so a test wires the whole M1–M4 composition in one
 * call and varies any field. Reuses the sibling packages' shipped `./testing` fakes — never a
 * production default.
 */
import { createInboundEnvelope, createRuntimePolicy } from '@qf-jarvis/agent-runtime';
import type { InboundEnvelope, InboundEnvelopeInput } from '@qf-jarvis/agent-runtime';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import { scriptedGatewayInvoker, structuredReply, syntheticRelease } from '@qf-jarvis/model-reply-adapter/testing';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import { clearControlState, fixedClock, scriptedAuthoritativeState } from './deterministic-authoritative-state.js';

/**
 * A ready-to-run runtime config that produces `CORE_ACCEPTED` on the happy path (clear state, CLIENT →
 * Riya, hosted, no knowledge → empty citations). Override any field for a specific test.
 */
export function syntheticRuntimeConfig(over: Partial<JarvisRuntimeConfig> = {}): JarvisRuntimeConfig {
  return {
    authoritativeState: scriptedAuthoritativeState(clearControlState()),
    policy: createRuntimePolicy({ policyRevision: 'policy.rev.1' }),
    clock: fixedClock(),
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    gatewayInvoker: scriptedGatewayInvoker(structuredReply({ citations: [] })),
    coreTransport: scriptedCoreTransport('ACCEPTED'),
    ...over,
  };
}

/** A synthetic inbound envelope matching the clear control state; override any field for a test. */
export function syntheticInboundEnvelope(
  over: Partial<InboundEnvelopeInput> = {},
): InboundEnvelope {
  return createInboundEnvelope({
    runtimeId: 'rt.1',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    tenantId: 'tenant.a',
    channel: 'WHATSAPP',
    partyType: 'CLIENT',
    direction: 'INBOUND',
    receivedAt: '2026-07-25T00:00:00Z',
    providerMessageRef: 'ref.opaque.1',
    dataClass: 'HOSTED_ALLOWED',
    normalizedText: 'hello, I have a question',
    ...over,
  });
}
