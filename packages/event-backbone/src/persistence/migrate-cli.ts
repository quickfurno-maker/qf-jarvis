/**
 * The migration CLI — an executable process boundary.
 *
 * Library modules take configuration as an argument (see database-config.ts). A CLI is
 * different in kind: it *is* the edge, it has no caller to be given anything by, and
 * `DATABASE_URL` is how every tool in this ecosystem is told where the database is.
 *
 * The environment reading itself lives in `cli-config.ts`, shared with `db:preflight`, so
 * that the connection the preflight validates is **the same connection this migrates**.
 *
 * ### What it will not print
 *
 * **Never the password. Never the connection URL. Never the user. Never the managed
 * hostname** — which, for a managed provider, contains the project ref. It prints the
 * redacted target, so that operational output can say *which* database it touched without
 * ever being able to leak *how to reach it*
 * (docs/architecture/trust-boundaries.md, "Logging restrictions").
 *
 * Exit code 0 on success, 1 on any failure. The pool is closed on both paths.
 */

import { resolveCliDatabaseConfig } from './cli-config.js';
import {
  describeConnectionTarget,
  describeTls,
  isLoopbackConnectionTarget,
} from './database-config.js';
import { migrateWithPreflight, PreflightFailedError } from './migrate.js';
import { UnboundedManagedMigrationError } from './migration-errors.js';
import { loadMigrationFiles } from './migration-runner.js';
import {
  parseMigrationThroughOption,
  planMigrationSelection,
  resolveMigrationTarget,
} from './migration-target.js';
import { closeDatabasePool, createDatabasePool } from './pool.js';
import { MIGRATION_SCHEMA, type MigrationFile } from './migration-types.js';
import { defaultMigrationsDirectory } from './migrations-directory.js';

/** Render a version list as zero-padded versions, or a dash when empty. */
function describeVersions(files: readonly MigrationFile[]): string {
  return files.length === 0
    ? '—'
    : files.map((file) => String(file.version).padStart(4, '0')).join(', ');
}

async function main(): Promise<number> {
  // Parsed FIRST, before any configuration is resolved and before any connection exists: an
  // unreadable invocation must never reach a database.
  let throughVersion: number | null;
  let files: readonly MigrationFile[];
  let target: MigrationFile | null = null;
  try {
    throughVersion = parseMigrationThroughOption(process.argv.slice(2));
    files = await loadMigrationFiles(defaultMigrationsDirectory());
    if (throughVersion !== null) {
      target = resolveMigrationTarget(files, throughVersion);
    }
  } catch (error: unknown) {
    process.stderr.write(
      `Refusing to migrate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  let config;
  try {
    config = await resolveCliDatabaseConfig('qf-jarvis-migrate');
  } catch (error: unknown) {
    // A missing DATABASE_URL, a missing or malformed CA certificate, a transaction-mode
    // pooler, or a URL carrying sslmode/sslrootcert. Every message names the RULE that was
    // broken and never the value that broke it.
    process.stderr.write(
      `Refusing to migrate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  // Redacted. Port and database — never the user, never the password, and never the managed
  // hostname, because that hostname carries the project ref.
  const redactedTarget = describeConnectionTarget(config.connectionString);
  const isLocal = isLoopbackConnectionTarget(config.connectionString);
  const classification = isLocal ? 'local (loopback)' : 'managed';

  // A managed database must name the exact version it intends to reach. Raised BEFORE the pool
  // is created, before the preflight, before the advisory lock, and before any migration SQL.
  if (!isLocal && throughVersion === null) {
    const unbounded = new UnboundedManagedMigrationError();
    process.stderr.write(`Refusing to migrate: ${unbounded.message}\n`);
    process.stderr.write('No connection was opened, no advisory lock was taken, and no DDL ran.\n');
    return 1;
  }

  process.stdout.write(`Migrating ${redactedTarget} (schema ${MIGRATION_SCHEMA})\n`);
  process.stdout.write(`TLS       ${describeTls(config.tls)}\n`);

  // The sanitized plan: what was asked for, and what the bound deliberately leaves out. Versions
  // and filenames only — never a host, a user, or a connection value.
  process.stdout.write('\nPlan\n');
  process.stdout.write(
    `  target       ${target === null ? 'unbounded (local only)' : `${String(target.version).padStart(4, '0')} (${target.filename})`}\n`,
  );
  process.stdout.write(`  target class ${classification}\n`);
  process.stdout.write(`  repository   ${describeVersions(files)}\n`);
  process.stdout.write(
    `  excluded     ${describeVersions(planMigrationSelection(files, new Set(), throughVersion).excluded)} (beyond target)\n`,
  );

  const pool = createDatabasePool(config);

  try {
    // The preflight is not optional and not a separate step an operator might skip. It runs
    // on the same client, before the advisory lock and before any DDL, and it aborts the
    // migration if it fails.
    const { preflight, migration } = await migrateWithPreflight(
      pool,
      config,
      defaultMigrationsDirectory(),
      { throughVersion: throughVersion ?? undefined },
    );

    process.stdout.write('\nPreflight\n');
    for (const check of preflight.checks) {
      const tier = check.required ? ' ' : '~';
      process.stdout.write(`  ok ${tier} ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write('\n');

    const previously = migration.alreadyApplied
      .map((record) => String(record.version).padStart(4, '0'))
      .join(', ');
    process.stdout.write(`  already applied  ${previously.length === 0 ? '—' : previously}\n`);

    if (migration.applied.length === 0) {
      // A bounded run whose target is already reached is a VERIFIED no-op: the history was read,
      // reconciled and checksum-verified, and nothing was selected.
      process.stdout.write(
        `  applied now      —\n\nAlready at target. ${String(migration.alreadyApplied.length)} migration(s) applied previously; nothing to do.\n`,
      );
      return 0;
    }

    process.stdout.write(`  applied now      ${describeVersions(migration.applied)}\n\n`);
    for (const applied of migration.applied) {
      process.stdout.write(`  applied  ${applied.filename}\n`);
    }
    process.stdout.write(`Applied ${String(migration.applied.length)} migration(s).\n`);
    return 0;
  } catch (error: unknown) {
    // These two mean very different things to somebody reading a deploy log at 2am.
    //
    //   "Managed database preflight failed"  → NOTHING was touched. No lock, no schema, no DDL.
    //   "Migration failed"                   → something ran, and rolled back.
    //
    // Collapsing them into one message would turn a safe outcome and a scary one into the
    // same line.
    if (error instanceof PreflightFailedError) {
      process.stderr.write(`\nManaged database preflight failed.\n`);
      for (const check of error.report.checks.filter((c) => c.required && !c.passed)) {
        process.stderr.write(`  FAIL  ${check.name}: ${check.detail}\n`);
      }
      process.stderr.write(
        '\nNo migration was attempted. No advisory lock was taken, no schema was created,\n' +
          'and no DDL ran. The database is exactly as it was.\n',
      );
      return 1;
    }

    const message = error instanceof Error ? error.message : 'Unknown migration failure';
    process.stderr.write(`Migration failed: ${message}\n`);

    if (error instanceof Error && error.cause instanceof Error) {
      process.stderr.write(`  cause: ${error.cause.message}\n`);
    }
    return 1;
  } finally {
    await closeDatabasePool(pool);
  }
}

// This module is an executable. Running it is the point; importing it is not.
const exitCode = await main();
process.exitCode = exitCode;
