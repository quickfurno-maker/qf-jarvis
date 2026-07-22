/**
 * QFJ-P03.07E — the failure inspection/quarantine operations boundary, DB-free (unit).
 *
 * A programmable fake pool/client records every SQL and returns programmed rows, so these tests prove
 * the operations service's authorization, bounded pagination, cursor/filter validation, bounded
 * inspection model, deterministic idempotency, generation guarding, divergence gate, and the fact that
 * NO checkpoint write / resolve / replay call ever leaves the service — all without a database. The full
 * transactional/concurrency/append-only behaviour is proven against real PostgreSQL in
 * `projection-failure-operations.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import type { ProjectionFailureId } from '../projections/projection-failure-persistence.js';
import {
  acknowledgeProjectionFailureOperation,
  inspectProjectionFailure,
  inspectProjectionFailureHistory,
  listProjectionFailuresForInspection,
  quarantineProjectionFailureOperation,
  ProjectionFailureOperationError,
  type ProjectionFailureAuthorizer,
  type ProjectionFailureOperationContext,
} from '../projections/projection-failure-operations.js';

const FAILURE_ID = 'a1b2c3d4-0000-4000-8000-000000000001' as ProjectionFailureId;
const CORRELATION = 'b1b2c3d4-0000-4000-8000-000000000002';
const NOW = new Date('2026-07-22T00:00:00.000Z');

const CONTEXT: ProjectionFailureOperationContext = {
  actorType: 'failure-operator',
  actorId: 'op-1',
  correlationId: CORRELATION,
};

const ALLOW: ProjectionFailureAuthorizer = { authorize: () => true };
const DENY: ProjectionFailureAuthorizer = { authorize: () => false };

interface Programmed {
  failure?: Record<string, unknown> | null;
  divergences?: Record<string, unknown>[];
  checkpoint?: Record<string, unknown> | null;
  attempts?: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
  existingAction?: Record<string, unknown> | null;
  listRows?: Record<string, unknown>[];
}

function rawFailure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    failure_id: FAILURE_ID,
    projection_name: 'event-type-activity',
    projection_version: 1,
    projection_position: '1',
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
    ...overrides,
  };
}

function rawAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sequence: '1',
    action_id: 'c1b2c3d4-0000-4000-8000-000000000003',
    failure_id: FAILURE_ID,
    action_type: 'created',
    actor_type: 'system',
    actor_id: 'projection-runner',
    reason: null,
    idempotency_key: null,
    expected_generation: null,
    resulting_generation: 0,
    occurred_at: NOW,
    recorded_at: NOW,
    ...overrides,
  };
}

function rawCheckpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projection_name: 'event-type-activity',
    projection_version: 1,
    last_position: '0',
    status: 'blocked',
    blocked_position: '1',
    failed_attempt_count: 5,
    last_safe_error_code: 'projection-handler-failed',
    next_attempt_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function rawAttempt(n: number): Record<string, unknown> {
  return {
    sequence: String(n),
    attempt_number: n,
    outcome: 'failed',
    safe_error_code: 'projection-handler-failed',
    started_at: NOW,
    completed_at: NOW,
    recorded_at: NOW,
  };
}

interface FakeResult {
  client: DatabasePool;
  calls: string[];
}

/** A fake pool whose single client answers each SQL from the programmed state and records every call. */
function fakePool(programmed: Programmed): FakeResult {
  const calls: string[] = [];
  const respond = (sql: string, params: readonly unknown[]): { rows: unknown[] } => {
    calls.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('blocked-checkpoint-without-active-failure')) {
      return { rows: programmed.divergences ?? [] };
    }
    if (sql.includes('ORDER BY created_at DESC, failure_id DESC')) {
      return { rows: programmed.listRows ?? [] };
    }
    if (sql.includes('WHERE idempotency_key = $1')) {
      const a = programmed.existingAction;
      return { rows: a == null ? [] : [a] };
    }
    if (sql.includes('projection_failure_action') && sql.includes('ORDER BY sequence')) {
      return { rows: programmed.actions ?? [] };
    }
    if (sql.includes('INSERT INTO qf_jarvis.projection_failure_action')) {
      return { rows: [actionFromInsert(params)] };
    }
    if (sql.includes('UPDATE qf_jarvis.projection_failure')) {
      const f = programmed.failure;
      if (f == null) return { rows: [] };
      const toStatus = params[1];
      return { rows: [{ ...f, status: toStatus, generation: (f['generation'] as number) + 1 }] };
    }
    if (sql.includes('FROM qf_jarvis.projection_replay_authorization')) return { rows: [] };
    if (sql.includes('FROM qf_jarvis.projection_replay_attempt')) return { rows: [] };
    if (sql.includes('FROM qf_jarvis.projection_checkpoint')) {
      const c = programmed.checkpoint;
      return { rows: c == null ? [] : [c] };
    }
    if (sql.includes('FROM qf_jarvis.projection_attempt')) {
      return { rows: programmed.attempts ?? [] };
    }
    if (sql.includes('FROM qf_jarvis.projection_failure')) {
      const f = programmed.failure;
      return { rows: f == null ? [] : [f] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const client = {
    query: (text: unknown, params?: unknown) => {
      const sql = typeof text === 'string' ? text : (text as { text: string }).text;
      return Promise.resolve(respond(sql, (params as readonly unknown[] | undefined) ?? []));
    },
    release: () => undefined,
  } as unknown as DatabaseClient;
  const pool = { connect: () => Promise.resolve(client) } as unknown as DatabasePool;
  return { client: pool, calls };
}

function actionFromInsert(params: readonly unknown[]): Record<string, unknown> {
  return {
    sequence: '2',
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

/** A pool that fails if connected — proves an operation rejected BEFORE touching the database. */
const NEVER_CONNECT = {
  connect: () => Promise.reject(new Error('must not connect')),
} as unknown as DatabasePool;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '<no-throw>';
  } catch (error) {
    return error instanceof ProjectionFailureOperationError ? error.code : `<${String(error)}>`;
  }
}

// --- Authorization ---------------------------------------------------------------------------------

describe('authorization is required and denies before any write', () => {
  it('list denies without connecting to the database', async () => {
    expect(await codeOf(listProjectionFailuresForInspection(NEVER_CONNECT, DENY, CONTEXT))).toBe(
      'authorization-denied',
    );
  });

  it('acknowledge denies and performs no write', async () => {
    const { client, calls } = fakePool({ failure: rawFailure() });
    expect(
      await codeOf(
        acknowledgeProjectionFailureOperation(client, DENY, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 0,
          now: NOW,
        }),
      ),
    ).toBe('authorization-denied');
    expect(calls.some((c) => c.includes('INSERT') || c.includes('UPDATE qf_jarvis'))).toBe(false);
  });

  it('quarantine denies and performs no write', async () => {
    const { client, calls } = fakePool({ failure: rawFailure() });
    expect(
      await codeOf(
        quarantineProjectionFailureOperation(client, DENY, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 0,
          now: NOW,
        }),
      ),
    ).toBe('authorization-denied');
    expect(calls.some((c) => c.includes('INSERT') || c.includes('UPDATE qf_jarvis'))).toBe(false);
  });
});

