/**
 * QFJ-P03.07D — the atomic retry-exhaustion seam, DB-free (unit).
 *
 * Proves the runner-facing establishment and reconciliation compose the QFJ-P03.07C primitives with the
 * exact ADR-0040 vocabularies and a DETERMINISTIC idempotency key, and fail closed on a missing poison
 * event or a divergent active-failure state — all WITHOUT a database, via a fake client that records
 * every query and returns programmed rows. The full transactional/atomic/concurrency behaviour is proven
 * against real PostgreSQL in `projection-retry-exhaustion.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionCheckpointInvalidError } from '../projections/projection-errors.js';
import type { ProjectionName } from '../projections/projection-name.js';
import {
  establishRetryExhaustionFailure,
  reconcileBlockedExhaustion,
  retryExhaustionIdempotencyKey,
} from '../projections/projection-retry-exhaustion.js';

const NAME = 'retry-exhaustion-unit' as ProjectionName;
const NOW = new Date('2026-07-19T00:00:00.000Z');

interface RecordedQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** A programmable fake client: a responder maps each SQL to its rows; every call is recorded. */
function fakeClient(
  responder: (sql: string, params: readonly unknown[]) => { rows: unknown[]; rowCount?: number },
): { client: DatabaseClient; calls: RecordedQuery[] } {
  const calls: RecordedQuery[] = [];
  const client = {
    query: (text: unknown, params?: unknown) => {
      const sql = typeof text === 'string' ? text : (text as { text: string }).text;
      const bound = (params as readonly unknown[] | undefined) ?? [];
      calls.push({ sql, params: bound });
      const { rows, rowCount } = responder(sql, bound);
      return Promise.resolve({ rows, rowCount: rowCount ?? rows.length });
    },
  } as unknown as DatabaseClient;
  return { client, calls };
}

/** A valid RawFailure row echoing the INSERT params (so mapFailure parses it without throwing). */
function failureRowFromInsert(params: readonly unknown[]): Record<string, unknown> {
  return {
    failure_id: params[0],
    projection_name: params[1],
    projection_version: params[2],
    projection_position: String(params[3]),
    event_storage_sequence: String(params[4]),
    event_id: params[5],
    category: params[6],
    safe_error_code: params[7],
    detail_digest: params[8],
    status: 'open',
    generation: 0,
    automatic_attempt_count: params[9],
    replay_attempt_count: 0,
    resolved_attempt_id: null,
    first_failed_at: params[10],
    last_failed_at: params[11],
    created_at: params[12],
    updated_at: params[12],
  };
}

/** A valid RawAction row echoing the INSERT params. */
function actionRowFromInsert(params: readonly unknown[]): Record<string, unknown> {
  return {
    sequence: '1',
    action_id: params[0],
    failure_id: params[1],
    action_type: params[2],
    actor_type: params[3],
    actor_id: params[4],
    reason: params[5],
    idempotency_key: params[6],
    expected_generation: params[7],
    resulting_generation: params[8],
    occurred_at: params[9],
    recorded_at: params[9],
  };
}

