/**
 * `@qf-jarvis/jarvis-runtime` — the QFJ-M5 Orchestrated Reply Composition Foundation (ADR-0059).
 *
 * The smallest stable composition surface: the runtime factory and its four async methods
 * (`processInbound` and its RWC-P2D content-bearing sibling `processInboundForCoreAuthorizedReply`,
 * plus the QFJ-P08-A operator `applyConversationControlCommand` and
 * `readConversationOperationsSnapshot`), the ONE authoritative content-free conversation-state source
 * contract and its two OPTIONAL operator capability extensions, the injected config, the closed
 * result/outcome vocabulary, the safe error, and the content-free observability contract. It does NOT
 * export mutable internals (the projection adapters, the flow, the validators) or the test fakes/
 * fixtures (those live under `./testing`). The composition wires M1–M4 without duplicating any business
 * rule; QuickFurno Core remains the only business authority and model output is a draft only — nothing
 * is sent, delivered, executed, or persisted.
 */

// Runtime factory.
export { createJarvisRuntime } from './composition/create-jarvis-runtime.js';
export type {
  CoreAuthorizedReplyJarvisRuntime,
  JarvisRuntime,
} from './composition/create-jarvis-runtime.js';

// The RWC-P2D Core-authorized reply materialization (ADR-0096). TYPES ONLY, and deliberately not a
// field on `JarvisRuntimeResult`: the ordinary result stays content-free and safe to log whole, and a
// caller that wants client-facing text must name the capability that carries it. `CORE_ACCEPTED`
// means Core authorized the exact proposal -- never sent, delivered, rendered or persisted.
export type {
  CoreTextCarryingProposalKind,
  JarvisCoreAuthorizedReplyResult,
  JarvisCoreAuthorizedReplyV1,
} from './contracts/core-authorized-reply.js';

// The ONE authoritative conversation-state source, plus its OPTIONAL operator capabilities
// (QFJ-P08-A, ADR-0075). Types only -- there is still exactly one `authoritativeState` config field,
// and no runtime detection helper is exported.
export type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
  ConversationStateKey,
  ConversationOperationsProjection,
  OperationsProjectingAuthoritativeConversationStatePort,
  OperatorAuthoritativeConversationStatePort,
  WritableAuthoritativeConversationStatePort,
} from './contracts/authoritative-state.js';

// The operator control/query result unions (QFJ-P08-A, ADR-0075). Types only.
export type {
  JarvisConversationControlInput,
  JarvisConversationControlResult,
} from './composition/control-surface.js';
export type {
  ConversationOperationsQueryInput,
  JarvisConversationOperationsResult,
} from './composition/operations-snapshot.js';

// The optional client-sales behaviour input seam (ADR-0068). Types only.
export type {
  ClientSalesBehaviourInput,
  ClientSalesBehaviourInputPort,
  ClientSalesBehaviourInputRequest,
} from './contracts/behaviour-input.js';

// The optional vendor-journey behaviour input seam (ADR-0071). Types only.
export type {
  VendorJourneyBehaviourInput,
  VendorJourneyBehaviourInputPort,
  VendorJourneyBehaviourInputRequest,
} from './contracts/vendor-journey-behaviour-input.js';

// Config + result + outcome vocabulary.
export type { JarvisRuntimeConfig, JarvisProvenanceRefs } from './contracts/runtime-config.js';
export type { JarvisRuntimeResult } from './contracts/runtime-result.js';
export { JARVIS_RUNTIME_OUTCOMES } from './contracts/reasons.js';
export type { JarvisRuntimeOutcome } from './contracts/reasons.js';

// Errors.
export { JarvisRuntimeError, JARVIS_RUNTIME_ERROR_CODES } from './contracts/errors.js';
export type { JarvisRuntimeErrorCode } from './contracts/errors.js';

// Observability.
export {
  JARVIS_RUNTIME_EVENT_TYPES,
  NOOP_JARVIS_RUNTIME_OBSERVABILITY,
} from './contracts/observability.js';
export type {
  JarvisRuntimeEvent,
  JarvisRuntimeEventType,
  JarvisRuntimeObservabilityHook,
} from './contracts/observability.js';
