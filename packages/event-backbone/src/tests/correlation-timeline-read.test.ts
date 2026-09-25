import { describe, expect, it } from 'vitest';

import type { DatabasePool } from '../persistence/pool.js';
import {
  CORRELATION_TIMELINE_MAX_ITEMS,
  readCorrelationTimeline,
} from '../projections/correlation-timeline-read.js';
import {
  ProjectionInputError,
  ProjectionStoredDataError,
} from '../projections/projection-errors.js';

function poolWithRows(rows: readonly Record<string, unknown>[]): {
  readonly pool: DatabasePool;
  readonly calls: { readonly sql: string; readonly params: readonly unknown[] }[];
  readonly released: { value: boolean };
} {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const released = { value: false };
  const client = {
    query: (sql: string, params: readonly unknown[]) => {
      calls.push({ sql, params });
      return Promise.resolve({ rows: [...rows], rowCount: rows.length });
    },
    release: () => {
      released.value = true;
    },
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as DatabasePool;
  return { pool, calls, released };
}

const CORRELATION = '11111111-2222-4333-8444-555555555555';

describe('readCorrelationTimeline', () => {
  it('returns ordered metadata only and releases the borrowed client', async () => {
    const fake = poolWithRows([
      {
        event_position: '4',
        event_type: 'qf.recommendation.created',
        event_version: 1,
        accepted_at: new Date('2026-09-25T04:00:00.000Z'),
      },
      {
        event_position: '7',
        event_type: 'qf.approval.decided',
        event_version: 2,
        accepted_at: new Date('2026-09-25T04:00:01.000Z'),
      },
    ]);

    const result = await readCorrelationTimeline(fake.pool, {
      correlationId: CORRELATION,
      limit: 10,
    });

    expect(result).toEqual({
      correlationId: CORRELATION,
      items: [
        {
          position: '4',
          eventType: 'qf.recommendation.created',
          eventVersion: 1,
          acceptedAt: '2026-09-25T04:00:00.000Z',
        },
        {
          position: '7',
          eventType: 'qf.approval.decided',
          eventVersion: 2,
          acceptedAt: '2026-09-25T04:00:01.000Z',
        },
      ],
      truncated: false,
      readOnly: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(fake.released.value).toBe(true);
    expect(fake.calls[0]?.sql).toContain('qf_jarvis.rm_correlation_timeline');
    expect(fake.calls[0]?.sql).not.toContain('payload');
    expect(fake.calls[0]?.sql).not.toContain('subject');
    expect(fake.calls[0]?.params).toEqual([CORRELATION, 11]);
  });

  it('uses one look-ahead row for bounded truncation', async () => {
    const fake = poolWithRows([
      {
        event_position: '1',
        event_type: 'qf.event.one',
        event_version: 1,
        accepted_at: new Date('2026-09-25T04:00:00.000Z'),
      },
      {
        event_position: '2',
        event_type: 'qf.event.two',
        event_version: 1,
        accepted_at: new Date('2026-09-25T04:00:01.000Z'),
      },
    ]);

    const result = await readCorrelationTimeline(fake.pool, {
      correlationId: CORRELATION,
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(fake.calls[0]?.params).toEqual([CORRELATION, 2]);
  });

  it('rejects invalid correlation ids and limits before opening a client', async () => {
    const fake = poolWithRows([]);
    await expect(
      readCorrelationTimeline(fake.pool, { correlationId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
    await expect(
      readCorrelationTimeline(fake.pool, {
        correlationId: CORRELATION,
        limit: CORRELATION_TIMELINE_MAX_ITEMS + 1,
      }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
    expect(fake.calls).toHaveLength(0);
  });

  it('fails closed on malformed stored rows and still releases the client', async () => {
    const fake = poolWithRows([
      {
        event_position: '1',
        event_type: 'INVALID TYPE',
        event_version: 1,
        accepted_at: new Date('2026-09-25T04:00:00.000Z'),
      },
    ]);
    await expect(
      readCorrelationTimeline(fake.pool, { correlationId: CORRELATION }),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
    expect(fake.released.value).toBe(true);
  });
});
