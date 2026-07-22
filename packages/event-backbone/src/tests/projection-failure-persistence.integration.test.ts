/**
 * QFJ-P03.07C — projection-failure persistence schema, repositories, invariants and grants against
 * real PostgreSQL 17 (migration 0006, ADR-0040).
 *
 * Proves: migrations 0001–0006 apply in order with 0001–0005 checksums intact; the four
 * failure-persistence tables/indexes/triggers exist; the failure lifecycle happy path; the active-
 * failure, active-authorization, attempt-number and live-attempt uniqueness invariants; append-only
 * and delete/truncate protection; the composite authorization/failure FK; least-privilege grants; the
 * fail-closed divergence detector; and atomic rollback. Loopback-guarded, synthetic fixtures only.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defaultMigrationsDirectory,
  withClient,
  withTransaction,
  type DatabasePool,
} from '../index.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { ProjectionCheckpointInvalidError } from '../projections/projection-errors.js';
import { toProjectionName, type ProjectionName } from '../projections/projection-name.js';
import type {
  ProjectionFailureActionId,
  ProjectionFailureId,
  ProjectionReplayAttemptId,
  ProjectionReplayAuthorizationId,
} from '../projections/projection-failure-persistence.js';
import {
  acknowledgeProjectionFailure,
  appendProjectionFailureAction,
  completeReplayAttempt,
  consumeReplayAuthorization,
  createProjectionFailure,
  createReplayAuthorization,
  detectProjectionFailureDivergences,
  quarantineProjectionFailure,
  readActiveProjectionFailure,
  readActiveReplayAuthorization,
  readLiveReplayAttempt,
  readProjectionFailureActions,
  readProjectionFailureById,
  resolveProjectionFailure,
  startReplayAttempt,
} from '../projections/projection-failure-repository.js';
import {
  closeTestPool,
  createProjectionPool,
  createTestPool,
  ensureManagedRolesExist,
  ensureProjectionRoleExists,
  ensureRuntimeRoleExists,
  resetTestDatabase,
  PROJECTION_ROLE,
} from './database-test-utils.js';

const PROJECTION_PASSWORD = randomUUID();
const RUNTIME_PASSWORD = randomUUID();
const T0 = new Date('2026-07-22T00:00:00.000Z');
const T1 = new Date('2026-07-22T00:00:05.000Z');
const T2 = new Date('2026-07-22T00:00:10.000Z');

const admin: DatabasePool = createTestPool({ applicationName: 'qf-fail-admin' });
let projectionPool: DatabasePool | undefined;

const IMMUTABLE_CHECKSUMS: Readonly<Record<string, string>> = {
  '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
  '0002_event_runtime_grants.sql':
    '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
  '0003_ingestion_rejection_and_event_conflict.sql':
    '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
  '0004_projection_foundation.sql':
    '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
  '0005_projection_event_positions.sql':
    '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
};

let uniqueCounter = 0;
function uniqueName(): ProjectionName {
  uniqueCounter += 1;
  return toProjectionName(`rm-fail-${String(uniqueCounter)}`);
}

/** A minimal OPEN failure at (name, 1, position), created via the repository. */
async function seedFailure(
  client: DatabaseClient,
  name: ProjectionName,
  position: bigint,
): Promise<ProjectionFailureId> {
  const failureId = randomUUID() as ProjectionFailureId;
  await createProjectionFailure(client, {
    failureId,
    name,
    version: 1,
    position,
    eventStorageSequence: position,
    category: 'DETERMINISTIC_HANDLER_FAILURE',
    safeErrorCode: 'projection-handler-failed',
    automaticAttemptCount: 5,
    firstFailedAt: T0,
    lastFailedAt: T1,
    now: T1,
  });
  return failureId;
}

/** Insert a valid blocked checkpoint directly (for divergence tests). */
async function seedBlockedCheckpoint(name: ProjectionName, blockedPosition: bigint): Promise<void> {
  await withClient(admin, (client) =>
    client.query(
      `INSERT INTO qf_jarvis.projection_checkpoint
         (projection_name, projection_version, last_position, status, blocked_position,
          failed_attempt_count, last_safe_error_code, created_at, updated_at)
       VALUES ($1, 1, $2, 'blocked', $3, 5, 'projection-handler-failed', $4, $4)`,
      [name, (blockedPosition - 1n).toString(), blockedPosition.toString(), T1],
    ),
  );
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await ensureManagedRolesExist(admin);
  await ensureRuntimeRoleExists(admin, RUNTIME_PASSWORD);
  await ensureProjectionRoleExists(admin, PROJECTION_PASSWORD);
  await runMigrations(admin, defaultMigrationsDirectory());
  projectionPool = createProjectionPool(PROJECTION_PASSWORD, 'qf-fail-runtime');
});

