import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  applyCorrelationTimeline,
  correlationTimelineProjection,
} from '../projections/handlers/correlation-timeline.js';
import { toCanonicalInstant, type ProjectionEvent } from '../projections/projection-definition.js';

interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function recordingClient(correlationId: string): {
  readonly client: DatabaseClient;
  readonly calls: RecordedQuery[];
} {
  const calls: RecordedQuery[] = [];
  let queryCount = 0;
  const client = {
    query: (sql: string, params: readonly unknown[]) => {
      calls.push({ sql, params });
      queryCount += 1;
      return Promise.resolve({
        rows: queryCount === 1 ? [{ correlation_id: correlationId }] : [],
        rowCount: queryCount === 1 ? 1 : 0,
      });
    },
  } as unknown as DatabaseClient;
  return { client, calls };
}

function event(overrides: Partial<ProjectionEvent> = {}): ProjectionEvent {
  return Object.freeze({
    position: 11n,
    eventType: 'qf.recommendation.created',
    eventVersion: 1,
    acceptedAt: toCanonicalInstant('2026-09-25T04:00:00.000Z'),
    ...overrides,
  });
}

describe('correlation-timeline projection', () => {
  it('has a stable identity and is frozen', () => {
    expect(correlationTimelineProjection.name).toBe('correlation-timeline');
    expect(correlationTimelineProjection.version).toBe(1);
    expect(Object.isFrozen(correlationTimelineProjection)).toBe(true);
  });

  it('reads only correlation identity then writes only correlation plus immutable metadata', async () => {
    const correlationId = '11111111-2222-4333-8444-555555555555';
    const { client, calls } = recordingClient(correlationId);
    await applyCorrelationTimeline(client, event());

    expect(calls).toHaveLength(2);
    expect(calls[0]?.sql).toContain('SELECT e.correlation_id::text AS correlation_id');
    expect(calls[0]?.params).toEqual(['11']);

    expect(calls[1]?.sql).toContain('INSERT INTO qf_jarvis.rm_correlation_timeline');
    expect(calls[1]?.sql).toContain('ON CONFLICT (correlation_id, event_position) DO NOTHING');
    expect(calls[1]?.params).toEqual([
      correlationId,
      '11',
      'qf.recommendation.created',
      1,
      '2026-09-25T04:00:00.000Z',
    ]);
  });

  it('does not widen ProjectionEvent with subject, payload, event id or causation id', () => {
    const keys = Object.keys(event()).sort();
    expect(keys).toEqual(['acceptedAt', 'eventType', 'eventVersion', 'position']);
  });
});
