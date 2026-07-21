/**
 * Stage 3.4.1 — projection foundation schema, repositories and privilege proofs, against real
 * PostgreSQL 17 (migration 0004, ADR-0034).
 *
 * Proves: migrations 0001–0004 apply fresh in order and re-migrate idempotently with 0001–0003
 * unchanged; the checkpoint invariants and repository behaviour; the append-only, payload-free
 * attempt log; the two disposable metadata read models; and the least-privilege grants to
 * qf_jarvis_projection_runtime (with the ingestion role and PUBLIC/managed aliases denied).
 *
 * Loopback-guarded harness. Synthetic fixtures only. No managed database, no live data.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import { runMigrations } from '../persistence/migration-runner.js';
import {
  advanceCheckpointOnSuccess,
  createCheckpointIfAbsent,
  readCheckpoint,
  recordCheckpointBlocked,
  recordCheckpointRetryPending,
} from '../projections/checkpoint-store.js';
import {
  appendFailedAttempt,
  appendSucceededAttempt,
  readAttemptsForEvent,
} from '../projections/attempt-store.js';
import { ProjectionCheckpointInvalidError } from '../projections/projection-errors.js';
import { toProjectionName } from '../projections/projection-name.js';
import {
  closeTestPool,
  createProjectionPool,
  createTestPool,
  ensureManagedRolesExist,
  ensureProjectionRoleExists,
  ensureRuntimeRoleExists,
  MANAGED_ROLES,
  PROJECTION_ROLE,
  resetTestDatabase,
  RUNTIME_ROLE,
} from './database-test-utils.js';

const RUNTIME_PASSWORD = randomUUID();
const PROJECTION_PASSWORD = randomUUID();
const NOW = new Date('2026-07-18T00:00:00.000Z');

const admin: DatabasePool = createTestPool({ applicationName: 'qf-proj-admin' });
// Optional/nullable: it is created only at the END of beforeAll, so if setup fails earlier it stays
// undefined and teardown must NOT throw a secondary undefined-pool error over the real failure.
let projectionPool: DatabasePool | undefined;

/** The projection pool, or a clear error if a test runs before setup created it. */
function requireProjectionPool(): DatabasePool {
  if (projectionPool === undefined) {
    throw new Error('projection pool was not initialised (setup did not complete)');
  }
  return projectionPool;
}

/**
 * Known SHA-256 of each migration: 0001–0003 are the IMMUTABLE values that must never change; 0004
 * is the reviewed Stage 3.4.1 value. Editing 0004 fails this until the reviewed checksum is
 * regenerated.
 */
