/**
 * Stage 3.4.5B — the production registry driven end-to-end by the real runner and worker against real
 * PostgreSQL 17 (ADR-0038 §deferrals).
 *
 * Seeds genuine events (each mapped to the next dense projection position) and drives the two REAL
 * read-model handlers through the merged `runProjectionOnce` / `runProjectionWorker`. State-based
 * proofs (checkpoints, attempt rows, advisory-key probes, pool counters, injected clock + immediate
 * sleep — never wall-clock sleeps): both real projections advance INDEPENDENTLY over one fixture
 * stream; each advances its own checkpoint with an attempt row per success (no fabrication); the
 * read-model effect is not duplicated on re-drive; a deterministic poison projection does not stall a
 * real one (isolation); concurrent workers never double-apply (advisory lock + checkpoint); a run
 * leaves no advisory-lock or client leak; and cancellation drains cleanly. Loopback-guarded harness.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import {
  DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME,
  DAILY_EVENT_ACCEPTANCE_PROJECTION_VERSION,
} from '../projections/handlers/daily-event-acceptance.js';
import {
  EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
  EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
} from '../projections/handlers/event-type-activity.js';
import { createProductionProjectionRegistry } from '../projections/production-registry.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { projectionAdvisoryLockKeyParameter } from '../projections/projection-lock-key.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';
import { runProjectionWorker, type WorkerSleep } from '../projections/projection-worker.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-prod-proj-admin' });

const EVENT_TYPE = 'qf.recommendation.created';
const EVENT_VERSION = 2;

function makeRecord(): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType: EVENT_TYPE,
    eventVersion: EVENT_VERSION,
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
const fixedNow = (): CanonicalInstant => now;

/** An immediate, recording sleep — the loop yields but the test never waits on the wall clock. */
function immediateSleep(): WorkerSleep {
  return () => Promise.resolve();
}

async function checkpointLast(name: string, version: number): Promise<bigint | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ last_position: string; status: string }>(
      `SELECT last_position, status FROM qf_jarvis.projection_checkpoint
         WHERE projection_name = $1 AND projection_version = $2`,
      [name, version],
    );
    const row = r.rows[0];
    return row === undefined ? null : BigInt(row.last_position);
  });
}

async function checkpointStatus(name: string, version: number): Promise<string | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ status: string }>(
      `SELECT status FROM qf_jarvis.projection_checkpoint
         WHERE projection_name = $1 AND projection_version = $2`,
      [name, version],
    );
    return r.rows[0]?.status ?? null;
  });
}

