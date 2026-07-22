/**
 * QFJ-P03.07F — authorized projection replay against real PostgreSQL 17 (ADR-0040).
 *
 * Blocks a projection through the runner (QFJ-P03.07D), quarantines it (QFJ-P03.07C transitions), then
 * proves the authorized-replay lifecycle: authorize → execute (claim + lease + handler + atomic success)
 * resumes the checkpoint exactly one position, succeeds the attempt, resolves the failure, consumes the
 * authorization, and writes the read model — after which the normal runner continues. Also proves a
 * deterministic replay failure (checkpoint stays blocked), idempotency, authorization denial, invalid
 * source status, concurrency, and expired-lease takeover.
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
import { deterministicHandlerFailure } from '../projections/projection-failure-taxonomy.js';
import {
  acknowledgeProjectionFailure,
  quarantineProjectionFailure,
} from '../projections/projection-failure-repository.js';
import type { ProjectionFailureId } from '../projections/projection-failure-persistence.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';
import {
  authorizeProjectionFailureReplay,
  executeAuthorizedProjectionReplay,
  takeOverExpiredProjectionReplayLease,
  type ProjectionReplayAuthorizer,
  type ProjectionReplayContext,
} from '../projections/projection-failure-replay.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-p03-07f-admin' });
const APPLIED = 'public._replay_applied';

const now: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
function laterNow(ms: number): CanonicalInstant {
  return toCanonicalInstant(new Date(Date.parse(now) + ms));
}
function laterDate(ms: number): Date {
  return new Date(Date.parse(now) + ms);
}

const ALLOW: ProjectionReplayAuthorizer = { authorize: () => true };
const DENY: ProjectionReplayAuthorizer = { authorize: () => false };
function ctx(
  actorType: ProjectionReplayContext['actorType'] = 'replay-approver',
): ProjectionReplayContext {
  return { actorType, actorId: 'approver-1', correlationId: randomUUID() };
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
  for (let i = 0; i < count; i += 1) await storeValidatedEvent(admin, makeRecord());
}

interface HandlerState {
  mode: 'poison' | 'infra' | 'ok';
}

/** A handler whose behaviour is mutable: deterministic poison, transient infra, or a successful write. */
function makeHandler(name: string, state: HandlerState) {
  return async (client: DatabaseClient, event: { readonly position: bigint }): Promise<void> => {
    if (state.mode === 'poison') {
      await Promise.resolve();
      throw deterministicHandlerFailure('deterministic reducer refusal');
    }
    if (state.mode === 'infra') {
      await Promise.resolve();
      throw Object.assign(new Error('transient infra'), { code: '40P01' });
    }
    await client.query(`INSERT INTO ${APPLIED}(projection, position) VALUES ($1, $2)`, [
      name,
      event.position.toString(),
    ]);
  };
}

function registryOf(name: string, state: HandlerState) {
  return createProjectionRegistry([{ name, version: 1, apply: makeHandler(name, state) }]);
}

/** Block a projection (5 deterministic failures) then move it to QUARANTINED (generation 2). */
async function blockAndQuarantine(
  name: string,
  state: HandlerState,
): Promise<{ failureId: ProjectionFailureId; generation: number }> {
  const registry = registryOf(name, state);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await runProjectionOnce({
      pool: admin,
      registry,
      name,
      version: 1,
      now: laterNow(attempt * 600000),
    });
  }
  const failureId = await withClient(admin, async (c) => {
    const r = await c.query<{ failure_id: string }>(
      `SELECT failure_id FROM qf_jarvis.projection_failure
        WHERE projection_name = $1 AND projection_version = 1 AND status NOT IN ('resolved','superseded','retired')`,
      [name],
    );
    return r.rows[0]?.failure_id as ProjectionFailureId;
  });
  const T = laterDate(6 * 600000);
  await withClient(admin, async (c) => {
    await acknowledgeProjectionFailure(c, { failureId, actorId: 'op', at: T, now: T });
    await quarantineProjectionFailure(c, { failureId, actorId: 'op', at: T, now: T });
  });
  return { failureId, generation: 2 };
}

async function failureStatus(failureId: string): Promise<string | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ status: string }>(
      `SELECT status FROM qf_jarvis.projection_failure WHERE failure_id = $1`,
      [failureId],
    );
    return r.rows[0]?.status ?? null;
  });
}

