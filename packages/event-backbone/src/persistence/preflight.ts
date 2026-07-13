/**
 * The managed-database **preflight**: everything you want to know before the first migration
 * touches a database you cannot undo a mistake on.
 *
 * ### It cannot write. That is enforced, not promised.
 *
 * Every query runs inside `BEGIN TRANSACTION READ ONLY`, which is then **rolled back**. A
 * stray `CREATE`, `INSERT`, `UPDATE` or `DELETE` in this file — now or in some future edit —
 * does not quietly succeed: **PostgreSQL refuses it**, with SQLSTATE `25006`.
 *
 * A comment saying "this function is read-only" is a promise made by whoever wrote it to
 * whoever reads it next, and it is worth exactly what that is worth. A read-only transaction
 * is a promise made by the database.
 *
 * ### Why a preflight exists at all
 *
 * The first migration against the managed database is the moment every deployment assumption
 * gets tested at once — TLS, connection mode, role privileges, server version, and whether
 * the schema is in the state we think it is. Discovering a wrong assumption *during* that
 * migration means discovering it with a half-applied schema and an advisory lock held.
 *
 * So it is checked first, from the **same validated configuration** `db:migrate` will use.
 * A preflight that validated a different connection than the migration then opens has
 * validated nothing.
 *
 * ### It fails closed
 *
 * Every required condition that is false makes the preflight fail. There is no "warning"
 * tier, because a warning in a deploy log is a thing that gets read once and then never
 * again.
 */

import {
  describeConnectionTarget,
  describeTls,
  isLoopbackConnectionTarget,
  type DatabaseConfig,
} from './database-config.js';
import type { DatabaseClient, DatabasePool } from './pool.js';
import { MIGRATION_SCHEMA } from './migration-types.js';
import { withClient } from './transaction.js';

/** The one PostgreSQL major version this repository supports (ADR-0023 §7). */
export const REQUIRED_POSTGRES_MAJOR_VERSION = 17;

/** One thing that was checked, and whether it passed. */
export interface PreflightCheck {
  readonly name: string;
  readonly passed: boolean;
  /** Safe to print. Never a URL, a host, a user, a password, a CA, or a project ref. */
  readonly detail: string;
  /** A failed advisory check reports but does not fail the preflight. */
  readonly required: boolean;
}

export interface PreflightReport {
  /** Redacted. `«managed host redacted»:5432/postgres` for anything non-loopback. */
  readonly target: string;
  readonly tls: string;
  readonly checks: readonly PreflightCheck[];
  readonly passed: boolean;
}

interface ServerFacts {
  readonly versionNum: number;
  readonly versionMajor: number;
  readonly databaseName: string;
  readonly currentUserIsSuperuser: boolean;
  readonly tlsActive: boolean;
  readonly schemaExists: boolean;
  readonly schemaTables: readonly string[];
  readonly migrationHistoryExists: boolean;
  readonly appliedMigrations: readonly { readonly version: number; readonly filename: string }[];
}

/**
 * Gather every fact, inside one **read-only** transaction, and roll it back.
 *
 * `pg_stat_ssl` is joined on the *current backend* — so `tlsActive` is a statement about
 * **this connection**, not about whether the server would accept TLS from somebody else.
 * That distinction is the whole point: a server that supports TLS while we connect without
 * it is precisely the failure being looked for.
 */
