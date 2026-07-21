/**
 * Stage 3.4.5B — the two real read-model handlers against real PostgreSQL 17 (ADR-0038 §deferrals).
 *
 * Exercises each handler DIRECTLY against its real `rm_*` table with synthetic, fully-controlled
 * {@link ProjectionEvent}s (chosen position + acceptedAt), because `qf_jarvis.event.accepted_at` is
 * database-generated (`DEFAULT now()`) and cannot be back-dated through the store — so multi-day and
 * midnight cases are only provable by driving the handler with controlled metadata. The end-to-end
 * runner+worker path over real seeded events is proven in `production-projections.integration.test.ts`.
 *
 * Proven: first write, multiple types/versions/days, UTC day grouping and the midnight boundary, count
 * progression, first/last projection positions, the last_accepted_at rule, projection-position replay
 * safety (no duplicate logical effect), and transaction rollback on failure. Loopback-guarded harness.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { applyDailyEventAcceptance } from '../projections/handlers/daily-event-acceptance.js';
import { applyEventTypeActivity } from '../projections/handlers/event-type-activity.js';
import { toCanonicalInstant, type ProjectionEvent } from '../projections/projection-definition.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-handlers-admin' });

function event(
  overrides: Partial<ProjectionEvent> & { readonly position: bigint },
): ProjectionEvent {
  return Object.freeze({
    eventType: 'qf.recommendation.created',
    eventVersion: 2,
    acceptedAt: toCanonicalInstant('2026-07-11T09:00:00.000Z'),
    ...overrides,
  });
}

interface EventTypeRow {
  readonly count: bigint;
  readonly first: bigint;
  readonly last: bigint;
  readonly lastAcceptedAt: string;
}

async function eventTypeRow(type: string, version: number): Promise<EventTypeRow | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      event_count: string;
      first_event_position: string;
      last_event_position: string;
      last_accepted_at: Date;
    }>(
      `SELECT event_count, first_event_position, last_event_position, last_accepted_at
         FROM qf_jarvis.rm_event_type_activity WHERE event_type = $1 AND event_version = $2`,
      [type, version],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      count: BigInt(row.event_count),
      first: BigInt(row.first_event_position),
      last: BigInt(row.last_event_position),
      lastAcceptedAt: row.last_accepted_at.toISOString(),
    };
  });
}

interface DailyRow {
  readonly count: bigint;
  readonly first: bigint;
  readonly last: bigint;
}

async function dailyRow(date: string): Promise<DailyRow | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      event_count: string;
      first_event_position: string;
      last_event_position: string;
    }>(
      `SELECT event_count, first_event_position, last_event_position
         FROM qf_jarvis.rm_daily_event_acceptance WHERE accepted_date = $1::date`,
      [date],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      count: BigInt(row.event_count),
      first: BigInt(row.first_event_position),
      last: BigInt(row.last_event_position),
    };
  });
}

/** Apply an event through a handler on a fresh borrowed client (auto-committed). */
async function apply(
  handler: (c: DatabaseClient, e: ProjectionEvent) => Promise<void>,
  e: ProjectionEvent,
): Promise<void> {
  await withClient(admin, (c) => handler(c, e));
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeTestPool(admin);
});

describe('rm_event_type_activity handler — real table', () => {
  it('first event inserts count 1 with first=last=position and the acceptance instant', async () => {
    const type = 'qf.first.write';
    await apply(applyEventTypeActivity, event({ position: 4n, eventType: type }));
    expect(await eventTypeRow(type, 2)).toEqual({
      count: 1n,
      first: 4n,
      last: 4n,
      lastAcceptedAt: '2026-07-11T09:00:00.000Z',
    });
  });

  it('separates rows by event type AND event version', async () => {
    await apply(
      applyEventTypeActivity,
      event({ position: 10n, eventType: 'qf.multi.kind', eventVersion: 1 }),
    );
    await apply(
      applyEventTypeActivity,
      event({ position: 11n, eventType: 'qf.multi.kind', eventVersion: 2 }),
    );
    await apply(
      applyEventTypeActivity,
      event({ position: 12n, eventType: 'qf.other.kind', eventVersion: 1 }),
    );
    expect((await eventTypeRow('qf.multi.kind', 1))?.count).toBe(1n);
    expect((await eventTypeRow('qf.multi.kind', 2))?.count).toBe(1n);
    expect((await eventTypeRow('qf.other.kind', 1))?.count).toBe(1n);
  });

  it('counts progress and advances last position + last_accepted_at (first stays fixed)', async () => {
    const type = 'qf.progression.kind';
    await apply(
      applyEventTypeActivity,
      event({
        position: 20n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T08:00:00.000Z'),
      }),
    );
    await apply(
      applyEventTypeActivity,
      event({
        position: 21n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T09:00:00.000Z'),
      }),
    );
    await apply(
      applyEventTypeActivity,
      event({
        position: 25n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T10:30:00.000Z'),
      }),
    );
    expect(await eventTypeRow(type, 2)).toEqual({
      count: 3n,
      first: 20n,
      last: 25n,
      lastAcceptedAt: '2026-07-11T10:30:00.000Z',
    });
  });

  it('is idempotent under projection-position replay (a re-presented ≤ position is a no-op)', async () => {
    const type = 'qf.replay.kind';
    await apply(
      applyEventTypeActivity,
      event({
        position: 30n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T08:00:00.000Z'),
      }),
    );
    await apply(
      applyEventTypeActivity,
      event({
        position: 33n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T09:00:00.000Z'),
      }),
    );
    // Re-present both already-applied positions (and a strictly lower one): all must be no-ops.
    await apply(
      applyEventTypeActivity,
      event({
        position: 30n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T23:00:00.000Z'),
      }),
    );
    await apply(
      applyEventTypeActivity,
      event({
        position: 33n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T23:00:00.000Z'),
      }),
    );
    await apply(
      applyEventTypeActivity,
      event({
        position: 31n,
        eventType: type,
        acceptedAt: toCanonicalInstant('2026-07-11T23:00:00.000Z'),
      }),
    );
    expect(await eventTypeRow(type, 2)).toEqual({
      count: 2n,
      first: 30n,
      last: 33n,
      lastAcceptedAt: '2026-07-11T09:00:00.000Z',
    });
  });

  it('rolls back cleanly: a write inside an aborted transaction leaves no row', async () => {
    const type = 'qf.rollback.kind';
    await withClient(admin, async (c) => {
      await c.query('BEGIN');
      await applyEventTypeActivity(c, event({ position: 40n, eventType: type }));
      await c.query('ROLLBACK');
    });
    expect(await eventTypeRow(type, 2)).toBeNull();
  });
});

