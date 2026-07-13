/**
 * `pnpm db:preflight` — check everything about a managed database **before** the first
 * migration touches it.
 *
 * It reads. It never writes: every query runs inside a `READ ONLY` transaction that is then
 * rolled back, so a write is not merely absent from this code — it is **refused by
 * PostgreSQL** (see preflight.ts).
 *
 * It uses the **same validated configuration** as `db:migrate`. A preflight that checked a
 * different connection than the migration then opens would have checked nothing.
 *
 * Exit 0 when every required check passes. Exit 1 otherwise, and **nothing has been changed
 * either way.**
 *
 * ### What it prints, and what it will never print
 *
 * The target is redacted — `«managed host redacted»:5432/postgres` — because the hostname of
 * a managed database contains the project ref. It prints no URL, no username, no password,
 * no CA path, and no CA contents.
 */

import { resolveCliDatabaseConfig } from './cli-config.js';
import { closeDatabasePool, createDatabasePool } from './pool.js';
import { runPreflight } from './preflight.js';

async function main(): Promise<number> {
  let config;
  try {
    config = await resolveCliDatabaseConfig('qf-jarvis-preflight');
  } catch (error: unknown) {
    // Covers a missing DATABASE_URL, a missing/unreadable/malformed CA, a transaction-mode
    // pooler, and a URL carrying sslmode. Every one of those messages names the RULE and
    // never the value.
    process.stderr.write(
      `Preflight refused to connect: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }

  const pool = createDatabasePool(config);

  try {
    const report = await runPreflight(pool, config);

    process.stdout.write(`Preflight  ${report.target}\n`);
    process.stdout.write(`TLS        ${report.tls}\n\n`);

    for (const check of report.checks) {
      const mark = check.passed ? 'ok  ' : 'FAIL';
      const tier = check.required ? ' ' : '~';
      process.stdout.write(`  ${mark}${tier} ${check.name}: ${check.detail}\n`);
    }

    if (!report.passed) {
      process.stderr.write(
        '\nPreflight FAILED. Nothing was changed — the database is exactly as it was.\n' +
          'Do not migrate until every required check passes.\n',
      );
      return 1;
    }

    process.stdout.write('\nPreflight passed. Nothing was changed (read-only transaction).\n');
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown preflight failure';
    process.stderr.write(`Preflight failed: ${message}\n`);
    return 1;
  } finally {
    await closeDatabasePool(pool);
  }
}

// This module is an executable. Running it is the point; importing it is not.
const exitCode = await main();
process.exitCode = exitCode;
