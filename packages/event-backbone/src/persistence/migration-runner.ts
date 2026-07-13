/**
 * A forward-only migration runner. About a hundred lines, and no framework.
 *
 * ### The order of operations, and why it is this order
 *
 * 1. **Load and validate the files first**, before touching the database. A malformed
 *    filename or a duplicate version is a repository defect, and there is no reason to
 *    open a connection to discover it.
 * 2. **Take an advisory lock.** Two migrators starting at once is normal — a rolling
 *    deploy does it by design. The lock makes the second one wait rather than race.
 * 3. **Bootstrap the history table**, idempotently, *inside* the lock. Bootstrapping
 *    outside the lock would be two processes racing to `CREATE TABLE`. The bootstrap also
 *    installs the controls that make the history itself **append-only** — see below.
 * 4. **Reconcile** what the database says was applied against what is on disk. Any
 *    disagreement fails closed, before a single new migration runs.
 * 5. **Apply each new migration in its own transaction.** One migration, one transaction:
 *    a failure rolls back exactly that migration and records nothing.
 * 6. **Release the lock in `finally`** — on success, on failure, on anything.
 *
 * ### Forward-only, and history is never rewritten
 *
 * There are no down-migrations. Rollback is a new migration, or a restore. And an applied
 * migration's checksum is checked on every startup: **editing history fails the process**
 * rather than quietly leaving two databases that disagree about what they are.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DuplicateMigrationVersionError,
  MalformedMigrationFilenameError,
  MigrationChecksumMismatchError,
  MigrationExecutionError,
  MigrationFileMissingError,
  OutOfOrderMigrationError,
} from './migration-errors.js';
import {
  MIGRATION_ADVISORY_LOCK_KEY,
  MIGRATION_FILENAME_PATTERN,
  MIGRATION_SCHEMA,
  MIGRATION_TABLE,
  type AppliedMigration,
  type MigrationFile,
  type MigrationResult,
} from './migration-types.js';
import type { DatabaseClient, DatabasePool } from './pool.js';
import { withClient } from './transaction.js';

/**
 * The history table — and the controls that make it **append-only**.
 *
 * Every statement here is idempotent, and every one of them runs while the advisory lock
 * is held, so two migrators starting at once cannot race to create the same object.
 *
 * The table is deliberately **not** a migration itself. A migration runner that needs its
 * own history table to exist before it can read its own history has a bootstrap problem,
 * and the honest fix is to state the bootstrap explicitly rather than hide it in `0000_`.
 *
 * ### Why the history is protected exactly as hard as the event log
 *
 * `schema_migration` **is** the migration history. It is the record that says *this
 * database is at version N, and version N had this exact content*. An `UPDATE` of a
 * checksum here silently defeats the reconciliation check that is the entire point of
 * checksumming — the runner would compare a tampered file against a tampered record,
 * find them in agreement, and start. A `DELETE` re-opens an applied migration for
 * re-application against a schema that already has it.
 *
 * A control that can be edited by the thing it constrains is not a control. So the same
 * two mechanisms guard it as guard the event log: a trigger that fires for every role,
 * and a REVOKE for ordinary ones.
 *
 * The runner needs only **SELECT** and **INSERT**, and it is written that way. Nothing in
 * this file issues an `UPDATE` or a `DELETE` against the history, and now nothing can.
 *
 * **The same limit applies, and is not glossed:** a PostgreSQL **superuser** is not
 * constrained by grants, and the table **owner** can `ALTER TABLE ... DISABLE TRIGGER`.
 * Therefore **the deployment's migration role must not be a superuser**, and the
 * application role must be neither a superuser nor the owner of these tables. That is a
 * deployment obligation. Stage 3.1 cannot discharge it, and does not pretend to.
 */
