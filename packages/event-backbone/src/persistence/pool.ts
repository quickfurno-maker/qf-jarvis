/**
 * The PostgreSQL connection pool.
 *
 * ### No hidden global, and nothing created at import time
 *
 * `createDatabasePool` is a function a caller invokes with an explicit config. There is
 * no module-level singleton, and importing this file connects to nothing.
 *
 * A module-scoped pool would mean that *importing* a persistence module opens sockets —
 * which makes the import graph a side effect, makes tests fight over a shared handle,
 * and makes it impossible to run two databases at once (which is exactly what the
 * migration runner's concurrency tests need to do).
 *
 * ### Timeouts are set, not left to chance
 *
 * `statement_timeout` is applied **server-side**, so PostgreSQL itself cancels a query
 * that overruns. A client-side timeout would abandon the socket while the server kept
 * working — which is how a "timed out" query keeps holding a lock.
 */

import pg from 'pg';

import type { DatabaseConfig } from './database-config.js';

const { Pool } = pg;

export type DatabasePool = pg.Pool;
export type DatabaseClient = pg.PoolClient;

/**
 * Create a pool. Connects lazily — no socket is opened until the first query.
 *
 * The caller owns the returned pool and **must** close it (see `closeDatabasePool`).
 */
export function createDatabasePool(config: DatabaseConfig): DatabasePool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    idleTimeoutMillis: config.idleTimeoutMillis,

    // Server-side. PostgreSQL cancels the query; the client does not merely stop waiting.
    statement_timeout: config.statementTimeoutMillis,

    application_name: config.applicationName,

    // A pooled connection that has been idle for a very long time may sit behind a
    // firewall that has silently dropped it. Recycling bounds that surprise.
    maxLifetimeSeconds: 1_800,
  });
}

/**
 * Close a pool and release every connection.
 *
 * Idempotent: closing an already-closed pool is not an error. Tests close pools in
 * `finally` blocks that may run twice, and a close that throws on the second call
 * turns a passing test into a confusing one.
 */
export async function closeDatabasePool(pool: DatabasePool): Promise<void> {
  if (pool.ended) {
    return;
  }
  await pool.end();
}
