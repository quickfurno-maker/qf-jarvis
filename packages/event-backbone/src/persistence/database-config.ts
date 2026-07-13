/**
 * Database configuration — validated, bounded, **explicitly supplied**, and **fail-closed
 * on transport security**.
 *
 * ### This module reads no environment
 *
 * A library that reaches into `process.env` is a library whose behaviour depends on
 * something the caller cannot see and a test cannot control. It also makes the
 * connection string an ambient global — which is how a test suite ends up pointed at
 * a production database because a shell variable was left set.
 *
 * So configuration arrives as an argument. The only places that may read the environment
 * are the CLIs (`migrate-cli.ts`, `preflight-cli.ts`), because those are executable
 * process boundaries rather than reusable library code.
 *
 * ### Bounds are conservative on purpose
 *
 * Every numeric field is bounded. An unbounded `maxConnections` exhausts PostgreSQL's
 * connection slots; an unbounded `statementTimeoutMillis` lets one pathological query
 * hold a lock forever. Neither is a hypothetical: both are the ordinary way a healthy
 * system stops being one.
 *
 * ### TLS is a decision, not a default
 *
 * `tls` is a **discriminated union**, so "which TLS policy is this connection using?" has
 * exactly one answer and it is written down. There is no `rejectUnauthorized` knob to turn
 * off, because there is no field for it — the unsafe configuration is **unrepresentable**
 * rather than merely discouraged (ADR-0024).
 *
 * ### The CA is parsed, not pattern-matched
 *
 * `X509Certificate` is a Node built-in, so this costs **no dependency**. It is what turns
 * "looks like a certificate" into "is a certificate, and is a CA".
 */

import { X509Certificate } from 'node:crypto';

/**
 * The TLS policy for a connection. **Two options, and no third.**
 *
 * - `disabled` — permitted **only** for a loopback host. A local database on `127.0.0.1`
 *   has no network to be intercepted on, and requiring certificates there would mean
 *   shipping a CA with the repository so that a laptop can talk to itself.
 * - `verify-full` — the certificate chain is verified **against a supplied CA**, and the
 *   hostname must match. `rejectUnauthorized` is `true`, always, and there is no way to
 *   express otherwise.
 *
 * **`sslmode=require` is not this.** `require` encrypts and verifies *nothing*: it accepts
 * any certificate from anybody, which stops a passive eavesdropper and does nothing at all
 * about an active one. An attacker who can answer for the host presents a self-signed
 * certificate and `require` shakes their hand. That is not a smaller version of TLS; it is
 * a different thing that shares a spelling with it.
 */
export type TlsConfig =
  | { readonly mode: 'disabled' }
  | {
      readonly mode: 'verify-full';
      /**
       * The CA certificate chain, PEM-encoded.
       *
       * **Public trust material, not a secret** — but still deployment configuration, held
       * outside the repository so that a provider rotating its CA does not require a commit
       * (ADR-0024 §3).
       */
      readonly caCertificatePem: string;
    };

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
  /** Explicit, validated, and never `rejectUnauthorized: false`. */
  readonly tls: TlsConfig;
}