const KNOWN_CHECKSUMS: Readonly<Record<string, string>> = {
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

async function tablePrivilege(role: string, table: string, priv: string): Promise<boolean> {
  return withClient(admin, async (client) => {
    const r = await client.query<{ g: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS g`, [
      role,
      `qf_jarvis.${table}`,
      priv,
    ]);
    return r.rows[0]?.g ?? false;
  });
}

async function columnPrivilege(
  role: string,
  table: string,
  column: string,
  priv: string,
): Promise<boolean> {
  return withClient(admin, async (client) => {
    const r = await client.query<{ g: boolean }>(
      `SELECT has_column_privilege($1, $2, $3, $4) AS g`,
      [role, `qf_jarvis.${table}`, column, priv],
    );
    return r.rows[0]?.g ?? false;
  });
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await ensureManagedRolesExist(admin);
  await ensureRuntimeRoleExists(admin, RUNTIME_PASSWORD);
  await ensureProjectionRoleExists(admin, PROJECTION_PASSWORD);
  await runMigrations(admin, defaultMigrationsDirectory());
  projectionPool = createProjectionPool(PROJECTION_PASSWORD, 'qf-proj-runtime');
});

afterAll(async () => {
  // Close the projection pool ONLY if it was created, and ALWAYS attempt to close admin — even if
  // closing the projection pool rejects. allSettled runs both closes to completion, so one cleanup
  // failure can never leak the other pool by short-circuiting. Failures are not swallowed: if either
  // close (or both) rejects, they are re-thrown together as an AggregateError.
  const closes: Promise<void>[] = [];
  if (projectionPool !== undefined) {
    closes.push(closeTestPool(projectionPool));
  }
  closes.push(closeTestPool(admin));

  const failures = (await Promise.allSettled(closes))
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason as unknown);

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to close one or more test pools');
  }
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('migrations apply in order, idempotently, with 0001–0005 unchanged', () => {
  it('records exactly 0001..0006 in order with the immutable checksums intact', async () => {
    const rows = await withClient(admin, async (client) => {
      const r = await client.query<{ version: number; filename: string; checksum: Buffer }>(
        `SELECT version, filename, checksum FROM qf_jarvis.schema_migration ORDER BY version ASC`,
      );
      return r.rows;
    });
    expect(rows.map((row) => row.filename)).toStrictEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
    ]);
    expect(rows.map((row) => row.version)).toStrictEqual([1, 2, 3, 4, 5, 6]);
    for (const row of rows) {
      const hex = row.checksum.toString('hex');
      if (KNOWN_CHECKSUMS[row.filename] !== undefined) {
        expect(hex).toBe(KNOWN_CHECKSUMS[row.filename]);
      }
    }
  });

  it('re-migrating is idempotent — still exactly six applied migrations', async () => {
    await runMigrations(admin, defaultMigrationsDirectory());
    const count = await withClient(admin, async (client) => {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM qf_jarvis.schema_migration`,
      );
      return Number.parseInt(r.rows[0]?.n ?? '0', 10);
    });
    expect(count).toBe(6);
  });

  it('records the EXACT reviewed 0004 and 0005 checksums in the migration history', async () => {
    // The runner stores sha256(fileContents); this pins the applied checksum to the reviewed value.
    // If either file is edited, this test fails until the reviewed checksum is regenerated (as required).
    const applied = await withClient(admin, async (client) => {
      const r = await client.query<{ filename: string; checksum: Buffer }>(
        `SELECT filename, checksum FROM qf_jarvis.schema_migration
         WHERE filename IN ('0004_projection_foundation.sql', '0005_projection_event_positions.sql')`,
      );
      return new Map(r.rows.map((row) => [row.filename, row.checksum.toString('hex')]));
    });
    expect(applied.get('0004_projection_foundation.sql')).toBe(
      '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
    );
    expect(applied.get('0005_projection_event_positions.sql')).toBe(
      '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
    );
  });
});

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

