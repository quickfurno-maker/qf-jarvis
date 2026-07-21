/**
 * Stage 3.4.5A — the projection worker/scheduler against real PostgreSQL 17 (ADR-0038).
 *
 * Drives the REAL runProjectionOnce (default runOnce) across a registry with SYNTHETIC handlers — no
 * real read-model handler and no rebuild (those are later slices). State-based proofs (pool counters /
 * pg_stat_activity / advisory-key probes / injected clock + sleep, never wall-clock sleeps) of:
 * deterministic multi-projection draining, one position per projection per cycle, poison isolation, the
 * retry clock gate (no premature retry, no busy-spin), graceful abort/drain, and no client/lock leak.
 *
 * Loopback-guarded harness; the worker borrows the admin pool and never closes it.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { deterministicHandlerFailure } from '../projections/projection-failure-taxonomy.js';
import { projectionAdvisoryLockKeyParameter } from '../projections/projection-lock-key.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';
import {
  ProjectionWorkerError,
  runProjectionWorker,
  type WorkerSleep,
} from '../projections/projection-worker.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-worker-admin' });
const APPLIED = 'public._worker_applied';

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

async function seedEvents(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await storeValidatedEvent(admin, makeRecord());
  }
}

const now: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
function laterNow(ms: number): CanonicalInstant {
  return toCanonicalInstant(new Date(Date.parse(now) + ms));
}

function okHandler(projectionName: string) {
  return async (client: DatabaseClient, event: { readonly position: bigint }): Promise<void> => {
    await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
      projectionName,
      event.position.toString(),
    ]);
  };
}
const failHandler = async (): Promise<void> => {
  await Promise.resolve();
  throw deterministicHandlerFailure('deterministic reducer refusal');
};
const infraHandler = async (): Promise<void> => {
  await Promise.resolve();
  throw Object.assign(new Error('simulated infrastructure'), { code: '40P01' });
};

function registryOf(
  definitions: readonly {
    readonly name: string;
    readonly version: number;
    readonly apply: (c: DatabaseClient, e: never) => Promise<void>;
  }[],
) {
  return createProjectionRegistry(definitions);
}

async function checkpointRow(
  name: string,
  version: number,
): Promise<{ last: bigint; status: string; count: number } | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      last_position: string;
      status: string;
      failed_attempt_count: number;
    }>(
      `SELECT last_position, status, failed_attempt_count
         FROM qf_jarvis.projection_checkpoint WHERE projection_name = $1 AND projection_version = $2`,
      [name, version],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return { last: BigInt(row.last_position), status: row.status, count: row.failed_attempt_count };
  });
}

async function appliedRows(projectionName: string): Promise<bigint[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ position: string }>(
      `SELECT position FROM ${APPLIED} WHERE projection = $1 ORDER BY position`,
      [projectionName],
    );
    return r.rows.map((row) => BigInt(row.position));
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

function checkedOut(pool: DatabasePool): number {
  return pool.totalCount - pool.idleCount;
}

async function idleInTxBackends(appName = 'qf-worker-admin'): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE application_name = $1 AND state LIKE 'idle in transaction%'`,
      [appName],
    );
    return r.rows[0]?.n ?? -1;
  });
}

async function pollUntil(predicate: () => Promise<boolean>, deadlineMs = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > deadlineMs) throw new Error('poll deadline exceeded');
    await new Promise((r) => setTimeout(r, 30));
  }
}

/** An immediate, recording sleep — no wall-clock waiting; the loop yields but the test stays fast. */
function recordingSleep(): { sleep: WorkerSleep; calls: number[] } {
  const calls: number[] = [];
  const sleep: WorkerSleep = (ms) => {
    calls.push(ms);
    return Promise.resolve();
  };
  return { sleep, calls };
}

const fixedNow = (): CanonicalInstant => now;

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

