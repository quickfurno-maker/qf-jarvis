/**
 * A self-contained PostgreSQL test harness for `@qf-jarvis/event-ingestion` integration tests.
 *
 * The event-store package's `database-test-utils` is a test file, not a public export, so this
 * package cannot import it. This harness rebuilds the minimum from `@qf-jarvis/event-backbone`'s
 * **public** API: a guarded loopback pool, a schema reset, the managed/runtime roles, and migration
 * through the public `migrateWithPreflight` gate (which passes on a loopback superuser). It touches
 * **only** the local/CI test database — never Supabase, never a managed target.
 *
 * Not a test file itself.
 */
import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  defaultMigrationsDirectory,
  migrateWithPreflight,
  withClient,
  type DatabaseConfig,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';

/** Loopback only — the allowlist a managed provider can never be one of. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
/** The database name must identify a test database. */
const TEST_DATABASE_PATTERN = /(^|[_-])test($|[_-])|test$/i;
/** Substrings that mean "not a test database, stop." */
const FORBIDDEN_SUBSTRINGS = ['supabase', 'quickfurno', 'prod', 'production', 'live'];

/** Supabase's roles — created so the denial assertions are not vacuous on a laptop. */
export const MANAGED_ROLES = ['anon', 'authenticated', 'service_role'] as const;
/** The deployment runtime role, exactly as migrations 0002/0003 expect to find it. */
export const RUNTIME_ROLE = 'qf_jarvis_runtime';

export class UnsafeTestDatabaseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsafeTestDatabaseError';
  }
}

/** The connection string for the test database. Throws if `DATABASE_URL` is absent. */
export function requireTestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new UnsafeTestDatabaseError(
      'DATABASE_URL is not set, so the PostgreSQL integration tests cannot run (they fail, never skip).',
    );
  }
  return url.trim();
}

/** Refuse anything that is not obviously a local test database. Returns host/database (no password). */
export function assertSafeTestDatabase(connectionString: string): {
  host: string;
  database: string;
} {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new UnsafeTestDatabaseError('DATABASE_URL is not a parseable URL.');
  }
  const host = url.hostname;
  const database = url.pathname.replace(/^\//, '');
  const haystack = `${host}/${database}`.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseError(`Refusing a non-loopback host "${host}".`);
  }
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(forbidden)) {
      throw new UnsafeTestDatabaseError(`Refusing "${haystack}": it contains "${forbidden}".`);
    }
  }
  if (!TEST_DATABASE_PATTERN.test(database)) {
    throw new UnsafeTestDatabaseError(`Refusing "${database}": not identifiably a test database.`);
  }
  return { host, database };
}

/** The default admin pool size. Concurrency proofs (Stage 3.3.5) override it to force real races. */
const DEFAULT_MAX_CONNECTIONS = 5;

/** The validated loopback config for the test database. */
export function testConfig(
  applicationName: string,
  maxConnections: number = DEFAULT_MAX_CONNECTIONS,
): DatabaseConfig {
  const connectionString = requireTestDatabaseUrl();
  assertSafeTestDatabase(connectionString);
  return createDatabaseConfig({ connectionString, maxConnections, applicationName });
}

/** A pool pointed at the guarded test database. The caller closes it. */
export function createTestPool(
  applicationName: string,
  maxConnections: number = DEFAULT_MAX_CONNECTIONS,
): DatabasePool {
  return createDatabasePool(testConfig(applicationName, maxConnections));
}

/** Drop QF Jarvis's own schema so a suite starts from nothing. Never touches `public`. */
export async function resetSchema(pool: DatabasePool): Promise<void> {
  assertSafeTestDatabase(requireTestDatabaseUrl());
  await withClient(pool, (client) => client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE'));
}

/** Ensure the Supabase-equivalent NOLOGIN roles exist, so a revoke has something to revoke from. */
export async function ensureManagedRolesExist(pool: DatabasePool): Promise<void> {
  await withClient(pool, async (client) => {
    for (const role of MANAGED_ROLES) {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${role}') THEN
            CREATE ROLE ${role} NOLOGIN;
          END IF;
        END $$;
      `);
    }
  });
}

/**
 * Create the runtime LOGIN role and set this run's password. Cluster-global; the migrations' grants
 * to it are conditional and idempotent. `ALTER ROLE ... PASSWORD` cannot take a bind parameter, so
 * the literal is escaped server-side with `format(%L)` — never string-concatenated.
 */
export async function ensureRuntimeRoleExists(pool: DatabasePool, password: string): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(`
      DO $runtime$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
          CREATE ROLE qf_jarvis_runtime LOGIN;
        END IF;
      END $runtime$;
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

/**
 * Apply the real 0001/0002/0003 migrations to the local test database through the PUBLIC migration
 * gate. On a loopback superuser the preflight passes; this is the same path the migrate-gate
 * integration tests use, and it never touches a managed database.
 */
export async function migrateTestDatabase(
  pool: DatabasePool,
  applicationName: string,
): Promise<void> {
  const config = testConfig(applicationName);
  const { migration } = await migrateWithPreflight(pool, config, defaultMigrationsDirectory());
  // Applied on the first run of a virgin schema; empty on a re-run. Either is fine.
  void migration;
}

/** The test connection string re-pointed at the runtime role. */
export function runtimeConnectionString(password: string): string {
  const url = new URL(requireTestDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = password;
  return url.toString();
}

/** A pool that connects AS the least-privileged runtime role. The caller closes it. */
export function createRuntimePool(
  password: string,
  applicationName: string,
  maxConnections = 3,
): DatabasePool {
  return createDatabasePool(
    createDatabaseConfig({
      connectionString: runtimeConnectionString(password),
      maxConnections,
      applicationName,
    }),
  );
}

/** Close a pool, tolerating an already-closed one. */
export async function closeTestPool(pool: DatabasePool): Promise<void> {
  await closeDatabasePool(pool);
}