describe('rm_daily_event_acceptance handler — real table', () => {
  it('first event on a day inserts count 1 with first=last=position', async () => {
    await apply(
      applyDailyEventAcceptance,
      event({ position: 4n, acceptedAt: toCanonicalInstant('2026-03-01T12:00:00.000Z') }),
    );
    expect(await dailyRow('2026-03-01')).toEqual({ count: 1n, first: 4n, last: 4n });
  });

  it('groups multiple events on one UTC day into a single incrementing row', async () => {
    const d = '2026-03-02';
    await apply(
      applyDailyEventAcceptance,
      event({ position: 10n, acceptedAt: toCanonicalInstant(`${d}T00:00:00.000Z`) }),
    );
    await apply(
      applyDailyEventAcceptance,
      event({ position: 11n, acceptedAt: toCanonicalInstant(`${d}T13:00:00.000Z`) }),
    );
    await apply(
      applyDailyEventAcceptance,
      event({ position: 12n, acceptedAt: toCanonicalInstant(`${d}T23:59:59.999Z`) }),
    );
    expect(await dailyRow(d)).toEqual({ count: 3n, first: 10n, last: 12n });
  });

  it('separates events across the UTC midnight boundary into two dates', async () => {
    await apply(
      applyDailyEventAcceptance,
      event({ position: 20n, acceptedAt: toCanonicalInstant('2026-03-03T23:59:59.999Z') }),
    );
    await apply(
      applyDailyEventAcceptance,
      event({ position: 21n, acceptedAt: toCanonicalInstant('2026-03-04T00:00:00.000Z') }),
    );
    expect(await dailyRow('2026-03-03')).toEqual({ count: 1n, first: 20n, last: 20n });
    expect(await dailyRow('2026-03-04')).toEqual({ count: 1n, first: 21n, last: 21n });
  });

  it('is idempotent under projection-position replay (a re-presented ≤ position is a no-op)', async () => {
    const d = '2026-03-05';
    await apply(
      applyDailyEventAcceptance,
      event({ position: 30n, acceptedAt: toCanonicalInstant(`${d}T01:00:00.000Z`) }),
    );
    await apply(
      applyDailyEventAcceptance,
      event({ position: 34n, acceptedAt: toCanonicalInstant(`${d}T02:00:00.000Z`) }),
    );
    await apply(
      applyDailyEventAcceptance,
      event({ position: 30n, acceptedAt: toCanonicalInstant(`${d}T03:00:00.000Z`) }),
    );
    await apply(
      applyDailyEventAcceptance,
      event({ position: 34n, acceptedAt: toCanonicalInstant(`${d}T03:00:00.000Z`) }),
    );
    expect(await dailyRow(d)).toEqual({ count: 2n, first: 30n, last: 34n });
  });

  it('rolls back cleanly: a write inside an aborted transaction leaves no row', async () => {
    const d = '2026-03-06';
    await withClient(admin, async (c) => {
      await c.query('BEGIN');
      await applyDailyEventAcceptance(
        c,
        event({ position: 40n, acceptedAt: toCanonicalInstant(`${d}T00:00:00.000Z`) }),
      );
      await c.query('ROLLBACK');
    });
    expect(await dailyRow(d)).toBeNull();
  });
});