/**
 * Revoke everything in the schema from PUBLIC and from a managed provider's own roles.
 *
 * ### Why this is a `DO` block and not four `REVOKE` statements
 *
 * `anon`, `authenticated` and `service_role` are **Supabase's** roles. They do not exist in
 * an ordinary PostgreSQL, so `REVOKE ... FROM service_role` is a **hard error** on a
 * developer's laptop and in CI. A migration that only runs on the provider would mean the
 * thing CI proved is not the thing production runs — which is the exact failure ADR-0019
 * refused when it rejected a dual dialect.
 *
 * So the roles are looked up in `pg_roles` first, and revoked from **only if they exist**.
 * The same SQL then runs everywhere: on Supabase it revokes three roles, and locally it
 * revokes none, because there are none.
 *
 * ### Why it re-runs on every migration
 *
 * It is idempotent on purpose. A managed provider that re-grants to its own roles during a
 * platform upgrade would otherwise silently re-open the door, and **nothing would go red**.
 * Re-asserting the revoke on every migration run is cheap; discovering the grant by reading
 * about it in someone else's incident report is not.
 */
const REVOKE_FROM_MANAGED_ROLES_SQL = `
DO $revoke$
DECLARE
  managed_role TEXT;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA ${MIGRATION_SCHEMA} FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA ${MIGRATION_SCHEMA} FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${MIGRATION_SCHEMA} FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${MIGRATION_SCHEMA} FROM %I', managed_role);
    END IF;
  END LOOP;
END
$revoke$;
`;

const BOOTSTRAP_SQL = `
-- The private schema. Everything QF Jarvis owns lives here; NOTHING lives in "public".
CREATE SCHEMA IF NOT EXISTS ${MIGRATION_SCHEMA};

CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
  version    INTEGER      NOT NULL PRIMARY KEY,
  filename   TEXT         NOT NULL,
  checksum   BYTEA        NOT NULL,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT schema_migration_filename_not_empty CHECK (length(filename) > 0),
  CONSTRAINT schema_migration_checksum_is_sha256 CHECK (octet_length(checksum) = 32),
  CONSTRAINT schema_migration_version_positive   CHECK (version > 0)
);

CREATE OR REPLACE FUNCTION ${MIGRATION_SCHEMA}.schema_migration_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $reject$
BEGIN
  RAISE EXCEPTION
    'The migration history is append-only: % is not permitted on table "${MIGRATION_TABLE}". '
    'A migration record is the evidence of what this database is. Editing it defeats the '
    'checksum reconciliation that protects the schema. Roll forward with a new migration.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$reject$;

CREATE OR REPLACE TRIGGER schema_migration_is_append_only
  BEFORE UPDATE OR DELETE ON ${MIGRATION_TABLE}
  FOR EACH ROW
  EXECUTE FUNCTION ${MIGRATION_SCHEMA}.schema_migration_reject_mutation();

-- Nobody reaches this schema by default. Not PUBLIC, and not a managed provider's roles.
-- Without USAGE on the schema, every object inside it is unreachable by name — which is
-- the property that makes one revoke worth more than a hundred table grants.
REVOKE ALL ON SCHEMA ${MIGRATION_SCHEMA} FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ${MIGRATION_SCHEMA} FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${MIGRATION_SCHEMA} FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${MIGRATION_SCHEMA} FROM PUBLIC;

${REVOKE_FROM_MANAGED_ROLES_SQL}
`;

/** SHA-256 over the exact file bytes. Not over decoded text — a re-encode is a different file. */
function checksumOf(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/**
 * Read the migrations directory, validate every filename, and checksum every file.
 *
 * Fails closed on a malformed name or a duplicate version. Non-`.sql` files are ignored,
 * so a `README.md` beside the migrations is not a crash.
 */
export async function loadMigrationFiles(directory: string): Promise<readonly MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const byVersion = new Map<number, MigrationFile>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) {
      continue;
    }

    const match = MIGRATION_FILENAME_PATTERN.exec(entry.name);
    if (match === null) {
      throw new MalformedMigrationFilenameError(entry.name);
    }

    const versionText = match[1];
    if (versionText === undefined) {
      throw new MalformedMigrationFilenameError(entry.name);
    }

    const version = Number.parseInt(versionText, 10);
    if (version <= 0) {
      throw new MalformedMigrationFilenameError(entry.name);
    }

    const existing = byVersion.get(version);
    if (existing !== undefined) {
      throw new DuplicateMigrationVersionError(version, existing.filename, entry.name);
    }

    const absolutePath = join(directory, entry.name);
    const bytes = await readFile(absolutePath);

    byVersion.set(version, {
      version,
      filename: entry.name,
      absolutePath,
      checksum: checksumOf(bytes),
      sql: bytes.toString('utf8'),
    });
  }

  return [...byVersion.values()].sort((a, b) => a.version - b.version);
}

