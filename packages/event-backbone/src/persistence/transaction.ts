/**
 * Client and transaction helpers.
 *
 * Two functions, and between them they close the three ways this goes wrong:
 *
 * 1. **A leaked client.** A `pool.connect()` whose `release()` is skipped on the error
 *    path exhausts the pool, and the symptom appears somewhere else entirely, later.
 *    Both helpers release in a `finally`.
 *
 * 2. **A swallowed error.** A `ROLLBACK` that itself throws must not replace the error
 *    that caused the rollback — the original failure is the one worth reporting, and
 *    the rollback failure is a symptom of it.
 *
 * 3. **A leaked transaction.** A callback that throws must not leave the connection in
 *    an aborted-transaction state and hand it back to the pool, where the next caller
 *    inherits a broken session.
 *
 * ### No retries here
 *
 * This layer does not retry. Retry policy — what is retryable, how many attempts, what
 * backoff — is a **Stage 3.4** decision recorded in ADR-0021, and burying an implicit
 * retry in the transaction helper would put that policy somewhere nobody thinks to
 * look for it, applied to everything, uniformly, whether or not it is safe.
 */

import type { DatabaseClient, DatabasePool } from './pool.js';

/**
 * Borrow a client for the duration of `callback`, and always release it.
 *
 * No transaction is opened. Statements run in PostgreSQL's implicit
 * autocommit mode. Use `withTransaction` when several statements must succeed or fail
 * together.
 */
export async function withClient<T>(
  pool: DatabasePool,
  callback: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

/**
 * Run `callback` inside a transaction. Commit on success; roll back on any failure.
 *
 * **The original error is always what propagates.** If the `ROLLBACK` also fails — a
 * dropped connection, say — that failure is deliberately discarded, because it is a
 * consequence of the first one and reporting it instead would hide the cause.
 */
export async function withTransaction<T>(
  pool: DatabasePool,
  callback: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let result: T;
    try {
      result = await callback(client);
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Deliberately ignored. The callback's error is the one that matters; a
        // rollback failure on top of it is a symptom, not the cause.
      }
      throw error;
    }

    await client.query('COMMIT');
    return result;
  } finally {
    client.release();
  }
}
