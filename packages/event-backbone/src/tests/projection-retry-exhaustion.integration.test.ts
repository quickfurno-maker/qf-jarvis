/**
 * QFJ-P03.07D — atomic retry-exhaustion integration against real PostgreSQL 17 (ADR-0040).
 *
 * Proves the fifth deterministic failure atomically establishes the whole exhaustion state — the final
 * attempt, the blocked checkpoint, the blocked position, EXACTLY ONE active failure aggregate, and the
 * append-only `created` action — in ONE READ COMMITTED transaction, and that:
 *   * attempts 1–4 create no failure aggregate and no action;
 *   * a pre-COMMIT failure at each establishment step rolls the ENTIRE transaction back (no attempt, no
 *     block, no failure, no action);
 *   * a restart after a committed exhaustion returns blocked-existing without re-invoking the handler or
 *     writing anything;
 *   * an exact duplicate invocation is idempotent;
 *   * concurrent workers establish exactly one aggregate/action/attempt;
 *   * an ambiguous COMMIT is reconciled, never blindly retried;
 *   * a non-deterministic failure on the would-be fifth invocation establishes nothing.
 *
 * Loopback-guarded harness; synthetic handlers only. Integration-gated (runs in CI).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import {
  deterministicHandlerFailure,
  projectionCancellation,
  repositoryInvariantFailure,
} from '../projections/projection-failure-taxonomy.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-p03-07d-admin' });

const now: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
function laterNow(ms: number): CanonicalInstant {
  return toCanonicalInstant(new Date(Date.parse(now) + ms));
}

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

// A deterministic reducer refusal (the only category that establishes an exhaustion failure).
const failHandler = async (): Promise<void> => {
  await Promise.resolve();
  throw deterministicHandlerFailure('deterministic reducer refusal');
};

function registryOf(name: string, apply: (c: DatabaseClient, e: never) => Promise<void>) {
  return createProjectionRegistry([{ name, version: 1, apply }]);
}

async function checkpointRow(
  name: string,
): Promise<{ last: bigint; status: string; count: number; blocked: bigint | null } | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      last_position: string;
      status: string;
      failed_attempt_count: number;
      blocked_position: string | null;
    }>(
      `SELECT last_position, status, failed_attempt_count, blocked_position
         FROM qf_jarvis.projection_checkpoint WHERE projection_name = $1 AND projection_version = 1`,
      [name],
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

async function attemptCount(name: string, position: bigint): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM qf_jarvis.projection_attempt
         WHERE projection_name = $1 AND projection_version = 1 AND event_position = $2`,
      [name, position.toString()],
    );
    return r.rows[0]?.n ?? -1;
  });
}

interface FailureView {
  readonly failureId: string;
  readonly position: bigint;
  readonly category: string;
  readonly code: string;
  readonly autoCount: number;
  readonly status: string;
  readonly generation: number;
  readonly eventStorageSequence: bigint;
}

async function activeFailures(name: string): Promise<FailureView[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      failure_id: string;
      projection_position: string;
      category: string;
      safe_error_code: string;
      automatic_attempt_count: number;
      status: string;
      generation: number;
      event_storage_sequence: string;
    }>(
      `SELECT failure_id, projection_position, category, safe_error_code, automatic_attempt_count,
              status, generation, event_storage_sequence
         FROM qf_jarvis.projection_failure
        WHERE projection_name = $1 AND projection_version = 1
          AND status NOT IN ('resolved','superseded','retired')
        ORDER BY projection_position`,
      [name],
    );
    return r.rows.map((row) => ({
      failureId: row.failure_id,
      position: BigInt(row.projection_position),
      category: row.category,
      code: row.safe_error_code,
      autoCount: row.automatic_attempt_count,
      status: row.status,
      generation: row.generation,
      eventStorageSequence: BigInt(row.event_storage_sequence),
    }));
  });
}

async function failureCount(name: string): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM qf_jarvis.projection_failure WHERE projection_name = $1`,
      [name],
    );
    return r.rows[0]?.n ?? -1;
  });
}

async function actionsFor(
  failureId: string,
): Promise<{ type: string; actor: string; actorId: string; key: string | null }[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      action_type: string;
      actor_type: string;
      actor_id: string;
      idempotency_key: string | null;
    }>(
      `SELECT action_type, actor_type, actor_id, idempotency_key
         FROM qf_jarvis.projection_failure_action WHERE failure_id = $1 ORDER BY sequence`,
      [failureId],
    );
    return r.rows.map((row) => ({
      type: row.action_type,
      actor: row.actor_type,
      actorId: row.actor_id,
      key: row.idempotency_key,
    }));
  });
}

/** Drive `k` deterministic failures (1..4 schedule retries), advancing injected time past each backoff. */
async function driveFailures(name: string, k: number): Promise<void> {
  const registry = registryOf(name, failHandler);
  for (let attempt = 1; attempt <= k; attempt += 1) {
    await runProjectionOnce({
      pool: admin,
      registry,
      name,
      version: 1,
      now: laterNow(attempt * 600000),
    });
  }
}

