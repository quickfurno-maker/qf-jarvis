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
import { describeConnectionTarget, describeTls } from './database-config.js';
import { migrateWithPreflight, PreflightFailedError } from './migrate.js';
import { closeDatabasePool, createDatabasePool } from './pool.js';
import { MIGRATION_SCHEMA } from './migration-types.js';
import { defaultMigrationsDirectory } from './migrations-directory.js';

async function main(): Promise<number> {
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
  const target = describeConnectionTarget(config.connectionString);
  process.stdout.write(`Migrating ${target} (schema ${MIGRATION_SCHEMA})\n`);
  process.stdout.write(`TLS       ${describeTls(config.tls)}\n`);

  const pool = createDatabasePool(config);

  try {
    // The preflight is not optional and not a separate step an operator might skip. It runs
    // on the same client, before the advisory lock and before any DDL, and it aborts the
    // migration if it fails.
    const { preflight, migration } = await migrateWithPreflight(
      pool,
      config,
      defaultMigrationsDirectory(),
    );

    process.stdout.write('\nPreflight\n');
    for (const check of preflight.checks) {
      const tier = check.required ? ' ' : '~';
      process.stdout.write(`  ok ${tier} ${check.name}: ${check.detail}\n`);
    }
    process.stdout.write('\n');

    if (migration.applied.length === 0) {
      process.stdout.write(
        `Already up to date. ${String(migration.alreadyApplied.length)} migration(s) applied previously.\n`,
      );
      return 0;
    }

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