describe('worker drains multiple projections deterministically (IW1, IW2)', () => {
  it('drives two healthy projections forward, advancing each independently every pass (IW1, IW2)', async () => {
    const a = 'worker-a';
    const b = 'worker-b';
    await seedEvents(3);
    const registry = registryOf([
      { name: a, version: 1, apply: okHandler(a) },
      { name: b, version: 1, apply: okHandler(b) },
    ]);
    const { sleep } = recordingSleep();

    // Both healthy projections are driven forward together, sequentially and uncontended. This proves
    // deterministic multi-projection draining: each advances IDENTICALLY (one position per cycle while
    // events remain), independent of the current log size. Idle-sleep / no-busy-spin is proven once
    // caught-up in IW5. (`succeeded` = advanced(a) + advanced(b).)
    const summary = await runProjectionWorker({
      pool: admin,
      registry,
      now: fixedNow,
      sleep,
      maxCycles: 5,
    });

    expect(summary.stoppedBy).toBe('max-cycles');
    const lastA = (await checkpointRow(a, 1))?.last ?? -1n;
    const lastB = (await checkpointRow(b, 1))?.last ?? -1n;
    expect(lastA).toBe(lastB); // deterministic parallel progress
    expect(lastA).toBeGreaterThanOrEqual(1n);
    expect((await checkpointRow(a, 1))?.status).toBe('active');
    expect((await appliedRows(a)).length).toBe(Number(lastA));
    expect((await appliedRows(b)).length).toBe(Number(lastB));
    expect(summary.succeeded).toBe(Number(lastA) + Number(lastB));
  });

  it('one cycle advances at most one position per projection (IW2)', async () => {
    const p = 'worker-onepass';
    await seedEvents(3);
    const registry = registryOf([{ name: p, version: 1, apply: okHandler(p) }]);
    const { sleep } = recordingSleep();

    await runProjectionWorker({ pool: admin, registry, now: fixedNow, sleep, maxCycles: 1 });
    expect((await checkpointRow(p, 1))?.last).toBe(1n); // exactly one after one pass
    await runProjectionWorker({ pool: admin, registry, now: fixedNow, sleep, maxCycles: 1 });
    expect((await checkpointRow(p, 1))?.last).toBe(2n); // exactly two after two passes
  });
});

describe('poison isolation: one blocked projection never stalls another (IW3)', () => {
  it('a blocked poison projection stays blocked while a healthy projection is driven to caught-up (IW3)', async () => {
    const poison = 'worker-poison';
    const healthy = 'worker-healthy';
    await seedEvents(2);

    // Pre-block the poison directly via the runner (five deterministic failures across advancing time).
    const poisonRegistry = registryOf([{ name: poison, version: 1, apply: failHandler }]);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await runProjectionOnce({
        pool: admin,
        registry: poisonRegistry,
        name: poison,
        version: 1,
        now: laterNow(attempt * 600000),
      });
    }
    expect((await checkpointRow(poison, 1))?.status).toBe('blocked');

    // Now run the worker over BOTH: the poison (blocked) and a healthy projection.
    const registry = registryOf([
      { name: poison, version: 1, apply: failHandler },
      { name: healthy, version: 1, apply: okHandler(healthy) },
    ]);
    const { sleep } = recordingSleep();
    await runProjectionWorker({ pool: admin, registry, now: fixedNow, sleep, maxCycles: 10 });

    // The poison stayed blocked and unchanged; the healthy projection advanced independently.
    expect((await checkpointRow(poison, 1))?.status).toBe('blocked');
    expect((await checkpointRow(healthy, 1))?.last).toBeGreaterThanOrEqual(2n);
    expect((await appliedRows(healthy)).length).toBeGreaterThanOrEqual(2);
  });

  it('a projection whose invocation THROWS a non-result failure ABORTS the cycle; the worker writes nothing and calls no later projection (IW3, test 10)', async () => {
    // The infra projection sorts before the healthy one, so it runs first and throws. A thrown value is
    // a non-result failure — the cycle stops with a fixed ProjectionWorkerError; the later projection is
    // never invoked; and the worker itself writes no attempt or checkpoint.
    const inf = 'worker-infra-a';
    const later = 'worker-infra-zz';
    await seedEvents(2);
    const registry = registryOf([
      { name: inf, version: 1, apply: infraHandler },
      { name: later, version: 1, apply: okHandler(later) },
    ]);
    const { sleep } = recordingSleep();
    await expect(
      runProjectionWorker({ pool: admin, registry, now: fixedNow, sleep, maxCycles: 5 }),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
    // The throwing projection: the runner rolled back — no attempt, checkpoint absent or unchanged.
    expect(await attemptCount(inf, 1, 1n)).toBe(0);
    const cpInfra = await checkpointRow(inf, 1);
    expect(cpInfra === null || (cpInfra.last === 0n && cpInfra.count === 0)).toBe(true);
    // The LATER projection was never called: no checkpoint, no applied rows.
    expect(await checkpointRow(later, 1)).toBeNull();
    expect((await appliedRows(later)).length).toBe(0);
  });
});

