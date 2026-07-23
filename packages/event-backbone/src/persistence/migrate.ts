/**
 * **The migration gate.** The preflight is not advisory, and it is not a habit an operator is
 * trusted to have — it is a precondition the code enforces.
 *
 * ### The order, and why it is provable rather than promised
 *
 * ```
 * 1. loadMigrationFiles(directory)      ← no connection yet. A bad filename needs no database.
 * 2. withClient(pool)                   ← ONE client, for everything below.
 * 3. runPreflightOnClient(client)       ← BEGIN TRANSACTION READ ONLY … ROLLBACK
 * 4. if (!report.passed) throw          ← nothing after this line runs
 * 5. runMigrationsOnClient(client)      ← pg_advisory_lock, bootstrap, DDL
 * ```
 *
 * **Step 5 contains the first statement that can change anything** — the advisory lock, the
 * `CREATE SCHEMA`, the `REVOKE`s, the migration itself. It is unreachable from a failed
 * preflight, because step 4 throws. There is no ordering to get wrong at a call site, because
 * there is no call site: a caller cannot ask for step 5 without step 3, since the only exported
 * way through this file runs both.
 *
 * ### One client, not two
 *
 * The preflight runs on **the same session** the migration then uses. A preflight on one
 * connection and a migration on another has verified a connection that is not the one about to
 * write — different backend, potentially different role, potentially different TLS. That is a
 * check that looks like a check.
 *
 * ### The configuration is never rebuilt
 *
 * `migrateWithPreflight` takes the `DatabaseConfig` the pool was built from. It does not
 * re-read the environment and it does not reconstruct anything, so the thing checked and the
 * thing used are the same object.
 */

import type { DatabaseConfig } from './database-config.js';
import {
  loadMigrationFiles,
  runMigrationsOnClient,
  type MigrationRunOptions,
} from './migration-runner.js';
import type { MigrationResult } from './migration-types.js';
import type { DatabasePool } from './pool.js';
import { runPreflightOnClient, type PreflightReport } from './preflight.js';
import { withClient } from './transaction.js';

/**
 * The preflight failed, so **no migration was attempted**.
 *
 * Distinct from a `MigrationExecutionError` on purpose, and the CLIs report them differently.
 * *"Managed database preflight failed"* and *"Migration failed"* mean very different things to
 * whoever is reading a deploy log at 2am: the first means **nothing was touched**, and the
 * second means something might have been.
 */
export class PreflightFailedError extends Error {
  public readonly report: PreflightReport;

  public constructor(report: PreflightReport) {
    const failed = report.checks
      .filter((check) => check.required && !check.passed)
      .map((check) => `${check.name}: ${check.detail}`);

    super(
      `Managed database preflight failed. NO migration was attempted and NOTHING was changed.\n` +
        failed.map((line) => `  - ${line}`).join('\n'),
    );

    this.name = 'PreflightFailedError';
    this.report = report;
  }
}

export interface MigrateWithPreflightResult {
  readonly preflight: PreflightReport;
  readonly migration: MigrationResult;
}

/**
 * Preflight, then migrate — on one client, in that order, or not at all.
 *
 * **This is the only PUBLIC way to migrate, and the package root enforces that.**
 *
 * `runMigrations` and `runMigrationsOnClient` still exist in `migration-runner.ts` — this file
 * composes them, and the runner's own tests exercise them in isolation — but they are
 * **internal runner and testing functions and are not exported from `../index.ts`.** They take
 * the advisory lock and execute DDL with **no preflight**, so publishing them beside this
 * function offered a consumer a supported, type-safe path *around* the gate. **`db:migrate`
 * cannot bypass the preflight**: it calls this, and there is no other public door.
 *
 * Deep imports from `persistence/*` are unsupported — the package `exports` map publishes `.`
 * and nothing else. `tests/public-api.test.ts` fails if a bypass is ever re-exported.
 */
export async function migrateWithPreflight(
  pool: DatabasePool,
  config: DatabaseConfig,
  migrationsDirectory: string,
  options: MigrationRunOptions = {},
): Promise<MigrateWithPreflightResult> {
  // Before a connection is opened. A malformed migration filename is a repository defect and
  // has no business costing a round trip to discover.
  const files = await loadMigrationFiles(migrationsDirectory);

  return withClient(pool, async (client) => {
    const preflight = await runPreflightOnClient(client, config);

    if (!preflight.passed) {
      // Nothing below has run. No advisory lock has been taken, no schema created, no
      // bootstrap executed, no history row written.
      throw new PreflightFailedError(preflight);
    }

    const migration = await runMigrationsOnClient(client, files, options);

    return { preflight, migration };
  });
}
