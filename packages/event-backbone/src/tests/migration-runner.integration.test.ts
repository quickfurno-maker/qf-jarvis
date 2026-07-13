/**
 * The migration runner, against a real PostgreSQL.
 *
 * These are integration tests and they require `DATABASE_URL`. They **fail** without it;
 * they do not skip. See database-test-utils.ts for why that is the only acceptable
 * behaviour.
 *
 * Every test starts from a dropped schema, so every run re-migrates from zero — which
 * means the "migrate a virgin database" path is exercised on every single run rather
 * than only on the day somebody remembers to try it.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultMigrationsDirectory,
  DuplicateMigrationVersionError,
  MalformedMigrationFilenameError,
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_SCHEMA,
  MigrationChecksumMismatchError,
  MigrationExecutionError,
  MigrationFileMissingError,
  OutOfOrderMigrationError,
  withClient,
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
  ensureManagedRolesExist,
  MANAGED_ROLES,
  resetTestDatabase,
} from './database-test-utils.js';

const pool: DatabasePool = createTestPool({ applicationName: 'qf-migration-runner-test' });

const temporaryDirectories: string[] = [];

/** A throwaway migrations directory containing exactly the files given. */
async function migrationsDirectory(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'qf-migrations-'));
  temporaryDirectories.push(directory);

  for (const [filename, sql] of Object.entries(files)) {
    await writeFile(join(directory, filename), sql, 'utf8');
  }

  return directory;
}

// Fixture migrations create their tables inside `qf_jarvis`, exactly as the real ones do.
// A fixture that wrote to `public` would be testing a code path that does not exist.
const CREATE_WIDGET = `CREATE TABLE qf_jarvis.widget (id INTEGER PRIMARY KEY);`;
const CREATE_GADGET = `CREATE TABLE qf_jarvis.gadget (id INTEGER PRIMARY KEY);`;

/** Fully qualified on purpose: nothing in this suite may depend on an ambient `search_path`. */
async function tableExistsIn(schema: string, name: string): Promise<boolean> {
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

async function tableExists(name: string): Promise<boolean> {
  return tableExistsIn(MIGRATION_SCHEMA, name);
}

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

beforeEach(async () => {
  await resetTestDatabase(pool);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

afterAll(async () => {
  // Leave the shared test database in the state the REAL migrations describe.
  //
  // This suite applies throwaway fixture migrations (`0001_create-widget.sql`), so without
  // this it would hand back a database whose recorded history says version 1 is
  // `0001_create-widget.sql` — and the next `pnpm db:migrate` would (correctly) refuse to
  // start, because the checksum on disk for version 1 belongs to `0001_event_log.sql`.
  //
  // Worse, whether that happened at all depended on WHICH integration file Vitest ran
  // last, because the other one re-migrates properly in its own `beforeAll`. A failure
  // that depends on file ordering is the kind that gets called flaky and then ignored.
  //
  // A suite that mutates shared state cleans up after itself. That is all this is.
  try {
    await resetTestDatabase(pool);
    await runMigrations(pool, defaultMigrationsDirectory());
  } finally {
    await closeTestPool(pool);
  }
});

describe('applying migrations', () => {
  it('applies every migration on a virgin database', async () => {
    const directory = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_create-gadget.sql': CREATE_GADGET,
    });

    const result = await runMigrations(pool, directory);

    expect(result.applied.map((m) => m.version)).toStrictEqual([1, 2]);
    expect(result.alreadyApplied).toStrictEqual([]);
    expect(await tableExists('widget')).toBe(true);
    expect(await tableExists('gadget')).toBe(true);
  });

  it('is a no-op the second time — no migration is silently re-applied', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });

    await runMigrations(pool, directory);
    const second = await runMigrations(pool, directory);

    expect(second.applied).toStrictEqual([]);
    expect(second.alreadyApplied.map((m) => m.version)).toStrictEqual([1]);
  });

  it('records the version, filename, checksum and applied time', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });

    const result = await runMigrations(pool, directory);
    const applied = result.applied[0];
    expect(applied).toBeDefined();

    const recorded = await withClient(pool, async (client) => {
      const rows = await client.query<{
        version: number;
        filename: string;
        checksum: Buffer;
        applied_at: Date;
      }>('SELECT version, filename, checksum, applied_at FROM qf_jarvis.schema_migration');
      return rows.rows[0];
    });

    expect(recorded).toBeDefined();
    expect(recorded?.version).toBe(1);
    expect(recorded?.filename).toBe('0001_create-widget.sql');
    // 32 bytes — a SHA-256 and nothing else. The CHECK constraint enforces it too.
    expect(recorded?.checksum.length).toBe(32);
    expect(recorded?.checksum.equals(applied?.checksum ?? Buffer.alloc(0))).toBe(true);
    expect(recorded?.applied_at).toBeInstanceOf(Date);
  });

  it('applies a new migration on top of an existing history', async () => {
    const first = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, first);

    const second = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_create-gadget.sql': CREATE_GADGET,
    });
    const result = await runMigrations(pool, second);

    expect(result.applied.map((m) => m.version)).toStrictEqual([2]);
    expect(result.alreadyApplied.map((m) => m.version)).toStrictEqual([1]);
  });
});

