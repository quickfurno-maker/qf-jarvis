/**
 * JAO-3 integration-test plumbing, and the guards that stop it ever running anywhere real.
 *
 * Not a test file. This is the ONLY module in the JAO-3 slice that reads `DATABASE_URL` or touches
 * the filesystem, and `apps/worker/tsconfig.build.json` excludes `src/tests/**` from the emitting
 * build -- so the production source contains no environment read and no file read at all.
 *
 * ### It fails loudly. It never skips.
 *
 * Without `DATABASE_URL` every JAO-3 database test FAILS. Durability across a restart is the entire
 * claim of this slice, and a suite that quietly reported success without a database would be worse
 * than no suite: an in-memory store also passes every test that never opens a connection.
 *
 * ### It refuses anything that might not be a test database
 *
 * Loopback host, test-shaped database name, and a refusal of anything Supabase-, QuickFurno- or
 * production-shaped. Supabase is a DEPLOYMENT target, never a test target (ADR-0023 §8). No
 * credential is ever printed: a failure names the rule that was broken, not the value.
 *
 * ### It owns exactly one schema, and drops exactly that one
 *
 * `qf_jarvis_jao3`, created by the local JAO-3 schema asset. It never touches `public`, never
 * touches `qf_jarvis` -- the managed event-backbone schema -- and never runs a managed migration.
 * That separation is the point: JAO-3's schema is a local asset for this proof, not an entry in
 * migration history that a routine `pnpm db:migrate` would apply to a real database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  withClient,
  type DatabaseConfig,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';

/** Loopback only. Not a provider denylist to keep up with -- an allowlist of three. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
/** The database name must say it is a test database. */
const TEST_DATABASE_PATTERN = /(^|[_-])test($|[_-])|test$/iu;
/** Substrings that mean "this is not a test database, stop". */
const FORBIDDEN_SUBSTRINGS = ['supabase', 'quickfurno', 'prod', 'production', 'live'];

/** The schema this harness owns, creates and drops. Nothing else. */
export const JAO3_TEST_SCHEMA = 'qf_jarvis_jao3';

export function requireJao3TestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      [
        'DATABASE_URL is not set, so the JAO-3 durability tests cannot run.',
        '',
        'These tests FAIL rather than skip. JAO-3 claims that operational memory survives a',
        'restart, and an in-memory store passes every test that never opens a connection.',
        '',
        'Local development (PowerShell):',
        '  $env:QF_JARVIS_POSTGRES_PASSWORD = "<local-only password>"',
        '  docker compose up -d --wait',
        '  $env:DATABASE_URL = "postgresql://qf_jarvis_dev:<local-only password>@127.0.0.1:55432/qf_jarvis_test"',
      ].join('\n'),
    );
  }

  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Never echo the string -- it carries a password.
    throw new Error('DATABASE_URL is not a parseable URL.');
  }

  const host = parsed.hostname.replace(/^\[|\]$/gu, '');
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      'DATABASE_URL must point at a loopback host. A managed database is never a test target.',
    );
  }
  const database = parsed.pathname.replace(/^\//u, '');
  const haystack = `${host} ${database}`.toLowerCase();
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(forbidden)) {
      throw new Error('DATABASE_URL resembles a managed or production target and is refused.');
    }
  }
  if (!TEST_DATABASE_PATTERN.test(database)) {
    throw new Error('DATABASE_URL must name a database that identifies itself as a test database.');
  }
  return trimmed;
}

export function jao3TestDatabaseConfig(applicationName: string): DatabaseConfig {
  return createDatabaseConfig({
    connectionString: requireJao3TestDatabaseUrl(),
    // Small: the restart proof holds several pools at once, and a suite that exhausts
    // PostgreSQL's connection slots fails for the wrong reason.
    maxConnections: 5,
    applicationName,
  });
}

/**
 * A pool over the validated test database. The caller closes it.
 *
 * Each "process" in the restart proof gets its own, which is what makes the boundary real: no
 * pool, client, adapter or closure survives from one to the next.
 */
export function createJao3TestPool(applicationName: string): DatabasePool {
  return createDatabasePool(jao3TestDatabaseConfig(applicationName));
}

/** The local schema asset, read from source. Deliberately not a managed migration. */
export function readJao3SchemaSql(): string {
  return readFileSync(
    fileURLToPath(
      new URL('../jao/operational-memory/schema/001_jao_investigation_memory.sql', import.meta.url),
    ),
    'utf8',
  );
}

/**
 * Drop JAO-3's own schema and apply the local asset, so a suite starts from nothing.
 *
 * `CASCADE` appears here and nowhere in the schema asset itself: this is test cleanup of one
 * schema this harness created, not a production statement. The managed `qf_jarvis` schema and the
 * shared `public` schema are never named.
 */
export async function resetJao3Schema(pool: DatabasePool): Promise<void> {
  requireJao3TestDatabaseUrl();
  await withClient(pool, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS ${JAO3_TEST_SCHEMA} CASCADE`);
    await client.query(readJao3SchemaSql());
  });
}

/** Apply the schema without dropping, proving the asset is safely re-appliable. */
export async function applyJao3Schema(pool: DatabasePool): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(readJao3SchemaSql());
  });
}

/** A raw count, for asserting that a write did or did not add history. */
export async function countJao3Rows(pool: DatabasePool, table: string): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM ${JAO3_TEST_SCHEMA}.${table}`,
    );
    return Number(result.rows[0]?.total ?? '0');
  });
}

/** Rows in one table for one investigation, so "zero duplicates" is counted rather than inferred. */
export async function countJao3RowsFor(
  pool: DatabasePool,
  table: 'checkpoint' | 'owner_correction' | 'operation_replay',
  investigationId: string,
): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ readonly total: string }>(
      `SELECT count(*)::text AS total FROM ${JAO3_TEST_SCHEMA}.${table} WHERE investigation_id = $1`,
      [investigationId],
    );
    return Number(result.rows[0]?.total ?? '0');
  });
}

/** Corrupt one persisted value, so "fails closed on a malformed row" can be measured. */
export async function forceJao3RawUpdate(
  pool: DatabasePool,
  sql: string,
  params: readonly unknown[],
): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(sql, [...params]);
  });
}

export { closeDatabasePool };
export type { DatabaseConfig, DatabasePool };
