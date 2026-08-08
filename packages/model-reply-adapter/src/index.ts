/**
 * `@qf-jarvis/model-reply-adapter` — the QFJ-M4 Model-Gateway Reply Adapter (ADR-0057).
 *
 * The smallest stable composition surface: the adapter factory/interface, the injected gateway-invoker
 * interface, the structured reply schema/types, the detailed result and safe-provenance types, the
 * injected content-free state types, and the safe error/reason/event vocabularies. It does NOT export
 * the internal request builder, validators, digest helpers, or the test fakes/fixtures (those live
 * under `./testing`). The existing `@qf-jarvis/model-gateway` remains the only routing authority; model
 * output is a draft/proposal input only — never a Core `ACCEPTED`, never sent, delivered, or executed.
 */

// Reasons + errors.
export { MODEL_REPLY_ADAPTER_REASONS } from './contracts/reasons.js';
export type { ModelReplyAdapterReason } from './contracts/reasons.js';
export { ModelReplyAdapterError, MODEL_REPLY_ADAPTER_ERROR_CODES } from './contracts/errors.js';
export type { ModelReplyAdapterErrorCode } from './contracts/errors.js';

// Structured reply contract.
// The OPTIONAL structured-output profile seam (ADR-0099). TYPES ONLY, and deliberately generic:
// nothing here names an agent, a domain vocabulary or a business concept. It exists so a richer
// single inference stays ONE inference rather than becoming two calls.
export type {
  ModelReplyStructuredOutputProfile,
  ModelReplyStructuredProjection,
} from './contracts/structured-output-profile.js';

export { STRUCTURED_REPLY_KINDS, structuredReplySchema } from './contracts/reply-schema.js';
export type {
  StructuredReply,
  StructuredReplyKind,
  StructuredReplyCitation,
} from './contracts/reply-schema.js';

// Result + state contracts.
export type { ModelReplyAdapterResult, SafeReplyProvenance } from './contracts/adapter-result.js';
export type { ReplyState, ReplyStateReader } from './contracts/state.js';

// Observability.
export {
  NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY,
  MODEL_REPLY_ADAPTER_EVENT_TYPES,
} from './contracts/observability.js';
export type {
  ModelReplyAdapterEvent,
  ModelReplyAdapterEventType,
  ModelReplyAdapterObservabilityHook,
} from './contracts/observability.js';

// Injected gateway-invoker seam.
export type {
  ModelGatewayInvoker,
  ModelGatewayInvocation,
} from './gateway/model-gateway-invoker.js';

// Adapter.
export { createModelReplyAdapter } from './adapter/create-model-reply-adapter.js';
export type {
  ModelReplyAdapter,
  ModelReplyAdapterConfig,
  ModelReplyPromptBinding,
  ModelReplyPromptBindings,
} from './adapter/create-model-reply-adapter.js';