// A pool that wraps `admin` and can reject on a SQL substring, or simulate COMMIT ack-loss / pre-send.
interface WrapOptions {
  readonly rejectOn?: string;
  readonly commitAckLoss?: boolean;
  readonly commitFailBeforeSend?: boolean;
}
function wrapPool(options: WrapOptions): DatabasePool {
  return {
    connect: async (): Promise<DatabaseClient> => {
      const real = await admin.connect();
      const wrapped: Partial<DatabaseClient> = {
        query: ((text: unknown, params?: unknown) => {
          const sql = typeof text === 'string' ? text : (text as { text: string }).text;
          if (sql === 'COMMIT' && options.commitAckLoss === true) {
            return (real.query as (t: unknown, p?: unknown) => Promise<unknown>)('COMMIT').then(
              () => {
                throw Object.assign(new Error('ack loss'), { code: '08006' });
              },
            );
          }
          if (sql === 'COMMIT' && options.commitFailBeforeSend === true) {
            return Promise.reject(
              Object.assign(new Error('pre-send commit failure'), { code: '08006' }),
            );
          }
          if (
            options.rejectOn !== undefined &&
            typeof sql === 'string' &&
            sql.includes(options.rejectOn)
          ) {
            return Promise.reject(Object.assign(new Error('injected failure'), { code: '40P01' }));
          }
          return (real.query as (t: unknown, p?: unknown) => Promise<unknown>)(text, params);
        }) as DatabaseClient['query'],
        release: (destroy?: boolean | Error) => {
          real.release(destroy === true ? true : undefined);
        },
      };
      return wrapped as DatabaseClient;
    },
  } as unknown as DatabasePool;
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeTestPool(admin);
});

// ---------------------------------------------------------------------------
// Attempts 1–4: no aggregate
// ---------------------------------------------------------------------------

describe('attempts 1–4 create no failure aggregate (R1)', () => {
  it('four deterministic failures leave the checkpoint active with no failure and no action', async () => {
    const name = 'd-1to4';
    await seedEvents(1);
    await driveFailures(name, 4);

    const cp = await checkpointRow(name);
    expect(cp?.status).toBe('active');
    expect(cp?.count).toBe(4);
    expect(cp?.last).toBe(0n);
    expect(await attemptCount(name, 1n)).toBe(4);
    expect(await failureCount(name)).toBe(0); // no aggregate yet
  });
});

// ---------------------------------------------------------------------------
// Fifth deterministic failure: atomic establishment
// ---------------------------------------------------------------------------

