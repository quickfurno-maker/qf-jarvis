/**
 * The package's own surface types (RWC-P2B, ADR-0095).
 *
 * The BEHAVIOURAL contract is not here: it is `RiyaContinuityStorePort`, owned by
 * `@qf-jarvis/riya-web-conversation-service`. This module adds only what constructing the adapter
 * needs, and deliberately re-exports nothing of the port -- two declarations of the same interface
 * are two things that can drift, and the drift would be invisible until a composition wired the
 * wrong one.
 */
import type { RiyaContinuityStorePort } from '@qf-jarvis/riya-web-conversation-service';
import type { Pool } from 'pg';

/**
 * What the adapter is built from. A pool, and nothing else.
 *
 * There is no connection string, no host, no credential, no environment name and no option that
 * could point this adapter somewhere by accident: the CALLER creates the pool, and owns closing it.
 * That is the same ownership rule `@qf-jarvis/postgres-conversation-state` and
 * `@qf-jarvis/postgres-execution-replay-store` follow, and it is why importing this package connects
 * nowhere and reads no environment.
 */
export interface PostgresRiyaContinuityStoreConfig {
  readonly pool: Pool;
}

/**
 * The durable store. Exactly the port, and nothing added.
 *
 * A structural alias rather than an extension on purpose: there is no `delete`, `clear`, `prune`,
 * `reset`, `list`, `count` or `all`, and no escape hatch that returns a raw row. A caller holding
 * this type can do exactly the three things the port declares, which is what makes "the adapter
 * cannot do more than the contract" a property of the type rather than a promise in a comment.
 */
export type PostgresRiyaContinuityStore = RiyaContinuityStorePort;
