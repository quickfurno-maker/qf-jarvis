/**
 * Stage 3.4.4 — the internal projection runner against real PostgreSQL 17 (ADR-0037).
 *
 * State-based proofs (pg_stat_activity / pg_blocking_pids / pool counters / bounded polling, never
 * sleeps) of: advisory-lock contention (busy), version AND name lock separation, atomic success,
 * SAVEPOINT-rolled-back handler writes with committed failure bookkeeping, infrastructure abort with no
 * attempt, retry scheduling, fifth-failure blocking, blocked-existing vs caught-up, blocked-projection
 * isolation, retry-pending, position traversal across a raw-identity gap, exact attempt numbering,
 * reconciliation divergence (count mismatch, numbering gap, succeeded row) plus the DB-enforced attempt
 * uniqueness, pre-COMMIT failure vs ambiguous COMMIT, confirmed outer rollback reuse, unknown-COMMIT
 * idempotency with destructive client disposal, release-failure isolation, mixed-path pool integrity,
 * and an aggregate lifecycle over every result/error category with no advisory-lock/client leakage.
 *
 * Every invariant carries its I-id in the test name; the I1-I24 map is in the correction-1 bundle.
 * Synthetic handlers only; no real read models. Loopback-guarded harness.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { projectionAdvisoryLockKeyParameter } from '../projections/projection-lock-key.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';
import { ProjectionRunnerError } from '../projections/projection-runner-errors.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-runner-admin' });
const APPLIED = 'public._runner_applied';

function makeRecord(overrides: Partial<EventPersistenceRecord> = {}): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType: 'qf.recommendation.created',
    eventVersion: 2,
    source: 'quickfurno-core',
    subjectType: 'client',
    subjectId: 'CORE-CLIENT-1',
    occurredAt: '2026-07-11T09:00:00Z',
    emittedAt: '2026-07-11T09:00:05Z',
    correlationId: randomUUID(),
    causationEventId: null,
    payload: { synthetic: true },
    semanticEventDigest: Buffer.alloc(32, 0xa1),
    bodyDigest: Buffer.alloc(32, 0xb2),
    signatureAlgorithm: 'ed25519',
    signatureKeyId: 'test-key',
    signatureSignedAt: '2026-07-11T09:00:06Z',
    signature: Buffer.alloc(64, 0xc3),
    ...overrides,
  };
}

/** Seed `count` genuine events; each maps to the next dense projection position. */
async function seedEvents(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await storeValidatedEvent(admin, makeRecord());
  }
}

const now: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
function laterNow(ms: number): CanonicalInstant {
  return toCanonicalInstant(new Date(Date.parse(now) + ms));
}

// A handler that writes the applied position (for atomicity checks).
function okHandler(projectionName: string) {
  return async (client: DatabaseClient, event: { readonly position: bigint }): Promise<void> => {
    await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
      projectionName,
      event.position.toString(),
    ]);
  };
}
// A deterministic reducer refusal (no SQLSTATE).
const failHandler = async (): Promise<void> => {
  await Promise.resolve();
  throw new Error('deterministic reducer refusal');
};
// An infrastructure-coded rejection (simulated deadlock); the connection stays usable.
const infraHandler = async (): Promise<void> => {
  await Promise.resolve();
  throw Object.assign(new Error('simulated infrastructure'), { code: '40P01' });
};

async function appliedRows(projectionName: string): Promise<bigint[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ position: string }>(
      `SELECT position FROM ${APPLIED} WHERE projection = $1 ORDER BY position`,
      [projectionName],
    );
    return r.rows.map((row) => BigInt(row.position));
  });
}

async function checkpointRow(
  name: string,
  version: number,
): Promise<{ last: bigint; status: string; count: number; blocked: bigint | null } | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      last_position: string;
      status: string;
      failed_attempt_count: number;
      blocked_position: string | null;
    }>(
      `SELECT last_position, status, failed_attempt_count, blocked_position
       FROM qf_jarvis.projection_checkpoint WHERE projection_name = $1 AND projection_version = $2`,
      [name, version],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      last: BigInt(row.last_position),
      status: row.status,
      count: row.failed_attempt_count,
      blocked: row.blocked_position === null ? null : BigInt(row.blocked_position),
    };
  });
}

async function attemptCount(name: string, version: number, position: bigint): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM qf_jarvis.projection_attempt
       WHERE projection_name = $1 AND projection_version = $2 AND event_position = $3`,
      [name, version, position.toString()],
    );
    return r.rows[0]?.n ?? -1;
  });
}

/** True iff the advisory key is held by ANOTHER session (tries a non-blocking lock in a throwaway txn). */
async function advisoryKeyHeldByOther(keyParameter: string): Promise<boolean> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{ got: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS got',
      [keyParameter],
    );
    await client.query('ROLLBACK');
    return r.rows[0]?.got === false;
  } finally {
    client.release();
  }
}

/** Bounded poll until `predicate` holds, or throw on deadline (never a bare sleep as the assertion). */
async function pollUntil(predicate: () => Promise<boolean>, deadlineMs = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > deadlineMs) throw new Error('poll deadline exceeded');
    await new Promise((r) => setTimeout(r, 30));
  }
}

// --- State-based pool/leak probes (pg_stat_activity, pg_blocking_pids, pool counters) -------------

/** Checked-out clients = borrowed but not returned. Zero when quiescent; any positive value is a leak. */
function checkedOut(pool: DatabasePool): number {
  return pool.totalCount - pool.idleCount;
}

/** Count of app backends left in an OPEN (or aborted) transaction — a leaked/aborted transaction. */
async function idleInTxBackends(appName = 'qf-runner-admin'): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE application_name = $1 AND state LIKE 'idle in transaction%'`,
      [appName],
    );
    return r.rows[0]?.n ?? -1;
  });
}

