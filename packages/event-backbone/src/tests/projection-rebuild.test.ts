/**
 * QFJ-P03.08 — unit proofs for the bounded rebuild driver (ADR-0043 §B/§E), against a scripted fake
 * client (no database).
 *
 * These pin the driver's contract: ascending contiguous traversal by POSITION (never sequence), the
 * once-captured horizon, `horizon = 0n` as a no-op, exactly-once handler invocation per position,
 * gap/read/handler failures aborting fail-closed with a bounded code, and hostile thrown values never
 * escaping. Isolation from the live checkpoint/attempt/failure tables is proven separately against real
 * PostgreSQL, because the driver here is given a client it may only read the position map / event with
 * and hand to the reducer — it issues no checkpoint/attempt/failure SQL of its own.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  defineProjection,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projections/projection-definition.js';
import { ProjectionRebuildError } from '../projections/projection-rebuild-errors.js';
import { captureRebuildHorizon, rebuildProjection } from '../projections/projection-rebuild.js';

/** A metadata-only event row as the reader's SELECT returns it (position + event metadata). */
interface RawEventRow {
  readonly position: string;
  readonly event_type: string;
  readonly event_version: number;
  readonly accepted_at: Date;
}

function eventRow(position: number): RawEventRow {
  return {
    position: String(position),
    event_type: 'qf.recommendation.created',
    event_version: 2,
    accepted_at: new Date(Date.UTC(2026, 6, 19, 0, 0, 0, 0)),
  };
}

/**
 * A fake client that answers exactly two query shapes: the horizon `MAX(position)` read and the
 * reader's position lookup. Positions present in `events` resolve to a metadata row; absent positions
 * resolve to no row (a gap). A `readThrowsAt` position makes the reader query reject (infrastructure
 * failure). Nothing else is answered.
 */
function fakeClient(options: {
  horizon?: string | null;
  events: ReadonlyMap<number, RawEventRow>;
  readThrowsAt?: number;
}): DatabaseClient {
  const query = (sql: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }> => {
    if (sql.includes('MAX(position)')) {
      return Promise.resolve({ rows: [{ horizon: options.horizon ?? '0' }] });
    }
    if (sql.includes('projection_event_position AS m')) {
      const position = Number(params?.[0]);
      if (options.readThrowsAt === position) {
        return Promise.reject(new Error('scripted infrastructure failure'));
      }
      const row = options.events.get(position);
      return Promise.resolve({ rows: row === undefined ? [] : [row] });
    }
    throw new Error(`unexpected SQL in fake client: ${sql}`);
  };
  return { query } as unknown as DatabaseClient;
}

function eventsUpTo(count: number): ReadonlyMap<number, RawEventRow> {
  const map = new Map<number, RawEventRow>();
  for (let position = 1; position <= count; position += 1) {
    map.set(position, eventRow(position));
  }
  return map;
}

/** A definition whose apply records every event it sees. */
function recordingDefinition(seen: ProjectionEvent[]): ProjectionDefinition {
  return defineProjection({
    name: 'unit-rebuild-probe',
    version: 1,
    apply: (_client: DatabaseClient, event: ProjectionEvent): Promise<void> => {
      seen.push(event);
      return Promise.resolve();
    },
  });
}

describe('captureRebuildHorizon', () => {
  it('captures MAX(position) as a bigint', async () => {
    const client = fakeClient({ horizon: '7', events: new Map() });
    expect(await captureRebuildHorizon(client)).toBe(7n);
  });

  it('returns 0n when no event has been ingested', async () => {
    const client = fakeClient({ horizon: '0', events: new Map() });
    expect(await captureRebuildHorizon(client)).toBe(0n);
  });
});

describe('rebuildProjection — traversal', () => {
  it('applies every position in ascending order, exactly once each', async () => {
    const seen: ProjectionEvent[] = [];
    const definition = recordingDefinition(seen);
    const client = fakeClient({ events: eventsUpTo(3) });

    const result = await rebuildProjection({ client, definition, horizon: 3n });

    expect(result.appliedPositions).toBe(3n);
    expect(result.horizon).toBe(3n);
    expect(seen.map((event) => event.position)).toEqual([1n, 2n, 3n]);
    // The handler sees the projection POSITION, never a raw storage sequence field.
    const first = seen[0];
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {})).toEqual([
      'position',
      'eventType',
      'eventVersion',
      'acceptedAt',
    ]);
  });

  it('treats horizon 0n as a successful no-op', async () => {
    const apply = vi.fn(() => Promise.resolve());
    const definition = defineProjection({ name: 'unit-rebuild-probe', version: 1, apply });
    const client = fakeClient({ events: new Map() });

    const result = await rebuildProjection({ client, definition, horizon: 0n });

    expect(result.appliedPositions).toBe(0n);
    expect(apply).not.toHaveBeenCalled();
  });

  it('excludes positions beyond the captured horizon', async () => {
    const seen: ProjectionEvent[] = [];
    const definition = recordingDefinition(seen);
    // Five events exist, but the horizon was captured at 2: only 1 and 2 are applied.
    const client = fakeClient({ events: eventsUpTo(5) });

    const result = await rebuildProjection({ client, definition, horizon: 2n });

    expect(result.appliedPositions).toBe(2n);
    expect(seen.map((event) => event.position)).toEqual([1n, 2n]);
  });
});

describe('rebuildProjection — fail-closed aborts', () => {
  it('aborts on a missing position within the horizon (gap)', async () => {
    const definition = recordingDefinition([]);
    // Position 2 is missing while the horizon is 3 — a gap.
    const events = new Map([
      [1, eventRow(1)],
      [3, eventRow(3)],
    ]);
    const client = fakeClient({ events });

    await expect(rebuildProjection({ client, definition, horizon: 3n })).rejects.toMatchObject({
      code: 'projection-rebuild-position-missing',
    });
  });

  it('aborts with a read-failed code on an infrastructure read error', async () => {
    const definition = recordingDefinition([]);
    const client = fakeClient({ events: eventsUpTo(3), readThrowsAt: 2 });

    await expect(rebuildProjection({ client, definition, horizon: 3n })).rejects.toMatchObject({
      code: 'projection-rebuild-read-failed',
    });
  });

  it('aborts with a handler-failed code, and never lets the reducer error escape', async () => {
    const secret = 'SENSITIVE-REDUCER-DETAIL-should-not-leak';
    const definition = defineProjection({
      name: 'unit-rebuild-probe',
      version: 1,
      apply: () => Promise.reject(new Error(secret)),
    });
    const client = fakeClient({ events: eventsUpTo(1) });

    let raised: unknown;
    try {
      await rebuildProjection({ client, definition, horizon: 1n });
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ProjectionRebuildError);
    expect((raised as ProjectionRebuildError).code).toBe('projection-rebuild-handler-failed');
    // No raw reducer text on message, and no cause carrying it.
    expect((raised as ProjectionRebuildError).message).not.toContain(secret);
    expect((raised as { cause?: unknown }).cause).toBeUndefined();
  });

  it('aborts with an invalid-request code on a malformed request', async () => {
    const client = fakeClient({ events: new Map() });
    await expect(
      rebuildProjection({
        client,
        definition: { name: '', version: 0, apply: 'nope' } as unknown as ProjectionDefinition,
        horizon: -1n,
      }),
    ).rejects.toMatchObject({ code: 'projection-rebuild-invalid-request' });
  });
});