describe('projection_checkpoint — create, invariants, repository behaviour', () => {
  it('creates a checkpoint, and a duplicate create adds no second row', async () => {
    const name = toProjectionName('chk-create');
    await withClient(admin, (c) => createCheckpointIfAbsent(c, { name, version: 1, now: NOW }));
    await withClient(admin, (c) => createCheckpointIfAbsent(c, { name, version: 1, now: NOW }));
    const row = await withClient(admin, (c) => readCheckpoint(c, { name, version: 1 }));
    expect(row?.lastPosition).toBe(0n);
    expect(row?.status).toBe('active');
    expect(row?.failedAttemptCount).toBe(0);
    expect(row?.blockedPosition).toBeNull();
    const count = await withClient(admin, async (client) => {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM qf_jarvis.projection_checkpoint
           WHERE projection_name = $1 AND projection_version = 1`,
        [name],
      );
      return Number.parseInt(r.rows[0]?.n ?? '0', 10);
    });
    expect(count).toBe(1);
  });

  it('refuses invalid active/blocked shapes and failure counts at the CHECK layer', async () => {
    const attempts: string[] = [
      // blocked with no blocked_position
      `INSERT INTO qf_jarvis.projection_checkpoint
        (projection_name, projection_version, last_position, status, failed_attempt_count, last_safe_error_code, created_at, updated_at)
       VALUES ('bad-a', 1, 0, 'blocked', 5, 'projection-handler-failed', now(), now())`,
      // active with a blocked_position
      `INSERT INTO qf_jarvis.projection_checkpoint
        (projection_name, projection_version, last_position, status, blocked_position, failed_attempt_count, created_at, updated_at)
       VALUES ('bad-b', 1, 0, 'active', 1, 0, now(), now())`,
      // failed_attempt_count out of range
      `INSERT INTO qf_jarvis.projection_checkpoint
        (projection_name, projection_version, last_position, status, failed_attempt_count, last_safe_error_code, created_at, updated_at)
       VALUES ('bad-c', 1, 0, 'active', 6, 'projection-handler-failed', now(), now())`,
      // active clean but next_attempt_at set
      `INSERT INTO qf_jarvis.projection_checkpoint
        (projection_name, projection_version, last_position, status, failed_attempt_count, next_attempt_at, created_at, updated_at)
       VALUES ('bad-d', 1, 0, 'active', 0, now(), now(), now())`,
      // blocked with next_attempt_at set
      `INSERT INTO qf_jarvis.projection_checkpoint
        (projection_name, projection_version, last_position, status, blocked_position, failed_attempt_count, last_safe_error_code, next_attempt_at, created_at, updated_at)
       VALUES ('bad-e', 1, 0, 'blocked', 1, 5, 'projection-handler-failed', now(), now(), now())`,
      // invalid projection name
      `INSERT INTO qf_jarvis.projection_checkpoint
        (projection_name, projection_version, last_position, status, failed_attempt_count, created_at, updated_at)
       VALUES ('Bad Name', 1, 0, 'active', 0, now(), now())`,
    ];
    for (const sql of attempts) {
      await expect(withClient(admin, (c) => c.query(sql))).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('refuses a DIRECT active/blocked failure-count violation (active with 5, blocked with != 5)', async () => {
    // Blocker 2: the status/count equivalence is enforced at the CHECK layer for INSERT and UPDATE.
    // INSERT active with count 5.
    await expect(
      withClient(admin, (c) =>
        c.query(`INSERT INTO qf_jarvis.projection_checkpoint
          (projection_name, projection_version, last_position, status, failed_attempt_count, last_safe_error_code, created_at, updated_at)
          VALUES ('active-five', 1, 0, 'active', 5, 'projection-handler-failed', now(), now())`),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    // UPDATE an existing valid active checkpoint to active/5.
    const name = toProjectionName('chk-active-five-update');
    await withClient(admin, (c) => createCheckpointIfAbsent(c, { name, version: 1, now: NOW }));
    await expect(
      withClient(admin, (c) =>
        c.query(
          `UPDATE qf_jarvis.projection_checkpoint
             SET failed_attempt_count = 5, last_safe_error_code = 'projection-handler-failed'
           WHERE projection_name = $1 AND projection_version = 1`,
          [name],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('advances ONLY by exactly one sequence (no skip), refusing jumps, regression, re-application, and a blocked advance', async () => {
    const name = toProjectionName('chk-advance');
    await withClient(admin, (c) => createCheckpointIfAbsent(c, { name, version: 1, now: NOW }));
    // 0 -> 1 -> 2 succeed.
    await withClient(admin, (c) =>
      advanceCheckpointOnSuccess(c, { name, version: 1, processedEventPosition: 1n, now: NOW }),
    );
    await withClient(admin, (c) =>
      advanceCheckpointOnSuccess(c, { name, version: 1, processedEventPosition: 2n, now: NOW }),
    );
    expect(
      (await withClient(admin, (c) => readCheckpoint(c, { name, version: 1 })))?.lastPosition,
    ).toBe(2n);
    // A skip (2 -> 4), a re-application (2 -> 2), and a regression (2 -> 1) all refuse.
    for (const seq of [4n, 2n, 1n]) {
      await expect(
        withClient(admin, (c) =>
          advanceCheckpointOnSuccess(c, {
            name,
            version: 1,
            processedEventPosition: seq,
            now: NOW,
          }),
        ),
      ).rejects.toThrow(ProjectionCheckpointInvalidError);
    }

    // A fresh checkpoint refuses 0 -> 2 (a skip from the very start).
    const fresh = toProjectionName('chk-advance-skip');
    await withClient(admin, (c) =>
      createCheckpointIfAbsent(c, { name: fresh, version: 1, now: NOW }),
    );
    await expect(
      withClient(admin, (c) =>
        advanceCheckpointOnSuccess(c, {
          name: fresh,
          version: 1,
          processedEventPosition: 2n,
          now: NOW,
        }),
      ),
    ).rejects.toThrow(ProjectionCheckpointInvalidError);
  });

  it('follows a STRICT failure progression 0->1->2->3->4->blocked, refusing every illegal transition', async () => {
    const name = toProjectionName('chk-progress');
    await withClient(admin, (c) => createCheckpointIfAbsent(c, { name, version: 1, now: NOW }));

    // A premature block from count 0, and a count jump (0 -> 2, 0 -> 4), all refuse.
    await expect(
      withClient(admin, (c) =>
        recordCheckpointBlocked(c, {
          name,
          version: 1,
          blockedPosition: 1n,
          safeErrorCode: 'projection-handler-failed',
          now: NOW,
        }),
      ),
    ).rejects.toThrow(ProjectionCheckpointInvalidError);
    for (const jump of [2, 4]) {
      await expect(
        withClient(admin, (c) =>
          recordCheckpointRetryPending(c, {
            name,
            version: 1,
            failedEventPosition: 1n,
            failedAttemptCount: jump,
            safeErrorCode: 'projection-handler-failed',
            nextAttemptAt: null,
            now: NOW,
          }),
        ),
      ).rejects.toThrow(ProjectionCheckpointInvalidError);
    }

    // Valid progression 0 -> 1 -> 2 -> 3 -> 4 (last_position stays 0; the poison event is event 1).
    const nextAt = new Date(NOW.getTime() + 60_000);
    for (const count of [1, 2, 3, 4]) {
      await withClient(admin, (c) =>
        recordCheckpointRetryPending(c, {
          name,
          version: 1,
          failedEventPosition: 1n,
          failedAttemptCount: count,
          safeErrorCode: 'projection-handler-failed',
          nextAttemptAt: nextAt,
          now: NOW,
        }),
      );
      const row = await withClient(admin, (c) => readCheckpoint(c, { name, version: 1 }));
      expect(row?.status).toBe('active');
      expect(row?.lastPosition).toBe(0n);
      expect(row?.failedAttemptCount).toBe(count);
      expect(row?.nextAttemptAt?.getTime()).toBe(nextAt.getTime());
    }

    // A regression (4 -> 1) and a repeat (4 -> 4) both refuse.
    for (const badCount of [1, 4]) {
      await expect(
        withClient(admin, (c) =>
          recordCheckpointRetryPending(c, {
            name,
            version: 1,
            failedEventPosition: 1n,
            failedAttemptCount: badCount,
            safeErrorCode: 'projection-handler-failed',
            nextAttemptAt: null,
            now: NOW,
          }),
        ),
      ).rejects.toThrow(ProjectionCheckpointInvalidError);
    }

    // The final transition 4 -> blocked (count 5, blocked_position = the poison event) succeeds.
    await withClient(admin, (c) =>
      recordCheckpointBlocked(c, {
        name,
        version: 1,
        blockedPosition: 1n,
        safeErrorCode: 'projection-handler-failed',
        now: NOW,
      }),
    );
    const blocked = await withClient(admin, (c) => readCheckpoint(c, { name, version: 1 }));
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockedPosition).toBe(1n);
    expect(blocked?.failedAttemptCount).toBe(5);
    expect(blocked?.nextAttemptAt).toBeNull();

    // A blocked checkpoint is immutable to retry-state transitions and cannot advance.
    await expect(
      withClient(admin, (c) =>
        recordCheckpointRetryPending(c, {
          name,
          version: 1,
          failedEventPosition: 1n,
          failedAttemptCount: 1,
          safeErrorCode: 'projection-handler-failed',
          nextAttemptAt: null,
          now: NOW,
        }),
      ),
    ).rejects.toThrow(ProjectionCheckpointInvalidError);
    await expect(
      withClient(admin, (c) =>
        recordCheckpointBlocked(c, {
          name,
          version: 1,
          blockedPosition: 1n,
          safeErrorCode: 'projection-handler-failed',
          now: NOW,
        }),
      ),
    ).rejects.toThrow(ProjectionCheckpointInvalidError);
    await expect(
      withClient(admin, (c) =>
        advanceCheckpointOnSuccess(c, { name, version: 1, processedEventPosition: 1n, now: NOW }),
      ),
    ).rejects.toThrow(ProjectionCheckpointInvalidError);
  });
});

// ---------------------------------------------------------------------------
// Attempt
// ---------------------------------------------------------------------------

describe('projection_attempt — append-only, safe-code only, no duplicate attempt', () => {
  it('appends a successful and a failed attempt, and reads them back', async () => {
    const name = toProjectionName('att-basic');
    await withClient(admin, (c) =>
      appendSucceededAttempt(c, {
        name,
        version: 1,
        eventPosition: 1n,
        attemptNumber: 1,
        startedAt: NOW,
        completedAt: NOW,
      }),
    );
    await withClient(admin, (c) =>
      appendFailedAttempt(c, {
        name,
        version: 1,
        eventPosition: 2n,
        attemptNumber: 1,
        safeErrorCode: 'projection-handler-failed',
        startedAt: NOW,
        completedAt: NOW,
      }),
    );
    const s = await withClient(admin, (c) =>
      readAttemptsForEvent(c, { name, version: 1, eventPosition: 1n }),
    );
    const f = await withClient(admin, (c) =>
      readAttemptsForEvent(c, { name, version: 1, eventPosition: 2n }),
    );
    expect(s).toHaveLength(1);
    expect(s[0]?.outcome).toBe('succeeded');
    expect(s[0]?.safeErrorCode).toBeNull();
    expect(f).toHaveLength(1);
    expect(f[0]?.outcome).toBe('failed');
    expect(f[0]?.safeErrorCode).toBe('projection-handler-failed');
  });

  it('refuses a duplicate (projection,version,event,attempt-number)', async () => {
    const name = toProjectionName('att-dup');
    await withClient(admin, (c) =>
      appendSucceededAttempt(c, {
        name,
        version: 1,
        eventPosition: 1n,
        attemptNumber: 1,
        startedAt: NOW,
        completedAt: NOW,
      }),
    );
    await expect(
      withClient(admin, (c) =>
        appendSucceededAttempt(c, {
          name,
          version: 1,
          eventPosition: 1n,
          attemptNumber: 1,
          startedAt: NOW,
          completedAt: NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' }); // unique_violation
  });

  it('refuses UPDATE and DELETE even for the privileged owner (append-only trigger)', async () => {
    const name = toProjectionName('att-immutable');
    await withClient(admin, (c) =>
      appendSucceededAttempt(c, {
        name,
        version: 1,
        eventPosition: 1n,
        attemptNumber: 1,
        startedAt: NOW,
        completedAt: NOW,
      }),
    );
    await expect(
      withClient(admin, (c) =>
        c.query(
          `UPDATE qf_jarvis.projection_attempt SET outcome = 'failed' WHERE projection_name = $1`,
          [name],
        ),
      ),
    ).rejects.toThrow(/append-only/); // restrict_violation raised by the trigger, for every role
    await expect(
      withClient(admin, (c) =>
        c.query(`DELETE FROM qf_jarvis.projection_attempt WHERE projection_name = $1`, [name]),
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('has no column that could carry payload or free-text error data', async () => {
    const columns = await withClient(admin, async (client) => {
      const r = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'qf_jarvis' AND table_name = 'projection_attempt'`,
      );
      return r.rows.map((row) => row.column_name);
    });
    for (const forbidden of [
      'payload',
      'raw_body',
      'error_message',
      'message',
      'detail',
      'stack',
      'correlation_id',
      'subject_id',
      'event_id',
    ]) {
      expect(columns).not.toContain(forbidden);
    }
    expect(columns).toContain('safe_error_code');
  });
});