describe('retry clock gate: no premature retry, no busy-spin (IW4, IW5)', () => {
  it('does not re-attempt a failing projection before next_attempt_at; advancing the clock lets it retry (IW4)', async () => {
    const rtr = 'worker-retry';
    await seedEvents(1);
    const registry = registryOf([{ name: rtr, version: 1, apply: failHandler }]);
    const { sleep, calls } = recordingSleep();

    let clock: CanonicalInstant = now;
    const movableNow = (): CanonicalInstant => clock;

    // Several passes at the SAME instant: exactly one failed attempt is recorded (first pass fails and
    // schedules; later passes see retry-pending and sleep — no premature retry, no busy-spin).
    await runProjectionWorker({ pool: admin, registry, now: movableNow, sleep, maxCycles: 4 });
    expect(await attemptCount(rtr, 1, 1n)).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(1); // it slept rather than hot-looping

    // Advance the clock well past the scheduled retry: the next pass performs attempt #2.
    clock = laterNow(600000);
    await runProjectionWorker({ pool: admin, registry, now: movableNow, sleep, maxCycles: 1 });
    expect(await attemptCount(rtr, 1, 1n)).toBe(2);
  });

  it('sleeps once per idle cycle when every projection is caught-up (IW5)', async () => {
    const p = 'worker-idle';
    await seedEvents(1);
    const registry = registryOf([{ name: p, version: 1, apply: okHandler(p) }]);
    // Drive to GENUINE caught-up directly (independent of the current log size), then observe the worker.
    let r = await runProjectionOnce({ pool: admin, registry, name: p, version: 1, now });
    while (r.outcome === 'succeeded') {
      r = await runProjectionOnce({ pool: admin, registry, name: p, version: 1, now });
    }
    expect(r.outcome).toBe('caught-up');
    // Now every pass is idle => exactly one bounded sleep per cycle (no busy-spin).
    const { sleep, calls } = recordingSleep();
    const summary = await runProjectionWorker({
      pool: admin,
      registry,
      now: fixedNow,
      sleep,
      maxCycles: 3,
    });
    expect(summary.succeeded).toBe(0); // nothing to advance
    expect(calls).toHaveLength(3);
  });
});

describe('shutdown/drain and no leakage (IW6, IW7)', () => {
  it('an abort mid-progress drains the in-flight invocation, stops the worker, and leaks nothing (IW6, IW7)', async () => {
    const p = 'worker-shutdown';
    await seedEvents(4);
    const key = projectionAdvisoryLockKeyParameter(p as never, 1);

    const controller = new AbortController();
    let applied = 0;
    // A handler that, on its SECOND invocation, aborts the worker — and still completes its write. The
    // worker must let that in-flight invocation finish (drain), then stop before a third invocation.
    const abortingHandler = async (
      client: DatabaseClient,
      event: { readonly position: bigint },
    ): Promise<void> => {
      applied += 1;
      await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
        p,
        event.position.toString(),
      ]);
      if (applied === 2) {
        controller.abort();
      }
    };
    const registry = registryOf([{ name: p, version: 1, apply: abortingHandler }]);
    const { sleep } = recordingSleep();

    const summary = await runProjectionWorker({
      pool: admin,
      registry,
      now: fixedNow,
      sleep,
      signal: controller.signal,
      maxCycles: 100,
    });
    expect(summary.stoppedBy).toBe('aborted');
    expect(applied).toBe(2); // the in-flight (second) invocation completed; no third started (drain)
    expect((await checkpointRow(p, 1))?.last).toBe(2n); // both drained positions committed

    // No leak: advisory lock free, no checked-out/idle-in-transaction client, pool still usable.
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    expect(checkedOut(admin)).toBe(0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });

  it('processes many passes without exhausting the pool or leaking advisory locks (IW7)', async () => {
    const p = 'worker-manypass';
    await seedEvents(6);
    const registry = registryOf([{ name: p, version: 1, apply: okHandler(p) }]);
    const key = projectionAdvisoryLockKeyParameter(p as never, 1);
    const { sleep } = recordingSleep();

    await runProjectionWorker({ pool: admin, registry, now: fixedNow, sleep, maxCycles: 20 });

    expect((await checkpointRow(p, 1))?.last).toBeGreaterThanOrEqual(6n);
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });
});

