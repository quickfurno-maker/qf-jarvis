/**
 * Integration-test plumbing for the QFJ-P08-B3 durable composition, and the guards that stop it ever
 * running anywhere real.
 *
 * Not a test file, and NOT part of the emitting build — `tsconfig.build.json` excludes `src/tests`,
 * so nothing here reaches `dist`. This is the ONLY module in `apps/api` that reads `DATABASE_URL`;
 * the B3 production module reads no environment at all and takes an explicit `DatabaseConfig`.
 *
 * ### It fails loudly. It never skips.
 *
 * Without `DATABASE_URL` every test here FAILS. The whole point of B3 is that a human takeover
 * survives a process restart, and a suite that quietly reported success without a database would be
 * worse than having no suite.
 *
 * ### It refuses anything that might not be a test database
 *
 * The guards mirror `@qf-jarvis/postgres-conversation-state`'s, deliberately, and all three must
 * pass: loopback host, test-shaped database name, and nothing Supabase-, QuickFurno- or
 * production-shaped. Supabase is a DEPLOYMENT target, never a test target (ADR-0023 §8). The managed
 * database still carries migration 0001 only, and nothing here may change that.
 *
 * Migrations are applied HERE, in test setup, and never by the application: B3 runs no migration.
 *
 * No credential is ever printed — a failure names the rule that was broken, not the value.
 */
import {
  closeDatabasePool,
  createDatabaseConfig,
  createDatabasePool,
  defaultMigrationsDirectory,
  migrateWithPreflight,
  withClient,
  type DatabaseConfig,
} from '@qf-jarvis/event-backbone';

/** Loopback only. Not a provider denylist to keep up with — an allowlist of three. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
/** The database name must say it is a test database. */
const TEST_DATABASE_PATTERN = /(^|[_-])test($|[_-])|test$/i;
/** Substrings that mean "this is not a test database, stop". */
const FORBIDDEN_SUBSTRINGS = ['supabase', 'quickfurno', 'prod', 'production', 'live'];

/** The validated test connection string. Throws — never skips — and never includes the URL. */
export function requireTestDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(
      'DATABASE_URL is required for the QFJ-P08-B3 durable composition tests. They prove that a ' +
        'human takeover survives a restart; they fail rather than skip.',
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

/** The validated config for the test database. This is what a B3 caller supplies explicitly. */
export function testDatabaseConfig(applicationName: string): DatabaseConfig {
  return createDatabaseConfig({ connectionString: requireTestDatabaseUrl(), applicationName });
}

/**
 * Drop and rebuild the schema, then apply every migration 0001–0008.
 *
 * Destructive, which is exactly why `requireTestDatabaseUrl` runs first. The application never does
 * this: B3 startup applies no migration and creates no schema object.
 */
export async function resetAndMigrate(applicationName: string): Promise<void> {
  const config = testDatabaseConfig(applicationName);
  const pool = createDatabasePool(config);
  try {
    await withClient(pool, async (client) => {
      await client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    });
    await migrateWithPreflight(pool, config, defaultMigrationsDirectory());
  } finally {
    await closeDatabasePool(pool);
  }
}

/** Run one statement on a short-lived pool of its own, for test setup and schema damage. */
export async function runSql(applicationName: string, sql: string): Promise<void> {
  const pool = createDatabasePool(testDatabaseConfig(applicationName));
  try {
    await withClient(pool, async (client) => {
      await client.query(sql);
    });
  } finally {
    await closeDatabasePool(pool);
  }
}

/**
 * Provision one conversation directly, BEFORE any B3 runtime starts.
 *
 * Deliberately a separate test-setup path rather than something the application does: B3 startup
 * never provisions a missing conversation, because inventing `partyType` or `dataClass` would be
 * this application manufacturing a business fact that only QuickFurno Core may supply.
 */
export async function seedConversation(
  applicationName: string,
  values: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly partyType?: string;
    readonly dataClass?: string;
    readonly subjectStatus?: string;
    readonly observedAt?: string;
  },
): Promise<void> {
  const pool = createDatabasePool(testDatabaseConfig(applicationName));
  try {
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO qf_jarvis.conversation_runtime_state
           (tenant_id, conversation_id, revision, party_type, data_class,
            cancelled, subject_status, subject_ref, human_takeover, ai_paused, observed_at)
         VALUES ($1, $2, 0, $3, $4, false, $5, NULL, false, false, $6)`,
        [
          values.tenantId,
          values.conversationId,
          values.partyType ?? 'CLIENT',
          values.dataClass ?? 'HOSTED_ALLOWED',
          values.subjectStatus ?? 'clear',
          values.observedAt ?? '2026-08-01T00:00:00.000Z',
        ],
      );
    });
  } finally {
    await closeDatabasePool(pool);
  }
}

/** Read one state row back, for asserting durability across a restart. */
export async function readStateRow(
  applicationName: string,
  tenantId: string,
  conversationId: string,
): Promise<Record<string, unknown> | undefined> {
  const pool = createDatabasePool(testDatabaseConfig(applicationName));
  try {
    return await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM qf_jarvis.conversation_runtime_state
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [tenantId, conversationId],
      );
      return result.rows[0] as Record<string, unknown> | undefined;
    });
  } finally {
    await closeDatabasePool(pool);
  }
}

/** Count ledger rows for one tenant, for asserting no duplicate effect. */
export async function countLedgerRows(applicationName: string, tenantId: string): Promise<number> {
  const pool = createDatabasePool(testDatabaseConfig(applicationName));
  try {
    return await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT count(*)::text AS n FROM qf_jarvis.conversation_control_command WHERE tenant_id = $1`,
        [tenantId],
      );
      return Number.parseInt((result.rows[0] as { n: string }).n, 10);
    });
  } finally {
    await closeDatabasePool(pool);
  }
}
