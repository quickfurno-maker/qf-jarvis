/**
 * `@qf-jarvis/jarvis-runtime` — the QFJ-M5 Orchestrated Reply Composition Foundation (ADR-0059).
 *
 * The smallest stable composition surface: the runtime factory and its async `processInbound`, the ONE
 * authoritative content-free conversation-state source contract, the injected config, the closed
 * result/outcome vocabulary, the safe error, and the content-free observability contract. It does NOT
 * export mutable internals (the projection adapters, the flow, the validators) or the test fakes/
 * fixtures (those live under `./testing`). The composition wires M1–M4 without duplicating any business
 * rule; QuickFurno Core remains the only business authority and model output is a draft only — nothing
 * is sent, delivered, executed, or persisted.
 */

// Runtime factory.
export { createJarvisRuntime } from './composition/create-jarvis-runtime.js';
export type { JarvisRuntime } from './composition/create-jarvis-runtime.js';

// The ONE authoritative conversation-state source.
export type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
} from './contracts/authoritative-state.js';

// Config + result + outcome vocabulary.
export type { JarvisRuntimeConfig } from './contracts/runtime-config.js';
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