// --- Context / input validation --------------------------------------------------------------------

describe('context and input validation fail closed before the database', () => {
  it('invalid actor type', async () => {
    const ctx = { ...CONTEXT, actorType: 'root' as never };
    expect(await codeOf(listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, ctx))).toBe(
      'invalid-actor',
    );
  });
  it('oversized actor id', async () => {
    const ctx = { ...CONTEXT, actorId: 'x'.repeat(200) };
    expect(await codeOf(listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, ctx))).toBe(
      'invalid-actor',
    );
  });
  it('control character in actor id', async () => {
    const ctx = { ...CONTEXT, actorId: `op${String.fromCharCode(7)}x` };
    expect(await codeOf(listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, ctx))).toBe(
      'invalid-actor',
    );
  });
  it('invalid correlation id', async () => {
    const ctx = { ...CONTEXT, correlationId: 'not-a-uuid' };
    expect(await codeOf(listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, ctx))).toBe(
      'invalid-correlation-id',
    );
  });
  it('invalid page size (too large)', async () => {
    expect(
      await codeOf(
        listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, CONTEXT, { pageSize: 5000 }),
      ),
    ).toBe('invalid-page-size');
  });
  it('invalid page size (non-positive)', async () => {
    expect(
      await codeOf(
        listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, CONTEXT, { pageSize: 0 }),
      ),
    ).toBe('invalid-page-size');
  });
  it('malformed cursor', async () => {
    expect(
      await codeOf(
        listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, CONTEXT, {
          cursor: '!!!not base64!!!',
        }),
      ),
    ).toBe('invalid-cursor');
  });
  it('invalid status filter', async () => {
    expect(
      await codeOf(
        listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, CONTEXT, { status: 'exploded' }),
      ),
    ).toBe('invalid-filter');
  });
  it('invalid category filter', async () => {
    expect(
      await codeOf(
        listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, CONTEXT, {
          category: 'MY_CATEGORY',
        }),
      ),
    ).toBe('invalid-filter');
  });
  it('SQL-looking name filter is rejected as an invalid filter', async () => {
    expect(
      await codeOf(
        listProjectionFailuresForInspection(NEVER_CONNECT, ALLOW, CONTEXT, {
          name: "x'; DROP TABLE qf_jarvis.event;--",
        }),
      ),
    ).toBe('invalid-filter');
  });
});

