/**
 * Integration-test plumbing — and the guards that stop it ever running anywhere real.
 *
 * Not a test file.
 *
 * ### It fails loudly. It never skips.
 *
 * If `DATABASE_URL` is absent, every database test **fails**. It does not skip.
 *
 * A skipped test is a green build that means nothing: the suite reports success, the
 * coverage looks fine, and the thing you believed was tested was never executed. On a
 * machine without a database that is *precisely* the outcome you must not get, because
 * the whole point of Stage 3.1 is that the database behaviour is proven.
 *
 * ### It refuses to touch anything that might not be a test database
 *
 * `resetTestDatabase` drops and recreates the public schema. That is a destructive
 * operation, and destructive operations pointed at the wrong host are how people lose
 * production data at 2am.
 *
 * So it is guarded three ways, and all three must pass:
 *
 * 1. The **host** must be loopback.
 * 2. The **database name** must look like a test database.
 * 3. The target must not resemble QuickFurno, Supabase, or anything production-shaped.
 *
 * The guards are deliberately paranoid. The cost of a false refusal is a developer
 * renaming a database; the cost of a false acceptance is unbounded.
 *
 * ### The `supabase` guard now matters MORE, not less
 *
 * QF Jarvis has its own Supabase-managed PostgreSQL project for deployment (ADR-0023).
 * That does **not** make Supabase an acceptable test target — it makes it a far more
 * dangerous one.
 *
 * Before, this guard defended against a mistake nobody could make: there was no Jarvis
 * Supabase to point at. Now there is one, and the thing standing between a stray
 * `DATABASE_URL` and `DROP SCHEMA public CASCADE` on **Jarvis's own immutable event log**
 * is this list.
 *
 * **Supabase is a deployment target. It is not a development target and it is not a test
 * target.** The guard stays, and it is not to be weakened for convenience.
 */

import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  MIGRATION_SCHEMA,
  withClient,
  type DatabasePool,
} from '../index.js';

/**
 * Loopback only. A test suite has no business connecting anywhere else.
 *
 * **This is what rejects every managed database**, including Supabase — not a hostname
 * denylist that has to keep up with providers, but an allowlist of three loopback names
 * that a managed provider can never be one of.
 *
 * `postgres` was removed along with the TLS loopback exemption: it is a **DNS name**, not a
 * loopback address, and it resolves to whatever the resolver says it does. It never belonged
 * in either list.
 */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** Supabase's roles. They do not exist on a laptop, which is the whole problem the tests solve. */
export const MANAGED_ROLES = ['anon', 'authenticated', 'service_role'] as const;

/** The database name must say it is a test database. */
const TEST_DATABASE_PATTERN = /(^|[_-])test($|[_-])|test$/i;

/**
 * Substrings that mean "this is not a test database, stop."
 *
 * `supabase` covers **both** QuickFurno Core's project (forbidden outright) and QF Jarvis's
 * own deployed project (a deployment target, never a test target) — ADR-0023 §8.
 */
const FORBIDDEN_SUBSTRINGS = ['supabase', 'quickfurno', 'prod', 'production', 'live'];

export class TestDatabaseUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TestDatabaseUnavailableError';
  }
}

export class UnsafeTestDatabaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsafeTestDatabaseError';
  }
}

/**
 * The connection string for the test database.
 *
 * **Throws when `DATABASE_URL` is absent.** That is the intended behaviour, and the
 * message says how to fix it rather than merely reporting that something is missing.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];

  if (url === undefined || url.trim() === '') {
    throw new TestDatabaseUnavailableError(
      [
        'DATABASE_URL is not set, so the PostgreSQL integration tests cannot run.',
        '',
        'These tests FAIL rather than skip. A skipped database test is a green build that',
        'proves nothing — and proving the database behaviour is the entire point of Stage 3.1.',
        '',
        'Local development (PowerShell):',
        '  $env:QF_JARVIS_POSTGRES_PASSWORD = "<local-only password>"',
        '  docker compose up -d --wait',
        '  $env:DATABASE_URL = "postgresql://qf_jarvis_dev:<local-only password>@127.0.0.1:55432/qf_jarvis_test"',
        '',
        'See docs/engineering/development-setup.md.',
      ].join('\n'),
    );
  }

  return url.trim();
}

/**
 * Refuse anything that is not obviously a local test database.
 *
 * Returns the parsed target so a caller can report it — **without** the password.
 */
