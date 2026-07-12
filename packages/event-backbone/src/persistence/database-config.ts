/**
 * Database configuration — validated, bounded, and **explicitly supplied**.
 *
 * ### This module reads no environment
 *
 * A library that reaches into `process.env` is a library whose behaviour depends on
 * something the caller cannot see and a test cannot control. It also makes the
 * connection string an ambient global — which is how a test suite ends up pointed at
 * a production database because a shell variable was left set.
 *
 * So configuration arrives as an argument. The only place that may read the
 * environment is the migration CLI (`migrate-cli.ts`), because that is an executable
 * process boundary rather than reusable library code.
 *
 * ### Bounds are conservative on purpose
 *
 * Every numeric field is bounded. An unbounded `maxConnections` exhausts PostgreSQL's
 * connection slots; an unbounded `statementTimeoutMillis` lets one pathological query
 * hold a lock forever. Neither is a hypothetical: both are the ordinary way a healthy
 * system stops being one.
 */

/** The validated shape. Every field is required — there are no ambient defaults at use sites. */
export interface DatabaseConfig {
  /** A `postgres://` or `postgresql://` URL. **Never logged, never printed.** */
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  /** Server-side `statement_timeout`. A query that exceeds it is cancelled by PostgreSQL. */
  readonly statementTimeoutMillis: number;
  /** Surfaces in `pg_stat_activity`, so a stuck connection can be attributed to a process. */
  readonly applicationName: string;
}

/** What a caller may supply. Everything except the connection string has a default. */
export interface DatabaseConfigInput {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
  readonly statementTimeoutMillis?: number;
  readonly applicationName?: string;
}

export const DATABASE_CONFIG_DEFAULTS = {
  maxConnections: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  statementTimeoutMillis: 30_000,
  applicationName: 'qf-jarvis-event-backbone',
} as const;

/** Conservative bounds. Outside them, a value is a bug rather than a preference. */
export const DATABASE_CONFIG_BOUNDS = {
  maxConnections: { min: 1, max: 50 },
  connectionTimeoutMillis: { min: 1_000, max: 60_000 },
  idleTimeoutMillis: { min: 1_000, max: 300_000 },
  statementTimeoutMillis: { min: 1_000, max: 300_000 },
  applicationNameMaxLength: 63,
} as const;

/** A configuration value was missing, malformed, or outside its bounds. */
export class DatabaseConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/**
 * The connection target is a **transaction-mode pooler**, and this package cannot use one.
 *
 * ### This is not a preference. Session state is load-bearing here.
 *
 * A transaction-mode pooler (Supabase's Supavisor, PgBouncer in `transaction` mode)
 * multiplexes many clients over few backend sessions, handing a *different* backend to
 * the same client between transactions. Everything below depends on that **not** happening:
 *
 * | What this package does                | Why transaction pooling breaks it                            |
 * | ------------------------------------- | ------------------------------------------------------------ |
 * | `pg_advisory_lock()` (migration)      | Session-scoped. Taken on one backend, released on another — or leaked |
 * | Projection advisory locks (Stage 3.4) | Same, and the projection would silently stop being exclusive  |
 * | `statement_timeout` on connect        | A session `SET` does not reliably survive the multiplexing     |
 * | `application_name` on connect         | Same — attribution in `pg_stat_activity` becomes unreliable    |
 *
 * **The failure mode is the reason this throws rather than warns.** Under transaction
 * pooling the migration runner would *appear* to work: no error, green logs, migrations
 * applied. It would simply have stopped serialising two concurrent migrators, and nobody
 * would learn that until two deploys raced. **A guarantee that fails silently is worse
 * than one that was never claimed.**
 *
 * ### Supported: direct connections, and session-mode poolers
 *
 * A future component MAY introduce a separate transaction-mode connection — but only after
 * **proving** it depends on no advisory lock, no prepared statement, and no session state.
 * That is a new decision with its own evidence, not a relaxation of this one.
 */
export class UnsupportedConnectionModeError extends DatabaseConfigError {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsupportedConnectionModeError';
  }
}

const POSTGRES_URL_PREFIXES = ['postgres://', 'postgresql://'] as const;

/**
 * Supabase's Supavisor transaction-mode port.
 *
 * Session mode is `5432` on the same pooler host; transaction mode is `6543`. The port is
 * the only thing that distinguishes them, which is exactly why a human gets it wrong.
 */
const SUPAVISOR_TRANSACTION_PORT = '6543';

/** The pooler's hostname family. A direct connection is `db.<ref>.supabase.co`, not this. */
const POOLER_HOST_PATTERN = /(^|\.)pooler\.supabase\.(com|co)$/i;

/**
 * Refuse a transaction-mode pooler. Never echo the URL, the host, or the password.
 *
 * **Detection is deliberately narrow.** It fires on a Supabase *pooler host*, or on the
 * Supavisor transaction port against *a Supabase host* — and on nothing else.
 *
 * A local database on `127.0.0.1:55432` and a CI database on `127.0.0.1:5432` are both
 * non-standard-or-standard ports on loopback, and **neither is rejected**. Refusing every
 * unusual port would break the local development database this repository ships with,
 * which is the kind of over-broad guard that gets disabled rather than fixed.
 */