/** What a caller may supply. Everything except the connection string has a default. */
export interface DatabaseConfigInput {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
  readonly statementTimeoutMillis?: number;
  readonly applicationName?: string;
  /**
   * Defaults to `{ mode: 'disabled' }`, which is **only valid for a loopback host**.
   *
   * That default is fail-closed rather than convenient: omitting TLS for a managed database
   * does not quietly produce an unencrypted connection — it produces a `DatabaseTlsError`.
   */
  readonly tls?: TlsConfig;
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

/**
 * Loopback hosts. **The only place TLS may be disabled — and the list is exactly three.**
 *
 * ### `postgres` used to be here, and that was a mistake
 *
 * It was admitted as "the Compose service name", on the reasoning that a container talking to
 * a sibling container is the same trust situation as a laptop talking to itself. **That
 * reasoning is wrong.** `postgres` is a *DNS name*, not a loopback address. It resolves to
 * whatever the resolver says it resolves to, and a hostname that a resolver controls is a
 * hostname an attacker who controls the resolver controls. It crosses a network, and a
 * connection that crosses a network gets TLS.
 *
 * A connection to `postgres:5432` now requires `verify-full` and therefore fails without a CA.
 *
 * ### Exact match, and nothing clever
 *
 * `localhost.example.com` is not loopback. `notlocalhost` is not loopback. `0.0.0.0` is not
 * loopback — it is a *bind* address, and connecting to it is not the same act as listening on
 * it. Only these three, matched exactly, after lowercasing and stripping IPv6 brackets.
 *
 * A substring or suffix test here would be the bug: `*.localhost` is attacker-registrable in
 * plenty of environments, and "contains localhost" is how an allowlist stops being one.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/** A configuration value was missing, malformed, or outside its bounds. */
export class DatabaseConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

/**
 * The transport-security configuration is unsafe, absent, or contradicted by the URL.
 *
 * Separate from `DatabaseConfigError` because it is a **security** failure rather than a
 * typo, and a caller may reasonably want to treat the two differently. It still extends it,
 * so a handler that catches the base type does not suddenly stop catching this.
 */
export class DatabaseTlsError extends DatabaseConfigError {
  public constructor(message: string) {
    super(message);
    this.name = 'DatabaseTlsError';
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
 * | What this package does                | Why transaction pooling breaks it                                     |
 * | ------------------------------------- | --------------------------------------------------------------------- |
 * | `pg_advisory_lock()` (migration)      | Session-scoped. Taken on one backend, released on another — or leaked  |
 * | Projection advisory locks (Stage 3.4) | Same, and the projection would silently stop being exclusive           |
 * | `statement_timeout` on connect        | A session `SET` does not reliably survive the multiplexing             |
 * | `application_name` on connect         | Same — attribution in `pg_stat_activity` becomes unreliable            |
 *
 * **The failure mode is the reason this throws rather than warns.** Under transaction
 * pooling the migration runner would *appear* to work: no error, green logs, migrations
 * applied. It would simply have stopped serialising two concurrent migrators, and nobody
 * would learn that until two deploys raced. **A guarantee that fails silently is worse
 * than one that was never claimed.**
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
 * TLS parameters that, if present in the URL, **silently replace the explicit `ssl` object**
 * that `createDatabasePool` passes to `pg`.
 *
 * This is the whole reason this check exists. `pg` parses the connection string with
 * `pg-connection-string`, and an `sslmode` in the URL wins over the `ssl` option — so a
 * carefully validated `verify-full` config with a pinned CA can be **silently downgraded to
 * `require`** by six characters in an environment variable. Nothing errors. Nothing logs.
 * The connection is encrypted, unverified, and reported as fine.
 *
 * So the two cannot coexist: TLS policy comes from the validated config, and the URL
 * carries **routing and credentials only**.
 */
const URL_TLS_PARAMETERS = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'] as const;

/** Every `-----BEGIN/END CERTIFICATE-----` block in a bundle. Global: a CA bundle has several. */
const CERTIFICATE_BLOCK_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/** A private key is not a CA certificate, and pasting one here is a live-fire mistake. */
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;

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
 * Normalise a URL hostname for comparison.
 *
 * `new URL('postgresql://u@[::1]:5432/db').hostname` returns **`[::1]`, brackets included**.
 * Comparing that against a bare `::1` silently says "not loopback", which would have demanded
 * a CA certificate for a connection to the machine you are sitting at — and, far worse, is
 * the same class of near-miss that makes an allowlist quietly stop matching.
 */
function normaliseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * Is this connection target a loopback host?
 *
 * Exported because the CLIs need it **before** building a config, to decide whether a CA
 * certificate is mandatory. An unparseable URL is **not** loopback — fail closed.
 */
export function isLoopbackConnectionTarget(connectionString: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(normaliseHost(new URL(connectionString).hostname));
  } catch {
    return false;
  }
}

/**
 * Validate a CA bundle by **actually parsing it as X.509**. Returns the bundle, or throws.
 *
 * ### Why a shape check was not enough
 *
 * The first version of this matched a regex: `BEGIN CERTIFICATE`, some base64, `END`. That
 * catches an empty file and an HTML error page from a proxy, which are the *common* failures.
 * It does not catch the *dangerous* ones:
 *
 * - **Random bytes wrapped in PEM headers.** Passes a regex. Parses as nothing. Would have
 *   failed at handshake time, in production, with an error message about something else.
 * - **A truncated download.** Same.
 * - **A perfectly valid LEAF certificate**, with `CA:FALSE`. This is the nasty one: it parses,
 *   it is real, it is *somebody's* certificate — and it is **useless as a trust anchor**. A
 *   regex has no opinion about it. `X509Certificate.ca` does.
 *
 * So every block is parsed with Node's built-in `X509Certificate` (**no dependency added**),
 * and **at least one must have `ca === true`**. A bundle of leaves is not a CA bundle.
 *
 * ### What this is NOT
 *
 * This is **syntax and CA-purpose validation**. It does not check expiry, it does not build a
 * chain, and it does not verify a hostname. **Those remain the TLS handshake's job**, where
 * they belong — doing them twice in two places is how the two places end up disagreeing.
 *
 * ### The errors say what is wrong and nothing about what is in the file
 *
 * **No subject. No issuer. No fingerprint. No serial. No PEM contents. No path.** A CA
 * certificate is public trust material rather than a secret, so none of that would be a
 * *breach* — but an error handler that habitually dumps the thing it just rejected is a habit,
 * and habits get applied to material that *is* secret. A one-based block index is enough for
 * anyone to find the offending block themselves.
 */
export function assertCaCertificateBundle(pem: string): string {
  const trimmed = pem.trim();

  if (trimmed === '') {
    throw new DatabaseTlsError(
      'The CA certificate is empty. A zero-byte certificate file is the ordinary result of a ' +
        'failed download or an unset deployment variable, and it must not be treated as trust.',
    );
  }

  if (PRIVATE_KEY_PATTERN.test(trimmed)) {
    throw new DatabaseTlsError(
      'The supplied CA material contains a PRIVATE KEY block. A private key is not a CA ' +
        "certificate, and it does not belong in a trust bundle. Supply the provider's public " +
        'CA certificate chain (a "CERTIFICATE" PEM).',
    );
  }

  const blocks = trimmed.match(CERTIFICATE_BLOCK_PATTERN) ?? [];

  if (blocks.length === 0) {
    throw new DatabaseTlsError(
      'The CA certificate contains no "-----BEGIN CERTIFICATE-----" block. ' +
        '(The contents are not echoed here, deliberately.)',
    );
  }

  // Anything outside the certificate blocks is refused. A provider's bundle sometimes carries
  // human-readable headers, and tolerating them means tolerating *arbitrary* leading bytes —
  // which is how a file that is half certificate and half something else gets accepted.
  const outsideBlocks = trimmed.replace(CERTIFICATE_BLOCK_PATTERN, '');
  if (outsideBlocks.trim() !== '') {
    throw new DatabaseTlsError(
      'The CA certificate contains text outside its certificate blocks. Only certificate ' +
        'blocks and whitespace are permitted. ' +
        '(The contents are not echoed here, deliberately.)',
    );
  }

  let certificateAuthorities = 0;

  for (const [index, block] of blocks.entries()) {
    let certificate: X509Certificate;

    try {
      certificate = new X509Certificate(block);
    } catch {
      // The WHOLE bundle is refused, not just the bad block. A bundle we only partly
      // understand is a trust decision made on incomplete information.
      throw new DatabaseTlsError(
        `The CA certificate could not be parsed as X.509: block ${String(index + 1)} of ` +
          `${String(blocks.length)} is not a valid certificate. The file is corrupt, truncated, ` +
          'or is not a certificate at all. The entire bundle is refused. ' +
          '(No certificate details are echoed here, deliberately.)',
      );
    }

    if (certificate.ca) {
      certificateAuthorities += 1;
    }
  }

  if (certificateAuthorities === 0) {
    throw new DatabaseTlsError(
      `The CA certificate contains ${String(blocks.length)} valid certificate(s), but NONE of ` +
        'them is a certificate authority (basicConstraints CA:TRUE). A leaf certificate is not ' +
        'a trust anchor: pinning one would verify nothing and fail at handshake time. Supply ' +
        "the provider's CA certificate, not a server certificate.",
    );
  }

  return trimmed;
}

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