export function assertSafeTestDatabase(connectionString: string): {
  host: string;
  database: string;
} {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Never echo the string — it contains a password.
    throw new UnsafeTestDatabaseError('DATABASE_URL is not a parseable URL.');
  }

  const host = url.hostname;
  const database = url.pathname.replace(/^\//, '');
  const haystack = `${host}/${database}`.toLowerCase();

  if (!ALLOWED_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run destructive integration tests against host "${host}". ` +
        `Only a loopback host is permitted (${[...ALLOWED_HOSTS].join(', ')}).`,
    );
  }

  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(forbidden)) {
      throw new UnsafeTestDatabaseError(
        `Refusing to run destructive integration tests against "${haystack}": ` +
          `it contains "${forbidden}". QF Jarvis never touches a QuickFurno or production database.`,
      );
    }
  }

  if (!TEST_DATABASE_PATTERN.test(database)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run destructive integration tests against database "${database}": ` +
        `its name does not identify it as a test database. Rename it (e.g. "qf_jarvis_test").`,
    );
  }

  return { host, database };
}

/** A pool pointed at the guarded test database. The caller closes it. */
export function createTestPool(overrides: { applicationName?: string } = {}): DatabasePool {
  const connectionString = requireTestDatabaseUrl();
  assertSafeTestDatabase(connectionString);

  return createDatabasePool(
    createDatabaseConfig({
      connectionString,
      // Small: several pools exist at once during the concurrency tests, and a test
      // suite that exhausts PostgreSQL's connection slots fails for the wrong reason.
      maxConnections: 5,
      applicationName: overrides.applicationName ?? 'qf-jarvis-event-backbone-test',
    }),
  );
}

/**
 * Drop **QF Jarvis's own schema**, and nothing else, so a suite starts from nothing.
 *
 * ### It drops `qf_jarvis`. It does NOT touch `public`.
 *
 * An earlier version of this helper ran `DROP SCHEMA public CASCADE`. That was wrong, and
 * it is worth being precise about why rather than just fixing it: **`public` is not ours.**
 * It is a shared schema that a managed provider, an extension, or another tool may have
 * put objects in. A test suite that drops it is a test suite that destroys somebody else's
 * data to clean up after itself — and the day `DATABASE_URL` points somewhere it should
 * not, the blast radius is the whole database rather than the one schema we created.
 *
 * We create exactly one schema. We drop exactly that one.
 *
 * Dropping it cascades away the event log, the migration history, both mutation-rejection
 * functions and both triggers — which is exactly right: every suite re-migrates from zero
 * and therefore proves the migration runner works from zero, every single run.
 *
 * The schema is **not** recreated here. `runMigrations` bootstraps it, so leaving it absent
 * is what makes each run exercise the bootstrap rather than assume it.
 */