async function gatherServerFacts(client: DatabaseClient): Promise<ServerFacts> {
  {
    await client.query('BEGIN TRANSACTION READ ONLY');

    try {
      const version = await client.query<{ version_num: string; database_name: string }>(
        `SELECT current_setting('server_version_num') AS version_num,
                current_database()                    AS database_name`,
      );

      const superuser = await client.query<{ is_superuser: boolean }>(
        `SELECT COALESCE(
                  (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user),
                  false
                ) AS is_superuser`,
      );

      const ssl = await client.query<{ ssl_active: boolean }>(
        `SELECT COALESCE(
                  (SELECT s.ssl FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_backend_pid()),
                  false
                ) AS ssl_active`,
      );

      const schema = await client.query<{ schema_exists: boolean }>(
        `SELECT EXISTS (
                  SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
                ) AS schema_exists`,
        [MIGRATION_SCHEMA],
      );

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = $1
          ORDER BY table_name`,
        [MIGRATION_SCHEMA],
      );

      const historyExists = tables.rows.some((row) => row.table_name === 'schema_migration');

      // Only read the history if it is actually there. Selecting from a table that does not
      // exist would abort the transaction and turn "a virgin database" into "an error".
      const applied = historyExists
        ? await client.query<{ version: number; filename: string }>(
            `SELECT version, filename FROM ${MIGRATION_SCHEMA}.schema_migration ORDER BY version`,
          )
        : { rows: [] as { version: number; filename: string }[] };

      const versionNum = Number.parseInt(version.rows[0]?.version_num ?? '0', 10);

      return {
        versionNum,
        versionMajor: Math.floor(versionNum / 10_000),
        databaseName: version.rows[0]?.database_name ?? '(unknown)',
        currentUserIsSuperuser: superuser.rows[0]?.is_superuser ?? false,
        tlsActive: ssl.rows[0]?.ssl_active ?? false,
        schemaExists: schema.rows[0]?.schema_exists ?? false,
        schemaTables: tables.rows.map((row) => row.table_name),
        migrationHistoryExists: historyExists,
        appliedMigrations: applied.rows.map((row) => ({
          version: row.version,
          filename: row.filename,
        })),
      };
    } finally {
      // ROLLBACK, not COMMIT. There is nothing to commit — and if some future edit ever gives
      // it something to commit, this is the line that throws that work away.
      await client.query('ROLLBACK');
    }
  }
}

/**
 * Run the preflight on a pool. **Reads only. Changes nothing. Fails closed.**
 *
 * This is the standalone form, used by `pnpm db:preflight`. `db:migrate` uses
 * `runPreflightOnClient` instead, so that the preflight and the migration share one session.
 */
export async function runPreflight(
  pool: DatabasePool,
  config: DatabaseConfig,
): Promise<PreflightReport> {
  return withClient(pool, (client) => runPreflightOnClient(client, config));
}

/**
 * Run the preflight on a client the caller already holds.
 *
 * The report's strings are all safe to print: the target is redacted, and no check ever
 * carries a URL, a hostname, a username, a password, a CA, or a project ref.
 */
export async function runPreflightOnClient(
  client: DatabaseClient,
  config: DatabaseConfig,
): Promise<PreflightReport> {
  const loopback = isLoopbackConnectionTarget(config.connectionString);
  const facts = await gatherServerFacts(client);

  const checks: PreflightCheck[] = [];

  checks.push({
    name: 'PostgreSQL major version',
    required: true,
    passed: facts.versionMajor === REQUIRED_POSTGRES_MAJOR_VERSION,
    detail:
      facts.versionMajor === REQUIRED_POSTGRES_MAJOR_VERSION
        ? // The PATCH level is deliberately not asserted. Major 17 is the contract; the
          // provider chooses its patch, and pinning it here would be asserting something
          // this repository cannot enforce (ADR-0023 §7).
          `major ${String(facts.versionMajor)} (patch level is the provider's, and is not pinned)`
        : `major ${String(facts.versionMajor)} — required ${String(REQUIRED_POSTGRES_MAJOR_VERSION)}`,
  });

  checks.push({
    name: 'TLS',
    required: true,
    // Loopback may go bare. Everything else MUST be encrypted, and the config layer has
    // already refused a non-loopback connection without verify-full — this re-checks the
    // fact on the wire rather than trusting the intent.
    passed: loopback ? true : facts.tlsActive && config.tls.mode === 'verify-full',
    detail: loopback
      ? `loopback — TLS not required (configured: ${describeTls(config.tls)})`
      : facts.tlsActive
        ? `active on this connection, ${describeTls(config.tls)}`
        : 'NOT ACTIVE on this connection, and the host is not loopback',
  });

  checks.push({
    name: 'Migration role is not a superuser',
    // REQUIRED off loopback. ADVISORY on loopback — and the reason is not squeamishness.
    //
    // The official `postgres` Docker image creates `POSTGRES_USER` as a SUPERUSER. That is
    // true of the `compose.yml` this repository ships, and of the CI service container. So a
    // required check here would fail the documented "clone, compose up, pnpm check" path on
    // every developer's first run, and fail CI — not because anything is wrong, but because a
    // throwaway loopback database is a throwaway loopback database.
    //
    // The obligation this check enforces is about the MANAGED deployment role, and that is
    // where it is enforced. On loopback the fact is still reported, so it is visible; it just
    // does not block a laptop.
    required: !loopback,
    passed: !facts.currentUserIsSuperuser,
    detail: facts.currentUserIsSuperuser
      ? // A superuser bypasses every grant, and can `ALTER TABLE ... DISABLE TRIGGER`. The
        // immutability of the event log is not a property of the schema alone; it is a
        // property of the schema AND a role that cannot switch it off.
        loopback
        ? 'the connected role IS a superuser — acceptable on a throwaway loopback database, and NOT acceptable on the managed one'
        : 'the connected role IS a superuser — the append-only triggers and the REVOKEs do not bind it'
      : 'the connected role is not a superuser',
  });

  checks.push({
    name: 'Connection mode',
    required: true,
    // Unreachable-by-construction: createDatabaseConfig throws on a transaction-mode pooler
    // before a pool can exist. Reported anyway, because an operator reading a preflight
    // wants to see the thing they were worried about, confirmed.
    passed: true,
    detail: 'direct or session-mode (transaction-mode pooling is refused at config construction)',
  });

  checks.push({
    name: 'Database',
    required: true,
    passed: facts.databaseName !== '(unknown)',
    detail: facts.databaseName,
  });

  checks.push({
    name: `${MIGRATION_SCHEMA} schema`,
    required: false,
    passed: true,
    detail: facts.schemaExists
      ? `present — ${facts.schemaTables.length === 0 ? 'no tables' : facts.schemaTables.join(', ')}`
      : 'absent (a virgin database — the migration bootstrap will create it)',
  });

  checks.push({
    name: 'Migration history',
    required: false,
    passed: true,
    detail: facts.migrationHistoryExists
      ? facts.appliedMigrations.length === 0
        ? 'table present, no migrations applied'
        : facts.appliedMigrations.map((m) => `${String(m.version)} ${m.filename}`).join(' · ')
      : 'absent (nothing has been applied to this database)',
  });

  return {
    target: describeConnectionTarget(config.connectionString),
    tls: describeTls(config.tls),
    checks,
    passed: checks.every((check) => !check.required || check.passed),
  };
}
