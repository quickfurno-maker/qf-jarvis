/**
 * Integration-test plumbing, and the guards that stop it ever running anywhere real.
 *
 * Not a test file. This is the ONLY module in the package that reads `DATABASE_URL`, and it is
 * excluded from the emitting build — production source contains no `process.env` at all.
 *
 * ### It fails loudly. It never skips.
 *
 * If `DATABASE_URL` is absent every database test FAILS. A skipped test is a green build that means
 * nothing: the durability, concurrency and idempotency claims of QFJ-P08-B2 are the entire point of
 * the phase, and a suite that quietly reports success without exercising a database would be worse
 * than having no tests.
 *
 * ### It refuses to touch anything that might not be a test database
 *
 * The guards mirror `event-backbone`'s, deliberately, and all three must pass:
 *
 * 1. the HOST must be loopback — an allowlist a managed provider can never be a member of;
 * 2. the DATABASE NAME must look like a test database;
 * 3. the target must not resemble Supabase, QuickFurno, or anything production-shaped.
 *
 * Supabase is a DEPLOYMENT target, never a test target (ADR-0023 §8). QF Jarvis has its own managed
 * project, which makes a stray `DATABASE_URL` more dangerous than it used to be, not less. The
 * managed database still carries migration 0001 only, and nothing here may change that.
 *
 * No credential is ever printed: failures name the rule that was broken, not the value that broke it.
 */
import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  defaultMigrationsDirectory,
  migrateWithPreflight,
  withClient,
  type DatabaseClient,
  type DatabaseConfig,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';

/** Loopback only. Not a provider denylist to keep up with — an allowlist of three. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** The database name must say it is a test database. */
const TEST_DATABASE_PATTERN = /(^|[_-])test($|[_-])|test$/i;

/** Substrings that mean "this is not a test database, stop". */
const FORBIDDEN_SUBSTRINGS = ['supabase', 'quickfurno', 'prod', 'production', 'live'];

/**
 * The validated test connection string.
 *
 * Throws — never skips — and never includes the URL in the message.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'DATABASE_URL is required for QFJ-P08-B2 integration tests. These tests prove durability, ' +
        'concurrency and idempotency against a real PostgreSQL; they fail rather than skip.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      'DATABASE_URL must point at a loopback host. Managed databases are never a test target.',
    );
  }

  const database = parsed.pathname.replace(/^\//, '');
  if (!TEST_DATABASE_PATTERN.test(database)) {
    throw new Error('DATABASE_URL must name a database that identifies itself as a test database.');
  }

  const haystack = `${host} ${database}`.toLowerCase();
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    if (haystack.includes(forbidden)) {
      throw new Error('DATABASE_URL resembles a managed or production target and is refused.');
    }
  }
  return url;
}

/** The validated config for the test database. */
export function testDatabaseConfig(applicationName: string): DatabaseConfig {
  return createDatabaseConfig({ connectionString: requireTestDatabaseUrl(), applicationName });
}

/** A pool over the validated test database. The caller closes it. */
export function createTestPool(applicationName: string): DatabasePool {
  return createDatabasePool(testDatabaseConfig(applicationName));
}

/**
 * The same validated test database, reached as a DIFFERENT login role (QFJ-P08-B3).
 *
 * Startup readiness makes a claim about the privileges of the CURRENT principal, and the only
 * honest way to test that is to connect as a principal that actually has them — or does not. `SET
 * ROLE` would not do: a pool hands out connections without a per-connection hook, so the role would
 * apply to some queries and not others.
 *
 * Host and database are taken from the already-validated URL and are NOT changed, so every guard
 * above still governs the target. Only the credentials are swapped, and the resulting string is
 * never logged.
 */
export function testDatabaseConfigAs(
  role: string,
  password: string,
  applicationName: string,
): DatabaseConfig {
  const parsed = new URL(requireTestDatabaseUrl());
  parsed.username = encodeURIComponent(role);
  parsed.password = encodeURIComponent(password);
  return createDatabaseConfig({ connectionString: parsed.toString(), applicationName });
}

/**
 * Ensure a LOGIN role exists with a known local-only password and may connect.
 *
 * The password is a literal supplied by the caller and is interpolated through `format(%L)` on the
 * server, never concatenated into SQL here. These roles are local test-cluster fixtures; nothing
 * about them exists in, or applies to, any managed database.
 */
export async function ensureLoginRole(
  pool: DatabasePool,
  role: string,
  password: string,
): Promise<void> {
  await withClient(pool, async (client) => {
    // A `DO` block accepts no bind parameters, so existence is checked with a parameterized SELECT
    // and each statement is then rendered server-side through `format`, never string-concatenated.
    const existing = await client.query('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [
      role,
    ]);
    if (existing.rowCount === 0) {
      const create = await client.query<{ stmt: string }>(
        `SELECT format('CREATE ROLE %I LOGIN', $1::text) AS stmt`,
        [role],
      );
      await client.query(create.rows[0]?.stmt ?? '');
    }
    const statement = await client.query<{ stmt: string }>(
      `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
      [role, password],
    );
    await client.query(statement.rows[0]?.stmt ?? '');
    const grant = await client.query<{ stmt: string }>(
      `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS stmt`,
      [role],
    );
    await client.query(grant.rows[0]?.stmt ?? '');
  });
}

export { closeDatabasePool, withClient };
export type { DatabaseClient, DatabaseConfig, DatabasePool };

/**
 * Drop and rebuild the schema, then apply every migration 0001–0008.
 *
 * Destructive, which is exactly why `requireTestDatabaseUrl` runs first and refuses anything that is
 * not provably a local test database.
 */
export async function resetAndMigrate(pool: DatabasePool, config: DatabaseConfig): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });
  await migrateWithPreflight(pool, config, defaultMigrationsDirectory());
}

/** Insert one provisioned conversation directly, for tests that need a starting row. */
export async function seedConversation(
  pool: DatabasePool,
  values: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly partyType?: string;
    readonly dataClass?: string;
    readonly cancelled?: boolean;
    readonly subjectStatus?: string;
    readonly subjectRef?: string | null;
    readonly observedAt?: string;
  },
): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query(
      `INSERT INTO qf_jarvis.conversation_runtime_state
         (tenant_id, conversation_id, revision, party_type, data_class,
          cancelled, subject_status, subject_ref, human_takeover, ai_paused, observed_at)
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7, false, false, $8)`,
      [
        values.tenantId,
        values.conversationId,
        values.partyType ?? 'CLIENT',
        values.dataClass ?? 'HOSTED_ALLOWED',
        values.cancelled ?? false,
        values.subjectStatus ?? 'clear',
        values.subjectRef ?? null,
        values.observedAt ?? '2026-08-01T00:00:00.000Z',
      ],
    );
  });
}
