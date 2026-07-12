/**
 * The migration CLI — an executable process boundary, and the **only** place in this
 * package that reads the environment.
 *
 * Library modules take configuration as an argument (see database-config.ts). A CLI is
 * different in kind: it *is* the edge, it has no caller to be given anything by, and
 * `DATABASE_URL` is how every tool in this ecosystem is told where the database is.
 *
 * ### What it will not print
 *
 * **Never the password. Never the connection URL. Never the user.** It prints the
 * redacted target — host, port, database — so that operational output can say *which*
 * database it touched without ever being able to leak *how to reach it*
 * (docs/architecture/trust-boundaries.md, "Logging restrictions").
 *
 * Exit code 0 on success, 1 on any failure. The pool is closed on both paths.
 */

import { createDatabaseConfig, describeConnectionTarget } from './database-config.js';
import { closeDatabasePool, createDatabasePool } from './pool.js';
import { MIGRATION_SCHEMA } from './migration-types.js';
import { defaultMigrationsDirectory } from './migrations-directory.js';
import { runMigrations } from './migration-runner.js';

async function main(): Promise<number> {
  const connectionString = process.env['DATABASE_URL'];

  if (connectionString === undefined || connectionString.trim() === '') {
    process.stderr.write(
      [
        'DATABASE_URL is not set.',
        '',
        'The QF Jarvis event backbone requires its own PostgreSQL database. It is never',
        "QuickFurno Core's database, and never QuickFurno Core's Supabase project (ADR-0019 §2).",
        '',
        'Deployment uses a DEDICATED, Supabase-managed QF-Jarvis project (ADR-0023).',
        '',
        'CONNECTION MODE: only a DIRECT or SESSION-mode connection is supported. A',
        'transaction-mode pooler (Supavisor, port 6543) is REFUSED — advisory locks,',
        'statement_timeout and application_name are all session-scoped, and transaction',
        'pooling would break the migration lock SILENTLY, with nothing going red.',
        '',
        `All Jarvis objects live in the "${MIGRATION_SCHEMA}" schema, never in "public".`,
        '',
        'Local development (PowerShell):',
        '  $env:QF_JARVIS_POSTGRES_PASSWORD = "<local-only password>"',
        '  docker compose up -d --wait',
        '  $env:DATABASE_URL = "postgresql://qf_jarvis_dev:<local-only password>@127.0.0.1:55432/qf_jarvis_dev"',
        '  pnpm db:migrate',
        '',
        'See docs/engineering/development-setup.md.',
        '',
      ].join('\n'),
    );
    return 1;
  }

  let config;
  try {
    config = createDatabaseConfig({
      connectionString,
      applicationName: 'qf-jarvis-migrate',
    });
  } catch (error: unknown) {
    // Includes UnsupportedConnectionModeError — a transaction-mode pooler. The message
    // names the rule and never the URL, the host, or the password.
    const message = error instanceof Error ? error.message : 'Invalid database configuration';
    process.stderr.write(`Refusing to migrate: ${message}\n`);
    return 1;
  }

  // Redacted. Host, port, database — never the user, never the password.
  const target = describeConnectionTarget(config.connectionString);
  process.stdout.write(`Migrating ${target} (schema ${MIGRATION_SCHEMA})\n`);

  const pool = createDatabasePool(config);

  try {
    const result = await runMigrations(pool, defaultMigrationsDirectory());

    if (result.applied.length === 0) {
      process.stdout.write(
        `Already up to date. ${String(result.alreadyApplied.length)} migration(s) applied previously.\n`,
      );
      return 0;
    }

    for (const migration of result.applied) {
      process.stdout.write(`  applied  ${migration.filename}\n`);
    }
    process.stdout.write(`Applied ${String(result.applied.length)} migration(s).\n`);
    return 0;
  } catch (error: unknown) {
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
