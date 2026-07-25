/**
 * `@qf-jarvis/core-decision-adapter` — the QFJ-M3 QuickFurno Core Decision Adapter (ADR-0056).
 *
 * The smallest stable composition surface: the protocol identity, the command/response/state/
 * observability contracts, the injected transport interface, the adapter factory, and the retry
 * classifier. It does NOT export the test fakes/fixtures (those live under `./testing`). Only a Core
 * response yields ACCEPTED; ACCEPTED is approved only — never sent, delivered, executed, or persisted.
 * This is a PROPOSED integration contract pending QuickFurno Core-side adoption.
 */

// Protocol + digest.
export {
  DEFAULT_CORE_DECISION_PROTOCOL,
  coreDecisionProtocolSchema,
} from './contracts/protocol.js';
export type { CoreDecisionProtocol } from './contracts/protocol.js';
export { contentDigest, canonicalJson, isCanonicalInstant } from './contracts/digest.js';

// Errors + reasons.
export { CoreAdapterError, CORE_ADAPTER_ERROR_CODES } from './contracts/errors.js';
export type { CoreAdapterErrorCode } from './contracts/errors.js';
export { CORE_ADAPTER_REASONS } from './contracts/reasons.js';
export type { CoreAdapterReason } from './contracts/reasons.js';

// Command / response / state.
export { buildCoreCommand, idempotencyKeyFor } from './contracts/command.js';
export type { CoreCommand, CoreCommandIdentity } from './contracts/command.js';
export { coreCommandResponseSchema } from './contracts/response.js';
export type { CoreCommandResponse } from './contracts/response.js';
export type { CoreDecisionState, CoreDecisionStateReader } from './contracts/state.js';

// Observability.
export {
  NOOP_CORE_ADAPTER_OBSERVABILITY,
  CORE_ADAPTER_EVENT_TYPES,
} from './contracts/observability.js';
export type {
  CoreAdapterEvent,
  CoreAdapterEventType,
  CoreAdapterObservabilityHook,
} from './contracts/observability.js';

// Transport + validation + gates + retry.
export { serializeCommand } from './transport/core-decision-transport.js';
export type { CoreDecisionTransport } from './transport/core-decision-transport.js';
export { validateResponse } from './adapter/validate-response.js';
export type { ResponseValidation } from './adapter/validate-response.js';
export { isStateBlocked } from './adapter/state-gates.js';
export { isRetryable } from './adapter/retry-classification.js';

// Adapter.
export { createCoreDecisionAdapter } from './adapter/create-core-decision-adapter.js';
export type {
  CoreDecisionAdapter,
  CoreDecisionAdapterConfig,
  CoreAdapterResult,
} from './adapter/create-core-decision-adapter.js';
