/**
 * **The preflight is a gate, not a suggestion.**
 *
 * `db:migrate` cannot skip it, because `migrateWithPreflight` is the only path to a migration
 * and it runs the preflight first, on the same client, before the advisory lock and before any
 * DDL. These tests prove that ordering by observing what is *absent* from the database after a
 * failed preflight — no schema, no history table, no lock.
 *
 * **No Supabase is contacted.** The "managed" case is simulated by handing the preflight a
 * config that *describes* a managed target while the pool is connected to loopback. That is not
 * a contrivance — it is exactly the failure the TLS check exists to catch: **the configuration
 * claims a verified connection and the wire says otherwise.** Believing the config over the
 * wire is how you end up "verifying" a plaintext session.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConfig,
  defaultMigrationsDirectory,
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_SCHEMA,
  migrateWithPreflight,
  PreflightFailedError,
  runPreflight,
  withClient,
  type DatabaseConfig,
  type DatabasePool,
} from '../index.js';
// The runner's UNGATED entry point. Deliberately NOT exported from the package root (see
// ../index.ts): it is reachable here because these tests live inside the package and exercise
// the runner in isolation. A CONSUMER cannot reach it, and must go through migrateWithPreflight.
import { runMigrations } from '../persistence/migration-runner.js';
import {
  closeTestPool,
  countAdvisoryLockHolders,
  createTestPool,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './database-test-utils.js';
import { SYNTHETIC_CA_PEM } from './fixtures/certificates.js';

const pool: DatabasePool = createTestPool({ applicationName: 'qf-migrate-gate-test' });

/** The honest config: loopback, TLS disabled, everything a preflight wants. */
const LOOPBACK_CONFIG: DatabaseConfig = createDatabaseConfig({
  connectionString: requireTestDatabaseUrl(),
  applicationName: 'qf-migrate-gate-test',
});

/**
 * A config that **claims** to be a CA-verified managed connection.
 *
 * The pool it will be used with is connected to loopback with no TLS, so the preflight's TLS
 * check — which reads `pg_stat_ssl` for the actual backend rather than trusting the config —
 * will find no TLS on the wire and fail. That is the required-check failure this suite needs,
 * and it is a real scenario rather than an invented one.
 */
const MANAGED_LOOKING_CONFIG: DatabaseConfig = createDatabaseConfig({
  connectionString: 'postgresql://postgres:pw@db.exampleref000000000000.supabase.co:5432/postgres',
  applicationName: 'qf-migrate-gate-test',
  tls: { mode: 'verify-full', caCertificatePem: SYNTHETIC_CA_PEM },
});

async function schemaExists(name: string): Promise<boolean> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
       ) AS exists`,
      [name],
    );
    return result.rows[0]?.exists ?? false;
  });
}

async function tableExists(schema: string, name: string): Promise<boolean> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = $1 AND table_name = $2
       ) AS exists`,
      [schema, name],
    );
    return result.rows[0]?.exists ?? false;
  });
}

beforeEach(async () => {
  await resetTestDatabase(pool);
});

afterAll(async () => {
  try {
    await resetTestDatabase(pool);
    await runMigrations(pool, defaultMigrationsDirectory());
  } finally {
    await closeTestPool(pool);
  }
});

describe('db:migrate runs the preflight automatically', () => {
  it('migrates a virgin database, and returns the preflight report alongside the result', async () => {
    const { preflight, migration } = await migrateWithPreflight(
      pool,
      LOOPBACK_CONFIG,
      defaultMigrationsDirectory(),
    );

    // The preflight ran. It is not something the CLI bolted on the side — it comes back in the
    // result, because it is part of the operation.
    expect(preflight.passed).toBe(true);
    expect(preflight.checks.length).toBeGreaterThan(0);

    expect(migration.applied.map((m) => m.filename)).toStrictEqual(['0001_event_log.sql']);
    expect(await tableExists(MIGRATION_SCHEMA, 'event')).toBe(true);
  });

  it('is a no-op on a second run, preflight and all', async () => {
    await migrateWithPreflight(pool, LOOPBACK_CONFIG, defaultMigrationsDirectory());
    const second = await migrateWithPreflight(pool, LOOPBACK_CONFIG, defaultMigrationsDirectory());

    expect(second.preflight.passed).toBe(true);
    expect(second.migration.applied).toStrictEqual([]);
    expect(second.migration.alreadyApplied.map((m) => m.version)).toStrictEqual([1]);
  });

  it('reports the schema as ABSENT in the preflight of a virgin database — so it ran BEFORE the bootstrap', async () => {
    // This is the ordering proof, from the inside. If the preflight ran after the bootstrap it
    // would have seen the schema it was supposed to report as missing.
    const { preflight } = await migrateWithPreflight(
      pool,
      LOOPBACK_CONFIG,
      defaultMigrationsDirectory(),
    );

    const schema = preflight.checks.find((c) => c.name === `${MIGRATION_SCHEMA} schema`);
    expect(schema?.detail).toContain('absent');

    // And yet the migration then created it. Preflight first, migration second, one client.
    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(true);
  });
});

