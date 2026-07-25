/**
 * Deterministic synthetic fixtures for the QFJ-M1 runtime (ADR-0054).
 *
 * The only shipped fixture content (exported under `./testing`). All synthetic — no real message,
 * subject, key, or token. Builds valid envelope/context/policy/model-interface inputs a test can vary.
 * The model interface's `draftReply` THROWS if the runtime ever calls it (it must not in M1).
 */
import type { ConversationContextInput } from '../contracts/conversation-context.js';
import type { InboundEnvelopeInput } from '../contracts/inbound-envelope.js';
import { createRuntimePolicy } from '../contracts/policy.js';
import type { RuntimePolicy } from '../contracts/policy.js';
import type { RuntimeModelInterface } from '../runtime/create-agent-runtime.js';
import type { RuntimeExecutionClass } from '../contracts/vocabularies.js';

/** A synthetic routing policy. */
export function syntheticPolicy(unknownRouting: 'JARVIS' | 'HUMAN' = 'JARVIS'): RuntimePolicy {
  return createRuntimePolicy({ policyRevision: 'policy.rev.1', unknownRouting });
}

/** A synthetic inbound envelope input; override any field for a specific test. */
export function envelopeInput(overrides: Partial<InboundEnvelopeInput> = {}): InboundEnvelopeInput {
  return {
    runtimeId: 'rt.1',
    conversationId: 'conv.1',
    messageId: 'msg.1',
    tenantId: 'tenant.a',
    channel: 'WHATSAPP',
    partyType: 'CLIENT',
    direction: 'INBOUND',
    receivedAt: '2026-07-25T00:00:00Z',
    providerMessageRef: 'wamid.opaque.ref',
    dataClass: 'HOSTED_ALLOWED',
    ...overrides,
  };
}

/** A synthetic conversation context input; override any field for a specific test. */
export function contextInput(
  overrides: Partial<ConversationContextInput> = {},
): ConversationContextInput {
  return {
    conversationId: 'conv.1',
    tenantId: 'tenant.a',
    partyType: 'CLIENT',
    state: 'ACTIVE_AI',
    dataClass: 'HOSTED_ALLOWED',
    ...overrides,
  };
}

/**
 * A synthetic model interface whose `draftReply` THROWS — proving the runtime never calls a model in
 * this slice. `executionClass` gates data-class serviceability.
 */
export function throwingModelInterface(
  executionClass: RuntimeExecutionClass = 'HOSTED',
): RuntimeModelInterface {
  return Object.freeze({
    executionClass,
    draftReply(_request: unknown): Promise<unknown> {
      throw new Error('QFJ-M1: the runtime must not call a model interface');
    },
  });
}
