/**
 * Integration-test plumbing, and the guards that stop it ever running anywhere real.
 *
 * Not a test file. This is the ONLY module in the package that reads `DATABASE_URL`, and it is
 * excluded from the emitting build — production source contains no environment read at all.
 *
 * ### It fails loudly. It never skips.
 *
 * Without `DATABASE_URL` every database test FAILS. Durability across a restart and correctness
 * under real concurrency are the entire point of this slice, and a suite that quietly reported
 * success without a database would be worse than having no suite: an in-memory guard also passes
 * every test that never opens a connection.
 *
 * ### It refuses anything that might not be a test database
 *
 * Loopback host, test-shaped database name, and a refusal of anything Supabase-, QuickFurno- or
 * production-shaped. Supabase is a DEPLOYMENT target, never a test target (ADR-0023 §8). Migration
 * 0010 is LOCAL/CI only; the managed database still carries migration 0001, and nothing here may
 * change that.
 *
 * No credential is ever printed: a failure names the rule that was broken, not the value.
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
      'DATABASE_URL is required for the QFJ-P09.03 durable execution replay store tests. They ' +
        'prove restart durability and single-first-seen arbitration under real concurrency; they ' +
        'fail rather than skip.',
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

export function testDatabaseConfig(
  applicationName: string,
  maxConnections?: number,
): DatabaseConfig {
  return createDatabaseConfig({
    connectionString: requireTestDatabaseUrl(),
    applicationName,
    ...(maxConnections === undefined ? {} : { maxConnections }),
  });
}

/**
 * A pool over the validated test database. The caller closes it.
 *
 * `maxConnections` is exposed because the contention proofs need it: with the default of 10, a
 * twenty-way race would silently become two waves of ten and the test would assert a weaker
 * property than its name claims.
 */
export function createTestPool(applicationName: string, maxConnections?: number): DatabasePool {
  return createDatabasePool(testDatabaseConfig(applicationName, maxConnections));
}

/**
 * Open and release `count` connections so the pool has them established.
 *
 * Without this, the first wave of a contention test spends its time in TCP and authentication
 * rather than contending, and the race the test claims to run does not happen.
 */
export async function warmPool(pool: DatabasePool, count: number): Promise<void> {
  const clients = await Promise.all(Array.from({ length: count }, () => pool.connect()));
  for (const client of clients) {
    client.release();
  }
}

/**
 * A rendezvous for the races `Promise.all` alone does not reliably produce.
 *
 * `Promise.all` USUALLY starts N claims close enough together to contend — and "usually" is exactly
 * how a concurrency regression gets merged on a quiet CI run. Holding every party at the instruction
 * before `claim` makes the simultaneity a fact of the test rather than a property of the machine it
 * ran on. (The pattern established by `@qf-jarvis/postgres-approval-queue`.)
 */
export function createBarrier(parties: number): { arriveAndWait: () => Promise<void> } {
  let arrived = 0;
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arriveAndWait: async (): Promise<void> => {
      arrived += 1;
      if (arrived >= parties) {
        release?.();
      }
      await opened;
    },
  };
}

/** The same validated database as a DIFFERENT login role, for the least-privilege proofs. */
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

/** Ensure a LOGIN role exists with a known local-only password and may connect. */
export async function ensureLoginRole(
  pool: DatabasePool,
  role: string,
  password: string,
): Promise<void> {
  await withClient(pool, async (client) => {
    // A `DO` block accepts no bind parameters, so existence is checked with a parameterized SELECT
    // and each statement is rendered server-side through `format`, never string-concatenated.
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
    const alter = await client.query<{ stmt: string }>(
      `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
      [role, password],
    );
    await client.query(alter.rows[0]?.stmt ?? '');
    const grant = await client.query<{ stmt: string }>(
      `SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS stmt`,
      [role],
    );
    await client.query(grant.rows[0]?.stmt ?? '');
  });
}

export { closeDatabasePool, withClient };
export type { DatabaseConfig, DatabasePool };

/** Drop and rebuild the schema, then apply every migration 0001–0011. */
export async function resetAndMigrate(pool: DatabasePool, config: DatabaseConfig): Promise<void> {
  await withClient(pool, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  });
  await migrateWithPreflight(pool, config, defaultMigrationsDirectory());
}

// ---------------------------------------------------------------------------
// Claim fixtures.
// ---------------------------------------------------------------------------
//
// Three opaque values, matching the canonical grammars exactly: a UUID execution intent id, an
// idempotency key of [A-Za-z0-9._:-] between 16 and 128 characters, and a lowercase 64-character
// SHA-256 hex digest. Nothing here is real key material, a real digest of anything, or a real
// identifier — and no fixture carries a recipient, a phone number, a message or a credential,
// because there is nowhere in this package to put one.

/** Distinct per call so two fixtures never collide on an identifier. */
let uniqueCounter = 0;
function uniqueSuffix(): string {
  uniqueCounter += 1;
  return String(uniqueCounter).padStart(12, '0');
}

/** A fresh, contract-shaped execution intent id. */
export function anIntentId(): string {
  return `a1b2c3d4-0000-4000-8000-${uniqueSuffix()}`;
}

/** A fresh, contract-shaped idempotency key: opaque, 16–128 of `[A-Za-z0-9._:-]`. */
export function anIdempotencyKey(): string {
  return `qf.exec.key-${uniqueSuffix()}`;
}

/**
 * A deterministic, contract-shaped body digest.
 *
 * `seed` is repeated to 64 lowercase hex characters, so two calls with the same seed are the same
 * digest and two different seeds are different digests. It is not a hash of anything: this package
 * never computes a digest, and inventing one here would suggest it might.
 */
export function aBodyDigest(seed: string): string {
  const hex = seed.toLowerCase().replace(/[^a-f0-9]/gu, '');
  if (hex.length === 0) {
    throw new Error('fixture: digest seed must contain at least one hex character');
  }
  return hex.repeat(Math.ceil(64 / hex.length)).slice(0, 64);
}

/** One complete claim. */
export function aClaim(over: {
  readonly executionIntentId?: string;
  readonly idempotencyKey?: string;
  readonly bodyDigestHex?: string;
}): { executionIntentId: string; idempotencyKey: string; bodyDigestHex: string } {
  return {
    executionIntentId: over.executionIntentId ?? anIntentId(),
    idempotencyKey: over.idempotencyKey ?? anIdempotencyKey(),
    bodyDigestHex: over.bodyDigestHex ?? aBodyDigest('ab'),
  };
}