// --- List inspection -------------------------------------------------------------------------------

describe('bounded keyset list inspection', () => {
  it('returns items and a nextCursor when more rows exist', async () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      rawFailure({ failure_id: `a1b2c3d4-0000-4000-8000-00000000000${String(i + 1)}` }),
    );
    const { client } = fakePool({ listRows: rows });
    const page = await listProjectionFailuresForInspection(client, ALLOW, CONTEXT, { pageSize: 2 });
    expect(page.items).toHaveLength(2); // one extra row was fetched to detect "more"
    expect(page.nextCursor).not.toBeNull();
    // The list item exposes only bounded fields — never a payload/message/stack key.
    const keys = Object.keys(page.items[0] ?? {});
    expect(keys).not.toContain('payload');
    expect(keys).not.toContain('detailDigest');
  });

  it('returns a null nextCursor on the last page', async () => {
    const { client } = fakePool({ listRows: [rawFailure()] });
    const page = await listProjectionFailuresForInspection(client, ALLOW, CONTEXT, {
      pageSize: 10,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});

// --- Detail inspection -----------------------------------------------------------------------------

describe('failure detail inspection', () => {
  it('returns a bounded model with checkpoint and attempt correlation and no sensitive fields', async () => {
    const { client } = fakePool({
      failure: rawFailure(),
      divergences: [],
      checkpoint: rawCheckpoint(),
      attempts: [rawAttempt(1), rawAttempt(2), rawAttempt(3), rawAttempt(4), rawAttempt(5)],
      actions: [rawAction()],
    });
    const detail = await inspectProjectionFailure(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
    });
    expect(detail.status).toBe('open');
    expect(detail.checkpoint.status).toBe('blocked');
    expect(detail.checkpoint.blockedPosition).toBe(1n);
    expect(detail.finalAttempt.attemptCount).toBe(5);
    expect(detail.finalAttempt.finalAttemptNumber).toBe(5);
    expect(detail.divergences).toEqual([]);
    expect(detail.actionCount).toBe(1);
    const keys = Object.keys(detail);
    for (const forbidden of ['payload', 'message', 'stack', 'sql', 'secret', 'eventId']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('fails closed with failure-not-found for a missing failure', async () => {
    const { client } = fakePool({ failure: null });
    expect(
      await codeOf(inspectProjectionFailure(client, ALLOW, CONTEXT, { failureId: FAILURE_ID })),
    ).toBe('failure-not-found');
  });

  it('fails closed with divergence-detected when an active failure diverges', async () => {
    const { client } = fakePool({
      failure: rawFailure(),
      divergences: [
        {
          code: 'active-failure-position-mismatch',
          projection_name: 'event-type-activity',
          projection_version: 1,
          failure_id: FAILURE_ID,
        },
      ],
    });
    expect(
      await codeOf(inspectProjectionFailure(client, ALLOW, CONTEXT, { failureId: FAILURE_ID })),
    ).toBe('divergence-detected');
  });
});

describe('action-history inspection', () => {
  it('returns the bounded history for the failure', async () => {
    const { client } = fakePool({
      failure: rawFailure(),
      actions: [
        rawAction(),
        rawAction({ action_type: 'acknowledged', actor_type: 'failure-operator' }),
      ],
    });
    const history = await inspectProjectionFailureHistory(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
    });
    expect(history).toHaveLength(2);
    expect(Object.keys(history[0] ?? {})).not.toContain('idempotencyKey');
  });

  it('fails closed when the failure is missing', async () => {
    const { client } = fakePool({ failure: null });
    expect(
      await codeOf(
        inspectProjectionFailureHistory(client, ALLOW, CONTEXT, { failureId: FAILURE_ID }),
      ),
    ).toBe('failure-not-found');
  });
});

// --- Acknowledge -----------------------------------------------------------------------------------

describe('acknowledge operation', () => {
  it('transitions open→acknowledged, appends one acknowledged action, and writes no checkpoint', async () => {
    const { client, calls } = fakePool({ failure: rawFailure({ status: 'open', generation: 0 }) });
    const result = await acknowledgeProjectionFailureOperation(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
      expectedGeneration: 0,
      reason: 'reviewed',
      now: NOW,
    });
    expect(result.status).toBe('acknowledged');
    expect(result.generation).toBe(1);
    expect(result.actionType).toBe('acknowledged');
    expect(result.idempotent).toBe(false);
    // Exactly one action insert; the transition UPDATE targets projection_failure; NEVER the checkpoint.
    expect(
      calls.filter((c) => c.includes('INSERT INTO qf_jarvis.projection_failure_action')),
    ).toHaveLength(1);
    expect(calls.some((c) => c.includes('UPDATE qf_jarvis.projection_checkpoint'))).toBe(false);
    expect(
      calls.some((c) => c.includes('projection_replay_authorization') && c.includes('INSERT')),
    ).toBe(false);
    // The action carries the deterministic idempotency key.
    const insert = calls.find((c) => c.includes('INSERT INTO qf_jarvis.projection_failure_action'));
    expect(insert).toBeDefined();
  });

  it('is idempotent when the exact action already exists (no second write)', async () => {
    const { client, calls } = fakePool({
      failure: rawFailure({ status: 'acknowledged', generation: 1 }),
      existingAction: rawAction({
        action_type: 'acknowledged',
        idempotency_key: `acknowledge-failure:${FAILURE_ID}:g0`,
      }),
    });
    const result = await acknowledgeProjectionFailureOperation(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
      expectedGeneration: 0,
      now: NOW,
    });
    expect(result.idempotent).toBe(true);
    expect(calls.some((c) => c.includes('INSERT INTO qf_jarvis.projection_failure_action'))).toBe(
      false,
    );
    expect(calls.some((c) => c.includes('UPDATE qf_jarvis.projection_failure'))).toBe(false);
  });

  it('rejects a stale generation', async () => {
    const { client } = fakePool({ failure: rawFailure({ status: 'open', generation: 3 }) });
    expect(
      await codeOf(
        acknowledgeProjectionFailureOperation(client, ALLOW, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 0,
          now: NOW,
        }),
      ),
    ).toBe('stale-generation');
  });

  it('rejects an already-acknowledged failure under a different key', async () => {
    const { client } = fakePool({
      failure: rawFailure({ status: 'acknowledged', generation: 1 }),
      existingAction: null,
    });
    expect(
      await codeOf(
        acknowledgeProjectionFailureOperation(client, ALLOW, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 1,
          now: NOW,
        }),
      ),
    ).toBe('already-acknowledged');
  });

  it('rejects an invalid source status (quarantined→acknowledge)', async () => {
    const { client } = fakePool({ failure: rawFailure({ status: 'quarantined', generation: 2 }) });
    expect(
      await codeOf(
        acknowledgeProjectionFailureOperation(client, ALLOW, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 2,
          now: NOW,
        }),
      ),
    ).toBe('invalid-transition');
  });

  it('rejects an oversized reason', async () => {
    const { client } = fakePool({ failure: rawFailure() });
    expect(
      await codeOf(
        acknowledgeProjectionFailureOperation(client, ALLOW, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 0,
          reason: 'x'.repeat(1000),
          now: NOW,
        }),
      ),
    ).toBe('invalid-reason');
  });
});