/** A responder for the happy establishment path with a poison event at the given storage sequence. */
function establishResponder(storageSequence: string, eventId: string | null) {
  return (sql: string, params: readonly unknown[]) => {
    if (sql.includes('projection_event_position')) {
      return { rows: [{ event_storage_sequence: storageSequence, event_id: eventId }] };
    }
    if (sql.includes('INSERT INTO qf_jarvis.projection_failure_action')) {
      return { rows: [actionRowFromInsert(params)] };
    }
    if (sql.includes('INSERT INTO qf_jarvis.projection_failure')) {
      return { rows: [failureRowFromInsert(params)] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
}

describe('retryExhaustionIdempotencyKey — deterministic, identity-derived', () => {
  it('derives the key ONLY from name, version, and position (stable across calls)', () => {
    const a = retryExhaustionIdempotencyKey(NAME, 1, 7n);
    const b = retryExhaustionIdempotencyKey(NAME, 1, 7n);
    expect(a).toBe(b);
    expect(a).toBe('retry-exhaustion:retry-exhaustion-unit:v1:p7');
  });

  it('differs by version and by position (no collision across distinct blocks)', () => {
    expect(retryExhaustionIdempotencyKey(NAME, 1, 7n)).not.toBe(
      retryExhaustionIdempotencyKey(NAME, 2, 7n),
    );
    expect(retryExhaustionIdempotencyKey(NAME, 1, 7n)).not.toBe(
      retryExhaustionIdempotencyKey(NAME, 1, 8n),
    );
  });

  it('carries no message, stack, or timestamp — only stable repository identity', () => {
    const key = retryExhaustionIdempotencyKey(NAME, 3, 42n);
    expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO date
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe('establishRetryExhaustionFailure — exact ADR-0040 persistence', () => {
  it('creates the failure aggregate with the deterministic category, safe code, and attempt bound', async () => {
    const { client, calls } = fakeClient(
      establishResponder('900', 'a1b2c3d4-0000-4000-8000-000000000001'),
    );
    const result = await establishRetryExhaustionFailure(client, {
      name: NAME,
      version: 1,
      blockedPosition: 7n,
      failedAt: NOW,
      now: NOW,
    });
    expect(typeof result.failureId).toBe('string');

    const failureInsert = calls.find((c) =>
      c.sql.includes('INSERT INTO qf_jarvis.projection_failure\n'),
    );
    expect(failureInsert).toBeDefined();
    const p = failureInsert?.params ?? [];
    expect(p[1]).toBe(NAME); // projection name
    expect(p[2]).toBe(1); // version
    expect(p[3]).toBe('7'); // blocked position
    expect(p[4]).toBe('900'); // event storage sequence (from the poison event)
    expect(p[6]).toBe('DETERMINISTIC_HANDLER_FAILURE'); // category
    expect(p[7]).toBe('projection-handler-failed'); // safe code
    expect(p[9]).toBe(5); // automatic attempt count at the bound
  });

  it('appends a `created` system action with the deterministic idempotency key', async () => {
    const { client, calls } = fakeClient(establishResponder('900', null));
    await establishRetryExhaustionFailure(client, {
      name: NAME,
      version: 1,
      blockedPosition: 7n,
      failedAt: NOW,
      now: NOW,
    });
    const actionInsert = calls.find((c) =>
      c.sql.includes('INSERT INTO qf_jarvis.projection_failure_action'),
    );
    expect(actionInsert).toBeDefined();
    const p = actionInsert?.params ?? [];
    expect(p[2]).toBe('created'); // action type
    expect(p[3]).toBe('system'); // actor type
    expect(p[4]).toBe('projection-runner'); // actor id
    expect(p[6]).toBe('retry-exhaustion:retry-exhaustion-unit:v1:p7'); // idempotency key
    expect(p[8]).toBe(0); // resulting generation of the fresh failure
  });

  it('orders the writes: read storage identity, then failure, then action', async () => {
    const { client, calls } = fakeClient(establishResponder('900', null));
    await establishRetryExhaustionFailure(client, {
      name: NAME,
      version: 1,
      blockedPosition: 7n,
      failedAt: NOW,
      now: NOW,
    });
    const order = calls.map((c) => {
      if (c.sql.includes('projection_event_position')) return 'read-storage';
      if (c.sql.includes('INSERT INTO qf_jarvis.projection_failure_action')) return 'action';
      if (c.sql.includes('INSERT INTO qf_jarvis.projection_failure')) return 'failure';
      return 'other';
    });
    expect(order).toEqual(['read-storage', 'failure', 'action']);
  });

  it('fails closed when no event maps to the blocked position (no failure written)', async () => {
    const { client, calls } = fakeClient((sql) => {
      if (sql.includes('projection_event_position')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    });
    await expect(
      establishRetryExhaustionFailure(client, {
        name: NAME,
        version: 1,
        blockedPosition: 7n,
        failedAt: NOW,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
    // No INSERT was attempted after the missing-event read.
    expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });
});

// --- reconcileBlockedExhaustion --------------------------------------------------------------------

/** A responder returning the given active-failure rows for the reconciliation SELECT. */
function reconcileResponder(rows: { position: string }[]) {
  return (sql: string) => {
    if (sql.includes('status NOT IN')) {
      return {
        rows: rows.map((r) => ({
          failure_id: 'a1b2c3d4-0000-4000-8000-000000000010',
          projection_name: NAME,
          projection_version: 1,
          projection_position: r.position,
          event_storage_sequence: '900',
          event_id: null,
          category: 'DETERMINISTIC_HANDLER_FAILURE',
          safe_error_code: 'projection-handler-failed',
          detail_digest: null,
          status: 'open',
          generation: 0,
          automatic_attempt_count: 5,
          replay_attempt_count: 0,
          resolved_attempt_id: null,
          first_failed_at: NOW,
          last_failed_at: NOW,
          created_at: NOW,
          updated_at: NOW,
        })),
      };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
}

describe('reconcileBlockedExhaustion — fail-closed biconditional (no repair)', () => {
  it('passes when exactly one active failure sits at the blocked position', async () => {
    const { client } = fakeClient(reconcileResponder([{ position: '7' }]));
    await expect(
      reconcileBlockedExhaustion(client, { name: NAME, version: 1, blockedPosition: 7n }),
    ).resolves.toBeUndefined();
  });

  it('fails closed when there is NO active failure (blocked-checkpoint-without-active-failure)', async () => {
    const { client } = fakeClient(reconcileResponder([]));
    await expect(
      reconcileBlockedExhaustion(client, { name: NAME, version: 1, blockedPosition: 7n }),
    ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
  });

  it('fails closed when there is MORE THAN ONE active failure', async () => {
    const { client } = fakeClient(reconcileResponder([{ position: '7' }, { position: '9' }]));
    await expect(
      reconcileBlockedExhaustion(client, { name: NAME, version: 1, blockedPosition: 7n }),
    ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
  });

  it('fails closed when the single active failure is at a DIFFERENT position (mismatch)', async () => {
    const { client } = fakeClient(reconcileResponder([{ position: '8' }]));
    await expect(
      reconcileBlockedExhaustion(client, { name: NAME, version: 1, blockedPosition: 7n }),
    ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
  });
});