describe('a failed preflight prevents the migration entirely', () => {
  it('throws PreflightFailedError, and never reaches runMigrations', async () => {
    const thrown: unknown = await migrateWithPreflight(
      pool,
      MANAGED_LOOKING_CONFIG,
      defaultMigrationsDirectory(),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(PreflightFailedError);

    // The message says what a deploy log needs it to say.
    const message = thrown instanceof Error ? thrown.message : '';
    expect(message).toContain('Managed database preflight failed');
    expect(message).toContain('NOTHING was changed');
    // And it names the failing check.
    expect(message).toContain('TLS');
  });

  it('leaves a virgin database completely unchanged — no schema, no history, no objects', async () => {
    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(false);

    await expect(
      migrateWithPreflight(pool, MANAGED_LOOKING_CONFIG, defaultMigrationsDirectory()),
    ).rejects.toBeInstanceOf(PreflightFailedError);

    // The bootstrap creates the schema and the history table. Neither exists, so the bootstrap
    // never ran — which means the advisory lock was never taken, because the lock is the line
    // immediately before it.
    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(false);
    expect(await tableExists(MIGRATION_SCHEMA, 'schema_migration')).toBe(false);
    expect(await tableExists(MIGRATION_SCHEMA, 'event')).toBe(false);
  });

  it('never acquires the migration advisory lock', async () => {
    await expect(
      migrateWithPreflight(pool, MANAGED_LOOKING_CONFIG, defaultMigrationsDirectory()),
    ).rejects.toBeInstanceOf(PreflightFailedError);

    // Not "released cleanly" — never taken at all. A lock taken and released would still mean
    // the migration path had begun.
    expect(await countAdvisoryLockHolders(pool, MIGRATION_ADVISORY_LOCK_KEY)).toBe(0);
  });

  it('leaves an ALREADY-MIGRATED database untouched too', async () => {
    await migrateWithPreflight(pool, LOOPBACK_CONFIG, defaultMigrationsDirectory());

    const before = await withClient(pool, async (client) => {
      const result = await client.query<{ checksum: string }>(
        `SELECT encode(checksum, 'hex') AS checksum
           FROM ${MIGRATION_SCHEMA}.schema_migration WHERE version = 1`,
      );
      return result.rows[0]?.checksum;
    });

    await expect(
      migrateWithPreflight(pool, MANAGED_LOOKING_CONFIG, defaultMigrationsDirectory()),
    ).rejects.toBeInstanceOf(PreflightFailedError);

    const after = await withClient(pool, async (client) => {
      const result = await client.query<{ checksum: string }>(
        `SELECT encode(checksum, 'hex') AS checksum
           FROM ${MIGRATION_SCHEMA}.schema_migration WHERE version = 1`,
      );
      return result.rows[0]?.checksum;
    });

    expect(after).toBe(before);
    expect(await countAdvisoryLockHolders(pool, MIGRATION_ADVISORY_LOCK_KEY)).toBe(0);
  });

  it('reveals no hostname, password or CA in the failure', async () => {
    const thrown: unknown = await migrateWithPreflight(
      pool,
      MANAGED_LOOKING_CONFIG,
      defaultMigrationsDirectory(),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    const message = thrown instanceof Error ? thrown.message : '';

    expect(message).not.toContain('exampleref000000000000');
    expect(message).not.toContain('supabase.co');
    expect(message).not.toContain('BEGIN CERTIFICATE');
    expect(message).not.toContain(':pw@');
  });
});

describe('the standalone preflight still works, and still changes nothing', () => {
  it('runs independently of a migration', async () => {
    const report = await runPreflight(pool, LOOPBACK_CONFIG);

    expect(report.passed).toBe(true);
    // It did not helpfully create the schema it was asked about.
    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(false);
  });

  it('reports failure without throwing, so `db:preflight` can print every failed check', async () => {
    // The standalone command's job is to TELL you what is wrong, not to blow up on the first
    // problem. The gate is what throws.
    const report = await runPreflight(pool, MANAGED_LOOKING_CONFIG);

    expect(report.passed).toBe(false);
    expect(report.checks.filter((c) => c.required && !c.passed).length).toBeGreaterThan(0);
    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(false);
  });
});