// --- Quarantine ------------------------------------------------------------------------------------

describe('quarantine operation', () => {
  it('transitions open→quarantined and appends one quarantined action', async () => {
    const { client, calls } = fakePool({
      failure: rawFailure({ status: 'open', generation: 0 }),
      divergences: [],
    });
    const result = await quarantineProjectionFailureOperation(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
      expectedGeneration: 0,
      reason: 'isolating',
      now: NOW,
    });
    expect(result.status).toBe('quarantined');
    expect(result.actionType).toBe('quarantined');
    expect(calls.some((c) => c.includes('UPDATE qf_jarvis.projection_checkpoint'))).toBe(false);
  });

  it('transitions acknowledged→quarantined', async () => {
    const { client } = fakePool({
      failure: rawFailure({ status: 'acknowledged', generation: 1 }),
      divergences: [],
    });
    const result = await quarantineProjectionFailureOperation(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
      expectedGeneration: 1,
      now: NOW,
    });
    expect(result.status).toBe('quarantined');
  });

  it('is blocked by a divergence (no transition, no action)', async () => {
    const { client, calls } = fakePool({
      failure: rawFailure({ status: 'open', generation: 0 }),
      divergences: [
        {
          code: 'active-failure-position-mismatch',
          projection_name: 'event-type-activity',
          projection_version: 1,
          failure_id: FAILURE_ID,
        },
      ],
    });
    expect(
      await codeOf(
        quarantineProjectionFailureOperation(client, ALLOW, CONTEXT, {
          failureId: FAILURE_ID,
          expectedGeneration: 0,
          now: NOW,
        }),
      ),
    ).toBe('divergence-detected');
    expect(calls.some((c) => c.includes('INSERT INTO qf_jarvis.projection_failure_action'))).toBe(
      false,
    );
    expect(calls.some((c) => c.includes('UPDATE qf_jarvis.projection_failure'))).toBe(false);
  });

  it('is idempotent when the exact quarantine action already exists', async () => {
    const { client, calls } = fakePool({
      failure: rawFailure({ status: 'quarantined', generation: 1 }),
      existingAction: rawAction({
        action_type: 'quarantined',
        idempotency_key: `quarantine-failure:${FAILURE_ID}:g0`,
      }),
    });
    const result = await quarantineProjectionFailureOperation(client, ALLOW, CONTEXT, {
      failureId: FAILURE_ID,
      expectedGeneration: 0,
      now: NOW,
    });
    expect(result.idempotent).toBe(true);
    expect(calls.some((c) => c.includes('INSERT'))).toBe(false);
  });
});
