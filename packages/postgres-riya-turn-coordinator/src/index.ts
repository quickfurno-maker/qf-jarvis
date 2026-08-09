/**
 * `@qf-jarvis/postgres-riya-turn-coordinator` — the durable Riya turn coordinator (RWC-P8, ADR-0104).
 *
 * The concrete implementation of the `RiyaTurnCoordinatorPort` that RWC-P8 declared and deliberately
 * left injected with no default. Two jobs: serialize TEXT turns so one conversation runs one at a
 * time across every replica, and record which logical messages have been claimed so a spent message
 * can never run again.
 *
 * It sits BELOW the ingress transport replay guard rather than replacing it. That guard protects one
 * signed request inside its freshness window and is process-local; a trusted caller can re-sign the
 * SAME logical message under a fresh `requestId`, and every transport guard in the deployment would
 * correctly let it through. Both layers stay.
 *
 * Serialization is a PostgreSQL SESSION advisory lock held on one dedicated client for the life of a
 * turn. There is NO transaction open across the model call: a `BEGIN` held from claim to finalization
 * would pin a connection and hold locks for the length of an inference. If an unlock is not provably
 * clean the physical connection is destroyed rather than returned to the pool, because a leaked
 * session lock would block an unrelated conversation forever with nothing to explain why.
 *
 * It stores no message text and no DIGEST of message text — a hash of a sentence is still a durable
 * fingerprint of what a person wrote. It stores no reply, no raw channel turn reference, no subject
 * reference, no contact detail, no provider artifact, no `requestId` and no Core decision: opaque
 * canonical identifiers, the channel, two non-content digests, a lifecycle state, and two timestamps
 * the database stamps.
 *
 * Nothing composes it: importing it connects nowhere, creates no pool, reads no environment and
 * starts nothing. Depends on `@qf-jarvis/riya-web-conversation-service` for the port types, and `pg`.
 */

export { createPostgresRiyaTurnCoordinator } from './adapter/create-coordinator.js';
export type { PostgresRiyaTurnCoordinatorConfig } from './adapter/create-coordinator.js';

export {
  POSTGRES_RIYA_TURN_COORDINATOR_ERROR_CODES,
  PostgresRiyaTurnCoordinatorError,
} from './contracts/errors.js';
export type { PostgresRiyaTurnCoordinatorErrorCode } from './contracts/errors.js';

// RWC-P9 (ADR-0105): content-free operational observability. TWO runtime values -- the closed event
// vocabulary and the no-op default. The SQL, the digests, the lock key, the table and the session
// release helper all stay internal, exactly as before.
export {
  NOOP_POSTGRES_RIYA_TURN_COORDINATOR_OBSERVABILITY,
  POSTGRES_RIYA_TURN_COORDINATOR_DISCARD_REASONS,
  POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES,
} from './contracts/observability.js';
export type {
  PostgresRiyaTurnCoordinatorDiscardReason,
  PostgresRiyaTurnCoordinatorEvent,
  PostgresRiyaTurnCoordinatorEventType,
  PostgresRiyaTurnCoordinatorObservabilityHook,
} from './contracts/observability.js';