async function succeededAttemptCount(name: string, version: number): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM qf_jarvis.projection_attempt
         WHERE projection_name = $1 AND projection_version = $2 AND outcome = 'succeeded'`,
      [name, version],
    );
    return r.rows[0]?.n ?? -1;
  });
}

async function eventTypeCount(): Promise<bigint> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ event_count: string }>(
      `SELECT event_count FROM qf_jarvis.rm_event_type_activity
         WHERE event_type = $1 AND event_version = $2`,
      [EVENT_TYPE, EVENT_VERSION],
    );
    return BigInt(r.rows[0]?.event_count ?? '0');
  });
}

async function dailyTotal(): Promise<bigint> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ total: string | null }>(
      `SELECT sum(event_count)::text AS total FROM qf_jarvis.rm_daily_event_acceptance`,
    );
    return BigInt(r.rows[0]?.total ?? '0');
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

const eventTypeLockKey = projectionAdvisoryLockKeyParameter(
  EVENT_TYPE_ACTIVITY_PROJECTION_NAME as never,
  EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
);
const dailyLockKey = projectionAdvisoryLockKeyParameter(
  DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME as never,
  DAILY_EVENT_ACCEPTANCE_PROJECTION_VERSION,
);

beforeEach(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterEach(async () => {
  // No advisory lock and no checked-out client may survive a run.
  expect(await advisoryKeyHeldByOther(eventTypeLockKey)).toBe(false);
  expect(await advisoryKeyHeldByOther(dailyLockKey)).toBe(false);
  expect(checkedOut(admin)).toBe(0);
});

afterAll(async () => {
  await closeTestPool(admin);
});

describe('production registry — both real projections advance independently', () => {
  it('drives both to caught-up over one fixture stream; each advances its own checkpoint', async () => {
    await seedEvents(3);
    const summary = await runProjectionWorker({
      pool: admin,
      registry: createProductionProjectionRegistry(),
      now: fixedNow,
      sleep: immediateSleep(),
      maxCycles: 10,
    });

    expect(summary.stoppedBy).toBe('max-cycles');
    expect(await checkpointLast(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(3n);
    expect(await checkpointLast(DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME, 1)).toBe(3n);
    // One row, count 3, for the single seeded (type, version) and the single acceptance day.
    expect(await eventTypeCount()).toBe(3n);
    expect(await dailyTotal()).toBe(3n);
  });

  it('records exactly one succeeded attempt per applied position — no fabricated checkpoint/attempt', async () => {
    await seedEvents(4);
    await runProjectionWorker({
      pool: admin,
      registry: createProductionProjectionRegistry(),
      now: fixedNow,
      sleep: immediateSleep(),
      maxCycles: 12,
    });
    expect(await succeededAttemptCount(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(4);
    expect(await succeededAttemptCount(DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME, 1)).toBe(4);
  });

  it('does not duplicate the read-model effect when re-driven after catch-up', async () => {
    await seedEvents(3);
    const registry = createProductionProjectionRegistry();
    const drive = (): Promise<unknown> =>
      runProjectionWorker({
        pool: admin,
        registry,
        now: fixedNow,
        sleep: immediateSleep(),
        maxCycles: 10,
      });
    await drive();
    await drive(); // a second full drive must add nothing (caught-up, position-guarded)
    expect(await eventTypeCount()).toBe(3n);
    expect(await dailyTotal()).toBe(3n);
    expect(await succeededAttemptCount(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(3);
  });
});

describe('production handler — isolation and concurrency', () => {
  it('a blocked deterministic-poison projection does not stall a real projection (isolation)', async () => {
    await seedEvents(2);
    const poison = 'isolation-poison';
    const failHandler = async (): Promise<void> => {
      await Promise.resolve();
      throw new Error('deterministic reducer refusal');
    };

    // Pre-block the poison with five deterministic failures across advancing injected time.
    const poisonRegistry = createProjectionRegistry([
      { name: poison, version: 1, apply: failHandler },
    ]);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await runProjectionOnce({
        pool: admin,
        registry: poisonRegistry,
        name: poison,
        version: 1,
        now: laterNow(attempt * 600_000),
      });
    }
    expect(await checkpointStatus(poison, 1)).toBe('blocked');

    // A mixed registry: the blocked poison alongside the REAL event-type projection.
    const real = createProductionProjectionRegistry().get(EVENT_TYPE_ACTIVITY_PROJECTION_NAME);
    if (real === undefined) {
      throw new Error('the production registry is missing event-type-activity');
    }
    const mixed = createProjectionRegistry([
      { name: poison, version: 1, apply: failHandler },
      real,
    ]);
    await runProjectionWorker({
      pool: admin,
      registry: mixed,
      now: () => laterNow(10_000_000),
      sleep: immediateSleep(),
      maxCycles: 8,
    });

    // The poison stays blocked; the real projection is driven all the way to caught-up regardless.
    expect(await checkpointStatus(poison, 1)).toBe('blocked');
    expect(await checkpointLast(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(2n);
    expect(await eventTypeCount()).toBe(2n);
  });

  it('concurrent workers over the production registry never double-apply (advisory lock + checkpoint)', async () => {
    await seedEvents(5);
    const drive = (): Promise<unknown> =>
      runProjectionWorker({
        pool: admin,
        registry: createProductionProjectionRegistry(),
        now: fixedNow,
        sleep: immediateSleep(),
        maxCycles: 30,
      });
    await Promise.all([drive(), drive()]);

    expect(await checkpointLast(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(5n);
    expect(await checkpointLast(DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME, 1)).toBe(5n);
    // Exactly five, never ten: each position was applied once despite two concurrent workers.
    expect(await eventTypeCount()).toBe(5n);
    expect(await dailyTotal()).toBe(5n);
    expect(await succeededAttemptCount(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(5);
  });
});

describe('production worker — graceful cancellation', () => {
  it('processes the stream then drains cleanly on abort during the idle wait', async () => {
    await seedEvents(2);
    const controller = new AbortController();
    // Abort the first time the worker yields (i.e. once both projections are caught-up).
    const abortingSleep: WorkerSleep = (_ms: number, signal?: AbortSignal) => {
      controller.abort();
      return signal?.aborted === true ? Promise.resolve() : Promise.resolve();
    };

    const summary = await runProjectionWorker({
      pool: admin,
      registry: createProductionProjectionRegistry(),
      now: fixedNow,
      sleep: abortingSleep,
      signal: controller.signal,
    });

    expect(summary.stoppedBy).toBe('aborted');
    // Both projections were fully drained before the abort took effect.
    expect(await checkpointLast(EVENT_TYPE_ACTIVITY_PROJECTION_NAME, 1)).toBe(2n);
    expect(await checkpointLast(DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME, 1)).toBe(2n);
  });
});