describe('history cannot be rewritten', () => {
  it('refuses to start when an applied migration has been edited', async () => {
    const original = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, original);

    // The same version, a different body. This is the failure that silently makes
    // staging and production two different databases.
    const edited = await migrationsDirectory({
      '0001_create-widget.sql': `${CREATE_WIDGET}\nALTER TABLE widget ADD COLUMN name TEXT;`,
    });

    await expect(runMigrations(pool, edited)).rejects.toThrow(MigrationChecksumMismatchError);
  });

  it('refuses to start when the database records a migration whose file is gone', async () => {
    const full = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_create-gadget.sql': CREATE_GADGET,
    });
    await runMigrations(pool, full);

    // The code is now behind the database.
    const truncated = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });

    await expect(runMigrations(pool, truncated)).rejects.toThrow(MigrationFileMissingError);
  });

  it('refuses a new migration inserted below one already applied', async () => {
    const first = await migrationsDirectory({ '0002_create-gadget.sql': CREATE_GADGET });
    await runMigrations(pool, first);

    // 0001 is new, but 0002 is already applied. A fresh database would never run these
    // in this order, so neither will this one.
    const backfilled = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_create-gadget.sql': CREATE_GADGET,
    });

    await expect(runMigrations(pool, backfilled)).rejects.toThrow(OutOfOrderMigrationError);
  });
});

