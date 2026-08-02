/**
 * `@qf-jarvis/postgres-conversation-state` — durable conversation-control state (QFJ-P08-B2, ADR-0077).
 *
 * The first production implementation of ADR-0075's writable authoritative-state boundary, and the
 * first durable QFJ-P08 human control: a takeover now survives a restart, and two processes compare
 * revisions through the database rather than through one process's memory.
 *
 * It implements the tenant-scoped read port, the writable operator capability and trusted
 * provisioning. It deliberately does NOT implement `readOperationsProjection` — no governed writer
 * exists for the six supplemental fields, so the composition's `operations-unavailable` remains the
 * honest answer (ADR-0076 §9).
 *
 * The reducer in `@qf-jarvis/conversation-control` stays the only thing that decides. The SQL CHECK
 * constraints validate evidence; they are not a second decision engine.
 *
 * **This package is not wired into anything.** QFJ-P08-B3 composes it. Importing it connects
 * nowhere, creates no pool, reads no environment and starts nothing: the caller injects a `pg` Pool
 * and owns its lifecycle. No operator API, no authentication, no consent, no approval, no transport.
 *
 * Three root runtime symbols.
 */
export {
  POSTGRES_CONVERSATION_STATE_ERROR_CODES,
  PostgresConversationStateError,
} from './contracts/errors.js';
export type { PostgresConversationStateErrorCode } from './contracts/errors.js';

export { createPostgresConversationStateAdapter } from './adapter/create-adapter.js';
export type {
  PostgresConversationStateAdapter,
  TrustedConversationStateProvisioningInput,
  TrustedConversationStateProvisioningResult,
} from './adapter/create-adapter.js';