  if (isSupabaseHost && url.port === SUPAVISOR_TRANSACTION_PORT) {
    throw new UnsupportedConnectionModeError(
      'This connection targets a Supabase Supavisor pooler on the TRANSACTION-mode port. ' +
        'The QF Jarvis event backbone requires session state — advisory locks, statement_timeout ' +
        'and application_name are all session-scoped — and transaction pooling would break the ' +
        'migration lock SILENTLY, with nothing going red. ' +
        'Use a direct connection, or the pooler in SESSION mode (ADR-0023 §6, ADR-0024).',
    );
  }
}

/**
 * Refuse a URL that carries TLS parameters, because they would **silently override** the
 * explicit `ssl` object.
 *
 * The error names the offending parameter — a parameter *name* is not a secret — and never
 * the URL, the host, or the value.
 */
function assertNoTlsParametersInUrl(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return;
  }

  const present = URL_TLS_PARAMETERS.filter((parameter) => url.searchParams.has(parameter));

  if (present.length > 0) {
    throw new DatabaseTlsError(
      `The connection URL carries TLS parameters (${present.join(', ')}), and node-postgres ` +
        'lets those REPLACE the explicit ssl configuration this package supplies. A pinned, ' +
        'CA-verified connection would be silently downgraded — encrypted, unverified, and ' +
        'reported as fine. ' +
        'Remove them: the URL carries routing and credentials only, and TLS policy comes from ' +
        'the validated configuration (ADR-0024 §4).',
    );
  }
}

