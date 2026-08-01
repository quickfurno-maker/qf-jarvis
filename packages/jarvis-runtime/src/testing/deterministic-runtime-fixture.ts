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
import {
  scriptedGatewayInvoker,
  structuredReply,
  syntheticRelease,
} from '@qf-jarvis/model-reply-adapter/testing';

import { createPromptDefinition, createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type {
  PromptAgentScope,
  PromptDefinition,
  PromptRegistry,
} from '@qf-jarvis/prompt-registry';
import type { ClientSalesSignals } from '@qf-jarvis/riya-agent';

import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type {
  ClientSalesBehaviourInput,
  ClientSalesBehaviourInputPort,
} from '../contracts/behaviour-input.js';
import {
  clearControlState,
  fixedClock,
  scriptedAuthoritativeState,
} from './deterministic-authoritative-state.js';

/**
 * A synthetic prompt registry for one agent scope (QFJ-S3-I-B, ADR-0073).
 *
 * A prompt definition is scope-bound and `(promptId, promptVersion)` is globally unique, so ONE
 * runtime configuration -- which carries a single `promptFamily` -- can serve exactly one scope. A
 * VENDOR test therefore supplies both a vendor prompt id and a VENDOR-scoped registry, exactly as a
 * real vendor deployment would.
 */
export function syntheticPromptDefinition(
  promptId = 'reply.client',
  agentScope: PromptAgentScope = 'CLIENT',
  promptVersion = 1,
): PromptDefinition {
  return createPromptDefinition({
    promptId,
    promptVersion,
    agentScope,
    taskClass: 'RESPONSE_GENERATION',
    resultMode: 'STRUCTURED',
    systemTemplate: `Synthetic ${agentScope} runtime fixture prompt. Not a production instruction.`,
  });
}

export function syntheticPromptRegistry(
  promptId = 'reply.client',
  agentScope: PromptAgentScope = 'CLIENT',
  promptVersion = 1,
): PromptRegistry {
  return createPromptRegistry([syntheticPromptDefinition(promptId, agentScope, promptVersion)]);
}

/** The default CLIENT definition the fixture config below binds -- registry AND evaluation digest. */
const DEFAULT_PROMPT = syntheticPromptDefinition();

/**
 * A ready-to-run runtime config that produces `CORE_ACCEPTED` on the happy path (clear state, CLIENT →
 * Riya, hosted, no knowledge → empty citations). Override any field for a specific test.
 */
export function syntheticRuntimeConfig(
  over: Partial<JarvisRuntimeConfig> = {},
): JarvisRuntimeConfig {
  return {
    authoritativeState: scriptedAuthoritativeState(clearControlState()),
    policy: createRuntimePolicy({ policyRevision: 'policy.rev.1' }),
    clock: fixedClock(),
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    // A model-backed draft now requires an injected registry (ADR-0073); the default one is
    // CLIENT-scoped to match `promptFamily` above.
    promptRegistry: createPromptRegistry([DEFAULT_PROMPT]),
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    // `evaluationRef` and `evaluationPromptDigest` are a pair: an evaluation reference that does not
    // say WHICH prompt bytes it covers is the gap ADR-0073 closes, so M4 refuses a half-supplied one.
    evaluationPromptDigest: DEFAULT_PROMPT.contentDigest,
    gatewayInvoker: scriptedGatewayInvoker(structuredReply({ citations: [] })),
    coreTransport: scriptedCoreTransport('ACCEPTED'),
    ...over,
  };
}

/**
 * A scripted client-sales behaviour input port (ADR-0068).
 *
 * Synthetic and inert: it answers with whatever the test hands it and records nothing beyond a call
 * count, so a spec can prove a gate refused BEFORE any behaviour input was read. `undefined` means
 * "no opinion", which keeps the runtime on the legacy REPLY path.
 */
export function scriptedBehaviourInput(
  input: ClientSalesBehaviourInput | undefined,
): ClientSalesBehaviourInputPort & { readonly calls: () => number } {
  let calls = 0;
  return {
    calls: (): number => calls,
    read(): Promise<ClientSalesBehaviourInput | undefined> {
      calls += 1;
      return Promise.resolve(input);
    },
  };
}

/** A behaviour input port that always rejects, to prove the seam fails closed with zero model calls. */
export function rejectingBehaviourInput(): ClientSalesBehaviourInputPort {
  return {
    read(): Promise<ClientSalesBehaviourInput | undefined> {
      return Promise.reject(new Error('synthetic behaviour input failure'));
    },
  };
}

/** Synthetic closed client-sales signals; override any field for a specific test. */
export function syntheticSignals(over: Partial<ClientSalesSignals> = {}): ClientSalesSignals {
  return {
    hasPriorSalesContext: false,
    requestedHumanAssistance: false,
    requestedQuoteOrConsultation: false,
    providedRequirementDetail: false,
    askedAboutReadiness: false,
    outOfSalesScope: false,
    missingDiscoveryFieldCount: 0,
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