/** Read the history table. Assumes the bootstrap has already run. */
async function readAppliedMigrations(client: DatabaseClient): Promise<readonly AppliedMigration[]> {
  const result = await client.query<{
    version: number;
    filename: string;
    checksum: Buffer;
    applied_at: Date;
  }>(`SELECT version, filename, checksum, applied_at FROM ${MIGRATION_TABLE} ORDER BY version ASC`);

  return result.rows.map((row) => ({
    version: row.version,
    filename: row.filename,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

/**
 * Reconcile the database's history against the files on disk. **Fails closed on any
 * disagreement, before a single new migration is applied.**
 */
function reconcile(files: readonly MigrationFile[], applied: readonly AppliedMigration[]): void {
  const fileByVersion = new Map(files.map((file) => [file.version, file]));

  for (const record of applied) {
    const file = fileByVersion.get(record.version);

    if (file === undefined) {
      throw new MigrationFileMissingError(record.version, record.filename);
    }

    if (!file.checksum.equals(record.checksum)) {
      throw new MigrationChecksumMismatchError(
        record.version,
        record.filename,
        record.checksum,
        file.checksum,
      );
    }
  }

  const appliedVersions = new Set(applied.map((record) => record.version));
  const highestApplied = applied.reduce((highest, record) => Math.max(highest, record.version), 0);

  for (const file of files) {
    if (!appliedVersions.has(file.version) && file.version < highestApplied) {
      throw new OutOfOrderMigrationError(file.version, file.filename, highestApplied);
    }
  }
}

/**
 * Apply one migration in its own transaction.
 *
 * The migration's SQL and the history row are written **together**. A migration that ran
 * but was not recorded would be re-applied on the next startup; a migration recorded but
 * not run would be skipped forever. One transaction makes both impossible.
 */
async function applyMigration(client: DatabaseClient, file: MigrationFile): Promise<void> {
  try {
    await client.query('BEGIN');
    await client.query(file.sql);
    await client.query(
      `INSERT INTO ${MIGRATION_TABLE} (version, filename, checksum) VALUES ($1, $2, $3)`,
      [file.version, file.filename, file.checksum],
    );
    await client.query('COMMIT');
  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original failure is the one worth reporting.
    }
    throw new MigrationExecutionError(file.version, file.filename, error);
  }
}

/**
 * Run every unapplied migration, in order, under an advisory lock.
 *
 * Idempotent: running it twice applies nothing the second time.
 */
export async function runMigrations(
  pool: DatabasePool,
  migrationsDirectory: string,
): Promise<MigrationResult> {
  // Validate the repository before opening a connection. A malformed filename is not a
  // database problem and should not need a database to discover.
  const files = await loadMigrationFiles(migrationsDirectory);

  return withClient(pool, (client) => runMigrationsOnClient(client, files));
}

/**
 * The migration itself, on a client the caller already holds.
 *
 * Extracted so that `migrateWithPreflight` can run the **read-only preflight and the migration
 * on the SAME session** (see migrate.ts). A preflight on one connection and a migration on
 * another has checked a connection that is not the one about to write.
 *
 * **This is the first line that touches the database with intent to change it.** Everything
 * that must happen before that — file validation, the preflight — has to happen before this
 * function is called, and `migrateWithPreflight` is the thing that guarantees it does.
 */
export async function runMigrationsOnClient(
  client: DatabaseClient,
  files: readonly MigrationFile[],
): Promise<MigrationResult> {
  // Session-scoped. Held until explicitly unlocked, or until this session ends —
  // which is what stops a crashed migrator from wedging the database permanently.
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);

  try {
    await client.query(BOOTSTRAP_SQL);

    const alreadyApplied = await readAppliedMigrations(client);
    reconcile(files, alreadyApplied);

    const appliedVersions = new Set(alreadyApplied.map((record) => record.version));
    const pending = files.filter((file) => !appliedVersions.has(file.version));

    const applied: MigrationFile[] = [];
    for (const file of pending) {
      await applyMigration(client, file);
      applied.push(file);
    }

    return { applied, alreadyApplied };
  } finally {
    // Released on every path — success, validation failure, SQL failure. The `finally`
    // is the whole reason a crashed migration does not block the next deploy.
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
  }
}