describe('fifth deterministic failure atomically establishes the exhaustion state (R2)', () => {
  it('blocks and creates exactly one active failure at the blocked position plus one created action', async () => {
    const name = 'd-fifth';
    await seedEvents(1);
    const fifth = await (async () => {
      await driveFailures(name, 4);
      return runProjectionOnce({
        pool: admin,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      });
    })();

    expect(fifth.outcome).toBe('blocked-now');
    if (fifth.outcome === 'blocked-now') {
      expect(fifth.attemptNumber).toBe(5);
      expect(fifth.blockedPosition).toBe(1n);
    }

    const cp = await checkpointRow(name);
    expect(cp?.status).toBe('blocked');
    expect(cp?.count).toBe(5);
    expect(cp?.blocked).toBe(1n);
    expect(cp?.last).toBe(0n); // last_position never advances on the poison
    expect(await attemptCount(name, 1n)).toBe(5); // exactly five, no sixth

    const failures = await activeFailures(name);
    expect(failures).toHaveLength(1);
    const f = failures[0];
    expect(f?.position).toBe(1n);
    expect(f?.category).toBe('DETERMINISTIC_HANDLER_FAILURE');
    expect(f?.code).toBe('projection-handler-failed');
    expect(f?.autoCount).toBe(5);
    expect(f?.status).toBe('open');
    expect(f?.eventStorageSequence).toBeGreaterThan(0n);

    const actions = await actionsFor(f?.failureId ?? '');
    expect(actions).toHaveLength(1);
    expect(actions[0]?.type).toBe('created');
    expect(actions[0]?.actor).toBe('system');
    expect(actions[0]?.actorId).toBe('projection-runner');
    expect(actions[0]?.key).toBe('retry-exhaustion:d-fifth:v1:p1');
  });
});

// ---------------------------------------------------------------------------
// Atomic rollback at each pre-commit establishment step (N)
// ---------------------------------------------------------------------------

describe('atomic rollback at each pre-commit failure-injection point (N/R3)', () => {
  async function assertNothingDurable(name: string): Promise<void> {
    const cp = await checkpointRow(name);
    // The checkpoint stays active at count 4 (the fifth attempt/block rolled back).
    expect(cp?.status).toBe('active');
    expect(cp?.count).toBe(4);
    expect(cp?.blocked).toBeNull();
    expect(await attemptCount(name, 1n)).toBe(4); // no fifth attempt
    expect(await failureCount(name)).toBe(0); // no aggregate
  }

  it('injected failure on the block UPDATE (after the fifth attempt) rolls everything back', async () => {
    const name = 'd-inj-block';
    await seedEvents(1);
    await driveFailures(name, 4);
    const pool = wrapPool({ rejectOn: "status = 'blocked'" });
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    await assertNothingDurable(name);
  });

  it('injected failure on the failure INSERT (after the block) rolls everything back', async () => {
    const name = 'd-inj-failure';
    await seedEvents(1);
    await driveFailures(name, 4);
    const pool = wrapPool({ rejectOn: 'INSERT INTO qf_jarvis.projection_failure\n' });
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    await assertNothingDurable(name);
  });

  it('injected failure on the created-action INSERT (after the failure) rolls everything back', async () => {
    const name = 'd-inj-action';
    await seedEvents(1);
    await driveFailures(name, 4);
    const pool = wrapPool({ rejectOn: 'INSERT INTO qf_jarvis.projection_failure_action' });
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    await assertNothingDurable(name);
  });

  it('a pre-send COMMIT failure (immediately before COMMIT) leaves nothing durable', async () => {
    const name = 'd-inj-commit';
    await seedEvents(1);
    await driveFailures(name, 4);
    const pool = wrapPool({ commitFailBeforeSend: true });
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });
    await assertNothingDurable(name);
  });
});

// ---------------------------------------------------------------------------
// Restart after a committed exhaustion: blocked-existing, no re-invocation (P2/R11)
// ---------------------------------------------------------------------------