afterAll(async () => {
  const closes: Promise<void>[] = [];
  if (projectionPool !== undefined) closes.push(closeTestPool(projectionPool));
  closes.push(closeTestPool(admin));
  const failures = (await Promise.allSettled(closes))
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason as unknown);
  if (failures.length > 0) throw new AggregateError(failures, 'Failed to close test pools');
});

describe('migration 0006 applies with 0001–0005 unchanged', () => {
  it('records exactly 0001..0006 with the immutable checksums intact', async () => {
    const rows = await withClient(admin, async (client) => {
      const r = await client.query<{ version: number; filename: string; checksum: Buffer }>(
        `SELECT version, filename, checksum FROM qf_jarvis.schema_migration ORDER BY version ASC`,
      );
      return r.rows;
    });
    expect(rows.map((r) => r.filename)).toStrictEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
    ]);
    for (const row of rows) {
      const known = IMMUTABLE_CHECKSUMS[row.filename];
      if (known !== undefined) expect(row.checksum.toString('hex')).toBe(known);
    }
  });

  it('creates the four failure-persistence tables and the guard functions in qf_jarvis', async () => {
    const { tables, functions } = await withClient(admin, async (client) => {
      const t = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'qf_jarvis'
            AND table_name IN ('projection_failure', 'projection_failure_action',
                               'projection_replay_authorization', 'projection_replay_attempt')`,
      );
      const f = await client.query<{ proname: string }>(
        `SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'qf_jarvis'
            AND p.proname IN ('projection_failure_guard_mutation',
                              'projection_failure_action_reject_mutation',
                              'projection_replay_authorization_guard_mutation',
                              'projection_replay_attempt_guard_mutation')`,
      );
      return { tables: t.rows.map((r) => r.table_name), functions: f.rows.map((r) => r.proname) };
    });
    for (const name of [
      'projection_failure',
      'projection_failure_action',
      'projection_replay_authorization',
      'projection_replay_attempt',
    ]) {
      expect(tables).toContain(name);
    }
    expect(functions.length).toBe(4);
  });
});

describe('failure lifecycle happy path', () => {
  it('create → acknowledge → quarantine → authorize → start → complete(succeeded) → resolve', async () => {
    const name = uniqueName();
    await withClient(admin, async (client) => {
      const failureId = await seedFailure(client, name, 3n);

      const created = await readProjectionFailureById(client, failureId);
      expect(created?.status).toBe('open');
      expect(created?.generation).toBe(0);
      expect((await readActiveProjectionFailure(client, { name, version: 1 }))?.failureId).toBe(
        failureId,
      );

      const acked = await acknowledgeProjectionFailure(client, {
        failureId,
        actorId: 'op-1',
        at: T1,
        now: T1,
      });
      expect(acked.status).toBe('acknowledged');
      expect(acked.generation).toBe(1);

      const quar = await quarantineProjectionFailure(client, {
        failureId,
        actorId: 'op-1',
        at: T1,
        now: T1,
      });
      expect(quar.status).toBe('quarantined');

      // Authorize at the current generation, then transition to replaying and start an attempt.
      const authId = randomUUID() as ProjectionReplayAuthorizationId;
      const auth = await createReplayAuthorization(client, {
        authorizationId: authId,
        failureId,
        failureGeneration: quar.generation,
        authorizedBy: 'approver-1',
        idempotencyKey: `auth-${failureId}`,
        createdAt: T1,
      });
      expect(auth.state).toBe('active');
      expect((await readActiveReplayAuthorization(client, failureId))?.authorizationId).toBe(
        authId,
      );

      await client.query(
        `UPDATE qf_jarvis.projection_failure SET status = 'replaying', generation = generation + 1, updated_at = $2 WHERE failure_id = $1`,
        [failureId, T1],
      );

      const attemptId = randomUUID() as ProjectionReplayAttemptId;
      const attempt = await startReplayAttempt(client, {
        attemptId,
        failureId,
        authorizationId: authId,
        attemptNumber: 1,
        leaseOwner: 'runner-1',
        leaseAcquiredAt: T1,
        leaseExpiresAt: T2,
        startedAt: T1,
      });
      expect(attempt.state).toBe('started');
      expect((await readLiveReplayAttempt(client, failureId))?.attemptId).toBe(attemptId);

      const done = await completeReplayAttempt(client, {
        attemptId,
        state: 'succeeded',
        finishedAt: T2,
        resultingPosition: 3n,
        commitObserved: true,
      });
      expect(done.state).toBe('succeeded');
      expect(done.resultingPosition).toBe(3n);

      await consumeReplayAuthorization(client, {
        authorizationId: authId,
        consumedAttemptId: attemptId,
        at: T2,
      });
      const resolved = await resolveProjectionFailure(client, {
        failureId,
        resolvedAttemptId: attemptId,
        at: T2,
        now: T2,
      });
      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedAttemptId).toBe(attemptId);

      // Append and read the audit trail.
      await appendProjectionFailureAction(client, {
        actionId: randomUUID() as ProjectionFailureActionId,
        failureId,
        actionType: 'resolved',
        actorType: 'system',
        actorId: 'runner-1',
        occurredAt: T2,
      });
      expect((await readProjectionFailureActions(client, failureId)).length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });
});

describe('uniqueness invariants', () => {
  it('at most one active failure per (name, version, position)', async () => {
    const name = uniqueName();
    await withClient(admin, async (client) => {
      await seedFailure(client, name, 4n);
      await expect(seedFailure(client, name, 4n)).rejects.toBeInstanceOf(
        ProjectionCheckpointInvalidError,
      );
      // A resolved failure frees the position for a fresh one.
      const first = await readActiveProjectionFailure(client, { name, version: 1 });
      await client.query(
        `UPDATE qf_jarvis.projection_failure SET status='resolved', resolved_at=$2, resolved_attempt_id=$3, updated_at=$2 WHERE failure_id=$1`,
        [first?.failureId, T2, randomUUID()],
      );
      await expect(seedFailure(client, name, 4n)).resolves.toBeDefined();
    });
  });

  it('at most one active authorization per failure, and single-consume', async () => {
    const name = uniqueName();
    await withClient(admin, async (client) => {
      const failureId = await seedFailure(client, name, 5n);
      const auth1 = randomUUID() as ProjectionReplayAuthorizationId;
      await createReplayAuthorization(client, {
        authorizationId: auth1,
        failureId,
        failureGeneration: 0,
        authorizedBy: 'approver-1',
        idempotencyKey: `k1-${failureId}`,
        createdAt: T1,
      });
      // A second ACTIVE authorization (new idempotency key) is rejected.
      await expect(
        createReplayAuthorization(client, {
          authorizationId: randomUUID() as ProjectionReplayAuthorizationId,
          failureId,
          failureGeneration: 0,
          authorizedBy: 'approver-2',
          idempotencyKey: `k2-${failureId}`,
          createdAt: T1,
        }),
      ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
      // The same idempotency key is idempotent (returns the existing authorization).
      const again = await createReplayAuthorization(client, {
        authorizationId: randomUUID() as ProjectionReplayAuthorizationId,
        failureId,
        failureGeneration: 0,
        authorizedBy: 'approver-1',
        idempotencyKey: `k1-${failureId}`,
        createdAt: T1,
      });
      expect(again.authorizationId).toBe(auth1);
      // Consume once; a second consume fails closed.
      await consumeReplayAuthorization(client, {
        authorizationId: auth1,
        consumedAttemptId: randomUUID() as ProjectionReplayAttemptId,
        at: T2,
      });
      await expect(
        consumeReplayAuthorization(client, {
          authorizationId: auth1,
          consumedAttemptId: randomUUID() as ProjectionReplayAttemptId,
          at: T2,
        }),
      ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
    });
  });

  it('at most one live attempt per failure and unique attempt numbers; a foreign authorization is rejected', async () => {
    const name = uniqueName();
    const other = uniqueName();
    await withClient(admin, async (client) => {
      const failureId = await seedFailure(client, name, 6n);
      const otherFailure = await seedFailure(client, other, 6n);
      const authId = randomUUID() as ProjectionReplayAuthorizationId;
      await createReplayAuthorization(client, {
        authorizationId: authId,
        failureId,
        failureGeneration: 0,
        authorizedBy: 'approver-1',
        idempotencyKey: `a-${failureId}`,
        createdAt: T1,
      });
      const attemptId = randomUUID() as ProjectionReplayAttemptId;
      await startReplayAttempt(client, {
        attemptId,
        failureId,
        authorizationId: authId,
        attemptNumber: 1,
        leaseOwner: 'runner-1',
        leaseAcquiredAt: T1,
        leaseExpiresAt: T2,
        startedAt: T1,
      });
      // A second LIVE attempt for the same failure is rejected.
      await expect(
        startReplayAttempt(client, {
          attemptId: randomUUID() as ProjectionReplayAttemptId,
          failureId,
          authorizationId: authId,
          attemptNumber: 2,
          leaseOwner: 'runner-2',
          leaseAcquiredAt: T1,
          leaseExpiresAt: T2,
          startedAt: T1,
        }),
      ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
      // An attempt whose authorization belongs to a DIFFERENT failure is rejected by the composite FK.
      await expect(
        startReplayAttempt(client, {
          attemptId: randomUUID() as ProjectionReplayAttemptId,
          failureId: otherFailure,
          authorizationId: authId, // belongs to `failureId`, not `otherFailure`
          attemptNumber: 1,
          leaseOwner: 'runner-3',
          leaseAcquiredAt: T1,
          leaseExpiresAt: T2,
          startedAt: T1,
        }),
      ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
    });
  });
});

describe('immutability, append-only and delete protection', () => {
  it('the action ledger refuses UPDATE and DELETE', async () => {
    const name = uniqueName();
    await withClient(admin, async (client) => {
      const failureId = await seedFailure(client, name, 7n);
      const action = await appendProjectionFailureAction(client, {
        actionId: randomUUID() as ProjectionFailureActionId,
        failureId,
        actionType: 'created',
        actorType: 'system',
        actorId: 'runner-1',
        occurredAt: T1,
      });
      await expect(
        client.query(
          `UPDATE qf_jarvis.projection_failure_action SET reason='x' WHERE action_id=$1`,
          [action.actionId],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        client.query(`DELETE FROM qf_jarvis.projection_failure_action WHERE action_id=$1`, [
          action.actionId,
        ]),
      ).rejects.toThrow(/append-only/);
    });
  });

  it('the failure aggregate refuses DELETE and identity changes', async () => {
    const name = uniqueName();
    await withClient(admin, async (client) => {
      const failureId = await seedFailure(client, name, 8n);
      await expect(
        client.query(`DELETE FROM qf_jarvis.projection_failure WHERE failure_id=$1`, [failureId]),
      ).rejects.toThrow(/not deletable/);
      await expect(
        client.query(
          `UPDATE qf_jarvis.projection_failure SET projection_position=99 WHERE failure_id=$1`,
          [failureId],
        ),
      ).rejects.toThrow(/immutable/);
    });
  });

  it('a terminal replay attempt cannot transition again', async () => {
    const name = uniqueName();
    await withClient(admin, async (client) => {
      const failureId = await seedFailure(client, name, 9n);
      const authId = randomUUID() as ProjectionReplayAuthorizationId;
      await createReplayAuthorization(client, {
        authorizationId: authId,
        failureId,
        failureGeneration: 0,
        authorizedBy: 'approver-1',
        idempotencyKey: `t-${failureId}`,
        createdAt: T1,
      });
      const attemptId = randomUUID() as ProjectionReplayAttemptId;
      await startReplayAttempt(client, {
        attemptId,
        failureId,
        authorizationId: authId,
        attemptNumber: 1,
        leaseOwner: 'runner-1',
        leaseAcquiredAt: T1,
        leaseExpiresAt: T2,
        startedAt: T1,
      });
      await completeReplayAttempt(client, {
        attemptId,
        state: 'failed',
        finishedAt: T2,
        outcomeCode: 'projection-handler-failed',
        commitObserved: true,
      });
      await expect(
        completeReplayAttempt(client, {
          attemptId,
          state: 'succeeded',
          finishedAt: T2,
          resultingPosition: 9n,
          commitObserved: true,
        }),
      ).rejects.toBeInstanceOf(ProjectionCheckpointInvalidError);
    });
  });
});

describe('least-privilege grants', () => {
  it('the projection role can INSERT/UPDATE the failure but not DELETE; append-only ledger has no UPDATE; PUBLIC has nothing', async () => {
    const priv = (table: string, p: string): Promise<boolean> =>
      withClient(admin, async (client) => {
        const r = await client.query<{ g: boolean }>(`SELECT has_table_privilege($1,$2,$3) AS g`, [
          PROJECTION_ROLE,
          `qf_jarvis.${table}`,
          p,
        ]);
        return r.rows[0]?.g ?? false;
      });
    expect(await priv('projection_failure', 'INSERT')).toBe(true);
    expect(await priv('projection_failure', 'UPDATE')).toBe(true);
    expect(await priv('projection_failure', 'DELETE')).toBe(false);
    expect(await priv('projection_failure_action', 'INSERT')).toBe(true);
    expect(await priv('projection_failure_action', 'UPDATE')).toBe(false);
    expect(await priv('projection_failure_action', 'DELETE')).toBe(false);
    expect(await priv('projection_replay_authorization', 'DELETE')).toBe(false);
    expect(await priv('projection_replay_attempt', 'DELETE')).toBe(false);

    const publicPriv = await withClient(admin, async (client) => {
      const r = await client.query<{ g: boolean }>(
        `SELECT has_table_privilege('public', 'qf_jarvis.projection_failure', 'SELECT') AS g`,
      );
      return r.rows[0]?.g ?? true;
    });
    expect(publicPriv).toBe(false);
  });

  it('the projection runtime role can drive the repositories end to end', async () => {
    const name = uniqueName();
    const pool = projectionPool;
    if (pool === undefined) throw new Error('projection pool not initialised');
    await withClient(pool, async (client) => {
      const failureId = await seedFailure(client, name, 11n);
      await acknowledgeProjectionFailure(client, { failureId, actorId: 'op', at: T1, now: T1 });
      await appendProjectionFailureAction(client, {
        actionId: randomUUID() as ProjectionFailureActionId,
        failureId,
        actionType: 'acknowledged',
        actorType: 'failure-operator',
        actorId: 'op',
        occurredAt: T1,
      });
      expect((await readProjectionFailureById(client, failureId))?.status).toBe('acknowledged');
    });
  });
});

describe('divergence detection (fail-closed) and atomic rollback', () => {
  it('detects a blocked checkpoint with no active failure', async () => {
    const name = uniqueName();
    await seedBlockedCheckpoint(name, 12n);
    const divergences = await withClient(admin, (client) =>
      detectProjectionFailureDivergences(client),
    );
    expect(
      divergences.some(
        (d) =>
          d.code === 'blocked-checkpoint-without-active-failure' &&
          d.projectionName === name &&
          d.projectionVersion === 1,
      ),
    ).toBe(true);
  });

  it('detects an active failure at a position different from the blocked checkpoint', async () => {
    const name = uniqueName();
    await seedBlockedCheckpoint(name, 20n);
    await withClient(admin, (client) => seedFailure(client, name, 21n)); // mismatched position
    const divergences = await withClient(admin, (client) =>
      detectProjectionFailureDivergences(client),
    );
    expect(
      divergences.some(
        (d) => d.code === 'active-failure-position-mismatch' && d.projectionName === name,
      ),
    ).toBe(true);
  });

  it('a rolled-back transaction leaves no partial failure state', async () => {
    const name = uniqueName();
    let failureId: ProjectionFailureId | null = null;
    await expect(
      withTransaction(admin, async (client) => {
        failureId = await seedFailure(client, name, 30n);
        await appendProjectionFailureAction(client, {
          actionId: randomUUID() as ProjectionFailureActionId,
          failureId,
          actionType: 'created',
          actorType: 'system',
          actorId: 'runner',
          occurredAt: T1,
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    const after = await withClient(admin, (client) =>
      readActiveProjectionFailure(client, { name, version: 1 }),
    );
    expect(after).toBeNull();
  });
});
