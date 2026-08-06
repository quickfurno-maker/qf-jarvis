/**
 * The store's public shapes (QFJ-P09.03, ADR-0091).
 *
 * There is exactly one capability, and it is the one `ExecutionReplayGuard` already defines.
 *
 * ### What is deliberately absent
 *
 * No `has`, `get`, `find`, `lookup`, `list`, `count`, `release`, `clear`, `delete`, `prune`,
 * `expire` or `reset`. Each of those is either a duplicate-enabling operation or a read that turns
 * this table into an oracle — "does this idempotency key exist?" is a question a prober would like
 * answered, and the claim path answers it only as a side effect of a caller that already holds an
 * authenticated dispatch.
 *
 * No `canExecute`, `canSend`, `isAuthorized`, `consentValid`, `retryAllowed`, `sent`, `delivered`
 * or `executed`. The reason is the same one ADR-0090 §8 gives for the observation type: none of
 * them would be true. This package records that a claim happened; it authorizes nothing.
 */
import type { ExecutionReplayGuard } from '@qf-jarvis/execution-dispatch-runtime';
import type { Pool } from 'pg';

/**
 * What a caller supplies to build the store.
 *
 * The `pg` Pool is INJECTED, and this package never creates one. It reads no `DATABASE_URL`, no
 * connection string, no host, no credential and no environment variable of any kind: connection
 * ownership stays with the composition root that already holds the secret, so a storage adapter
 * never becomes a second place a credential can be configured — or leaked.
 */
export interface PostgresExecutionReplayStoreConfig {
  /** An open `pg` Pool. The caller creates it, configures it, and closes it. */
  readonly pool: Pool;
}

/**
 * The durable store.
 *
 * Structurally an `ExecutionReplayGuard` and nothing more, so the QFJ-P09.02 dispatch boundary can
 * take it directly and no second interface has to be kept in step with the first.
 *
 * There is deliberately no `assertReady`, unlike `@qf-jarvis/postgres-approval-queue`. That queue
 * is composed into a running application at startup, where a probe has a caller; this store has no
 * production consumer in this slice, and a missing migration 0010 already surfaces on the first
 * claim as `schema-incompatible` — which the dispatch boundary converts to `replay-guard-unavailable`
 * and refuses. Failing closed at the moment of use is the answer; an extra method the verifier can
 * never call is not.
 */
export type PostgresExecutionReplayStore = ExecutionReplayGuard;
