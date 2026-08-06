/**
 * `@qf-jarvis/postgres-execution-replay-store` — the durable execution replay / idempotency store
 * (QFJ-P09.03, ADR-0091).
 *
 * ### What this is
 *
 * The PostgreSQL implementation of `ExecutionReplayGuard`, the interface QFJ-P09.02 (ADR-0090)
 * declared REQUIRED and injected with deliberately NO default. Neither available default was safe:
 * an in-memory guard passes every test and loses its state on every restart, and a permissive one
 * turns "unknown" into "first seen". This package supplies the missing durability, and only that.
 *
 * A claim binds all three of `executionIntentId`, `idempotencyKey` and the VERIFIER-computed body
 * digest, with INDEPENDENT database uniqueness on the first two. Binding fewer leaves a way through:
 * the same intent re-sent under a fresh key, one key reused across intents, or the same id and key
 * carrying different bytes.
 *
 * ### What this is not
 *
 * It is **transport-neutral**. The Core → n8n wire protocol remains PROPOSED, and persisting a
 * replay fact does not adopt it: not one of the three stored values is a transport artifact. There
 * is no transport, endpoint, URL, webhook, workflow id, HTTP client, n8n client, provider client or
 * credential anywhere in this package, and nothing in the repository imports it — it is a durable
 * adapter with tests, deliberately, until a later composition slice adopts it.
 *
 * It creates **no execution authority**. Jarvis recommends, QuickFurno Core authorizes, n8n
 * executes, providers deliver, results return to Core. A stored claim says one instruction already
 * crossed the B4 boundary; it does not say anything may happen, and it does not say anything did.
 *
 * It stores **no executable payload**. No `ExecutionIntentV1`, no action parameters, no recipient,
 * no contact detail, no message content, no consent, no approval evidence, no credential and no
 * provider result. ADR-0090 §8 removed the intent from the exact-replay result precisely so a replay
 * observation carries nothing to act on twice; a store that persisted and returned it would undo
 * that.
 *
 * There is **no retention**: no TTL, sweeper, cleanup or archive. Deleting a claim turns an old
 * duplicate back into a first-seen, which is the failure this store exists to prevent.
 *
 * ### The public surface is small on purpose
 *
 * Three runtime values and the types they need. The SQL, the table name, the input validator, the
 * error classifier, the pool and the integration harness are all deliberately NOT exported: each is
 * either an internal detail whose misuse would weaken the boundary, or a test-only artefact that
 * must never reach a caller. There is no `has`, `get`, `list`, `count`, `release`, `clear`,
 * `delete`, `prune` or `reset`, and no `canExecute`, `canSend`, `isAuthorized` or `executed` —
 * because none of them would be true.
 */

export { createPostgresExecutionReplayStore } from './adapter/create-store.js';

export {
  POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES,
  PostgresExecutionReplayStoreError,
} from './contracts/errors.js';
export type { PostgresExecutionReplayStoreErrorCode } from './contracts/errors.js';

export type {
  PostgresExecutionReplayStore,
  PostgresExecutionReplayStoreConfig,
} from './contracts/api.js';