export async function resetTestDatabase(pool: DatabasePool): Promise<void> {
  assertSafeTestDatabase(requireTestDatabaseUrl());

  await withClient(pool, async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS ${MIGRATION_SCHEMA} CASCADE`);
  });
}

/**
 * Ensure the managed provider's roles exist, so the revocation test is not vacuous.
 *
 * `anon`, `authenticated` and `service_role` are **Supabase's** roles. On a laptop they do
 * not exist — which means a test asserting "they have no grants" would pass by asserting
 * nothing at all. That is a green test that proves the opposite of what it claims.
 *
 * So the test creates them. They are `NOLOGIN` and hold no privileges; they exist purely so
 * that the conditional revoke in the migration bootstrap has something to revoke *from*,
 * and so the test can grant to them, re-migrate, and prove the grant was taken back.
 *
 * **It throws rather than skips** if the connected role cannot create a role. A skipped
 * security test is worse than an absent one, because it looks like coverage.
 */
export async function ensureManagedRolesExist(pool: DatabasePool): Promise<void> {
  assertSafeTestDatabase(requireTestDatabaseUrl());

  try {
    await withClient(pool, async (client) => {
      for (const role of MANAGED_ROLES) {
        await client.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
              CREATE ROLE ${role} NOLOGIN;
            END IF;
          END
          $$;
        `);
      }
    });
  } catch (error: unknown) {
    throw new TestDatabaseUnavailableError(
      [
        'Could not create the Supabase-equivalent roles (anon, authenticated, service_role)',
        'needed to prove that the migration revokes their access to the qf_jarvis schema.',
        '',
        'The connected role needs CREATEROLE. With the shipped `compose.yml` it already has it.',
        'On a hand-rolled local PostgreSQL, grant it once, as a superuser:',
        '',
        '  ALTER ROLE <your_dev_role> CREATEROLE;',
        '',
        'This test FAILS rather than skips: a security test that silently does not run is',
        'worse than one that was never written, because it looks like coverage.',
        '',
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'),
    );
  }
}

/** Close a pool, tolerating an already-closed one. Used in `afterAll`. */
export async function closeTestPool(pool: DatabasePool): Promise<void> {
  await closeDatabasePool(pool);
}

/**
 * How many sessions currently hold the migration advisory lock.
 *
 * The migration runner must release its lock on **every** path — success, validation
 * failure, and SQL failure. This is how the tests prove it, rather than assuming it.
 */
export async function countAdvisoryLockHolders(pool: DatabasePool, key: number): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_locks
        WHERE locktype = 'advisory'
          AND granted
          AND ((classid::bigint << 32) | objid::bigint) = $1::bigint`,
      [key],
    );

    const row = result.rows[0];
    return row === undefined ? 0 : Number.parseInt(row.count, 10);
  });
}

/**
 * The DEPLOYMENT runtime role, exactly as migrations 0002/0003 expect to find it.
 *
 * It does not exist on a laptop by default — no more than the managed roles do — so tests create it
 * BEFORE migrating, the only order in which the conditional runtime grants have something to grant
 * to. A separate low-privilege LOGIN role is what makes the column-level authorization assertions
 * real: they connect **as this role** and observe what PostgreSQL itself refuses.
 */
export const RUNTIME_ROLE = 'qf_jarvis_runtime';

/**
 * Create the runtime LOGIN role and set this run's password.
 *
 * The role is cluster-global and persists between test files; the migrations' grants to it are
 * conditional and idempotent, so re-migrating in any file neither fails nor over-grants. `ALTER
 * ROLE ... PASSWORD` cannot take a bind parameter, so the literal is escaped server-side with
 * `format(%L)` — never string-concatenated — before it is executed.
 */
export async function ensureRuntimeRoleExists(
  admin: DatabasePool,
  password: string,
): Promise<void> {
  assertSafeTestDatabase(requireTestDatabaseUrl());

  await withClient(admin, async (client) => {
    await client.query(`
      DO $runtime$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
          CREATE ROLE qf_jarvis_runtime LOGIN;
        END IF;
      END
      $runtime$;
    `);

    const built = await client.query<{ stmt: string }>(
      `SELECT format('ALTER ROLE qf_jarvis_runtime WITH LOGIN PASSWORD %L', $1::text) AS stmt`,
      [password],
    );
    const stmt = built.rows[0]?.stmt;
    if (stmt === undefined) {
      throw new Error('Failed to build the runtime role password statement');
    }
    await client.query(stmt);
  });
}

/** The test database connection string, re-pointed at the runtime role. Same loopback host/db. */
export function runtimeConnectionString(password: string): string {
  const url = new URL(requireTestDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = password;
  return url.toString();
}

/** A pool that connects AS the least-privileged runtime role. The caller closes it. */
export function createRuntimePool(password: string, applicationName: string): DatabasePool {
  return createDatabasePool(
    createDatabaseConfig({
      connectionString: runtimeConnectionString(password),
      maxConnections: 3,
      applicationName,
    }),
  );
}
