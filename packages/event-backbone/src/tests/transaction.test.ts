/**
 * `withClient` / `withTransaction` client-lifecycle ordering (Stage 3.3.5).
 *
 * A pooled `pg` client is a SINGLE connection: it cannot run two queries at once, and a client
 * returned to the pool while a query is still in flight is how the "Calling client.query() when the
 * client is already executing a query" deprecation appears. These tests pin the ordering guarantees
 * both helpers must keep, using a fake client that records every operation in order:
 *
 * - the callback promise fully settles BEFORE `release()`;
 * - a rejected callback is awaited before `release()`;
 * - `COMMIT` runs only AFTER the transaction callback completes;
 * - `ROLLBACK` runs only AFTER the callback rejects;
 * - `release()` runs AFTER `COMMIT`/`ROLLBACK`;
 * - the ORIGINAL callback/database error is what propagates (a failing `ROLLBACK` never masks it);
 * - the client is released exactly once.
 *
 * The helpers are already correct — they `await` the callback and the COMMIT/ROLLBACK before the
 * `finally` release — so these are regression guards, not a bug reproduction.
 */
import { describe, expect, it } from 'vitest';

import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import { withClient, withTransaction } from '../persistence/transaction.js';

/** A fake single-connection client that records an ordered log of every operation. */
class RecordingClient {
  public readonly log: string[] = [];
  public releaseCount = 0;
  /** SQL text (uppercased first word) that should reject when queried, e.g. 'ROLLBACK'. */
  public failOn: string | null = null;

  public query(text: string): Promise<{ rows: never[] }> {
    const verb = text.trim().split(/\s+/)[0]?.toUpperCase() ?? text;
    this.log.push(`query:${verb}`);
    if (this.failOn !== null && verb === this.failOn) {
      return Promise.reject(new Error(`database failure on ${verb}`));
    }
    return Promise.resolve({ rows: [] });
  }

  public release(): void {
    this.releaseCount += 1;
    this.log.push('release');
  }
}

/** A pool that always hands out the given client. */
function poolFor(client: RecordingClient): DatabasePool {
  return {
    connect: () => Promise.resolve(client as unknown as DatabaseClient),
  } as unknown as DatabasePool;
}

/** Resolve after a macrotask, so "did release wait for me?" is a real question. */
function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('withClient — releases only after the callback settles', () => {
  it('does not release the client before an async callback resolves', async () => {
    const client = new RecordingClient();
    const result = await withClient(poolFor(client), async () => {
      await delay();
      client.log.push('callback-resolved');
      return 'value';
    });
    expect(result).toBe('value');
    expect(client.log).toStrictEqual(['callback-resolved', 'release']);
    expect(client.releaseCount).toBe(1);
  });

  it('awaits a REJECTED async callback before releasing, and preserves the error', async () => {
    const client = new RecordingClient();
    const original = new Error('callback failed');
    let caught: unknown;
    try {
      await withClient(poolFor(client), async () => {
        await delay();
        client.log.push('callback-rejected');
        throw original;
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(original);
    expect(client.log).toStrictEqual(['callback-rejected', 'release']);
    expect(client.releaseCount).toBe(1);
  });
});

describe('withTransaction — COMMIT/ROLLBACK order and error preservation', () => {
  it('runs BEGIN, then the callback to completion, then COMMIT, then release', async () => {
    const client = new RecordingClient();
    const result = await withTransaction(poolFor(client), async (c) => {
      await c.query('INSERT');
      await delay();
      client.log.push('callback-resolved');
      return 42;
    });
    expect(result).toBe(42);
    expect(client.log).toStrictEqual([
      'query:BEGIN',
      'query:INSERT',
      'callback-resolved',
      'query:COMMIT',
      'release',
    ]);
    expect(client.releaseCount).toBe(1);
  });

  it('runs ROLLBACK only after the callback rejects, then releases, preserving the error', async () => {
    const client = new RecordingClient();
    const original = new Error('callback failed mid-transaction');
    let caught: unknown;
    try {
      await withTransaction(poolFor(client), async () => {
        await delay();
        client.log.push('callback-rejected');
        throw original;
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(original);
    expect(client.log).toStrictEqual([
      'query:BEGIN',
      'callback-rejected',
      'query:ROLLBACK',
      'release',
    ]);
    expect(client.releaseCount).toBe(1);
  });

  it('never COMMITs when the callback rejects', async () => {
    const client = new RecordingClient();
    await withTransaction(poolFor(client), () => Promise.reject(new Error('boom'))).catch(
      () => undefined,
    );
    expect(client.log).not.toContain('query:COMMIT');
  });

  it('propagates the ORIGINAL callback error even when ROLLBACK itself fails', async () => {
    const client = new RecordingClient();
    client.failOn = 'ROLLBACK'; // the rollback throws on top of the callback error
    const original = new Error('the real cause');
    let caught: unknown;
    try {
      await withTransaction(poolFor(client), () => Promise.reject(original));
    } catch (error: unknown) {
      caught = error;
    }
    // The callback's error is the cause; the rollback failure is a symptom and must not mask it.
    expect(caught).toBe(original);
    expect((caught as Error).message).toBe('the real cause');
    // Still released exactly once, after the (failed) ROLLBACK attempt.
    expect(client.log).toStrictEqual(['query:BEGIN', 'query:ROLLBACK', 'release']);
    expect(client.releaseCount).toBe(1);
  });

  it('propagates a COMMIT failure and still releases exactly once', async () => {
    const client = new RecordingClient();
    client.failOn = 'COMMIT';
    let caught: unknown;
    try {
      await withTransaction(poolFor(client), () => Promise.resolve('ok'));
    } catch (error: unknown) {
      caught = error;
    }
    expect((caught as Error).message).toBe('database failure on COMMIT');
    expect(client.log).toStrictEqual(['query:BEGIN', 'query:COMMIT', 'release']);
    expect(client.releaseCount).toBe(1);
  });
});
