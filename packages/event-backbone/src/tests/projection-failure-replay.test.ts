/**
 * QFJ-P03.07F — the authorized-replay boundary, DB-free (unit).
 *
 * Proves input validation, authorization (including capability separation), and the fail-closed authorize
 * paths (stale generation, wrong source status, divergence gate, active-authorization uniqueness) via a
 * recording fake pool/client — all without a database. The full lease/handler/atomic-success/failure/
 * takeover/reconcile behaviour is proven against real PostgreSQL in
 * `projection-failure-replay.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import type {
  ProjectionFailureId,
  ProjectionReplayAuthorizationId,
} from '../projections/projection-failure-persistence.js';
import {
  authorizeProjectionFailureReplay,
  executeAuthorizedProjectionReplay,
  PROJECTION_REPLAY_CAPABILITIES,
  ProjectionReplayError,
  takeOverExpiredProjectionReplayLease,
  type ProjectionReplayAuthorizer,
  type ProjectionReplayContext,
} from '../projections/projection-failure-replay.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';

const FAILURE_ID = 'a1b2c3d4-0000-4000-8000-000000000001' as ProjectionFailureId;
const AUTH_ID = 'b1b2c3d4-0000-4000-8000-000000000002' as ProjectionReplayAuthorizationId;
const CORRELATION = 'c1b2c3d4-0000-4000-8000-000000000003';
const NOW = new Date('2026-07-22T00:00:00.000Z');
const EXPIRES = new Date('2026-07-22T01:00:00.000Z');

const CONTEXT: ProjectionReplayContext = {
  actorType: 'replay-approver',
  actorId: 'approver-1',
  correlationId: CORRELATION,
};

const ALLOW: ProjectionReplayAuthorizer = { authorize: () => true };
const DENY: ProjectionReplayAuthorizer = { authorize: () => false };

const registry = createProjectionRegistry([
  { name: 'event-type-activity', version: 1, apply: () => Promise.resolve() },
]);

interface Programmed {
  failure?: Record<string, unknown> | null;
  existingAction?: Record<string, unknown> | null;
  divergences?: Record<string, unknown>[];
  checkpoint?: Record<string, unknown> | null;
  activeAuth?: Record<string, unknown> | null;
}

function rawFailure(status: string, generation: number): Record<string, unknown> {
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
    status,
    generation,
    automatic_attempt_count: 5,
    replay_attempt_count: 0,
    resolved_attempt_id: null,
    first_failed_at: NOW,
    last_failed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
  };
}

function rawCheckpoint(): Record<string, unknown> {
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
  };
}

function fakePool(p: Programmed): { pool: DatabasePool; calls: string[] } {
  const calls: string[] = [];
  const respond = (sql: string): { rows: unknown[] } => {
    calls.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('blocked-checkpoint-without-active-failure')) {
      return { rows: p.divergences ?? [] };
    }
    if (sql.includes('WHERE idempotency_key = $1')) {
      return { rows: p.existingAction == null ? [] : [p.existingAction] };
    }
    if (sql.includes('FROM qf_jarvis.projection_replay_authorization')) {
      return { rows: p.activeAuth == null ? [] : [p.activeAuth] };
    }
    if (sql.includes('FROM qf_jarvis.projection_replay_attempt')) return { rows: [] };
    if (sql.includes('FROM qf_jarvis.projection_checkpoint')) {
      return { rows: p.checkpoint == null ? [] : [p.checkpoint] };
    }
    if (sql.includes('FROM qf_jarvis.projection_failure')) {
      return { rows: p.failure == null ? [] : [p.failure] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const client = {
    query: (text: unknown) => {
      const sql = typeof text === 'string' ? text : (text as { text: string }).text;
      return Promise.resolve(respond(sql));
    },
    release: () => undefined,
  } as unknown as DatabaseClient;
  return { pool: { connect: () => Promise.resolve(client) } as unknown as DatabasePool, calls };
}

const NEVER_CONNECT = {
  connect: () => Promise.reject(new Error('must not connect')),
} as unknown as DatabasePool;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '<no-throw>';
  } catch (error) {
    return error instanceof ProjectionReplayError ? error.code : `<${String(error)}>`;
  }
}

const authorizeInput = {
  failureId: FAILURE_ID,
  expectedGeneration: 2,
  expiresAt: EXPIRES,
  now: NOW,
};

describe('replay capabilities', () => {
  it('exposes exactly the three closed replay capabilities', () => {
    expect([...PROJECTION_REPLAY_CAPABILITIES]).toEqual([
      'projection-failure:authorize-replay',
      'projection-failure:execute-replay',
      'projection-failure:take-over-replay',
    ]);
  });
});

describe('input validation fails closed before the database', () => {
  it('invalid actor type', async () => {
    const ctx = { ...CONTEXT, actorType: 'root' as never };
    expect(
      await codeOf(authorizeProjectionFailureReplay(NEVER_CONNECT, ALLOW, ctx, authorizeInput)),
    ).toBe('invalid-actor');
  });
  it('invalid correlation id', async () => {
    const ctx = { ...CONTEXT, correlationId: 'not-a-uuid' };
    expect(
      await codeOf(authorizeProjectionFailureReplay(NEVER_CONNECT, ALLOW, ctx, authorizeInput)),
    ).toBe('invalid-correlation-id');
  });
  it('invalid failure identifier', async () => {
    expect(
      await codeOf(
        authorizeProjectionFailureReplay(NEVER_CONNECT, ALLOW, CONTEXT, {
          ...authorizeInput,
          failureId: 'nope' as ProjectionFailureId,
        }),
      ),
    ).toBe('invalid-identifier');
  });
  it('expiry in the past', async () => {
    expect(
      await codeOf(
        authorizeProjectionFailureReplay(NEVER_CONNECT, ALLOW, CONTEXT, {
          ...authorizeInput,
          expiresAt: new Date('2026-07-21T00:00:00.000Z'),
        }),
      ),
    ).toBe('invalid-expiry');
  });
  it('expiry beyond the maximum bound', async () => {
    expect(
      await codeOf(
        authorizeProjectionFailureReplay(NEVER_CONNECT, ALLOW, CONTEXT, {
          ...authorizeInput,
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ),
    ).toBe('invalid-expiry');
  });
  it('execute rejects an out-of-bounds lease duration', async () => {
    expect(
      await codeOf(
        executeAuthorizedProjectionReplay(NEVER_CONNECT, ALLOW, registry, CONTEXT, {
          failureId: FAILURE_ID,
          authorizationId: AUTH_ID,
          leaseOwner: 'runner-1',
          leaseDurationMs: 1,
          now: NOW,
        }),
      ),
    ).toBe('invalid-lease-duration');
  });
});

describe('authorization is required and denies before any write', () => {
  it('authorize denies and performs no write', async () => {
    const { pool, calls } = fakePool({ failure: rawFailure('quarantined', 2) });
    expect(
      await codeOf(authorizeProjectionFailureReplay(pool, DENY, CONTEXT, authorizeInput)),
    ).toBe('authorization-denied');
    expect(calls.some((c) => c.includes('INSERT') || c.includes('UPDATE qf_jarvis'))).toBe(false);
  });
  it('execute denies and performs no write', async () => {
    const { pool, calls } = fakePool({ failure: rawFailure('replay-authorized', 3) });
    expect(
      await codeOf(
        executeAuthorizedProjectionReplay(pool, DENY, registry, CONTEXT, {
          failureId: FAILURE_ID,
          authorizationId: AUTH_ID,
          leaseOwner: 'runner-1',
          leaseDurationMs: 60_000,
          now: NOW,
        }),
      ),
    ).toBe('authorization-denied');
    expect(calls.some((c) => c.includes('INSERT') || c.includes('UPDATE qf_jarvis'))).toBe(false);
  });
  it('takeover denies and performs no write', async () => {
    const { pool, calls } = fakePool({ failure: rawFailure('replaying', 4) });
    expect(
      await codeOf(
        takeOverExpiredProjectionReplayLease(pool, DENY, CONTEXT, {
          failureId: FAILURE_ID,
          authorizationId: AUTH_ID,
          previousAttemptId: 'd1b2c3d4-0000-4000-8000-000000000004' as never,
          newLeaseOwner: 'runner-2',
          leaseDurationMs: 60_000,
          now: NOW,
        }),
      ),
    ).toBe('authorization-denied');
    expect(calls.some((c) => c.includes('INSERT') || c.includes('UPDATE qf_jarvis'))).toBe(false);
  });
});

describe('authorize fails closed on invalid state', () => {
  it('failure not found', async () => {
    const { pool } = fakePool({ failure: null });
    expect(
      await codeOf(authorizeProjectionFailureReplay(pool, ALLOW, CONTEXT, authorizeInput)),
    ).toBe('failure-not-found');
  });
  it('stale generation', async () => {
    const { pool } = fakePool({ failure: rawFailure('quarantined', 9), existingAction: null });
    expect(
      await codeOf(authorizeProjectionFailureReplay(pool, ALLOW, CONTEXT, authorizeInput)),
    ).toBe('stale-generation');
  });
  it('invalid source status (not quarantined)', async () => {
    const { pool } = fakePool({ failure: rawFailure('open', 2), existingAction: null });
    expect(
      await codeOf(authorizeProjectionFailureReplay(pool, ALLOW, CONTEXT, authorizeInput)),
    ).toBe('invalid-source-status');
  });
  it('divergence blocks authorization', async () => {
    const { pool } = fakePool({
      failure: rawFailure('quarantined', 2),
      existingAction: null,
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
      await codeOf(authorizeProjectionFailureReplay(pool, ALLOW, CONTEXT, authorizeInput)),
    ).toBe('divergence-detected');
  });
  it('an existing active authorization blocks a second authorization', async () => {
    const { pool } = fakePool({
      failure: rawFailure('quarantined', 2),
      existingAction: null,
      divergences: [],
      checkpoint: rawCheckpoint(),
      activeAuth: {
        authorization_id: AUTH_ID,
        failure_id: FAILURE_ID,
        failure_generation: 2,
        state: 'active',
        authorized_by: 'x',
        reason: null,
        idempotency_key: 'k',
        created_at: NOW,
        expires_at: EXPIRES,
        consumed_at: null,
        consumed_attempt_id: null,
      },
    });
    expect(
      await codeOf(authorizeProjectionFailureReplay(pool, ALLOW, CONTEXT, authorizeInput)),
    ).toBe('authorization-already-active');
  });
});