/** Count of app backends currently WAITING on a lock (pg_blocking_pids non-empty). */
async function blockedBackends(appName = 'qf-runner-admin'): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE application_name = $1 AND cardinality(pg_blocking_pids(pid)) > 0`,
      [appName],
    );
    return r.rows[0]?.n ?? -1;
  });
}

/** Hold an advisory key in a dedicated FOREIGN session (transaction-scoped); returns a bounded release. */
async function holdAdvisoryKey(keyParameter: string): Promise<() => Promise<void>> {
  const holder = await admin.connect();
  try {
    await holder.query('BEGIN');
    const got = await holder.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',
      [keyParameter],
    );
    if (got.rows[0]?.locked !== true) {
      throw new Error('could not acquire the advisory key to hold');
    }
  } catch (error) {
    // Never return an OPEN transaction to the pool: roll back the started transaction FIRST, then
    // release, before re-throwing the acquisition/assertion failure.
    try {
      await holder.query('ROLLBACK');
    } catch {
      /* the connection may already be unusable; the release below still returns/destroys it */
    }
    holder.release();
    throw error;
  }
  return async () => {
    try {
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }
  };
}

/** Forge an ACTIVE checkpoint directly (bypassing the runner) to drive reconciliation-divergence tests. */
async function forgeActiveCheckpoint(name: string, count: number, last: bigint): Promise<void> {
  await withClient(admin, (c) =>
    c.query(
      `INSERT INTO qf_jarvis.projection_checkpoint
         (projection_name, projection_version, last_position, status, failed_attempt_count,
          last_safe_error_code, created_at, updated_at)
       VALUES ($1, 1, $2, 'active', $3, 'projection-handler-failed', $4, $4)`,
      [name, last.toString(), count, new Date(now)],
    ),
  );
}

/** Insert one raw attempt row directly (to forge a divergent shape or probe the unique constraint). */
async function insertRawAttempt(
  name: string,
  position: bigint,
  attemptNumber: number,
  outcome: 'succeeded' | 'failed',
  code: string | null,
): Promise<void> {
  await withClient(admin, (c) =>
    c.query(
      `INSERT INTO qf_jarvis.projection_attempt
         (projection_name, projection_version, event_position, attempt_number, outcome,
          safe_error_code, started_at, completed_at)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $6)`,
      [name, position.toString(), attemptNumber, outcome, code, new Date(now)],
    ),
  );
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
  await withClient(admin, (c) =>
    c.query(
      `CREATE TABLE IF NOT EXISTS ${APPLIED} (projection text NOT NULL, position bigint NOT NULL,
         PRIMARY KEY (projection, position))`,
    ),
  );
});

afterAll(async () => {
  await withClient(admin, (c) => c.query(`DROP TABLE IF EXISTS ${APPLIED}`)).catch(() => undefined);
  await closeTestPool(admin);
});

function registryOf(
  name: string,
  version: number,
  apply: (c: DatabaseClient, e: never) => Promise<void>,
) {
  return createProjectionRegistry([{ name, version, apply }]);
}

// ---------------------------------------------------------------------------
// Selection + caught-up + position traversal
// ---------------------------------------------------------------------------

describe('selection and caught-up', () => {
  it('rejects an unknown name or version mismatch (I: selection)', async () => {
    const registry = registryOf('runner-unknown-a', 1, okHandler('runner-unknown-a'));
    await expect(
      runProjectionOnce({ pool: admin, registry, name: 'not-registered', version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-unknown-definition' });
    await expect(
      runProjectionOnce({ pool: admin, registry, name: 'runner-unknown-a', version: 2, now }),
    ).rejects.toMatchObject({ code: 'projection-unknown-definition' });
  });

  it('returns caught-up with no next position and mutates nothing (I11)', async () => {
    const name = 'runner-caughtup';
    const registry = registryOf(name, 1, okHandler(name));
    // Advance to the current tip first, then a run with nothing new is caught-up.
    await seedEvents(1);
    // Process everything available.
    let result = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    while (result.outcome === 'succeeded') {
      result = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    }
    expect(result.outcome).toBe('caught-up');
    const cp = await checkpointRow(name, 1);
    expect(cp).not.toBeNull();
    // A caught-up run does not change the checkpoint.
    const again = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(again.outcome).toBe('caught-up');
    expect(await checkpointRow(name, 1)).toEqual(cp);
  });
});

// ---------------------------------------------------------------------------
// Atomic success + attempt numbering + gap traversal
// ---------------------------------------------------------------------------

describe('successful processing', () => {
  it('applies the handler, appends one succeeded attempt, and advances one position atomically (I4, I12, I14)', async () => {
    const name = 'runner-ok';
    const registry = registryOf(name, 1, okHandler(name));
    // Create a raw-identity GAP: a benign duplicate consumes a storage sequence but no position.
    const dupId = randomUUID();
    await storeValidatedEvent(admin, makeRecord({ eventId: dupId }));
    await storeValidatedEvent(admin, makeRecord({ eventId: dupId })); // duplicate: no new position
    await storeValidatedEvent(admin, makeRecord());

    const first = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(first.outcome).toBe('succeeded');
    if (first.outcome === 'succeeded') {
      expect(first.attemptNumber).toBe(1);
      expect(first.position).toBeGreaterThan(0n);
    }
    // Handler state, the succeeded attempt, and the advance are all present.
    const cp = await checkpointRow(name, 1);
    expect(cp?.last).toBeGreaterThan(0n);
    expect(cp?.status).toBe('active');
    expect(cp?.count).toBe(0);
    expect((await appliedRows(name)).length).toBe(1);

    // Positions are dense/contiguous — the runner never stalls on the raw-identity gap.
    let r = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    while (r.outcome === 'succeeded') {
      r = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    }
    expect(r.outcome).toBe('caught-up');
    const applied = await appliedRows(name);
    for (let i = 0; i < applied.length; i += 1) {
      expect(applied[i]).toBe(BigInt(i + 1));
    }
  });
});

// ---------------------------------------------------------------------------
// Deterministic failure -> retry -> fifth-failure block -> blocked-existing
// ---------------------------------------------------------------------------

describe('deterministic failure, retry, and blocking', () => {
  it('rolls the handler write back to the SAVEPOINT while committing the failed attempt and retry (I5)', async () => {
    const name = 'runner-fail';
    const registry = registryOf(name, 1, failHandler);
    await seedEvents(1);
    const cpBefore = await checkpointRow(name, 1);
    const pending = (cpBefore?.last ?? 0n) + 1n;

    const result = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(result.outcome).toBe('retry-scheduled');
    if (result.outcome === 'retry-scheduled') {
      expect(result.attemptNumber).toBe(1);
      expect(result.safeErrorCode).toBe('projection-handler-failed');
      expect(typeof result.nextAttemptAt).toBe('string');
    }
    // last_position unchanged (still 0); one failed attempt committed; no handler state row.
    const cp = await checkpointRow(name, 1);
    expect(cp?.last).toBe(0n);
    expect(cpBefore).toBeNull(); // the checkpoint is created lazily on the first run
    expect(cp?.count).toBe(1);
    expect(await attemptCount(name, 1, pending)).toBe(1);
    expect((await appliedRows(name)).length).toBe(0);
  });

  it('blocks on the fifth failure (blocked-now), then returns blocked-existing without a new attempt (I7, I8, I14)', async () => {
    const name = 'runner-poison';
    const registry = registryOf(name, 1, failHandler);
    await seedEvents(1);
    const pending = ((await checkpointRow(name, 1))?.last ?? 0n) + 1n;

    // Failures 1..4 schedule retries; drive time forward past each next_attempt_at.
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const r = await runProjectionOnce({
        pool: admin,
        registry,
        name,
        version: 1,
        now: laterNow(attempt * 600000),
      });
      expect(r.outcome).toBe('retry-scheduled');
      if (r.outcome === 'retry-scheduled') expect(r.attemptNumber).toBe(attempt);
    }
    // Fifth failure blocks NOW.
    const fifth = await runProjectionOnce({
      pool: admin,
      registry,
      name,
      version: 1,
      now: laterNow(5 * 600000),
    });
    expect(fifth.outcome).toBe('blocked-now');
    if (fifth.outcome === 'blocked-now') {
      expect(fifth.attemptNumber).toBe(5);
      expect(fifth.blockedPosition).toBe(pending);
    }
    const cp = await checkpointRow(name, 1);
    expect(cp?.status).toBe('blocked');
    expect(cp?.count).toBe(5);
    expect(cp?.blocked).toBe(pending);
    expect(await attemptCount(name, 1, pending)).toBe(5);

    // A later invocation finds an already-blocked checkpoint and writes nothing.
    const existing = await runProjectionOnce({
      pool: admin,
      registry,
      name,
      version: 1,
      now: laterNow(6 * 600000),
    });
    expect(existing.outcome).toBe('blocked-existing');
    if (existing.outcome === 'blocked-existing') {
      expect(existing.failedAttemptCount).toBe(5);
      expect(existing.blockedPosition).toBe(pending);
    }
    // Still exactly five attempts — blocked-existing added none.
    expect(await attemptCount(name, 1, pending)).toBe(5);
  });

  it('returns retry-pending across a fresh runner input when now is before next_attempt_at (I10)', async () => {
    const name = 'runner-pending';
    const registry = registryOf(name, 1, failHandler);
    await seedEvents(1);
    const scheduled = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(scheduled.outcome).toBe('retry-scheduled');

    // A second invocation at (nearly) the same instant is before next_attempt_at -> retry-pending.
    const pendingResult = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(pendingResult.outcome).toBe('retry-pending');
    if (pendingResult.outcome === 'retry-pending') {
      expect(pendingResult.failedAttemptCount).toBe(1);
    }
    // retry-pending appended no attempt (still exactly one).
    const pending = ((await checkpointRow(name, 1))?.last ?? 0n) + 1n;
    expect(await attemptCount(name, 1, pending)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Infrastructure abort — no attempt
// ---------------------------------------------------------------------------

describe('infrastructure failure', () => {
  it('aborts with no attempt when the handler raises an infrastructure SQLSTATE (I6)', async () => {
    const name = 'runner-infra';
    const registry = registryOf(name, 1, infraHandler);
    await seedEvents(1);
    const pending = ((await checkpointRow(name, 1))?.last ?? 0n) + 1n;

    await expect(
      runProjectionOnce({ pool: admin, registry, name, version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    // No attempt was recorded. The infra abort rolls back the ENTIRE transaction, including the lazy
    // checkpoint creation, so the checkpoint either does not exist or is unchanged (count 0, active).
    expect(await attemptCount(name, 1, pending)).toBe(0);
    const cp = await checkpointRow(name, 1);
    expect(cp === null || (cp.count === 0 && cp.status === 'active')).toBe(true);
    // Advisory lock released after the thrown failure.
    expect(await advisoryKeyHeldByOther(projectionAdvisoryLockKeyParameter(name as never, 1))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Advisory-lock contention, version/name separation, no leak
// ---------------------------------------------------------------------------

describe('advisory-lock concurrency (state-based)', () => {
  it('one runner processes while a same-name+version runner returns busy (I1, I13)', async () => {
    const name = 'runner-lock';
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);

    // A gated handler holds the lock until the test releases it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedRegistry = registryOf(name, 1, async (client, event: { position: bigint }) => {
      await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
        name,
        event.position.toString(),
      ]);
      await gate;
    });
    const busyRegistry = registryOf(name, 1, okHandler(name));

    const runnerA = runProjectionOnce({
      pool: admin,
      registry: gatedRegistry,
      name,
      version: 1,
      now,
    });
    try {
      // Prove A holds the advisory lock before probing B (state-based, bounded).
      await pollUntil(() => advisoryKeyHeldByOther(key));
      const b = await runProjectionOnce({
        pool: admin,
        registry: busyRegistry,
        name,
        version: 1,
        now,
      });
      expect(b.outcome).toBe('busy');
    } finally {
      release();
      // Always settle the gated runner in cleanup, even if an assertion above threw, so its client is
      // never left dangling/checked-out.
      await runnerA.catch(() => undefined);
    }
    const a = await runnerA;
    expect(a.outcome).toBe('succeeded');
    // Lock released after both runs; no leak.
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
  });

  it('the same name at different versions uses different lock keys and processes independently (I2)', async () => {
    const name = 'runner-versions';
    await seedEvents(1);
    const key1 = projectionAdvisoryLockKeyParameter(name as never, 1);
    const key2 = projectionAdvisoryLockKeyParameter(name as never, 2);
    // Different versions => different advisory keys => they can never contend for the same lock.
    expect(key1).not.toBe(key2);

    // Hold v1's key in a separate session, then prove a v2 run (different key) still proceeds.
    const holder = await admin.connect();
    try {
      await holder.query('BEGIN');
      const got = await holder.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1::bigint) AS locked',
        [key1],
      );
      expect(got.rows[0]?.locked).toBe(true); // v1's key is now held
      const v2 = registryOf(name, 2, okHandler(`${name}-v2`));
      const r = await runProjectionOnce({ pool: admin, registry: v2, name, version: 2, now });
      expect(r.outcome).toBe('succeeded'); // v2 uses key2, unaffected by the held key1
    } finally {
      // ROLLBACK in cleanup BEFORE release, so an assertion failure never returns an open
      // transaction to the pool.
      try {
        await holder.query('ROLLBACK');
      } catch {
        /* the connection may already be unusable; the release below still handles it */
      }
      holder.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Attempt/checkpoint corruption divergence
// ---------------------------------------------------------------------------

describe('attempt/checkpoint corruption', () => {
  it('rejects a checkpoint whose failed count does not match the stored attempts (I16)', async () => {
    const name = 'runner-corrupt';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);
    // Forge divergence: a checkpoint with failed_attempt_count = 2 but NO attempt rows for the pending
    // position (last_position + 1 = 1). Inserted directly (the checkpoint is otherwise lazy).
    await withClient(admin, (c) =>
      c.query(
        `INSERT INTO qf_jarvis.projection_checkpoint
           (projection_name, projection_version, last_position, status, failed_attempt_count,
            last_safe_error_code, created_at, updated_at)
         VALUES ($1, 1, 0, 'active', 2, 'projection-handler-failed', $2, $2)`,
        [name, new Date(now)],
      ),
    );
    await expect(
      runProjectionOnce({ pool: admin, registry, name, version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-attempt-checkpoint-divergent' });
    // Nothing mutated by the divergence abort.
    const after = await checkpointRow(name, 1);
    expect(after?.count).toBe(2);
    expect(after?.last).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Unknown COMMIT + destructive disposal + release failure
// ---------------------------------------------------------------------------

/** A marker carried by an INJECTED unexpected value; it must NEVER surface in a returned/thrown error. */
const UNEXPECTED_MARKER = 'UNEXPECTED-BOOM-4d2e';

interface WrapOptions {
  readonly commitAckLoss?: boolean;
  readonly commitFailBeforeSend?: boolean;
  readonly failRelease?: boolean;
  /** Throw an UNEXPECTED non-Error value (carrying UNEXPECTED_MARKER) when a query SQL includes this. */
  readonly throwUnexpectedOn?: string;
  /** Make the outer ROLLBACK fail, to exercise the rollback-fails => destroy branch. */
  readonly failRollback?: boolean;
}

/** A pool that wraps `admin`, optionally simulating COMMIT ack-loss and/or a throwing release. */
function wrapPool(options: WrapOptions): { pool: DatabasePool; releasedDestroy: boolean[] } {
  const releasedDestroy: boolean[] = [];
  const pool = {
    connect: async (): Promise<DatabaseClient> => {
      const real = await admin.connect();
      const wrapped: Partial<DatabaseClient> = {
        query: ((text: unknown, params?: unknown) => {
          const sql = typeof text === 'string' ? text : (text as { text: string }).text;
          if (sql === 'COMMIT' && options.commitAckLoss === true) {
            // The COMMIT lands on the server, then the client "loses" the acknowledgement.
            return (real.query as (t: unknown, p?: unknown) => Promise<unknown>)('COMMIT').then(
              () => {
                throw Object.assign(new Error('simulated acknowledgement loss'), { code: '08006' });
              },
            );
          }
          if (sql === 'COMMIT' && options.commitFailBeforeSend === true) {
            // The COMMIT is NEVER forwarded to the server — nothing commits, and the client cannot
            // know the outcome, so its transaction state is uncertain (must be destroyed).
            return Promise.reject(
              Object.assign(new Error('simulated pre-send commit failure'), { code: '08006' }),
            );
          }
          if (sql === 'ROLLBACK' && options.failRollback === true) {
            // The cleanup ROLLBACK itself fails: the transaction state becomes unknown => destroy.
            return Promise.reject(new Error('simulated rollback failure'));
          }
          if (
            options.throwUnexpectedOn !== undefined &&
            typeof sql === 'string' &&
            sql.includes(options.throwUnexpectedOn)
          ) {
            // Inject an UNEXPECTED, NON-Error value while the transaction is open. The runner must
            // contain it (roll back, fixed code) and never let the marker escape. A non-Error is
            // deliberate — the runner must not assume a caught value is an Error.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            return Promise.reject({ marker: UNEXPECTED_MARKER });
          }
          return (real.query as (t: unknown, p?: unknown) => Promise<unknown>)(text, params);
        }) as DatabaseClient['query'],
        release: (destroy?: boolean | Error) => {
          releasedDestroy.push(destroy === true);
          real.release(destroy === true ? true : undefined);
          if (options.failRelease === true) {
            throw new Error('simulated release failure');
          }
        },
      };
      return wrapped as DatabaseClient;
    },
  } as unknown as DatabasePool;
  return { pool, releasedDestroy };
}

describe('unknown COMMIT, idempotency, and client disposal', () => {
  it('throws commit-outcome-unknown, destroys the client, and re-invocation does not double-apply (I19, I23)', async () => {
    const name = 'runner-ackloss';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);
    const pending = ((await checkpointRow(name, 1))?.last ?? 0n) + 1n;

    const { pool, releasedDestroy } = wrapPool({ commitAckLoss: true });
    await expect(
      runProjectionOnce({ pool, registry, name, version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });
    // The client was DESTROYED (release(true)) after the ambiguous commit.
    expect(releasedDestroy).toEqual([true]);

    // The COMMIT actually landed: the checkpoint advanced and exactly one attempt exists.
    const cp = await checkpointRow(name, 1);
    expect(cp?.last).toBe(pending);
    expect(await attemptCount(name, 1, pending)).toBe(1);
    const appliedAfterFirst = (await appliedRows(name)).length;

    // Re-invocation (normal pool) does NOT re-apply the committed position — it processes the NEXT
    // one or is caught-up. No double application.
    const again = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(again.outcome === 'succeeded' || again.outcome === 'caught-up').toBe(true);
    expect(await attemptCount(name, 1, pending)).toBe(1); // still exactly one for the first position
    expect((await appliedRows(name)).length).toBeGreaterThanOrEqual(appliedAfterFirst);
  });

  it('a throwing release after a confirmed COMMIT does not mask the successful result (I22)', async () => {
    const name = 'runner-release-ok';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);
    const { pool, releasedDestroy } = wrapPool({ failRelease: true });
    const result = await runProjectionOnce({ pool, registry, name, version: 1, now });
    expect(result.outcome).toBe('succeeded'); // the swallowed release failure did not replace it
    expect(releasedDestroy).toEqual([false]); // a normal (non-destructive) release was attempted
  });

  it('a throwing release after a primary failure does not mask the primary error (I22)', async () => {
    const name = 'runner-release-fail';
    const registry = registryOf(name, 1, infraHandler);
    await seedEvents(1);
    const { pool } = wrapPool({ failRelease: true });
    await expect(
      runProjectionOnce({ pool, registry, name, version: 1, now }),
    ).rejects.toBeInstanceOf(ProjectionRunnerError);
  });

  it('a connect failure before a client exists becomes projection-runner-unavailable', async () => {
    const brokenPool = {
      connect: (): Promise<DatabaseClient> => Promise.reject(new Error('cannot connect')),
    } as unknown as DatabasePool;
    const registry = registryOf('runner-noconn', 1, okHandler('runner-noconn'));
    await expect(
      runProjectionOnce({ pool: brokenPool, registry, name: 'runner-noconn', version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-runner-unavailable' });
  });
});

// ---------------------------------------------------------------------------
// No lock/client leak across many runs
// ---------------------------------------------------------------------------

describe('no leakage', () => {
  it('processes many events without exhausting the pool or leaking advisory locks (I13)', async () => {
    const name = 'runner-many';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(6);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    let result = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    let runs = 0;
    while (result.outcome === 'succeeded' && runs < 200) {
      expect(await advisoryKeyHeldByOther(key)).toBe(false); // no lock survives a completed run
      result = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
      runs += 1;
    }
    expect(result.outcome).toBe('caught-up');
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    // The pool still works (no client leak).
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// I3 — distinct projection NAMES use distinct advisory keys and never block each other
// ---------------------------------------------------------------------------

describe('distinct names use distinct locks and do not block each other (I3)', () => {
  it('name A running (holding its lock) never blocks a different name B; pg_blocking_pids stays empty (I3)', async () => {
    const nameA = 'runner-i3-a';
    const nameB = 'runner-i3-b';
    await seedEvents(1);
    const keyA = projectionAdvisoryLockKeyParameter(nameA as never, 1);
    const keyB = projectionAdvisoryLockKeyParameter(nameB as never, 1);
    expect(keyA).not.toBe(keyB); // distinct names => distinct advisory keys

    // A holds its own lock inside its runner transaction until the test releases the gate.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gatedA = registryOf(nameA, 1, async (client, event: { position: bigint }) => {
      await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
        nameA,
        event.position.toString(),
      ]);
      await gate;
    });
    const runA = runProjectionOnce({ pool: admin, registry: gatedA, name: nameA, version: 1, now });
    try {
      await pollUntil(() => advisoryKeyHeldByOther(keyA)); // A provably holds keyA
      // B uses a DIFFERENT key and runs to completion while A still holds keyA.
      const b = await runProjectionOnce({
        pool: admin,
        registry: registryOf(nameB, 1, okHandler(nameB)),
        name: nameB,
        version: 1,
        now,
      });
      expect(b.outcome).toBe('succeeded');
      expect(await advisoryKeyHeldByOther(keyA)).toBe(true); // A is STILL holding while B finished
      expect(await advisoryKeyHeldByOther(keyB)).toBe(false); // B released keyB at its own commit
      expect(await blockedBackends()).toBe(0); // nothing in our app ever waited on a lock
    } finally {
      release();
      // Always settle the gated runner in cleanup, even on an assertion failure above.
      await runA.catch(() => undefined);
    }
    const a = await runA;
    expect(a.outcome).toBe('succeeded');
    expect(await advisoryKeyHeldByOther(keyA)).toBe(false); // released after A committed
  });
});

// ---------------------------------------------------------------------------
// I9 — a blocked projection does not stall an independent one
// ---------------------------------------------------------------------------

describe('a blocked projection does not stall an independent projection (I9)', () => {
  it('projection A is blocked at its poison position while projection B processes to caught-up (I9)', async () => {
    const nameA = 'runner-i9-a';
    const nameB = 'runner-i9-b';
    await seedEvents(1);

    // Block A: five deterministic failures (advance time past each backoff window).
    const regA = registryOf(nameA, 1, failHandler);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await runProjectionOnce({
        pool: admin,
        registry: regA,
        name: nameA,
        version: 1,
        now: laterNow(attempt * 600000),
      });
    }
    expect((await checkpointRow(nameA, 1))?.status).toBe('blocked');

    // B — an entirely independent projection — processes to caught-up regardless of A's block.
    const regB = registryOf(nameB, 1, okHandler(nameB));
    let r = await runProjectionOnce({ pool: admin, registry: regB, name: nameB, version: 1, now });
    let guard = 0;
    while (r.outcome === 'succeeded' && guard < 500) {
      r = await runProjectionOnce({ pool: admin, registry: regB, name: nameB, version: 1, now });
      guard += 1;
    }
    expect(r.outcome).toBe('caught-up');
    expect((await appliedRows(nameB)).length).toBeGreaterThan(0);

    // A is still blocked and writes nothing; B's checkpoint is active and advanced. Full isolation.
    const again = await runProjectionOnce({
      pool: admin,
      registry: regA,
      name: nameA,
      version: 1,
      now: laterNow(9 * 600000),
    });
    expect(again.outcome).toBe('blocked-existing');
    const cpB = await checkpointRow(nameB, 1);
    expect(cpB?.status).toBe('active');
    expect(cpB?.last).toBeGreaterThan(0n);
  });
});

// ---------------------------------------------------------------------------
// I17 / I18 — reconciliation divergence variants (numbering gap, DB-enforced uniqueness, succeeded row)
// ---------------------------------------------------------------------------

describe('reconciliation divergence variants (I17, I18)', () => {
  it('a numbering GAP in the stored attempts is divergence with no mutation (I17)', async () => {
    const name = 'runner-i17-gap';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);
    const pending = 1n;
    await forgeActiveCheckpoint(name, 2, 0n); // claims two failed attempts...
    await insertRawAttempt(name, pending, 1, 'failed', 'projection-handler-failed');
    await insertRawAttempt(name, pending, 3, 'failed', 'projection-handler-failed'); // ...numbered 1 and 3

    await expect(
      runProjectionOnce({ pool: admin, registry, name, version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-attempt-checkpoint-divergent' });

    // No mutation: the checkpoint and the two forged attempts are unchanged, nothing applied.
    const cp = await checkpointRow(name, 1);
    expect(cp?.count).toBe(2);
    expect(cp?.last).toBe(0n);
    expect(cp?.status).toBe('active');
    expect(await attemptCount(name, 1, pending)).toBe(2);
    expect((await appliedRows(name)).length).toBe(0);
    expect(await advisoryKeyHeldByOther(projectionAdvisoryLockKeyParameter(name as never, 1))).toBe(
      false,
    );
  });

  it('the database uniqueness constraint refuses a duplicate attempt number (I17)', async () => {
    // Duplicate attempt numbers cannot be forged legitimately: the unique constraint
    // (projection_name, projection_version, event_position, attempt_number) refuses the second row.
    const name = 'runner-i17-unique';
    await insertRawAttempt(name, 1n, 1, 'failed', 'projection-handler-failed');
    await expect(
      insertRawAttempt(name, 1n, 1, 'failed', 'projection-handler-failed'),
    ).rejects.toMatchObject({ code: '23505' }); // unique_violation
    expect(await attemptCount(name, 1, 1n)).toBe(1); // exactly one row survived
  });

  it('a SUCCEEDED attempt at the active pending position is divergence with no mutation (I18)', async () => {
    const name = 'runner-i18-succeeded';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);
    const pending = 1n;
    await forgeActiveCheckpoint(name, 1, 0n); // claims one FAILED attempt...
    await insertRawAttempt(name, pending, 1, 'succeeded', null); // ...but the stored row SUCCEEDED

    await expect(
      runProjectionOnce({ pool: admin, registry, name, version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-attempt-checkpoint-divergent' });

    const cp = await checkpointRow(name, 1);
    expect(cp?.count).toBe(1);
    expect(cp?.last).toBe(0n);
    expect(await attemptCount(name, 1, pending)).toBe(1); // only the one forged row
    expect((await appliedRows(name)).length).toBe(0); // nothing applied
  });
});

// ---------------------------------------------------------------------------
// I20 — a failure BEFORE COMMIT is sent: nothing commits, the client is destroyed, same position once
// ---------------------------------------------------------------------------

describe('pre-COMMIT failure (nothing durable, destroyed, reprocessed once) (I20)', () => {
  it('injects a failure before COMMIT is sent; nothing commits, the client is destroyed, a fresh run processes the same position once (I20)', async () => {
    const name = 'runner-i20';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);

    const { pool, releasedDestroy } = wrapPool({ commitFailBeforeSend: true });
    await expect(
      runProjectionOnce({ pool, registry, name, version: 1, now }),
    ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });
    expect(releasedDestroy).toEqual([true]); // uncertain state => destroyed, released exactly once

    // NOTHING committed: the COMMIT never reached the server, so the whole transaction rolled back.
    const cp = await checkpointRow(name, 1);
    expect(cp === null || cp.last === 0n).toBe(true);
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    expect((await appliedRows(name)).length).toBe(0);

    // A fresh invocation on the normal pool processes the SAME position, exactly once.
    const again = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
    expect(again.outcome).toBe('succeeded');
    if (again.outcome === 'succeeded') expect(again.position).toBe(1n);
    expect(await attemptCount(name, 1, 1n)).toBe(1);
    expect((await appliedRows(name)).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// I21 — a confirmed outer ROLLBACK: no state, connection reusable, same position reprocessed once
// ---------------------------------------------------------------------------

describe('confirmed outer ROLLBACK (reusable connection, reprocessed once) (I21)', () => {
  it('an infrastructure abort is a confirmed rollback: no state, a NON-destructive release, same position reprocessed once (I21)', async () => {
    const name = 'runner-i21';
    await seedEvents(1);

    // infraHandler => classifyHandlerError=infrastructure => abortAndThrow => outer ROLLBACK confirmed.
    const { pool, releasedDestroy } = wrapPool({});
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, 1, infraHandler),
        name,
        version: 1,
        now,
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    // A confirmed rollback returns the connection to the pool: normal (non-destructive) release ONLY.
    expect(releasedDestroy).toEqual([false]);

    // No handler/bookkeeping state survived the rollback.
    const cp = await checkpointRow(name, 1);
    expect(cp === null || (cp.last === 0n && cp.count === 0)).toBe(true);
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    expect((await appliedRows(name)).length).toBe(0);

    // The reused connection is healthy: a fresh ok run processes the SAME position exactly once.
    const again = await runProjectionOnce({
      pool: admin,
      registry: registryOf(name, 1, okHandler(name)),
      name,
      version: 1,
      now,
    });
    expect(again.outcome).toBe('succeeded');
    if (again.outcome === 'succeeded') expect(again.position).toBe(1n);
    expect(await attemptCount(name, 1, 1n)).toBe(1);
    expect((await appliedRows(name)).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// I15 — mixed result/error paths never exhaust the pool or return aborted transactions to it
// ---------------------------------------------------------------------------

describe('mixed-path pool integrity (I15)', () => {
  it('repeated success/caught-up/busy/retry/blocked/thrown-error paths leave the pool healthy and unaborted (I15)', async () => {
    // Success + caught-up.
    const okName = 'runner-i15-ok';
    const okReg = registryOf(okName, 1, okHandler(okName));
    await seedEvents(3);
    let r = await runProjectionOnce({
      pool: admin,
      registry: okReg,
      name: okName,
      version: 1,
      now,
    });
    let guard = 0;
    while (r.outcome === 'succeeded' && guard < 500) {
      r = await runProjectionOnce({ pool: admin, registry: okReg, name: okName, version: 1, now });
      guard += 1;
    }
    expect(r.outcome).toBe('caught-up');

    // Busy — a foreign session holds the key.
    const busyName = 'runner-i15-busy';
    const busyKey = projectionAdvisoryLockKeyParameter(busyName as never, 1);
    const releaseHold = await holdAdvisoryKey(busyKey);
    try {
      const busy = await runProjectionOnce({
        pool: admin,
        registry: registryOf(busyName, 1, okHandler(busyName)),
        name: busyName,
        version: 1,
        now,
      });
      expect(busy.outcome).toBe('busy');
    } finally {
      await releaseHold();
    }

    // Retry (deterministic failure).
    const retryName = 'runner-i15-retry';
    expect(
      (
        await runProjectionOnce({
          pool: admin,
          registry: registryOf(retryName, 1, failHandler),
          name: retryName,
          version: 1,
          now,
        })
      ).outcome,
    ).toBe('retry-scheduled');

    // Blocked (fifth failure).
    const blockName = 'runner-i15-block';
    const blockReg = registryOf(blockName, 1, failHandler);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await runProjectionOnce({
        pool: admin,
        registry: blockReg,
        name: blockName,
        version: 1,
        now: laterNow(attempt * 600000),
      });
    }
    expect((await checkpointRow(blockName, 1))?.status).toBe('blocked');

    // Thrown errors: infrastructure, unknown definition, and an ambiguous COMMIT (destroys a client).
    await expect(
      runProjectionOnce({
        pool: admin,
        registry: registryOf('runner-i15-infra', 1, infraHandler),
        name: 'runner-i15-infra',
        version: 1,
        now,
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    await expect(
      runProjectionOnce({
        pool: admin,
        registry: registryOf('runner-i15-known', 1, okHandler('runner-i15-known')),
        name: 'not-registered',
        version: 1,
        now,
      }),
    ).rejects.toMatchObject({ code: 'projection-unknown-definition' });
    const ackName = 'runner-i15-ack';
    const { pool: ackPool } = wrapPool({ commitAckLoss: true });
    await seedEvents(1);
    await expect(
      runProjectionOnce({
        pool: ackPool,
        registry: registryOf(ackName, 1, okHandler(ackName)),
        name: ackName,
        version: 1,
        now,
      }),
    ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });

    // After every path: no checked-out/leaked client and no open/aborted transaction on the pool.
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    expect(checkedOut(admin)).toBe(0);
    expect(await idleInTxBackends()).toBe(0);

    // The pool is not exhausted: every one of its `max` (5) slots yields a working client.
    const clients = await Promise.all([0, 1, 2, 3, 4].map(() => admin.connect()));
    try {
      for (const c of clients) {
        const one = await c.query<{ ok: number }>('SELECT 1 AS ok');
        expect(one.rows[0]?.ok).toBe(1); // never "current transaction is aborted"
      }
    } finally {
      for (const c of clients) c.release();
    }
  });
});

// ---------------------------------------------------------------------------
// I24 — aggregate lifecycle over EVERY result/error category; no retained lock, no leaked client
// ---------------------------------------------------------------------------

describe('aggregate lifecycle over every result/error category (I24)', () => {
  it('busy, caught-up, succeeded, retry-scheduled, blocked-now, blocked-existing, retry-pending, deterministic failure, infrastructure failure, divergent, pre-COMMIT, ambiguous COMMIT, confirmed rollback and connect failure each leave no retained lock and no leaked client (I24)', async () => {
    const keyOf = (name: string): string => projectionAdvisoryLockKeyParameter(name as never, 1);
    /** After each category: no retained advisory lock and no checked-out/leaked/aborted client. */
    const assertClean = async (keyParameter: string | null): Promise<void> => {
      if (keyParameter !== null) {
        expect(await advisoryKeyHeldByOther(keyParameter)).toBe(false);
      }
      await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    };

    // busy
    {
      const name = 'runner-i24-busy';
      await seedEvents(1);
      const releaseHold = await holdAdvisoryKey(keyOf(name));
      try {
        const busy = await runProjectionOnce({
          pool: admin,
          registry: registryOf(name, 1, okHandler(name)),
          name,
          version: 1,
          now,
        });
        expect(busy.outcome).toBe('busy');
      } finally {
        await releaseHold();
      }
      await assertClean(keyOf(name));
    }

    // caught-up
    {
      const name = 'runner-i24-caughtup';
      const registry = registryOf(name, 1, okHandler(name));
      await seedEvents(1);
      let r = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
      let guard = 0;
      while (r.outcome === 'succeeded' && guard < 500) {
        r = await runProjectionOnce({ pool: admin, registry, name, version: 1, now });
        guard += 1;
      }
      expect(r.outcome).toBe('caught-up');
      await assertClean(keyOf(name));
    }

    // succeeded
    {
      const name = 'runner-i24-succeeded';
      await seedEvents(1);
      const r = await runProjectionOnce({
        pool: admin,
        registry: registryOf(name, 1, okHandler(name)),
        name,
        version: 1,
        now,
      });
      expect(r.outcome).toBe('succeeded');
      await assertClean(keyOf(name));
    }

    // retry-scheduled
    {
      const name = 'runner-i24-retry';
      await seedEvents(1);
      const r = await runProjectionOnce({
        pool: admin,
        registry: registryOf(name, 1, failHandler),
        name,
        version: 1,
        now,
      });
      expect(r.outcome).toBe('retry-scheduled');
      await assertClean(keyOf(name));
    }

    // deterministic handler failure (a failed attempt durably recorded with the closed code)
    {
      const name = 'runner-i24-detfail';
      await seedEvents(1);
      const r = await runProjectionOnce({
        pool: admin,
        registry: registryOf(name, 1, failHandler),
        name,
        version: 1,
        now,
      });
      expect(r.outcome).toBe('retry-scheduled');
      if (r.outcome === 'retry-scheduled')
        expect(r.safeErrorCode).toBe('projection-handler-failed');
      expect(await attemptCount(name, 1, 1n)).toBe(1);
      await assertClean(keyOf(name));
    }

    // retry-pending
    {
      const name = 'runner-i24-pending';
      const registry = registryOf(name, 1, failHandler);
      await seedEvents(1);
      expect(
        (await runProjectionOnce({ pool: admin, registry, name, version: 1, now })).outcome,
      ).toBe('retry-scheduled');
      expect(
        (await runProjectionOnce({ pool: admin, registry, name, version: 1, now })).outcome,
      ).toBe('retry-pending');
      await assertClean(keyOf(name));
    }

    // blocked-now, then blocked-existing
    {
      const name = 'runner-i24-blocked';
      const registry = registryOf(name, 1, failHandler);
      await seedEvents(1);
      let fifth = await runProjectionOnce({
        pool: admin,
        registry,
        name,
        version: 1,
        now: laterNow(600000),
      });
      for (let attempt = 2; attempt <= 5; attempt += 1) {
        fifth = await runProjectionOnce({
          pool: admin,
          registry,
          name,
          version: 1,
          now: laterNow(attempt * 600000),
        });
      }
      expect(fifth.outcome).toBe('blocked-now');
      await assertClean(keyOf(name));
      const existing = await runProjectionOnce({
        pool: admin,
        registry,
        name,
        version: 1,
        now: laterNow(9 * 600000),
      });
      expect(existing.outcome).toBe('blocked-existing');
      await assertClean(keyOf(name));
    }

    // infrastructure failure
    {
      const name = 'runner-i24-infra';
      await seedEvents(1);
      await expect(
        runProjectionOnce({
          pool: admin,
          registry: registryOf(name, 1, infraHandler),
          name,
          version: 1,
          now,
        }),
      ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
      expect(await attemptCount(name, 1, 1n)).toBe(0);
      await assertClean(keyOf(name));
    }

    // divergent state
    {
      const name = 'runner-i24-divergent';
      await seedEvents(1);
      await forgeActiveCheckpoint(name, 2, 0n); // count 2, no attempt rows => divergent
      await expect(
        runProjectionOnce({
          pool: admin,
          registry: registryOf(name, 1, okHandler(name)),
          name,
          version: 1,
          now,
        }),
      ).rejects.toMatchObject({ code: 'projection-attempt-checkpoint-divergent' });
      await assertClean(keyOf(name));
    }

    // pre-COMMIT failure (nothing commits, client destroyed)
    {
      const name = 'runner-i24-precommit';
      await seedEvents(1);
      const { pool, releasedDestroy } = wrapPool({ commitFailBeforeSend: true });
      await expect(
        runProjectionOnce({
          pool,
          registry: registryOf(name, 1, okHandler(name)),
          name,
          version: 1,
          now,
        }),
      ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });
      expect(releasedDestroy).toEqual([true]); // destroyed, released exactly once
      expect(await attemptCount(name, 1, 1n)).toBe(0); // nothing committed
      await assertClean(keyOf(name));
    }

    // ambiguous COMMIT (server committed, ack lost, client destroyed)
    {
      const name = 'runner-i24-ackloss';
      await seedEvents(1);
      const { pool, releasedDestroy } = wrapPool({ commitAckLoss: true });
      await expect(
        runProjectionOnce({
          pool,
          registry: registryOf(name, 1, okHandler(name)),
          name,
          version: 1,
          now,
        }),
      ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });
      expect(releasedDestroy).toEqual([true]); // destroyed, released exactly once
      expect(await attemptCount(name, 1, 1n)).toBe(1); // the COMMIT landed on the server
      await assertClean(keyOf(name));
    }

    // confirmed rollback (non-destructive release, reusable)
    {
      const name = 'runner-i24-rollback';
      await seedEvents(1);
      const { pool, releasedDestroy } = wrapPool({});
      await expect(
        runProjectionOnce({
          pool,
          registry: registryOf(name, 1, infraHandler),
          name,
          version: 1,
          now,
        }),
      ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
      expect(releasedDestroy).toEqual([false]); // normal release ONLY after a confirmed rollback
      await assertClean(keyOf(name));
    }

    // connect failure (no client, no key ever taken)
    {
      const name = 'runner-i24-noconnect';
      const brokenPool = {
        connect: (): Promise<DatabaseClient> => Promise.reject(new Error('cannot connect')),
      } as unknown as DatabasePool;
      await expect(
        runProjectionOnce({
          pool: brokenPool,
          registry: registryOf(name, 1, okHandler(name)),
          name,
          version: 1,
          now,
        }),
      ).rejects.toMatchObject({ code: 'projection-runner-unavailable' });
      await assertClean(keyOf(name));
    }

    // Final: the real pool is fully healthy across every category above.
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Hostile handler values + the transaction-state safety net (extends I6 and I24)
// ---------------------------------------------------------------------------

describe('hostile handler values and the transaction-state safety net (I6, I24)', () => {
  it('a handler throwing an object with an own code GETTER: getter never invoked, no attempt, infrastructure, confirmed rollback, no leak (I6)', async () => {
    const name = 'runner-code-getter';
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    let getterInvoked = false;
    const getterHandler = async (): Promise<void> => {
      await Promise.resolve();
      const hostile = {};
      Object.defineProperty(hostile, 'code', {
        get() {
          getterInvoked = true;
          return '23505'; // a DETERMINISTIC code — proving it WOULD change the outcome if invoked
        },
        enumerable: true,
        configurable: true,
      });
      // A non-Error hostile value is deliberate — this is what the classifier must survive.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw hostile;
    };
    const { pool, releasedDestroy } = wrapPool({});
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, 1, getterHandler),
        name,
        version: 1,
        now,
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    expect(getterInvoked).toBe(false); // the getter was NEVER called
    expect(releasedDestroy).toEqual([false]); // confirmed rollback => normal (reusable) release
    expect(await attemptCount(name, 1, 1n)).toBe(0); // NO attempt recorded
    const cp = await checkpointRow(name, 1);
    expect(cp === null || (cp.last === 0n && cp.count === 0)).toBe(true); // checkpoint/state unchanged
    expect((await appliedRows(name)).length).toBe(0);
    expect(await advisoryKeyHeldByOther(key)).toBe(false); // advisory lock released by the rollback
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
  });

  it('a handler throwing a REVOKED Proxy: no raw TypeError/Proxy value escapes, no attempt, fixed infrastructure error, full rollback, no leak (I6)', async () => {
    const name = 'runner-revoked-proxy';
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    const revokedHandler = async (): Promise<void> => {
      await Promise.resolve();
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      // A revoked Proxy is deliberately not an Error — touching it throws a TypeError the runner must
      // never let escape.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw proxy;
    };
    const { pool, releasedDestroy } = wrapPool({});
    let caught: unknown;
    try {
      await runProjectionOnce({
        pool,
        registry: registryOf(name, 1, revokedHandler),
        name,
        version: 1,
        now,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    expect(caught).not.toBeInstanceOf(TypeError); // never a raw TypeError from the revoked proxy
    expect((caught as ProjectionRunnerError).code).toBe('projection-infrastructure-failed');
    expect(releasedDestroy).toEqual([false]); // confirmed rollback => reusable
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
  });

  it('REPOSITORY-PHASE containment: a failure on the checkpoint query (caught by the LOCAL executeRun catch) rolls back; the client is REUSABLE and the injected marker never leaks (I24)', async () => {
    // NOTE: injecting on `projection_checkpoint` hits the LOCAL try/catch around
    // createCheckpointIfAbsent/readCheckpointForUpdate (which calls abortAndThrow) — it does NOT reach
    // the final outer safety boundary. This proves repository-phase containment; the genuine outer
    // boundary is proven separately below via the pre-COMMIT result-construction injection.
    const name = 'runner-unexpected-ok';
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    // Inject a non-Error value on the checkpoint query (advisory lock already held, transaction open).
    const { pool, releasedDestroy } = wrapPool({ throwUnexpectedOn: 'projection_checkpoint' });
    let caught: unknown;
    try {
      await runProjectionOnce({
        pool,
        registry: registryOf(name, 1, okHandler(name)),
        name,
        version: 1,
        now,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    expect((caught as ProjectionRunnerError).code).toBe('projection-infrastructure-failed');
    // The injected marker is never preserved anywhere in the repository error.
    const rendered = `${(caught as Error).message} ${(caught as ProjectionRunnerError).code} ${(caught as Error).stack ?? ''}`;
    expect(rendered).not.toContain(UNEXPECTED_MARKER);
    expect(JSON.stringify(caught ?? {})).not.toContain(UNEXPECTED_MARKER);
    // Rollback confirmed => NORMAL release => the connection is reusable; nothing durable happened.
    expect(releasedDestroy).toEqual([false]);
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });

  it('REPOSITORY-PHASE containment: a checkpoint-query failure (LOCAL catch) with a FAILING rollback destroys the client; the primary infrastructure code is not replaced by cleanup text (I24)', async () => {
    // As above, this injection hits the LOCAL executeRun catch, not the final outer boundary; it proves
    // repository-phase containment when the fallback ROLLBACK itself fails.
    const name = 'runner-unexpected-rollbackfail';
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    const { pool, releasedDestroy } = wrapPool({
      throwUnexpectedOn: 'projection_checkpoint',
      failRollback: true,
    });
    let caught: unknown;
    try {
      await runProjectionOnce({
        pool,
        registry: registryOf(name, 1, okHandler(name)),
        name,
        version: 1,
        now,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    // The PRIMARY repository code stands; a failed cleanup ROLLBACK does not rewrite it.
    expect((caught as ProjectionRunnerError).code).toBe('projection-infrastructure-failed');
    const rendered = `${(caught as Error).message} ${(caught as ProjectionRunnerError).code} ${(caught as Error).stack ?? ''}`;
    expect(rendered).not.toContain(UNEXPECTED_MARKER);
    expect(rendered).not.toContain('simulated rollback failure');
    // Rollback FAILED => uncertain state => DESTROY via release(true). No lock or client leak.
    expect(releasedDestroy).toEqual([true]);
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The GENUINE final safety boundary (Correction-3 C3)
//
// The checkpoint-query injections above are caught by the LOCAL try/catch around
// createCheckpointIfAbsent/readCheckpointForUpdate. To reach the FINAL outer boundary in
// runProjectionOnce, we must throw at an operation that is OUTSIDE every local executeRun catch while
// the transaction is open. `succeededResult(...)` is exactly that seam: it is built (and `Object.freeze`d)
// in the success path BEFORE the bookkeeping try and BEFORE COMMIT. We temporarily replace Object.freeze
// so that freezing the targeted `succeeded` result throws a private marker; every other freeze delegates
// normally, and Object.freeze is ALWAYS restored. Integration tests are serialized (fileParallelism
// false), so no parallel observer sees the replacement.
//
// Exact call path proven: runProjectionOnce -> executeRun -> (handler succeeds) ->
//   `const result = succeededResult(identity, pending, attemptNumber)` [Object.freeze THROWS here,
//   outside the bookkeeping try/catch and before outerCommit] -> the throw escapes executeRun ->
//   runProjectionOnce's final `catch` (the boundary): isProjectionRunnerErrorSafely(err) === false ->
//   tx is 'open' -> ROLLBACK -> throw fresh projection-infrastructure-failed.
// ---------------------------------------------------------------------------

/**
 * Run `body` with Object.freeze temporarily patched so that freezing the `succeeded` result for
 * `targetName` throws `new Error(marker)`. Every other object is frozen normally, and a foreign
 * object's hostile getter can never break freeze (the discriminator read is guarded). Object.freeze is
 * ALWAYS restored in `finally`.
 */
async function withSucceededFreezeThrowing<T>(
  targetName: string,
  marker: string,
  body: () => Promise<T>,
): Promise<T> {
  const realFreeze = Object.freeze;
  const patched = (obj: unknown): unknown => {
    let isTarget: boolean;
    try {
      isTarget =
        typeof obj === 'object' &&
        obj !== null &&
        (obj as { outcome?: unknown }).outcome === 'succeeded' &&
        (obj as { projectionName?: unknown }).projectionName === targetName;
    } catch {
      isTarget = false; // never let a foreign object's hostile getter break Object.freeze
    }
    if (isTarget) {
      throw new Error(marker);
    }
    return (realFreeze as (o: unknown) => unknown)(obj);
  };
  Object.freeze = patched as unknown as typeof Object.freeze;
  try {
    return await body();
  } finally {
    Object.freeze = realFreeze; // ALWAYS restore, even if an assertion in `body` throws
  }
}

describe('the GENUINE final safety boundary — pre-COMMIT result construction (I24)', () => {
  it('FINAL BOUNDARY: an unexpected pre-COMMIT result-construction failure (outside every local catch) rolls back; client REUSABLE, marker never leaks (I24)', async () => {
    const name = 'runner-boundary-ok';
    const registry = registryOf(name, 1, okHandler(name)); // built BEFORE Object.freeze is patched
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    const MARKER = 'BOUNDARY-FREEZE-A-6b2c';
    const { pool, releasedDestroy } = wrapPool({});
    let caught: unknown;
    await withSucceededFreezeThrowing(name, MARKER, async () => {
      try {
        await runProjectionOnce({ pool, registry, name, version: 1, now });
      } catch (error) {
        caught = error;
      }
    });
    // A FRESH repository-owned infrastructure error — never the injected marker.
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    expect((caught as ProjectionRunnerError).code).toBe('projection-infrastructure-failed');
    const cause = JSON.stringify((caught as { cause?: unknown }).cause ?? null);
    const rendered = `${(caught as Error).message} ${(caught as ProjectionRunnerError).code} ${(caught as Error).stack ?? ''} ${cause}`;
    expect(rendered).not.toContain(MARKER);
    expect(JSON.stringify(caught ?? {})).not.toContain(MARKER);
    // Nothing durable survived: no attempt, no advance, no handler-state write.
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    const cp = await checkpointRow(name, 1);
    expect(cp === null || (cp.last === 0n && cp.count === 0)).toBe(true);
    expect((await appliedRows(name)).length).toBe(0);
    // Transaction became CLOSED => NORMAL (non-destructive) release => the connection is reusable.
    expect(releasedDestroy).toEqual([false]);
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });

  it('FINAL BOUNDARY: the same pre-COMMIT failure with a FAILING fallback rollback destroys the client; marker and rollback text never leak (I24)', async () => {
    const name = 'runner-boundary-destroy';
    const registry = registryOf(name, 1, okHandler(name));
    await seedEvents(1);
    const key = projectionAdvisoryLockKeyParameter(name as never, 1);
    const MARKER = 'BOUNDARY-FREEZE-B-9d17';
    const { pool, releasedDestroy } = wrapPool({ failRollback: true });
    let caught: unknown;
    await withSucceededFreezeThrowing(name, MARKER, async () => {
      try {
        await runProjectionOnce({ pool, registry, name, version: 1, now });
      } catch (error) {
        caught = error;
      }
    });
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    expect((caught as ProjectionRunnerError).code).toBe('projection-infrastructure-failed');
    const rendered = `${(caught as Error).message} ${(caught as ProjectionRunnerError).code} ${(caught as Error).stack ?? ''}`;
    expect(rendered).not.toContain(MARKER);
    expect(rendered).not.toContain('simulated rollback failure');
    expect(await attemptCount(name, 1, 1n)).toBe(0);
    // Transaction became UNKNOWN => DESTROY via release(true), exactly once.
    expect(releasedDestroy).toEqual([true]);
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });
});