function assertSupportedConnectionMode(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Malformed URLs are the caller's problem, reported elsewhere and without the value.
    return;
  }

  const host = url.hostname.toLowerCase();
  const isPoolerHost = POOLER_HOST_PATTERN.test(host);
  const isSupabaseHost =
    isPoolerHost || host.endsWith('.supabase.co') || host.endsWith('.supabase.com');
  const isTransactionPort = url.port === SUPAVISOR_TRANSACTION_PORT;

  if (isPoolerHost && isTransactionPort) {
    throw new UnsupportedConnectionModeError(
      'This connection targets a Supabase Supavisor pooler on the TRANSACTION-mode port. ' +
        'The QF Jarvis event backbone requires session state — advisory locks, statement_timeout ' +
        'and application_name are all session-scoped — and transaction pooling would break the ' +
        'migration lock SILENTLY, with nothing going red. ' +
        'Use a direct connection, or the pooler in SESSION mode (ADR-0023 §6).',
    );
  }

  if (isSupabaseHost && isTransactionPort) {
    throw new UnsupportedConnectionModeError(
      'This connection targets a Supabase host on the Supavisor TRANSACTION-mode port. ' +
        'Only a direct connection or a SESSION-mode pooler is supported: this package depends ' +
        'on session-scoped advisory locks, and transaction pooling would break them silently ' +
        '(ADR-0023 §6).',
    );
  }
}

function requireInBounds(
  name: string,
  value: number,
  bounds: { readonly min: number; readonly max: number },
): number {
  if (!Number.isInteger(value)) {
    throw new DatabaseConfigError(`${name} must be an integer`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new DatabaseConfigError(
      `${name} must be between ${String(bounds.min)} and ${String(bounds.max)}`,
    );
  }
  return value;
}

/**
 * Validate a configuration, or throw.
 *
 * The error messages name the **field**, never the value — a `DatabaseConfigError`
 * that helpfully quotes a malformed connection string has just written a password
 * into an exception message, which becomes a log line, which becomes a breach. This
 * is the same rule the contracts package applies to validation failures
 * (docs/governance/security-principles.md §5).
 */
export function createDatabaseConfig(input: DatabaseConfigInput): DatabaseConfig {
  const connectionString = input.connectionString.trim();

  if (connectionString === '') {
    throw new DatabaseConfigError('connectionString must not be empty');
  }

  if (!POSTGRES_URL_PREFIXES.some((prefix) => connectionString.startsWith(prefix))) {
    throw new DatabaseConfigError(
      'connectionString must be a PostgreSQL URL beginning "postgres://" or "postgresql://"',
    );
  }

  // Enforced HERE, not in the migration CLI — so it holds for EVERY pool this package
  // creates, including the ones a future ingestion path or projection runner will open.
  // A rule that only guards `db:migrate` guards the one caller that was already careful.
  assertSupportedConnectionMode(connectionString);

  const applicationName = input.applicationName ?? DATABASE_CONFIG_DEFAULTS.applicationName;

  if (applicationName.trim() === '') {
    throw new DatabaseConfigError('applicationName must not be empty');
  }

  if (applicationName.length > DATABASE_CONFIG_BOUNDS.applicationNameMaxLength) {
    throw new DatabaseConfigError(
      `applicationName must be at most ${String(DATABASE_CONFIG_BOUNDS.applicationNameMaxLength)} characters`,
    );
  }

  return {
    connectionString,
    maxConnections: requireInBounds(
      'maxConnections',
      input.maxConnections ?? DATABASE_CONFIG_DEFAULTS.maxConnections,
      DATABASE_CONFIG_BOUNDS.maxConnections,
    ),
    connectionTimeoutMillis: requireInBounds(
      'connectionTimeoutMillis',
      input.connectionTimeoutMillis ?? DATABASE_CONFIG_DEFAULTS.connectionTimeoutMillis,
      DATABASE_CONFIG_BOUNDS.connectionTimeoutMillis,
    ),
    idleTimeoutMillis: requireInBounds(
      'idleTimeoutMillis',
      input.idleTimeoutMillis ?? DATABASE_CONFIG_DEFAULTS.idleTimeoutMillis,
      DATABASE_CONFIG_BOUNDS.idleTimeoutMillis,
    ),
    statementTimeoutMillis: requireInBounds(
      'statementTimeoutMillis',
      input.statementTimeoutMillis ?? DATABASE_CONFIG_DEFAULTS.statementTimeoutMillis,
      DATABASE_CONFIG_BOUNDS.statementTimeoutMillis,
    ),
    applicationName,
  };
}

/**
 * A redacted description of where a connection points — safe to print.
 *
 * Host, port, and database only. **No user, no password, no query string.** This
 * exists so that operational output can say *which* database it touched without ever
 * being able to leak *how to reach it*.
 */
export function describeConnectionTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, '');
    const port = url.port === '' ? '5432' : url.port;
    return `${url.hostname}:${port}/${database === '' ? '(default)' : database}`;
  } catch {
    // Never echo the string we failed to parse — it may contain a password.
    return '(unparseable connection target)';
  }
}