describe('everything lives in qf_jarvis, and nothing lives in public', () => {
  it('creates the qf_jarvis schema from nothing', async () => {
    // resetTestDatabase dropped it. The bootstrap must put it back, under the lock.
    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(false);

    await runMigrations(pool, defaultMigrationsDirectory());

    expect(await schemaExists(MIGRATION_SCHEMA)).toBe(true);
  });

  it('leaves the public schema present, and anything already in it untouched', async () => {
    // A stand-in for "somebody else's object" — an extension's table, a provider's table,
    // a colleague's scratch table. The earlier `DROP SCHEMA public CASCADE` destroyed all
    // of it to clean up after itself. This test is what stops that coming back.
    await withClient(pool, (client) =>
      client.query('CREATE TABLE IF NOT EXISTS public.not_ours (id INTEGER PRIMARY KEY)'),
    );
    await withClient(pool, (client) =>
      client.query('INSERT INTO public.not_ours (id) VALUES (1) ON CONFLICT DO NOTHING'),
    );

    await resetTestDatabase(pool);
    await runMigrations(pool, defaultMigrationsDirectory());

    expect(await schemaExists('public')).toBe(true);
    expect(await tableExistsIn('public', 'not_ours')).toBe(true);

    const rows = await withClient(pool, async (client) => {
      const result = await client.query<{ id: number }>('SELECT id FROM public.not_ours');
      return result.rows.map((row) => row.id);
    });
    expect(rows).toStrictEqual([1]);

    await withClient(pool, (client) => client.query('DROP TABLE public.not_ours'));
  });

  it('puts every Stage 3.1 table in qf_jarvis and none in any other schema', async () => {
    await runMigrations(pool, defaultMigrationsDirectory());

    const schemas = await withClient(pool, async (client) => {
      const result = await client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name
           FROM information_schema.tables
          WHERE table_name IN ('event', 'schema_migration')`,
      );
      return result.rows;
    });

    expect(schemas.length).toBe(2);
    for (const row of schemas) {
      expect(row.table_schema).toBe(MIGRATION_SCHEMA);
    }
  });

  it('puts both mutation-rejection functions in qf_jarvis', async () => {
    await runMigrations(pool, defaultMigrationsDirectory());

    const functions = await withClient(pool, async (client) => {
      const result = await client.query<{ nspname: string; proname: string }>(
        `SELECT n.nspname, p.proname
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE p.proname IN ('event_reject_mutation', 'schema_migration_reject_mutation')`,
      );
      return result.rows;
    });

    expect(functions.length).toBe(2);
    for (const row of functions) {
      expect(row.nspname).toBe(MIGRATION_SCHEMA);
    }
  });

  it('grants PUBLIC nothing on the schema', async () => {
    await runMigrations(pool, defaultMigrationsDirectory());

    const granted = await withClient(pool, async (client) => {
      const result = await client.query<{ usage: boolean; create: boolean }>(
        `SELECT has_schema_privilege('public', $1, 'USAGE')  AS usage,
                has_schema_privilege('public', $1, 'CREATE') AS create`,
        [MIGRATION_SCHEMA],
      );
      return result.rows[0];
    });

    expect(granted?.usage).toBe(false);
    expect(granted?.create).toBe(false);
  });
});

describe('the managed provider’s roles are revoked — and re-revoked on every run', () => {
  it('leaves anon, authenticated and service_role with no access to qf_jarvis', async () => {
    // The roles do not exist on a laptop, so without this the assertion below would pass
    // by asserting nothing at all — a green test proving the opposite of its own claim.
    await ensureManagedRolesExist(pool);

    await runMigrations(pool, defaultMigrationsDirectory());

    for (const role of MANAGED_ROLES) {
      const privileges = await withClient(pool, async (client) => {
        const result = await client.query<{ schema_usage: boolean; event_select: boolean }>(
          `SELECT has_schema_privilege($1, $2, 'USAGE')                 AS schema_usage,
                  has_table_privilege($1, $2 || '.event', 'SELECT')     AS event_select`,
          [role, MIGRATION_SCHEMA],
        );
        return result.rows[0];
      });

      expect(privileges?.schema_usage).toBe(false);
      expect(privileges?.event_select).toBe(false);
    }
  });

  it('takes the access BACK when the provider grants it — which is why it re-runs', async () => {
    await ensureManagedRolesExist(pool);
    await runMigrations(pool, defaultMigrationsDirectory());

    // Simulate exactly the thing this defends against: the provider (or a well-meaning
    // human) grants its own roles access to our schema during a platform upgrade.
    await withClient(pool, async (client) => {
      for (const role of MANAGED_ROLES) {
        await client.query(`GRANT USAGE ON SCHEMA ${MIGRATION_SCHEMA} TO ${role}`);
        await client.query(`GRANT SELECT ON ${MIGRATION_SCHEMA}.event TO ${role}`);
      }
    });

    // Sanity: the grant actually took. Without this the test could pass on a no-op.
    const grantedNow = await withClient(pool, async (client) => {
      const result = await client.query<{ usage: boolean }>(
        `SELECT has_schema_privilege('service_role', $1, 'USAGE') AS usage`,
        [MIGRATION_SCHEMA],
      );
      return result.rows[0]?.usage;
    });
    expect(grantedNow).toBe(true);

    // Re-running the migrations must take it back. The bootstrap's revoke is idempotent
    // and unconditional-on-existence for exactly this reason: a provider that re-grants
    // during an upgrade would otherwise silently re-open the door, with nothing going red.
    await runMigrations(pool, defaultMigrationsDirectory());

    for (const role of MANAGED_ROLES) {
      const privileges = await withClient(pool, async (client) => {
        const result = await client.query<{ schema_usage: boolean; event_select: boolean }>(
          `SELECT has_schema_privilege($1, $2, 'USAGE')             AS schema_usage,
                  has_table_privilege($1, $2 || '.event', 'SELECT') AS event_select`,
          [role, MIGRATION_SCHEMA],
        );
        return result.rows[0];
      });

      expect(privileges?.schema_usage).toBe(false);
      expect(privileges?.event_select).toBe(false);
    }
  });

  it('applies cleanly on a PostgreSQL that has none of those roles', async () => {
    // The conditional DO block is what makes the SAME migration run on a laptop, in CI,
    // and on the provider. An unconditional `REVOKE ... FROM service_role` is a hard error
    // where the role does not exist — and a migration that only runs on the provider is a
    // migration CI never actually proved.
    await withClient(pool, async (client) => {
      for (const role of MANAGED_ROLES) {
        await client.query(`DROP ROLE IF EXISTS ${role}`);
      }
    });

    await resetTestDatabase(pool);
    const result = await runMigrations(pool, defaultMigrationsDirectory());

    expect(result.applied.map((m) => m.filename)).toStrictEqual(['0001_event_log.sql']);
    expect(await tableExists('event')).toBe(true);
  });
});

describe('the migration history is append-only', () => {
  /**
   * `schema_migration` **is** the migration history, so it is protected exactly as hard as
   * the event log.
   *
   * An `UPDATE` of a checksum here silently defeats the reconciliation that is the entire
   * point of checksumming: the runner would compare a tampered file against a tampered
   * record, find them in agreement, and start. A `DELETE` re-opens an applied migration
   * for re-application against a schema that already has it.
   *
   * A control that can be edited by the thing it constrains is not a control.
   */
  async function historyRow(): Promise<{
    version: number;
    filename: string;
    checksum: Buffer;
    applied_at: Date;
  }> {
    const row = await withClient(pool, async (client) => {
      const result = await client.query<{
        version: number;
        filename: string;
        checksum: Buffer;
        applied_at: Date;
      }>(
        'SELECT version, filename, checksum, applied_at FROM qf_jarvis.schema_migration WHERE version = 1',
      );
      return result.rows[0];
    });

    if (row === undefined) {
      throw new Error('Expected a migration history row for version 1');
    }
    return row;
  }

  it('refuses UPDATE of an applied migration record, and leaves it intact', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, directory);

    const before = await historyRow();

    await expect(
      withClient(pool, (client) =>
        // The attack this stops: rewrite the recorded checksum so an edited migration
        // reconciles cleanly and the schema drifts without anything failing.
        client.query('UPDATE qf_jarvis.schema_migration SET checksum = $1 WHERE version = 1', [
          Buffer.alloc(32, 0xff),
        ]),
      ),
    ).rejects.toThrow(/append-only|not permitted/i);

    const after = await historyRow();

    expect(after.version).toBe(before.version);
    expect(after.filename).toBe(before.filename);
    expect(after.checksum.equals(before.checksum)).toBe(true);
    expect(after.applied_at.getTime()).toBe(before.applied_at.getTime());
  });

  it('refuses DELETE of an applied migration record, and the record survives', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, directory);

    const before = await historyRow();

    await expect(
      withClient(pool, (client) =>
        client.query('DELETE FROM qf_jarvis.schema_migration WHERE version = 1'),
      ),
    ).rejects.toThrow(/append-only|not permitted/i);

    const after = await historyRow();
    expect(after.checksum.equals(before.checksum)).toBe(true);
  });

  it('refuses a bulk DELETE, so the whole history cannot be wiped', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, directory);

    await expect(
      withClient(pool, (client) => client.query('DELETE FROM qf_jarvis.schema_migration')),
    ).rejects.toThrow(/append-only|not permitted/i);

    const rows = await withClient(pool, async (client) => {
      const result = await client.query<{ version: number }>(
        'SELECT version FROM qf_jarvis.schema_migration',
      );
      return result.rows;
    });

    expect(rows).toHaveLength(1);
  });

  it('still permits the runner to INSERT a newly applied migration', async () => {
    // The runner needs SELECT and INSERT, and nothing more. If append-only had been
    // implemented as a blanket revoke, this is the test that would have caught it.
    const first = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, first);

    const second = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_create-gadget.sql': CREATE_GADGET,
    });
    const result = await runMigrations(pool, second);

    expect(result.applied.map((m) => m.version)).toStrictEqual([2]);

    const versions = await withClient(pool, async (client) => {
      const rows = await client.query<{ version: number }>(
        'SELECT version FROM qf_jarvis.schema_migration ORDER BY version',
      );
      return rows.rows.map((row) => row.version);
    });
    expect(versions).toStrictEqual([1, 2]);
  });

  it('remains a no-op on repeated execution, with the history untouched', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, directory);

    const before = await historyRow();

    const second = await runMigrations(pool, directory);
    const third = await runMigrations(pool, directory);

    expect(second.applied).toStrictEqual([]);
    expect(third.applied).toStrictEqual([]);

    const after = await historyRow();
    expect(after.checksum.equals(before.checksum)).toBe(true);
    expect(after.applied_at.getTime()).toBe(before.applied_at.getTime());
  });

  it('still reconciles checksums — the protection did not disable the check', async () => {
    const original = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, original);

    const edited = await migrationsDirectory({
      '0001_create-widget.sql': `${CREATE_WIDGET}\nALTER TABLE widget ADD COLUMN name TEXT;`,
    });

    await expect(runMigrations(pool, edited)).rejects.toThrow(MigrationChecksumMismatchError);
  });
});

describe('the repository is validated before the database is touched', () => {
  it('refuses a malformed filename', async () => {
    const directory = await migrationsDirectory({ 'create-widget.sql': CREATE_WIDGET });

    await expect(runMigrations(pool, directory)).rejects.toThrow(MalformedMigrationFilenameError);
  });

  it.each([
    '1_create-widget.sql',
    '0001-create-widget.sql',
    '0001_Create-Widget.sql',
    '0001_create widget.sql',
  ])('refuses the malformed filename "%s"', async (filename) => {
    const directory = await migrationsDirectory({ [filename]: CREATE_WIDGET });

    await expect(runMigrations(pool, directory)).rejects.toThrow(MalformedMigrationFilenameError);
  });

  it('refuses two files claiming the same version', async () => {
    const directory = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0001_create-gadget.sql': CREATE_GADGET,
    });

    await expect(runMigrations(pool, directory)).rejects.toThrow(DuplicateMigrationVersionError);
  });

  it('ignores non-SQL files, so a README beside the migrations is not a crash', async () => {
    const directory = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      'README.md': '# migrations',
    });

    const result = await runMigrations(pool, directory);
    expect(result.applied.map((m) => m.version)).toStrictEqual([1]);
  });
});

describe('a failed migration changes nothing', () => {
  it('rolls back, records nothing, and reports the cause', async () => {
    const directory = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_broken.sql': `CREATE TABLE gadget (id INTEGER PRIMARY KEY);\nTHIS IS NOT SQL;`,
    });

    await expect(runMigrations(pool, directory)).rejects.toThrow(MigrationExecutionError);

    // 0001 committed in its own transaction and stands.
    expect(await tableExists('widget')).toBe(true);
    // 0002 rolled back entirely — including the table it created before the syntax error.
    expect(await tableExists('gadget')).toBe(false);

    const applied = await withClient(pool, async (client) => {
      const rows = await client.query<{ version: number }>(
        'SELECT version FROM qf_jarvis.schema_migration ORDER BY version',
      );
      return rows.rows.map((row) => row.version);
    });

    // Nothing was recorded for the failed migration.
    expect(applied).toStrictEqual([1]);
  });

  it('preserves the original PostgreSQL error as the cause', async () => {
    const directory = await migrationsDirectory({ '0001_broken.sql': 'THIS IS NOT SQL;' });

    // Asymmetric matchers (`expect.objectContaining`) are typed `any`, and this package
    // does not use `any`. Capturing the rejection and narrowing it is both stricter and
    // clearer about what is actually being asserted.
    const thrown: unknown = await runMigrations(pool, directory).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(thrown).toBeInstanceOf(MigrationExecutionError);

    const cause = thrown instanceof Error ? thrown.cause : undefined;

    // The SQLSTATE and message from PostgreSQL are what a human actually needs. Wrapping
    // the error without them would be throwing away the answer.
    expect(cause).toBeInstanceOf(Error);
    expect(cause instanceof Error ? cause.message : '').toContain('syntax error');
  });
});

describe('the advisory lock', () => {
  it('is released after a successful run', async () => {
    const directory = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });

    await runMigrations(pool, directory);

    expect(await countAdvisoryLockHolders(pool, MIGRATION_ADVISORY_LOCK_KEY)).toBe(0);
  });

  it('is released after a failed migration', async () => {
    const directory = await migrationsDirectory({ '0001_broken.sql': 'THIS IS NOT SQL;' });

    await expect(runMigrations(pool, directory)).rejects.toThrow(MigrationExecutionError);

    // A crashed migration that keeps the lock wedges every future deploy.
    expect(await countAdvisoryLockHolders(pool, MIGRATION_ADVISORY_LOCK_KEY)).toBe(0);
  });

  it('is released after a reconciliation failure', async () => {
    const original = await migrationsDirectory({ '0001_create-widget.sql': CREATE_WIDGET });
    await runMigrations(pool, original);

    const edited = await migrationsDirectory({
      '0001_create-widget.sql': `${CREATE_WIDGET}\n-- edited`,
    });
    await expect(runMigrations(pool, edited)).rejects.toThrow(MigrationChecksumMismatchError);

    expect(await countAdvisoryLockHolders(pool, MIGRATION_ADVISORY_LOCK_KEY)).toBe(0);
  });

  it('serialises concurrent migrators — the second waits, and applies nothing twice', async () => {
    const directory = await migrationsDirectory({
      '0001_create-widget.sql': CREATE_WIDGET,
      '0002_create-gadget.sql': CREATE_GADGET,
    });

    // A rolling deploy starts two migrators at once. This is normal, not exceptional.
    const [first, second] = await Promise.all([
      runMigrations(pool, directory),
      runMigrations(pool, directory),
    ]);

    const appliedCounts = [first.applied.length, second.applied.length].sort((a, b) => a - b);

    // One ran both migrations; the other found the work already done. Between them the
    // work happened exactly once — which is what the lock is for.
    expect(appliedCounts).toStrictEqual([0, 2]);

    expect(await tableExists('widget')).toBe(true);
    expect(await tableExists('gadget')).toBe(true);

    const applied = await withClient(pool, async (client) => {
      const rows = await client.query<{ version: number }>(
        'SELECT version FROM qf_jarvis.schema_migration ORDER BY version',
      );
      return rows.rows.map((row) => row.version);
    });
    expect(applied).toStrictEqual([1, 2]);

    expect(await countAdvisoryLockHolders(pool, MIGRATION_ADVISORY_LOCK_KEY)).toBe(0);
  });
});