// ---------------------------------------------------------------------------
// Read-model schemas
// ---------------------------------------------------------------------------

describe('read models — exist, enforce positive counts and sequence ordering, hold no PII', () => {
  it('both read-model tables exist', async () => {
    const tables = await withClient(admin, async (client) => {
      const r = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'qf_jarvis' AND table_name IN ('rm_event_type_activity','rm_daily_event_acceptance')`,
      );
      return r.rows.map((row) => row.table_name).sort();
    });
    expect(tables).toStrictEqual(['rm_daily_event_acceptance', 'rm_event_type_activity']);
  });

  it('rejects a non-positive count and an out-of-order position pair', async () => {
    await expect(
      withClient(admin, (c) =>
        c.query(`INSERT INTO qf_jarvis.rm_event_type_activity
          (event_type, event_version, event_count, first_event_position, last_event_position, last_accepted_at)
          VALUES ('qf.x', 2, 0, 1, 1, now())`),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      withClient(admin, (c) =>
        c.query(`INSERT INTO qf_jarvis.rm_daily_event_acceptance
          (accepted_date, event_count, first_event_position, last_event_position)
          VALUES ('2026-07-18', 1, 5, 3)`),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('contains no prohibited columns', async () => {
    const cols = await withClient(admin, async (client) => {
      const r = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'qf_jarvis'
             AND table_name IN ('rm_event_type_activity','rm_daily_event_acceptance')`,
      );
      return r.rows.map((row) => `${row.table_name}.${row.column_name}`);
    });
    for (const forbidden of [
      'payload',
      'subject_id',
      'subject_type',
      'correlation_id',
      'event_id',
      'phone',
      'email',
      'address',
      'gps',
      'transcript',
    ]) {
      expect(cols.some((c) => c.endsWith(`.${forbidden}`))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Privileges
// ---------------------------------------------------------------------------

describe('privileges — projection role least privilege; ingestion role and PUBLIC/managed denied', () => {
  it('the projection role can perform exactly its intended operations (connected AS the role)', async () => {
    const pool = requireProjectionPool();
    const name = toProjectionName('priv-positive');
    // checkpoint: create + advance (0 -> 1, the exact next sequence)
    await withClient(pool, (c) => createCheckpointIfAbsent(c, { name, version: 1, now: NOW }));
    await withClient(pool, (c) =>
      advanceCheckpointOnSuccess(c, { name, version: 1, processedEventPosition: 1n, now: NOW }),
    );
    // attempt: insert
    await withClient(pool, (c) =>
      appendSucceededAttempt(c, {
        name,
        version: 1,
        eventPosition: 1n,
        attemptNumber: 1,
        startedAt: NOW,
        completedAt: NOW,
      }),
    );
    // read model: upsert
    await withClient(pool, (c) =>
      c.query(`INSERT INTO qf_jarvis.rm_event_type_activity
        (event_type, event_version, event_count, first_event_position, last_event_position, last_accepted_at)
        VALUES ('qf.recommendation.created', 2, 1, 1, 1, now())
        ON CONFLICT (event_type, event_version) DO UPDATE SET event_count = qf_jarvis.rm_event_type_activity.event_count + 1`),
    );
    const stored = await withClient(admin, async (client) => {
      const r = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM qf_jarvis.rm_event_type_activity WHERE event_type = 'qf.recommendation.created'`,
      );
      return Number.parseInt(r.rows[0]?.n ?? '0', 10);
    });
    expect(stored).toBe(1);
  });

  it('grants the projection role only the intended table privileges', async () => {
    for (const [table, priv, expected] of [
      ['projection_checkpoint', 'SELECT', true],
      ['projection_checkpoint', 'INSERT', true],
      ['projection_checkpoint', 'UPDATE', true],
      ['projection_checkpoint', 'DELETE', false],
      // projection_attempt INSERT is COLUMN-level (checked below), so table-level INSERT is false.
      ['projection_attempt', 'UPDATE', false],
      ['projection_attempt', 'DELETE', false],
      ['rm_event_type_activity', 'SELECT', true],
      ['rm_event_type_activity', 'INSERT', true],
      ['rm_event_type_activity', 'UPDATE', true],
      ['rm_event_type_activity', 'DELETE', false],
      ['rm_daily_event_acceptance', 'UPDATE', true],
      ['rm_daily_event_acceptance', 'DELETE', false],
    ] as const) {
      expect(await tablePrivilege(PROJECTION_ROLE, table, priv)).toBe(expected);
    }
    // The append-only attempt log is granted COLUMN-level INSERT on the caller columns only.
    expect(
      await columnPrivilege(PROJECTION_ROLE, 'projection_attempt', 'projection_name', 'INSERT'),
    ).toBe(true);
    expect(await columnPrivilege(PROJECTION_ROLE, 'projection_attempt', 'outcome', 'INSERT')).toBe(
      true,
    );
    expect(await columnPrivilege(PROJECTION_ROLE, 'projection_attempt', 'sequence', 'SELECT')).toBe(
      true,
    );
  });

  it('the projection role reads only event metadata columns, never payload or identifiers', async () => {
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'sequence', 'SELECT')).toBe(true);
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'event_type', 'SELECT')).toBe(true);
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'event_version', 'SELECT')).toBe(true);
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'accepted_at', 'SELECT')).toBe(true);
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'payload', 'SELECT')).toBe(false);
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'subject_id', 'SELECT')).toBe(false);
    expect(await columnPrivilege(PROJECTION_ROLE, 'event', 'correlation_id', 'SELECT')).toBe(false);
    // and it can never mutate the immutable log
    expect(await tablePrivilege(PROJECTION_ROLE, 'event', 'UPDATE')).toBe(false);
    expect(await tablePrivilege(PROJECTION_ROLE, 'event', 'DELETE')).toBe(false);
    expect(await tablePrivilege(PROJECTION_ROLE, 'event', 'INSERT')).toBe(false);
  });

  it('denies the projection role audit content, migration history, and schema CREATE', async () => {
    expect(
      await columnPrivilege(PROJECTION_ROLE, 'ingestion_rejection', 'reason_code', 'SELECT'),
    ).toBe(false);
    expect(
      await columnPrivilege(PROJECTION_ROLE, 'event_conflict', 'conflicting_body_digest', 'SELECT'),
    ).toBe(false);
    expect(await tablePrivilege(PROJECTION_ROLE, 'schema_migration', 'SELECT')).toBe(false);
    const canCreate = await withClient(admin, async (client) => {
      const r = await client.query<{ g: boolean }>(
        `SELECT has_schema_privilege($1, 'qf_jarvis', 'CREATE') AS g`,
        [PROJECTION_ROLE],
      );
      return r.rows[0]?.g ?? true;
    });
    expect(canCreate).toBe(false);
  });

  it('the ingestion role gets NO privilege on any projection table', async () => {
    for (const table of [
      'projection_checkpoint',
      'projection_attempt',
      'rm_event_type_activity',
      'rm_daily_event_acceptance',
    ]) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await tablePrivilege(RUNTIME_ROLE, table, priv)).toBe(false);
      }
    }
  });

  it('denies PUBLIC and every managed alias on all four projection tables', async () => {
    const roles = ['public', ...MANAGED_ROLES];
    for (const role of roles) {
      for (const table of [
        'projection_checkpoint',
        'projection_attempt',
        'rm_event_type_activity',
        'rm_daily_event_acceptance',
      ]) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          expect(await tablePrivilege(role, table, priv)).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Pool lifecycle
// ---------------------------------------------------------------------------

describe('pool lifecycle — teardown is safe and idempotent', () => {
  it('a dedicated projection pool can be used then closed twice without a secondary error', async () => {
    // Models the teardown discipline: close only if created, and a redundant close never throws — so
    // a beforeAll failure is never masked by an undefined-pool or double-close error in afterAll.
    const pool = createProjectionPool(PROJECTION_PASSWORD, 'qf-proj-lifecycle');
    const one = await withClient(pool, async (client) => {
      const r = await client.query<{ one: number }>('SELECT 1 AS one');
      return r.rows[0]?.one;
    });
    expect(one).toBe(1);
    await closeTestPool(pool);
    await expect(closeTestPool(pool)).resolves.toBeUndefined(); // idempotent, no throw
  });
});
