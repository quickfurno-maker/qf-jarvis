/**
 * Stage 3.4.5B — `daily-event-acceptance` real handler, deterministic unit proofs (no database).
 *
 * Proves exact identity, pure UTC-date derivation (including the midnight/date boundary), a single
 * deterministic position-guarded upsert with event-only parameters, independence from wall clock /
 * randomness / environment, no extra side effect, and unchanged propagation of a dependency failure.
 * The SQL-level day-grouping/counter semantics are proven against a real table in
 * `projection-handlers.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  applyDailyEventAcceptance,
  dailyEventAcceptanceProjection,
  utcDateOf,
  DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME,
  DAILY_EVENT_ACCEPTANCE_PROJECTION_VERSION,
} from '../projections/handlers/daily-event-acceptance.js';
import { toCanonicalInstant, type ProjectionEvent } from '../projections/projection-definition.js';

interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function recordingClient(): { client: DatabaseClient; calls: RecordedQuery[] } {
  const calls: RecordedQuery[] = [];
  const client = {
    query: (sql: string, params: readonly unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  } as unknown as DatabaseClient;
  return { client, calls };
}

function rejectingClient(rejection: unknown): DatabaseClient {
  return {
    // Deliberately an arbitrary/hostile value (possibly a non-Error): proves the handler propagates
    // whatever the driver throws, unchanged and uninspected.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    query: () => Promise.reject(rejection),
  } as unknown as DatabaseClient;
}

function event(overrides: Partial<ProjectionEvent> = {}): ProjectionEvent {
  return Object.freeze({
    position: 1n,
    eventType: 'qf.recommendation.created',
    eventVersion: 2,
    acceptedAt: toCanonicalInstant('2026-07-11T09:00:00.000Z'),
    ...overrides,
  });
}

describe('daily-event-acceptance — definition identity', () => {
  it('has the exact kebab-case projection name and version 1', () => {
    expect(dailyEventAcceptanceProjection.name).toBe('daily-event-acceptance');
    expect(dailyEventAcceptanceProjection.version).toBe(1);
    expect(DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME).toBe('daily-event-acceptance');
    expect(DAILY_EVENT_ACCEPTANCE_PROJECTION_VERSION).toBe(1);
  });

  it('is frozen (an immutable definition)', () => {
    expect(Object.isFrozen(dailyEventAcceptanceProjection)).toBe(true);
  });
});

describe('daily-event-acceptance — pure UTC date derivation', () => {
  it('derives the UTC calendar date from the first ten characters of the canonical instant', () => {
    expect(utcDateOf('2026-07-11T09:00:00.000Z')).toBe('2026-07-11');
    expect(utcDateOf('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
    expect(utcDateOf('2026-12-31T23:59:59.999Z')).toBe('2026-12-31');
  });

  it('is stable across the UTC midnight boundary (never a local timezone)', () => {
    // 23:59:59.999Z and the next 00:00:00.000Z fall on adjacent UTC dates, deterministically.
    expect(utcDateOf('2026-07-11T23:59:59.999Z')).toBe('2026-07-11');
    expect(utcDateOf('2026-07-12T00:00:00.000Z')).toBe('2026-07-12');
  });
});

describe('daily-event-acceptance — one deterministic guarded upsert', () => {
  it('issues exactly one query, with the position-guarded increment upsert keyed by accepted_date', async () => {
    const { client, calls } = recordingClient();
    await applyDailyEventAcceptance(client, event());

    expect(calls).toHaveLength(1);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('INSERT INTO qf_jarvis.rm_daily_event_acceptance');
    expect(sql).toContain('ON CONFLICT (accepted_date) DO UPDATE');
    expect(sql).toContain('event_count         = rm.event_count + 1');
    expect(sql).toContain('WHERE EXCLUDED.last_event_position > rm.last_event_position');
  });

  it('binds only [utc-date, position-as-decimal-string]', async () => {
    const { client, calls } = recordingClient();
    await applyDailyEventAcceptance(
      client,
      event({ position: 42n, acceptedAt: toCanonicalInstant('2026-07-11T23:30:00.000Z') }),
    );
    expect(calls[0]?.params).toEqual(['2026-07-11', '42']);
  });

  it('two instants on the same UTC day bind the same accepted_date', async () => {
    const a = recordingClient();
    const b = recordingClient();
    await applyDailyEventAcceptance(
      a.client,
      event({ position: 1n, acceptedAt: toCanonicalInstant('2026-07-11T00:00:00.000Z') }),
    );
    await applyDailyEventAcceptance(
      b.client,
      event({ position: 2n, acceptedAt: toCanonicalInstant('2026-07-11T23:59:59.999Z') }),
    );
    expect(a.calls[0]?.params[0]).toBe('2026-07-11');
    expect(b.calls[0]?.params[0]).toBe('2026-07-11');
  });

  it('binds a large position as an exact decimal string', async () => {
    const { client, calls } = recordingClient();
    await applyDailyEventAcceptance(client, event({ position: 9_007_199_254_740_993n }));
    expect(calls[0]?.params[1]).toBe('9007199254740993');
  });
});

describe('daily-event-acceptance — determinism and purity', () => {
  it('produces identical SQL and params on repeated application of the same event', async () => {
    const e = event({ position: 5n });
    const a = recordingClient();
    const b = recordingClient();
    await applyDailyEventAcceptance(a.client, e);
    await applyDailyEventAcceptance(b.client, e);
    expect(a.calls).toEqual(b.calls);
  });

  it('does not read the wall clock, randomness, or the environment', async () => {
    const dateNow = vi.spyOn(Date, 'now');
    const mathRandom = vi.spyOn(Math, 'random');
    process.env['QF_JARVIS_UNIT_TEST_MARKER'] = 'must-not-influence-output';

    const before = recordingClient();
    await applyDailyEventAcceptance(before.client, event({ position: 9n }));

    process.env['QF_JARVIS_UNIT_TEST_MARKER'] = 'changed';
    const after = recordingClient();
    await applyDailyEventAcceptance(after.client, event({ position: 9n }));

    delete process.env['QF_JARVIS_UNIT_TEST_MARKER'];
    expect(after.calls).toEqual(before.calls);
    expect(dateNow).not.toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
    dateNow.mockRestore();
    mathRandom.mockRestore();
  });
});

describe('daily-event-acceptance — failures propagate unchanged', () => {
  it('rejects with the exact thrown value, never inspecting or wrapping it', async () => {
    const hostile = Object.assign(new Error('driver detail'), { code: '53300' });
    await expect(applyDailyEventAcceptance(rejectingClient(hostile), event())).rejects.toBe(
      hostile,
    );
  });

  it('propagates a thrown primitive unchanged', async () => {
    await expect(applyDailyEventAcceptance(rejectingClient(42), event())).rejects.toBe(42);
  });
});
