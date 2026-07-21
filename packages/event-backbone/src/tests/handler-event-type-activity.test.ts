/**
 * Stage 3.4.5B — `event-type-activity` real handler, deterministic unit proofs (no database).
 *
 * These prove the handler's contract WITHOUT PostgreSQL: exact identity, that every event is relevant
 * and produces exactly one deterministic, projection-position-guarded upsert with event-only
 * parameters, that its output does not depend on the wall clock / randomness / the environment, that
 * it has no side effect beyond the one borrowed-client query, and that a dependency failure propagates
 * unchanged (the handler never inspects or normalizes a thrown value). The SQL-level counter/position
 * semantics are proven against a real table in `projection-handlers.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  applyEventTypeActivity,
  eventTypeActivityProjection,
  EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
  EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
} from '../projections/handlers/event-type-activity.js';
import { toCanonicalInstant, type ProjectionEvent } from '../projections/projection-definition.js';

interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** A recording client whose `query` captures each call and resolves to an empty result. */
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

/** A client whose `query` rejects with the given value, to prove failure propagation. */
function rejectingClient(rejection: unknown): DatabaseClient {
  return {
    // The rejection is deliberately an arbitrary/hostile value (possibly a non-Error primitive): the
    // point is to prove the handler propagates whatever the driver throws, unchanged and uninspected.
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

describe('event-type-activity — definition identity', () => {
  it('has the exact kebab-case projection name and version 1', () => {
    expect(eventTypeActivityProjection.name).toBe('event-type-activity');
    expect(eventTypeActivityProjection.version).toBe(1);
    expect(EVENT_TYPE_ACTIVITY_PROJECTION_NAME).toBe('event-type-activity');
    expect(EVENT_TYPE_ACTIVITY_PROJECTION_VERSION).toBe(1);
    expect(typeof eventTypeActivityProjection.apply).toBe('function');
  });

  it('is frozen (an immutable definition)', () => {
    expect(Object.isFrozen(eventTypeActivityProjection)).toBe(true);
  });
});

describe('event-type-activity — one deterministic guarded upsert', () => {
  it('issues exactly one query, with the position-guarded increment upsert', async () => {
    const { client, calls } = recordingClient();
    await applyEventTypeActivity(client, event());

    expect(calls).toHaveLength(1);
    const sql = calls[0]?.sql ?? '';
    expect(sql).toContain('INSERT INTO qf_jarvis.rm_event_type_activity');
    expect(sql).toContain('ON CONFLICT (event_type, event_version) DO UPDATE');
    expect(sql).toContain('event_count         = rm.event_count + 1');
    expect(sql).toContain('WHERE EXCLUDED.last_event_position > rm.last_event_position');
  });

  it('binds only event metadata: [eventType, eventVersion, position-as-decimal-string, acceptedAt]', async () => {
    const { client, calls } = recordingClient();
    await applyEventTypeActivity(
      client,
      event({
        position: 7n,
        eventType: 'qf.quote.issued',
        eventVersion: 3,
        acceptedAt: toCanonicalInstant('2026-07-11T09:00:00.000Z'),
      }),
    );

    expect(calls[0]?.params).toEqual(['qf.quote.issued', 3, '7', '2026-07-11T09:00:00.000Z']);
  });

  it('binds a large position as an exact decimal string (never a lossy JS number)', async () => {
    const { client, calls } = recordingClient();
    const big = 9_007_199_254_740_993n; // Number.MAX_SAFE_INTEGER + 2
    await applyEventTypeActivity(client, event({ position: big }));
    expect(calls[0]?.params[2]).toBe('9007199254740993');
  });

  it('processes every event type — nothing is "irrelevant" to a count-everything projection', async () => {
    for (const eventType of [
      'qf.recommendation.created',
      'qf.quote.issued',
      'qf.privacy.erasure-recorded',
    ]) {
      const { client, calls } = recordingClient();
      await applyEventTypeActivity(client, event({ eventType }));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.params[0]).toBe(eventType);
    }
  });
});

describe('event-type-activity — determinism and purity', () => {
  it('produces identical SQL and params on repeated application of the same event', async () => {
    const e = event({ position: 5n });
    const a = recordingClient();
    const b = recordingClient();
    await applyEventTypeActivity(a.client, e);
    await applyEventTypeActivity(b.client, e);
    expect(a.calls).toEqual(b.calls);
  });

  it('does not read the wall clock, randomness, or the environment', async () => {
    const dateNow = vi.spyOn(Date, 'now');
    const mathRandom = vi.spyOn(Math, 'random');
    process.env['QF_JARVIS_UNIT_TEST_MARKER'] = 'must-not-influence-output';

    const before = recordingClient();
    await applyEventTypeActivity(before.client, event({ position: 9n }));

    process.env['QF_JARVIS_UNIT_TEST_MARKER'] = 'changed';
    const after = recordingClient();
    await applyEventTypeActivity(after.client, event({ position: 9n }));

    delete process.env['QF_JARVIS_UNIT_TEST_MARKER'];
    expect(after.calls).toEqual(before.calls);
    expect(dateNow).not.toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
    dateNow.mockRestore();
    mathRandom.mockRestore();
  });

  it('has no side effect beyond the single borrowed-client query', async () => {
    const { client, calls } = recordingClient();
    await applyEventTypeActivity(client, event());
    expect(calls).toHaveLength(1);
  });
});

describe('event-type-activity — failures propagate unchanged (no second retry authority)', () => {
  it('rejects with the exact thrown value, never inspecting or wrapping it', async () => {
    const hostile = Object.assign(new Error('driver detail that must not be swallowed'), {
      code: '40P01',
      cause: { secret: true },
    });
    await expect(applyEventTypeActivity(rejectingClient(hostile), event())).rejects.toBe(hostile);
  });

  it('propagates a thrown primitive unchanged', async () => {
    await expect(applyEventTypeActivity(rejectingClient('boom'), event())).rejects.toBe('boom');
  });
});