describe('restart after a committed exhaustion is idempotent (P2/R5/R11)', () => {
  it('a later invocation returns blocked-existing without re-invoking the handler or writing anything', async () => {
    const name = 'd-restart';
    await seedEvents(1);
    let handlerCalls = 0;
    const countingFail = async (): Promise<void> => {
      handlerCalls += 1;
      await Promise.resolve();
      throw deterministicHandlerFailure('deterministic reducer refusal');
    };
    const registry = registryOf(name, countingFail);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await runProjectionOnce({
        pool: admin,
        registry,
        name,
        version: 1,
        now: laterNow(attempt * 600000),
      });
    }
    expect(handlerCalls).toBe(5);
    const f0 = await activeFailures(name);
    expect(f0).toHaveLength(1);

    // Restart: another invocation finds the blocked checkpoint and writes nothing.
    const existing = await runProjectionOnce({
      pool: admin,
      registry,
      name,
      version: 1,
      now: laterNow(6 * 600000),
    });
    expect(existing.outcome).toBe('blocked-existing');
    expect(handlerCalls).toBe(5); // the handler was NOT re-invoked
    expect(await attemptCount(name, 1n)).toBe(5); // no sixth attempt
    expect(await failureCount(name)).toBe(1); // no second failure
    const actions = await actionsFor(f0[0]?.failureId ?? '');
    expect(actions).toHaveLength(1); // no second created action
    expect(f0[0]?.generation).toBe(0); // the aggregate was not mutated
  });
});

// ---------------------------------------------------------------------------
// Ambiguous COMMIT: reconciled, never blindly retried (I/R differentiate)
// ---------------------------------------------------------------------------