/**
 * A deterministic barrier: one worker instance enters its handler (holding the transaction-scoped
 * advisory lock, transaction open) and PARKS on `wait` while a second instance attempts concurrently.
 * `open()` releases the first, which then commits. No wall-clock sleeps — the barrier orders the two
 * instances precisely so the concurrency proof is not timing-dependent.
 */
function makeGate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

describe('multi-instance concurrency against real PostgreSQL (IW8, IW9)', () => {
  it('two instances on the SAME projection+event: advisory locking serializes them, exactly one effect (IW8)', async () => {
    const p = 'worker-conc-same';
    await seedEvents(2);
    const key = projectionAdvisoryLockKeyParameter(p as never, 1);

    // Instance 1's handler holds the advisory lock (txn open) and parks on the barrier until instance 2
    // has run its full attempt. Only the first-ever invocation parks.
    const inHandler = makeGate();
    const secondDone = makeGate();
    let handlerCalls = 0;
    const barrierHandler = async (
      client: DatabaseClient,
      event: { readonly position: bigint },
    ): Promise<void> => {
      handlerCalls += 1;
      await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
        p,
        event.position.toString(),
      ]);
      if (handlerCalls === 1) {
        inHandler.open(); // instance 1 now holds the lock inside an open transaction
        await secondDone.wait; // hold it open while instance 2 attempts concurrently
      }
    };
    const registry = registryOf([{ name: p, version: 1, apply: barrierHandler }]);

    // Instance 1 (floating) drives one position; it parks inside the handler holding the lock.
    const instance1 = runProjectionWorker({
      pool: admin,
      registry,
      now: fixedNow,
      sleep: recordingSleep().sleep,
      maxCycles: 1,
    });
    await inHandler.wait;

    // The assertions below run while instance 1 is parked inside its handler (holding the advisory
    // lock and an open transaction). Guard them so the barrier is ALWAYS released and instance 1 is
    // ALWAYS awaited — even if an assertion throws — so no worker can stay parked on any exit path.
    let bodyFailed = false;
    let instance1Summary: Awaited<ReturnType<typeof runProjectionWorker>> | undefined;
    try {
      // While instance 1 holds the transaction lock, the key is held by another backend...
      expect(await advisoryKeyHeldByOther(key)).toBe(true);
      // ...so instance 2 (a second worker) cannot acquire it: its cycle observes `busy` and advances nothing.
      const instance2 = await runProjectionWorker({
        pool: admin,
        registry,
        now: fixedNow,
        sleep: recordingSleep().sleep,
        maxCycles: 1,
      });
      expect(instance2.succeeded).toBe(0); // second instance observed the existing lock; no duplicate effect
    } catch (error) {
      bodyFailed = true;
      throw error;
    } finally {
      // Always release instance 1 and always await it: on failure, drain it WITHOUT masking the
      // original assertion error; on success, surface any worker rejection.
      secondDone.open();
      if (bodyFailed) {
        await instance1.catch(() => undefined);
      } else {
        instance1Summary = await instance1;
      }
    }

    expect(instance1Summary?.succeeded).toBe(1);
    expect(handlerCalls).toBe(1); // the handler ran exactly once — no duplicate successful attempt
    expect((await appliedRows(p)).length).toBe(1); // exactly one read-model effect
    expect((await checkpointRow(p, 1))?.last).toBe(1n); // checkpoint advanced exactly once
    expect(await attemptCount(p, 1, 1n)).toBe(1); // one succeeded attempt, no duplicate

    // No leaks: lock released, no checked-out or idle-in-transaction clients, pool usable.
    expect(await advisoryKeyHeldByOther(key)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    expect(checkedOut(admin)).toBe(0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });

  it('two instances on UNRELATED projections do not block each other; both commit independently (IW9)', async () => {
    const a = 'worker-conc-unrel-a';
    const b = 'worker-conc-unrel-b';
    await seedEvents(2);
    const keyA = projectionAdvisoryLockKeyParameter(a as never, 1);
    const keyB = projectionAdvisoryLockKeyParameter(b as never, 1);

    // Instance A parks inside its handler holding A's advisory lock (txn open). B must proceed anyway
    // because it locks a DIFFERENT key.
    const aInHandler = makeGate();
    const aContinue = makeGate();
    let aCalls = 0;
    const handlerA = async (
      client: DatabaseClient,
      event: { readonly position: bigint },
    ): Promise<void> => {
      aCalls += 1;
      await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
        a,
        event.position.toString(),
      ]);
      if (aCalls === 1) {
        aInHandler.open();
        await aContinue.wait;
      }
    };
    const registryA = registryOf([{ name: a, version: 1, apply: handlerA }]);
    const registryB = registryOf([{ name: b, version: 1, apply: okHandler(b) }]);

    const instanceA = runProjectionWorker({
      pool: admin,
      registry: registryA,
      now: fixedNow,
      sleep: recordingSleep().sleep,
      maxCycles: 1,
    });
    await aInHandler.wait; // A holds its lock, transaction open

    // The assertions below run while instance A is parked inside its handler (holding A's advisory
    // lock and an open transaction). Guard them so A's barrier is ALWAYS released and instance A is
    // ALWAYS awaited — even if an assertion throws — so no worker can stay parked on any exit path.
    let bodyFailed = false;
    let instanceASummary: Awaited<ReturnType<typeof runProjectionWorker>> | undefined;
    try {
      // A's key is held; B's key is free — B is not blocked and drives its own position to completion.
      expect(await advisoryKeyHeldByOther(keyA)).toBe(true);
      expect(await advisoryKeyHeldByOther(keyB)).toBe(false);
      const instanceB = await runProjectionWorker({
        pool: admin,
        registry: registryB,
        now: fixedNow,
        sleep: recordingSleep().sleep,
        maxCycles: 1,
      });
      expect(instanceB.succeeded).toBe(1); // B committed while A was still held — neither blocked the other
      expect((await checkpointRow(b, 1))?.last).toBe(1n);
    } catch (error) {
      bodyFailed = true;
      throw error;
    } finally {
      // Always release instance A and always await it: on failure, drain it WITHOUT masking the
      // original assertion error; on success, surface any worker rejection.
      aContinue.open();
      if (bodyFailed) {
        await instanceA.catch(() => undefined);
      } else {
        instanceASummary = await instanceA;
      }
    }
    expect(instanceASummary?.succeeded).toBe(1);

    // Both effects committed, both checkpoints advanced independently.
    expect((await appliedRows(a)).length).toBe(1);
    expect((await appliedRows(b)).length).toBe(1);
    expect((await checkpointRow(a, 1))?.last).toBe(1n);
    expect((await checkpointRow(b, 1))?.last).toBe(1n);

    // No leaks on either key.
    expect(await advisoryKeyHeldByOther(keyA)).toBe(false);
    expect(await advisoryKeyHeldByOther(keyB)).toBe(false);
    await pollUntil(async () => checkedOut(admin) === 0 && (await idleInTxBackends()) === 0);
    expect(checkedOut(admin)).toBe(0);
    await expect(withClient(admin, (c) => c.query('SELECT 1 AS ok'))).resolves.toBeDefined();
  });
});