/**
 * Every check that can be made from the **URL alone**, before any I/O.
 *
 * `createDatabaseConfig` calls this too, so it cannot be bypassed — but the CLIs call it
 * *first*, before reading a CA certificate off disk. Without that, an operator with both a
 * transaction-pooler URL **and** a missing CA is told about the CA, fixes it, and only then
 * discovers the pooler problem. Two round trips to learn two things that were both knowable
 * immediately.
 */
export function assertConnectionUrlIsSupported(connectionString: string): void {
  assertSupportedConnectionMode(connectionString);
  assertNoTlsParametersInUrl(connectionString);
}

/**
 * The heart of the TLS policy. **Loopback may go bare; nothing else may.**
 *
 * The asymmetry is the point. On loopback there is no network to intercept, and demanding a
 * certificate would mean committing a CA so a laptop can talk to itself. Off loopback there
 * is always a network, and "it is probably fine" is not a threat model.
 */
function resolveTls(connectionString: string, requested: TlsConfig | undefined): TlsConfig {
  const tls: TlsConfig = requested ?? { mode: 'disabled' };
  const loopback = isLoopbackConnectionTarget(connectionString);

  if (tls.mode === 'disabled') {
    if (!loopback) {
      throw new DatabaseTlsError(
        'TLS is disabled for a NON-LOOPBACK database. That is refused, always. ' +
          'A managed connection crosses a network, and an unverified connection to a database ' +
          'is an invitation to sit between it and us. ' +
          'Supply tls: { mode: "verify-full", caCertificatePem } — and note that sslmode=require ' +
          'is NOT sufficient: it encrypts without verifying anyone, so it stops a passive ' +
          'eavesdropper and does nothing at all about an active one (ADR-0024 §2).',
      );
    }
    return tls;
  }

  // verify-full — permitted anywhere, including loopback (a developer running local TLS is
  // welcome to). The bundle is PARSED here, and must contain a real CA; the chain and the
  // hostname are Node's to verify, at handshake time.
  return {
    mode: 'verify-full',
    caCertificatePem: assertCaCertificateBundle(tls.caCertificatePem),
  };
}

/**
 * Validate a configuration, or throw.
 *
 * The error messages name the **field** or the **rule**, never the value — a
 * `DatabaseConfigError` that helpfully quotes a malformed connection string has just written
 * a password into an exception message, which becomes a log line, which becomes a breach.
 * This is the same rule the contracts package applies to validation failures
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

  // Enforced HERE, not in a CLI — so every rule holds for EVERY pool this package creates,
  // including the ones a future ingestion path or projection runner will open. A rule that
  // only guards `db:migrate` guards the one caller that was already being careful.
  assertSupportedConnectionMode(connectionString);
  assertNoTlsParametersInUrl(connectionString);

  const tls = resolveTls(connectionString, input.tls);

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
    tls,
  };
}

/**
 * A redacted description of where a connection points — safe to print.
 *
 * ### The hostname of a managed database IS a secret here, and that is not obvious
 *
 * A Supabase direct host is `db.<project-ref>.supabase.co`. **Printing the hostname prints
 * the project ref**, which the owner has ruled must never appear in Git, a log, or a CI
 * transcript. An earlier version of this function printed `host:port/database` for every
 * target, which would have written the ref into the output of the very first managed
 * `db:migrate`.
 *
 * So:
 *
 * - **Loopback** → `127.0.0.1:55432/qf_jarvis_test`. Useful, and it identifies nothing.
 * - **Anything else** → `«managed host redacted»:5432/postgres`. The **port and database
 *   name** are kept, because they are what an operator actually needs to know they are
 *   pointed at the right database — and neither identifies the project.
 *
 * **Never the user, never the password, never the query string, and now never the managed
 * hostname.**
 */
export function describeConnectionTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = url.pathname.replace(/^\//, '');
    const port = url.port === '' ? '5432' : url.port;
    const host = LOOPBACK_HOSTS.has(normaliseHost(url.hostname))
      ? url.hostname
      : '«managed host redacted»';

    return `${host}:${port}/${database === '' ? '(default)' : database}`;
  } catch {
    // Never echo the string we failed to parse — it may contain a password.
    return '(unparseable connection target)';
  }
}

/** How a connection describes its own transport security, safely, for an operator. */
export function describeTls(tls: TlsConfig): string {
  return tls.mode === 'disabled'
    ? 'disabled (loopback only)'
    : 'verify-full (CA-pinned, rejectUnauthorized=true)';
}