async function checkpointOf(
  name: string,
): Promise<{ status: string; last: bigint; blocked: bigint | null } | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      status: string;
      last_position: string;
      blocked_position: string | null;
    }>(
      `SELECT status, last_position, blocked_position FROM qf_jarvis.projection_checkpoint
        WHERE projection_name = $1 AND projection_version = 1`,
      [name],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      status: row.status,
      last: BigInt(row.last_position),
      blocked: row.blocked_position === null ? null : BigInt(row.blocked_position),
    };
  });
}

async function appliedCount(name: string): Promise<number> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${APPLIED} WHERE projection = $1`,
      [name],
    );
    return r.rows[0]?.n ?? -1;
  });
}

async function attemptStates(failureId: string): Promise<string[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ state: string }>(
      `SELECT state FROM qf_jarvis.projection_replay_attempt WHERE failure_id = $1 ORDER BY attempt_number`,
      [failureId],
    );
    return r.rows.map((row) => row.state);
  });
}

async function authState(failureId: string): Promise<string | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ state: string }>(
      `SELECT state FROM qf_jarvis.projection_replay_authorization WHERE failure_id = $1`,
      [failureId],
    );
    return r.rows[0]?.state ?? null;
  });
}

async function actionTypes(failureId: string): Promise<string[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ action_type: string }>(
      `SELECT action_type FROM qf_jarvis.projection_failure_action WHERE failure_id = $1 ORDER BY sequence`,
      [failureId],
    );
    return r.rows.map((row) => row.action_type);
  });
}

const EXPIRES = laterDate(10 * 600000);

beforeAll(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
  await withClient(admin, (c) =>
    c.query(
      `CREATE TABLE IF NOT EXISTS ${APPLIED} (projection text NOT NULL, position bigint NOT NULL,
         PRIMARY KEY (projection, position))`,
    ),
  );
});

afterAll(async () => {
  await withClient(admin, (c) => c.query(`DROP TABLE IF EXISTS ${APPLIED}`)).catch(() => undefined);
  await closeTestPool(admin);
});

// ---------------------------------------------------------------------------

describe('authorized replay happy path', () => {
  it('authorize → execute resumes the checkpoint exactly one position and resolves the failure', async () => {
    await seedEvents(1);
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-happy';
    const { failureId, generation } = await blockAndQuarantine(name, state);

    const auth = await authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: generation,
      reason: 'fix deployed',
      expiresAt: EXPIRES,
      now: laterDate(7 * 600000),
    });
    expect(auth.status).toBe('replay-authorized');
    expect(auth.idempotent).toBe(false);
    expect(await failureStatus(failureId)).toBe('replay-authorized');
    expect((await checkpointOf(name))?.status).toBe('blocked'); // authorize leaves it blocked

    // The underlying bug is fixed: the handler now succeeds.
    state.mode = 'ok';
    const result = await executeAuthorizedProjectionReplay(
      admin,
      ALLOW,
      registryOf(name, state),
      ctx(),
      {
        failureId,
        authorizationId: auth.authorizationId,
        leaseOwner: 'runner-1',
        leaseDurationMs: 60_000,
        now: laterDate(8 * 600000),
      },
    );

    expect(result.outcome).toBe('replay-succeeded');
    if (result.outcome === 'replay-succeeded') expect(result.resolvedPosition).toBe(1n);
    expect(await failureStatus(failureId)).toBe('resolved');
    expect(await attemptStates(failureId)).toEqual(['succeeded']);
    expect(await authState(failureId)).toBe('consumed');
    expect(await appliedCount(name)).toBe(1); // the read model was written exactly once

    const cp = await checkpointOf(name);
    expect(cp?.status).toBe('active');
    expect(cp?.last).toBe(1n); // advanced exactly to the poison position
    expect(cp?.blocked).toBeNull();

    expect(await actionTypes(failureId)).toContain('replay-authorized');
    expect(await actionTypes(failureId)).toContain('replay-started');
    expect(await actionTypes(failureId)).toContain('replay-succeeded');
    expect(await actionTypes(failureId)).toContain('resolved');

    // Normal processing resumes from the next position (succeeded if one exists, else caught-up).
    const again = await runProjectionOnce({
      pool: admin,
      registry: registryOf(name, state),
      name,
      version: 1,
      now: laterNow(12 * 600000),
    });
    expect(['succeeded', 'caught-up']).toContain(again.outcome);
  });

  it('a repeated execute after success is idempotent (already-resolved)', async () => {
    await seedEvents(1);
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-idem';
    const { failureId, generation } = await blockAndQuarantine(name, state);
    const auth = await authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: generation,
      expiresAt: EXPIRES,
      now: laterDate(7 * 600000),
    });
    state.mode = 'ok';
    const input = {
      failureId,
      authorizationId: auth.authorizationId,
      leaseOwner: 'runner-1',
      leaseDurationMs: 60_000,
      now: laterDate(8 * 600000),
    };
    const first = await executeAuthorizedProjectionReplay(
      admin,
      ALLOW,
      registryOf(name, state),
      ctx(),
      input,
    );
    const second = await executeAuthorizedProjectionReplay(
      admin,
      ALLOW,
      registryOf(name, state),
      ctx(),
      input,
    );
    expect(first.outcome).toBe('replay-succeeded');
    expect(second.outcome).toBe('already-resolved');
    expect(await appliedCount(name)).toBe(1); // handler applied exactly once
    expect(await attemptStates(failureId)).toEqual(['succeeded']);
  });
});

describe('deterministic replay failure', () => {
  it('leaves the checkpoint blocked, records a failed attempt, and returns the failure to quarantined', async () => {
    await seedEvents(1);
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-fail';
    const { failureId, generation } = await blockAndQuarantine(name, state);
    const auth = await authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: generation,
      expiresAt: EXPIRES,
      now: laterDate(7 * 600000),
    });
    // The bug is NOT fixed — the handler still deterministically refuses.
    const result = await executeAuthorizedProjectionReplay(
      admin,
      ALLOW,
      registryOf(name, state),
      ctx(),
      {
        failureId,
        authorizationId: auth.authorizationId,
        leaseOwner: 'runner-1',
        leaseDurationMs: 60_000,
        now: laterDate(8 * 600000),
      },
    );
    expect(result.outcome).toBe('replay-failed');
    expect(await failureStatus(failureId)).toBe('quarantined'); // back to a controlled state
    expect(await attemptStates(failureId)).toEqual(['failed']);
    expect(await authState(failureId)).toBe('consumed'); // one-shot
    expect(await appliedCount(name)).toBe(0); // no read-model mutation committed
    const cp = await checkpointOf(name);
    expect(cp?.status).toBe('blocked'); // checkpoint never advanced
    expect(cp?.last).toBe(0n);
    expect(await actionTypes(failureId)).toContain('replay-failed');
  });
});

describe('authorization and lifecycle gates', () => {
  it('an unauthorized actor cannot authorize replay (no write)', async () => {
    await seedEvents(1);
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-denied';
    const { failureId, generation } = await blockAndQuarantine(name, state);
    await expect(
      authorizeProjectionFailureReplay(admin, DENY, ctx(), {
        failureId,
        expectedGeneration: generation,
        expiresAt: EXPIRES,
        now: laterDate(7 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'authorization-denied' });
    expect(await failureStatus(failureId)).toBe('quarantined'); // unchanged
    expect(await authState(failureId)).toBeNull(); // no authorization created
  });

  it('authorizing a non-quarantined failure fails closed', async () => {
    await seedEvents(1);
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-openstate';
    const { failureId } = await blockAndQuarantine(name, state);
    // Authorize once (quarantined → replay-authorized), then a second authorize sees replay-authorized.
    await authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 2,
      expiresAt: EXPIRES,
      now: laterDate(7 * 600000),
    });
    await expect(
      authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 3,
        expiresAt: EXPIRES,
        now: laterDate(7 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'invalid-source-status' });
  });
});

describe('concurrency', () => {
  it('two concurrent executors apply the handler once and produce one success', async () => {
    await seedEvents(1);
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-conc';
    const { failureId, generation } = await blockAndQuarantine(name, state);
    const auth = await authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: generation,
      expiresAt: EXPIRES,
      now: laterDate(7 * 600000),
    });
    state.mode = 'ok';
    const mk = (owner: string) =>
      executeAuthorizedProjectionReplay(admin, ALLOW, registryOf(name, state), ctx(), {
        failureId,
        authorizationId: auth.authorizationId,
        leaseOwner: owner,
        leaseDurationMs: 60_000,
        now: laterDate(8 * 600000),
      }).catch((e: unknown) => e);
    const [a, b] = await Promise.all([mk('runner-a'), mk('runner-b')]);
    void a;
    void b;
    // Whatever the interleaving, the read model was applied exactly once and the failure is resolved once.
    expect(await appliedCount(name)).toBe(1);
    expect(await failureStatus(failureId)).toBe('resolved');
    const succeeded = (await attemptStates(failureId)).filter((s) => s === 'succeeded');
    expect(succeeded).toHaveLength(1);
  });
});

describe('expired-lease takeover', () => {
  it('after a transient replay failure leaves a live lease, an expired lease can be taken over and completed', async () => {
    await seedEvents(1);
    // Block with a DETERMINISTIC poison (infra failures record no attempt and never block).
    const state: HandlerState = { mode: 'poison' };
    const name = 'f-takeover';
    const { failureId, generation } = await blockAndQuarantine(name, state);
    const auth = await authorizeProjectionFailureReplay(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: generation,
      expiresAt: EXPIRES,
      now: laterDate(7 * 600000),
    });
    // Now make the replay hit a transient infrastructure failure: it leaves a STARTED attempt + live lease.
    state.mode = 'infra';
    const infra = await executeAuthorizedProjectionReplay(
      admin,
      ALLOW,
      registryOf(name, state),
      ctx(),
      {
        failureId,
        authorizationId: auth.authorizationId,
        leaseOwner: 'runner-1',
        leaseDurationMs: 1_000,
        now: laterDate(8 * 600000),
      },
    ).catch((e: unknown) => (e instanceof Error ? (e as { code?: string }).code : 'x'));
    expect(infra).toBe('infrastructure-failed');
    expect(await attemptStates(failureId)).toEqual(['started']);

    const previousAttemptId = await withClient(admin, async (c) => {
      const r = await c.query<{ attempt_id: string }>(
        `SELECT attempt_id FROM qf_jarvis.projection_replay_attempt WHERE failure_id = $1 AND state = 'started'`,
        [failureId],
      );
      return r.rows[0]?.attempt_id;
    });
    if (previousAttemptId === undefined) throw new Error('expected a started attempt');

    // Takeover before expiry is refused.
    await expect(
      takeOverExpiredProjectionReplayLease(admin, ALLOW, ctx(), {
        failureId,
        authorizationId: auth.authorizationId,
        previousAttemptId: previousAttemptId as never,
        newLeaseOwner: 'runner-2',
        leaseDurationMs: 60_000,
        now: laterDate(8 * 600000),
      }),
    ).rejects.toMatchObject({ code: 'lease-not-expired' });

    // After the lease expires, takeover abandons the old attempt and starts a fresh one.
    const takeover = await takeOverExpiredProjectionReplayLease(
      admin,
      ALLOW,
      ctx('administrator'),
      {
        failureId,
        authorizationId: auth.authorizationId,
        previousAttemptId: previousAttemptId as never,
        newLeaseOwner: 'runner-2',
        leaseDurationMs: 60_000,
        now: laterDate(9 * 600000),
      },
    );
    expect(takeover.idempotent).toBe(false);
    expect(await attemptStates(failureId)).toEqual(['abandoned', 'started']);
    expect(await actionTypes(failureId)).toContain('lease-taken-over');

    // The new owner resumes and, with the fix in place, completes the replay successfully.
    state.mode = 'ok';
    const done = await executeAuthorizedProjectionReplay(
      admin,
      ALLOW,
      registryOf(name, state),
      ctx(),
      {
        failureId,
        authorizationId: auth.authorizationId,
        leaseOwner: 'runner-2',
        leaseDurationMs: 60_000,
        now: laterDate(9 * 600000 + 1000),
      },
    );
    expect(done.outcome).toBe('replay-succeeded');
    expect(await failureStatus(failureId)).toBe('resolved');
    expect(await appliedCount(name)).toBe(1);
    expect((await checkpointOf(name))?.status).toBe('active');
  });
});