describe('ambiguous COMMIT is reconciled to the durable state (P4)', () => {
  it('an ack-lost COMMIT that landed is observed as blocked-existing on the next invocation, adding nothing', async () => {
    const name = 'd-ambiguous';
    await seedEvents(1);
    await driveFailures(name, 4);
    const pool = wrapPool({ commitAckLoss: true });
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'projection-commit-outcome-unknown' });

    // The COMMIT actually landed: exactly one failure/action/attempt exist.
    const failures = await activeFailures(name);
    expect(failures).toHaveLength(1);
    expect(await attemptCount(name, 1n)).toBe(5);

    // The next invocation reconciles to the durable state — blocked-existing, nothing added.
    const again = await runProjectionOnce({
      pool: admin,
      registry: registryOf(name, failHandler),
      name,
      version: 1,
      now: laterNow(6 * 600000),
    });
    expect(again.outcome).toBe('blocked-existing');
    expect(await attemptCount(name, 1n)).toBe(5);
    expect(await failureCount(name)).toBe(1);
    expect(await actionsFor(failures[0]?.failureId ?? '')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency: two workers race the fifth failure (O/R4)
// ---------------------------------------------------------------------------

describe('concurrent fifth failures establish exactly one aggregate/action/attempt (O/R4)', () => {
  it('two workers racing the fifth failure never double-establish', async () => {
    const name = 'd-concurrent';
    await seedEvents(1);
    await driveFailures(name, 4);

    const registry = registryOf(name, failHandler);
    const at = laterNow(5 * 600000);
    const [a, b] = await Promise.all([
      runProjectionOnce({ pool: admin, registry, name, version: 1, now: at }).catch(
        (e: unknown) => e,
      ),
      runProjectionOnce({ pool: admin, registry, name, version: 1, now: at }).catch(
        (e: unknown) => e,
      ),
    ]);
    // Whatever the interleaving, the durable state is single and consistent.
    const cp = await checkpointRow(name);
    expect(cp?.status).toBe('blocked');
    expect(cp?.count).toBe(5);
    expect(await attemptCount(name, 1n)).toBe(5); // exactly five, never six
    const failures = await activeFailures(name);
    expect(failures).toHaveLength(1); // exactly one aggregate
    expect(await actionsFor(failures[0]?.failureId ?? '')).toHaveLength(1); // exactly one created action

    // At least one caller observed a blocked outcome (blocked-now or blocked-existing); neither
    // produced a divergence.
    const outcomes = [a, b].map((r) =>
      typeof r === 'object' && r !== null && 'outcome' in r
        ? (r as { outcome: string }).outcome
        : 'threw',
    );
    expect(
      outcomes.some((o) => o === 'blocked-now' || o === 'blocked-existing' || o === 'busy'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-deterministic categories on the would-be fifth invocation establish nothing (R7–R10)
// ---------------------------------------------------------------------------

describe('a non-deterministic failure on the would-be fifth invocation establishes nothing (R7–R10)', () => {
  const infraHandler = async (): Promise<void> => {
    await Promise.resolve();
    throw Object.assign(new Error('infra'), { code: '40P01' });
  };
  const unknownHandler = async (): Promise<void> => {
    await Promise.resolve();
    throw new Error('ordinary bug');
  };
  const cancelHandler = async (): Promise<void> => {
    await Promise.resolve();
    throw projectionCancellation();
  };
  const invariantHandler = async (): Promise<void> => {
    await Promise.resolve();
    throw repositoryInvariantFailure();
  };

  const cases: { label: string; handler: () => Promise<void>; code: string }[] = [
    { label: 'infrastructure', handler: infraHandler, code: 'projection-infrastructure-failed' },
    { label: 'unknown', handler: unknownHandler, code: 'projection-unknown-failure' },
    { label: 'cancellation', handler: cancelHandler, code: 'projection-infrastructure-failed' },
    {
      label: 'repository invariant',
      handler: invariantHandler,
      code: 'projection-infrastructure-failed',
    },
  ];

  for (const { label, handler, code } of cases) {
    it(`${label}: after four deterministic failures, the fifth (non-deterministic) invocation blocks nothing`, async () => {
      const name = `d-nondet-${label.replace(/\s+/g, '-')}`;
      await seedEvents(1);
      await driveFailures(name, 4);
      await expect(
        runProjectionOnce({
          pool: admin,
          registry: registryOf(name, handler),
          name,
          version: 1,
          now: laterNow(5 * 600000),
        }),
      ).rejects.toMatchObject({ code });
      const cp = await checkpointRow(name);
      expect(cp?.status).toBe('active'); // never blocked by a non-deterministic failure
      expect(cp?.count).toBe(4); // no fifth attempt consumed
      expect(await attemptCount(name, 1n)).toBe(4);
      expect(await failureCount(name)).toBe(0); // no aggregate established
    });
  }
});

// ---------------------------------------------------------------------------
// Restart after a rolled-back fifth: normal retry may proceed and then block (P3)
// ---------------------------------------------------------------------------

describe('restart after a rolled-back fifth attempt (P3)', () => {
  it('a later normal invocation completes the exhaustion exactly once', async () => {
    const name = 'd-rollback-recover';
    await seedEvents(1);
    await driveFailures(name, 4);

    // The fifth invocation fails during establishment and rolls back — nothing durable.
    const pool = wrapPool({ rejectOn: 'INSERT INTO qf_jarvis.projection_failure_action' });
    await expect(
      runProjectionOnce({
        pool,
        registry: registryOf(name, failHandler),
        name,
        version: 1,
        now: laterNow(5 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'projection-infrastructure-failed' });
    expect(await failureCount(name)).toBe(0);
    expect(await attemptCount(name, 1n)).toBe(4);

    // A later NORMAL invocation retries the fifth failure and establishes exhaustion exactly once.
    const fifth = await runProjectionOnce({
      pool: admin,
      registry: registryOf(name, failHandler),
      name,
      version: 1,
      now: laterNow(6 * 600000),
    });
    expect(fifth.outcome).toBe('blocked-now');
    expect(await attemptCount(name, 1n)).toBe(5);
    const failures = await activeFailures(name);
    expect(failures).toHaveLength(1);
    expect(await actionsFor(failures[0]?.failureId ?? '')).toHaveLength(1);
  });
});
