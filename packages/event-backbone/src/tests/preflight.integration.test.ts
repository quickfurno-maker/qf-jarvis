/**
 * The managed-database preflight, against a real PostgreSQL.
 *
 * **No Supabase is contacted here, and none may be.** The whole point of the preflight is to
 * be provable *before* the first managed connection exists, so it is proved against loopback
 * — where the destructive guards permit us to set up the exact states we need to see.
 *
 * These are integration tests: they require `DATABASE_URL` and they **fail** without it.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConfig,
  defaultMigrationsDirectory,
  MIGRATION_SCHEMA,
  REQUIRED_POSTGRES_MAJOR_VERSION,
  runMigrations,
  runPreflight,
  withClient,
  type DatabasePool,
  type PreflightCheck,
  type PreflightReport,
} from '../index.js';
import {
  closeTestPool,
  createTestPool,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './database-test-utils.js';

const pool: DatabasePool = createTestPool({ applicationName: 'qf-preflight-test' });

const config = createDatabaseConfig({
  connectionString: requireTestDatabaseUrl(),
  applicationName: 'qf-preflight-test',
});

/** Everything the preflight could conceivably disturb, as one comparable snapshot. */
async function snapshotDatabase(): Promise<string> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ snapshot: string }>(
      `SELECT COALESCE(string_agg(entry, '|' ORDER BY entry), '(empty)') AS snapshot
         FROM (
           SELECT n.nspname || '.' || c.relname || ':' || c.relkind::text AS entry
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public', $1)
           UNION ALL
           SELECT 'schema:' || schema_name
             FROM information_schema.schemata
            WHERE schema_name IN ('public', $1)
         ) AS entries`,
      [MIGRATION_SCHEMA],
    );
    return result.rows[0]?.snapshot ?? '(empty)';
  });
}

function check(report: PreflightReport, name: string): PreflightCheck {
  const found = report.checks.find((c) => c.name === name);
  if (found === undefined) {
    throw new Error(`Expected a preflight check named "${name}"`);
  }
  return found;
}

beforeEach(async () => {
  await resetTestDatabase(pool);
});

afterAll(async () => {
  // Leave the shared test database as the real migrations describe it, so a later
  // `pnpm db:migrate` is a clean no-op rather than a checksum surprise.
  try {
    await resetTestDatabase(pool);
    await runMigrations(pool, defaultMigrationsDirectory());
  } finally {
    await closeTestPool(pool);
  }
});

describe('the preflight reports the truth about a virgin database', () => {
  it('passes, and reports the schema and history as absent', async () => {
    const report = await runPreflight(pool, config);

    expect(report.passed).toBe(true);
    expect(check(report, `${MIGRATION_SCHEMA} schema`).detail).toContain('absent');
    expect(check(report, 'Migration history').detail).toContain('absent');
  });

  it('reports PostgreSQL major 17, and does not assert a patch level', async () => {
    const report = await runPreflight(pool, config);
    const version = check(report, 'PostgreSQL major version');

    expect(version.passed).toBe(true);
    expect(version.detail).toContain(`major ${String(REQUIRED_POSTGRES_MAJOR_VERSION)}`);
    // The provider owns its patch level (ADR-0023 §7). Asserting one here would be asserting
    // something this repository cannot enforce.
    expect(version.detail).toContain('not pinned');
  });

  it('reports that the connected role is not a superuser', async () => {
    // If this ever fails locally, the local role has been given superuser — and every
    // immutability guarantee in Stage 3.1 is void, because a superuser bypasses grants and
    // can DISABLE TRIGGER. That is exactly what this check exists to catch.
    const role = check(await runPreflight(pool, config), 'Migration role is not a superuser');

    expect(role.passed).toBe(true);
    expect(role.detail).toContain('not a superuser');
  });

  it('treats loopback as not requiring TLS, and says so', async () => {
    const tls = check(await runPreflight(pool, config), 'TLS');

    expect(tls.passed).toBe(true);
    expect(tls.detail).toContain('loopback');
  });

  it('reports the database name', async () => {
    const database = check(await runPreflight(pool, config), 'Database');

    expect(database.passed).toBe(true);
    expect(database.detail).toContain('test');
  });
});

describe('the preflight reports the truth about a migrated database', () => {
  it('reports the schema, its tables, and the applied migration', async () => {
    await runMigrations(pool, defaultMigrationsDirectory());

    const report = await runPreflight(pool, config);

    expect(report.passed).toBe(true);

    const schema = check(report, `${MIGRATION_SCHEMA} schema`);
    expect(schema.detail).toContain('present');
    expect(schema.detail).toContain('event');
    expect(schema.detail).toContain('schema_migration');

    const history = check(report, 'Migration history');
    expect(history.detail).toContain('0001_event_log.sql');
  });
});

describe('the preflight changes nothing — and PostgreSQL is what enforces that', () => {
  it('leaves a virgin database byte-for-byte as it found it', async () => {
    const before = await snapshotDatabase();

    await runPreflight(pool, config);
    await runPreflight(pool, config);

    expect(await snapshotDatabase()).toBe(before);
    // Specifically: it did NOT helpfully create the schema it was asked about.
    expect(before).not.toContain(`schema:${MIGRATION_SCHEMA}`);
  });

  it('leaves a migrated database exactly as it found it, rows included', async () => {
    await runMigrations(pool, defaultMigrationsDirectory());

    const before = await snapshotDatabase();
    const historyBefore = await withClient(pool, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${MIGRATION_SCHEMA}.schema_migration`,
      );
      return result.rows[0]?.count;
    });

    await runPreflight(pool, config);

    expect(await snapshotDatabase()).toBe(before);

    const historyAfter = await withClient(pool, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${MIGRATION_SCHEMA}.schema_migration`,
      );
      return result.rows[0]?.count;
    });
    expect(historyAfter).toBe(historyBefore);
  });

  it('runs inside a READ ONLY transaction — a write would be refused by the server', async () => {
    // The claim "this function performs no writes" is a promise made by whoever wrote it.
    // A READ ONLY transaction is a promise made by PostgreSQL. This proves the mechanism the
    // preflight relies on actually refuses a write, with SQLSTATE 25006.
    const rejection = await withClient(pool, async (client) => {
      await client.query('BEGIN TRANSACTION READ ONLY');
      try {
        await client.query('CREATE TABLE public.should_never_exist (id INTEGER)');
        return undefined;
      } catch (error: unknown) {
        return error;
      } finally {
        await client.query('ROLLBACK');
      }
    });

    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toMatchObject({ code: '25006' });

    const exists = await withClient(pool, async (client) => {
      const result = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'should_never_exist'
         ) AS exists`,
      );
      return result.rows[0]?.exists;
    });
    expect(exists).toBe(false);
  });
});

describe('the preflight prints nothing that identifies the target', () => {
  it('reports a redacted target and a safe TLS description', async () => {
    const report = await runPreflight(pool, config);

    // Loopback: the host is safe to show, and useful.
    expect(report.target).toContain('127.0.0.1');
    expect(report.target).not.toContain('local-stage');
    expect(report.tls).toContain('disabled');

    // Nothing in any check detail may carry a credential.
    for (const c of report.checks) {
      expect(c.detail).not.toContain('postgresql://');
      expect(c.detail).not.toContain('@');
    }
  });
});
