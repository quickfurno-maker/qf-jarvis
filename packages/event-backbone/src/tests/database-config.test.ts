/**
 * Database configuration — a pure unit suite. **No database required.**
 *
 * These run everywhere, always, including on a machine with no PostgreSQL. They cover the
 * two properties that matter before a socket is ever opened: bounds are enforced, and
 * **nothing ever echoes a connection string**.
 */

import { describe, expect, it } from 'vitest';

import {
  assertCaCertificateBundle,
  createDatabaseConfig,
  DATABASE_CONFIG_BOUNDS,
  DATABASE_CONFIG_DEFAULTS,
  DatabaseConfigError,
  DatabaseTlsError,
  describeConnectionTarget,
  isLoopbackConnectionTarget,
  UnsupportedConnectionModeError,
  type TlsConfig,
} from '../index.js';
import {
  SYNTHETIC_CA_2_PEM,
  SYNTHETIC_CA_BUNDLE_PEM,
  SYNTHETIC_CA_PEM,
  SYNTHETIC_GARBAGE_PEM,
  SYNTHETIC_LEAF_PEM,
  SYNTHETIC_PRIVATE_KEY_PEM,
  SYNTHETIC_TRUNCATED_PEM,
} from './fixtures/certificates.js';

const VALID_URL = 'postgresql://qf_jarvis_dev:local-only@127.0.0.1:55432/qf_jarvis_test';

/**
 * Synthetic Supabase-shaped URLs.
 *
 * **These are placeholders. None of them is the QF-Jarvis project.** The real project ref,
 * hostname and credentials live outside this repository and appear in no file in it
 * (ADR-0023 §6). `exampleref000000000000` is deliberately not a valid ref.
 */
const POOLER_HOST = 'aws-0-ap-south-1.pooler.supabase.com';
const DIRECT_HOST = 'db.exampleref000000000000.supabase.co';

const MANAGED_URL = `postgresql://postgres:pw@${DIRECT_HOST}:5432/postgres`;
const SESSION_POOLER_URL = `postgresql://postgres.ref:pw@${POOLER_HOST}:5432/postgres`;
const TRANSACTION_POOLER_URL = `postgresql://postgres.ref:pw@${POOLER_HOST}:6543/postgres`;

const VERIFY_FULL: TlsConfig = { mode: 'verify-full', caCertificatePem: SYNTHETIC_CA_PEM };
const TLS_DISABLED: TlsConfig = { mode: 'disabled' };

/** Build a `verify-full` config with a given CA bundle, against a managed target. */
function withCa(caCertificatePem: string) {
  return () =>
    createDatabaseConfig({
      connectionString: MANAGED_URL,
      tls: { mode: 'verify-full', caCertificatePem },
    });
}

describe('createDatabaseConfig', () => {
  it('accepts a valid URL and applies defaults', () => {
    const config = createDatabaseConfig({ connectionString: VALID_URL });

    expect(config.connectionString).toBe(VALID_URL);
    expect(config.maxConnections).toBe(DATABASE_CONFIG_DEFAULTS.maxConnections);
    expect(config.statementTimeoutMillis).toBe(DATABASE_CONFIG_DEFAULTS.statementTimeoutMillis);
    expect(config.applicationName).toBe(DATABASE_CONFIG_DEFAULTS.applicationName);
  });

  it.each(['postgres://user@127.0.0.1/db', 'postgresql://user@127.0.0.1/db'])(
    'accepts the "%s" scheme',
    (connectionString) => {
      expect(() => createDatabaseConfig({ connectionString })).not.toThrow();
    },
  );

  it.each(['postgres://user@host/db', 'postgresql://user@host/db'])(
    'accepts the scheme in "%s" but still refuses it — the host is not loopback and TLS is off',
    (connectionString) => {
      // These URLs used to be accepted. They no longer are, and that is the correction:
      // a non-loopback host with no TLS is now a hard failure rather than a plaintext
      // connection nobody noticed (ADR-0024 §2).
      expect(() => createDatabaseConfig({ connectionString })).toThrow(DatabaseTlsError);
    },
  );

  it.each(['', '   ', 'mysql://user@host/db', 'http://example.com', 'user@host/db'])(
    'refuses the connection string %j',
    (connectionString) => {
      expect(() => createDatabaseConfig({ connectionString })).toThrow(DatabaseConfigError);
    },
  );

  it.each([
    ['maxConnections', DATABASE_CONFIG_BOUNDS.maxConnections.min - 1],
    ['maxConnections', DATABASE_CONFIG_BOUNDS.maxConnections.max + 1],
    ['connectionTimeoutMillis', DATABASE_CONFIG_BOUNDS.connectionTimeoutMillis.min - 1],
    ['connectionTimeoutMillis', DATABASE_CONFIG_BOUNDS.connectionTimeoutMillis.max + 1],
    ['idleTimeoutMillis', DATABASE_CONFIG_BOUNDS.idleTimeoutMillis.max + 1],
    ['statementTimeoutMillis', DATABASE_CONFIG_BOUNDS.statementTimeoutMillis.max + 1],
  ])('refuses %s = %i, outside its bounds', (field, value) => {
    expect(() => createDatabaseConfig({ connectionString: VALID_URL, [field]: value })).toThrow(
      DatabaseConfigError,
    );
  });

  it('refuses a non-integer bound', () => {
    expect(() =>
      createDatabaseConfig({ connectionString: VALID_URL, maxConnections: 2.5 }),
    ).toThrow(DatabaseConfigError);
  });

  it('refuses an empty or over-long application name', () => {
    expect(() =>
      createDatabaseConfig({ connectionString: VALID_URL, applicationName: '' }),
    ).toThrow(DatabaseConfigError);
    expect(() =>
      createDatabaseConfig({
        connectionString: VALID_URL,
        applicationName: 'x'.repeat(DATABASE_CONFIG_BOUNDS.applicationNameMaxLength + 1),
      }),
    ).toThrow(DatabaseConfigError);
  });

  it('never echoes the connection string in an error message', () => {
    const secret = 'postgresql://user:SUPER-SECRET-PASSWORD@127.0.0.1:5432/db';

    try {
      createDatabaseConfig({ connectionString: secret, maxConnections: 9_999 });
      expect.unreachable('expected a DatabaseConfigError');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // The validator that refuses a bad config must not then log the password in it.
      expect(message).not.toContain('SUPER-SECRET-PASSWORD');
      expect(message).not.toContain(secret);
      expect(message).toContain('maxConnections');
    }
  });
});

describe('the transaction-mode pooler is refused', () => {
  /**
   * Refused at **config construction**, so it holds for EVERY pool this package creates —
   * not only `db:migrate`. A rule that guards one caller guards the caller that was
   * already being careful.
   *
   * The failure this prevents is silent: under transaction pooling the migration runner
   * would appear to work, and would simply have stopped serialising two concurrent
   * migrators. **A guarantee that fails quietly is worse than one never claimed.**
   */
  it.each([
    ['the Supavisor pooler host', `postgresql://postgres.ref:pw@${POOLER_HOST}:6543/postgres`],
    ['a direct Supabase host', `postgresql://postgres:pw@${DIRECT_HOST}:6543/postgres`],
    [
      'the pooler with a query string',
      `postgresql://u:pw@${POOLER_HOST}:6543/postgres?sslmode=require`,
    ],
  ])('refuses %s on port 6543', (_label, url) => {
    expect(() => createDatabaseConfig({ connectionString: url })).toThrow(
      UnsupportedConnectionModeError,
    );
  });

  it('is a DatabaseConfigError, so existing handlers still catch it', () => {
    expect(() =>
      createDatabaseConfig({ connectionString: `postgresql://u:pw@${POOLER_HOST}:6543/postgres` }),
    ).toThrow(DatabaseConfigError);
  });

  it('never echoes the URL, the host, or the password when refusing', () => {
    const url = `postgresql://postgres.ref:SUPER-SECRET-PASSWORD@${POOLER_HOST}:6543/postgres`;

    try {
      createDatabaseConfig({ connectionString: url });
      expect.unreachable('expected an UnsupportedConnectionModeError');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      expect(message).not.toContain('SUPER-SECRET-PASSWORD');
      expect(message).not.toContain(url);
      expect(message).not.toContain(POOLER_HOST);
      // It explains the rule instead, which is the part a human can act on.
      expect(message).toContain('SESSION');
    }
  });

  it.each([
    ['a session-mode pooler', SESSION_POOLER_URL],
    ['a direct Supabase connection', MANAGED_URL],
  ])('accepts %s — when TLS is verify-full', (_label, url) => {
    // Note the added TLS. Before Stage 3.1.1 these were accepted with no TLS at all, which
    // meant a managed connection could have been opened in plaintext.
    expect(() => createDatabaseConfig({ connectionString: url, tls: VERIFY_FULL })).not.toThrow();
  });

  it.each([
    ['the local development database', 'postgresql://u:pw@127.0.0.1:55432/qf_jarvis_test'],
    ['the CI database', 'postgresql://u:pw@127.0.0.1:5432/qf_jarvis_test'],
    [
      'a local database that happens to use port 6543',
      'postgresql://u:pw@127.0.0.1:6543/qf_jarvis_test',
    ],
  ])('does not reject %s', (_label, url) => {
    // The guard keys on a SUPABASE host, not on the port alone. Refusing every unusual
    // port would break the local database this repository ships with — and an over-broad
    // guard is one that gets disabled rather than fixed.
    expect(() => createDatabaseConfig({ connectionString: url })).not.toThrow();
  });
});

describe('TLS is fail-closed', () => {
  it('accepts loopback with TLS disabled', () => {
    // A laptop talking to itself has no network to be intercepted on, and demanding a
    // certificate here would mean committing a CA so the machine can trust itself.
    const config = createDatabaseConfig({ connectionString: VALID_URL, tls: TLS_DISABLED });
    expect(config.tls).toStrictEqual({ mode: 'disabled' });
  });

  it('defaults to TLS disabled — which is safe ONLY because non-loopback then fails', () => {
    expect(createDatabaseConfig({ connectionString: VALID_URL }).tls.mode).toBe('disabled');
    // The same default, off loopback, is a hard error rather than a quiet plaintext session.
    expect(() => createDatabaseConfig({ connectionString: MANAGED_URL })).toThrow(DatabaseTlsError);
  });

  it.each([
    ['a managed Supabase host', MANAGED_URL],
    ['a session-mode pooler', SESSION_POOLER_URL],
    ['an arbitrary private host', 'postgresql://u:pw@db.internal:5432/qf'],
    ['a bare IP that is not loopback', 'postgresql://u:pw@10.0.0.5:5432/qf'],
  ])('REJECTS %s with TLS disabled', (_label, url) => {
    expect(() => createDatabaseConfig({ connectionString: url, tls: TLS_DISABLED })).toThrow(
      DatabaseTlsError,
    );
  });

  it('rejects a Supabase connection with NO TLS configuration at all', () => {
    // The omission must not be read as "the caller knows what they are doing".
    expect(() => createDatabaseConfig({ connectionString: MANAGED_URL })).toThrow(DatabaseTlsError);
  });

  it.each([
    ['a direct managed connection', MANAGED_URL],
    ['a session-mode pooler', SESSION_POOLER_URL],
    ['loopback (permitted, if a developer wants local TLS)', VALID_URL],
  ])('accepts %s with verify-full and a certificate-shaped PEM', (_label, url) => {
    const config = createDatabaseConfig({ connectionString: url, tls: VERIFY_FULL });

    expect(config.tls.mode).toBe('verify-full');
    if (config.tls.mode === 'verify-full') {
      expect(config.tls.caCertificatePem).toContain('BEGIN CERTIFICATE');
    }
  });

  it('cannot represent rejectUnauthorized: false — the unsafe config has no field', () => {
    // The strongest statement available: the type system has no way to express it. A test
    // that merely asserted "we do not set it" would pass the day somebody sets it.
    const config = createDatabaseConfig({ connectionString: MANAGED_URL, tls: VERIFY_FULL });

    expect(Object.keys(config.tls).toSorted()).toStrictEqual(['caCertificatePem', 'mode']);
    expect(config.tls).not.toHaveProperty('rejectUnauthorized');
    // And there is no third mode to smuggle one in through.
    expect(['disabled', 'verify-full']).toContain(config.tls.mode);
  });

  it('never echoes the CA, the URL, the host or the password when refusing', () => {
    const url = `postgresql://postgres:SUPER-SECRET-PASSWORD@${DIRECT_HOST}:5432/postgres`;
    const secretishPem = 'BEGIN-NOT-A-CERT-SENSITIVE-BLOB';

    try {
      createDatabaseConfig({
        connectionString: url,
        tls: { mode: 'verify-full', caCertificatePem: secretishPem },
      });
      expect.unreachable('expected a DatabaseTlsError');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      expect(message).not.toContain('SUPER-SECRET-PASSWORD');
      expect(message).not.toContain(url);
      expect(message).not.toContain(DIRECT_HOST);
      expect(message).not.toContain('exampleref000000000000');
      expect(message).not.toContain(secretishPem);
    }
  });
});

describe('the CA bundle is PARSED as X.509, not pattern-matched', () => {
  /**
   * A regex over PEM headers catches an empty file and an HTML error page. It does not catch
   * the failures that actually hurt: random bytes in a PEM envelope, a truncated download, or
   * — worst — **a perfectly valid leaf certificate**, which parses, is real, and is useless as
   * a trust anchor. `X509Certificate.ca` has an opinion about that. A regex does not.
   */
  it('accepts a single valid CA', () => {
    expect(withCa(SYNTHETIC_CA_PEM)).not.toThrow();
  });

  it('accepts a multi-certificate CA bundle', () => {
    // The ordinary shape of a provider's bundle: several roots in one file.
    expect(SYNTHETIC_CA_BUNDLE_PEM.match(/BEGIN CERTIFICATE/g)).toHaveLength(2);
    expect(withCa(SYNTHETIC_CA_BUNDLE_PEM)).not.toThrow();
  });

  it('preserves the original PEM bundle for the pg ssl object', () => {
    // The validated bundle must reach `pg` byte-for-byte. Re-serialising it from the parsed
    // certificates would be re-encoding trust material, which is a way to introduce a bug into
    // the one thing that must not have one.
    const config = createDatabaseConfig({
      connectionString: MANAGED_URL,
      tls: { mode: 'verify-full', caCertificatePem: `\n  ${SYNTHETIC_CA_BUNDLE_PEM}  \n` },
    });

    expect(config.tls.mode).toBe('verify-full');
    if (config.tls.mode === 'verify-full') {
      expect(config.tls.caCertificatePem).toBe(SYNTHETIC_CA_BUNDLE_PEM);
      expect(config.tls.caCertificatePem).toContain(SYNTHETIC_CA_PEM);
      expect(config.tls.caCertificatePem).toContain(SYNTHETIC_CA_2_PEM);
    }
  });

  it('REJECTS a valid leaf certificate with ca=false — it parses, and it is not a trust anchor', () => {
    // The dangerous case. A shape check waves this through; it then fails at handshake time,
    // in production, with an error about something else entirely.
    expect(withCa(SYNTHETIC_LEAF_PEM)).toThrow(/certificate authority|CA:TRUE/i);
  });

  it('rejects syntactically wrapped random bytes', () => {
    expect(withCa(SYNTHETIC_GARBAGE_PEM)).toThrow(/could not be parsed as X\.509/);
  });

  it('rejects a truncated certificate', () => {
    expect(withCa(SYNTHETIC_TRUNCATED_PEM)).toThrow(/could not be parsed as X\.509/);
  });

  it('rejects the WHOLE bundle when one block is malformed, even if another is a valid CA', () => {
    // A bundle we only partly understand is a trust decision made on incomplete information.
    expect(withCa(`${SYNTHETIC_CA_PEM}\n${SYNTHETIC_GARBAGE_PEM}`)).toThrow(
      /could not be parsed as X\.509/,
    );
    expect(withCa(`${SYNTHETIC_GARBAGE_PEM}\n${SYNTHETIC_CA_PEM}`)).toThrow(
      /could not be parsed as X\.509/,
    );
  });

  it('rejects a private key mixed into a certificate bundle', () => {
    expect(withCa(`${SYNTHETIC_CA_PEM}\n${SYNTHETIC_PRIVATE_KEY_PEM}`)).toThrow(/PRIVATE KEY/);
  });

  it.each([
    ['before', `not a certificate\n${SYNTHETIC_CA_PEM}`],
    ['after', `${SYNTHETIC_CA_PEM}\nnot a certificate`],
    ['between two certificates', `${SYNTHETIC_CA_PEM}\nsurprise\n${SYNTHETIC_CA_2_PEM}`],
  ])('rejects unexpected text %s the certificates', (_label, pem) => {
    expect(withCa(pem)).toThrow(/outside its certificate blocks/);
  });

  it('tolerates surrounding whitespace, and only whitespace', () => {
    expect(withCa(`\n\n  ${SYNTHETIC_CA_PEM}\n\n  `)).not.toThrow();
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n  '],
    ['not a PEM at all', 'hello, I am definitely a certificate'],
    ['an HTML error page from a proxy', '<!doctype html><title>403 Forbidden</title>'],
  ])('rejects a %s CA bundle', (_label, pem) => {
    expect(withCa(pem)).toThrow(DatabaseTlsError);
  });

  it('assertCaCertificateBundle returns the trimmed bundle unchanged', () => {
    expect(assertCaCertificateBundle(`\n  ${SYNTHETIC_CA_PEM}  \n`)).toBe(SYNTHETIC_CA_PEM);
  });

  it('reveals no subject, issuer, fingerprint, serial, PEM content or path in its errors', () => {
    const cases = [SYNTHETIC_LEAF_PEM, SYNTHETIC_GARBAGE_PEM, SYNTHETIC_TRUNCATED_PEM];

    for (const pem of cases) {
      try {
        withCa(pem)();
        expect.unreachable('expected a DatabaseTlsError');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        expect(message).not.toContain('QF Jarvis Synthetic Test CA');
        expect(message).not.toContain('leaf.example.invalid');
        expect(message).not.toContain('BEGIN CERTIFICATE');
        expect(message).not.toContain(pem.split('\n')[1] ?? '<none>');
        expect(message).not.toContain('/path');
        expect(message).not.toContain('QF_JARVIS_DB_CA_CERT_PATH=');
      }
    }
  });
});

describe('TLS parameters in the URL are refused, because pg would let them win', () => {
  /**
   * The bug this prevents is the nastiest one in this file.
   *
   * `pg` parses the connection string with `pg-connection-string`, and an `sslmode` in the
   * URL **overrides** the `ssl` object the pool was given. So a carefully validated
   * `verify-full` config with a pinned CA can be **silently downgraded to `require`** by six
   * characters in an environment variable. Nothing errors. Nothing logs. The connection is
   * encrypted, unverified, and reported as healthy.
   */
  it.each(['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])(
    'refuses a URL carrying ?%s',
    (parameter) => {
      expect(() =>
        createDatabaseConfig({
          connectionString: `${MANAGED_URL}?${parameter}=whatever`,
          tls: VERIFY_FULL,
        }),
      ).toThrow(DatabaseTlsError);
    },
  );

  it('refuses ?sslmode=require specifically — encryption is not verification', () => {
    expect(() =>
      createDatabaseConfig({
        connectionString: `${MANAGED_URL}?sslmode=require`,
        tls: VERIFY_FULL,
      }),
    ).toThrow(DatabaseTlsError);
  });

  it('names the offending parameter but not the URL', () => {
    try {
      createDatabaseConfig({
        connectionString: `postgresql://u:HUNTER2@${DIRECT_HOST}:5432/db?sslmode=require`,
        tls: VERIFY_FULL,
      });
      expect.unreachable('expected a DatabaseTlsError');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      expect(message).toContain('sslmode');
      expect(message).not.toContain('HUNTER2');
      expect(message).not.toContain(DIRECT_HOST);
    }
  });

  it('still refuses TLS parameters on a loopback URL — one rule, not two', () => {
    expect(() =>
      createDatabaseConfig({
        connectionString: `${VALID_URL}?sslmode=disable`,
        tls: TLS_DISABLED,
      }),
    ).toThrow(DatabaseTlsError);
  });
});

describe('connection mode interacts with TLS exactly as it should', () => {
  it('still refuses transaction-mode pooling, even with perfect TLS', () => {
    expect(() =>
      createDatabaseConfig({ connectionString: TRANSACTION_POOLER_URL, tls: VERIFY_FULL }),
    ).toThrow(UnsupportedConnectionModeError);
  });

  it('accepts session-mode pooling with verified TLS', () => {
    const config = createDatabaseConfig({
      connectionString: SESSION_POOLER_URL,
      tls: VERIFY_FULL,
    });
    expect(config.tls.mode).toBe('verify-full');
  });

  it('accepts a direct managed connection with verified TLS', () => {
    const config = createDatabaseConfig({ connectionString: MANAGED_URL, tls: VERIFY_FULL });
    expect(config.tls.mode).toBe('verify-full');
  });
});

describe('describeConnectionTarget', () => {
  it('reports host, port and database for a LOOPBACK target — and nothing else', () => {
    const described = describeConnectionTarget(
      'postgresql://qf_jarvis_dev:SUPER-SECRET@127.0.0.1:55432/qf_jarvis_test',
    );

    expect(described).toBe('127.0.0.1:55432/qf_jarvis_test');
    expect(described).not.toContain('SUPER-SECRET');
    expect(described).not.toContain('qf_jarvis_dev:');
  });

  it('REDACTS the hostname of a managed target, because the hostname carries the project ref', () => {
    // `db.<project-ref>.supabase.co` — printing the host prints the ref. An earlier version
    // of this function printed host:port/database for every target, which would have written
    // the project ref into the output of the very first managed `db:migrate`.
    const described = describeConnectionTarget(
      `postgresql://postgres:pw@${DIRECT_HOST}:5432/postgres`,
    );

    expect(described).not.toContain('exampleref000000000000');
    expect(described).not.toContain('supabase');
    expect(described).not.toContain('pw');
    // The port and database survive: an operator still needs to know WHICH database.
    expect(described).toContain(':5432/postgres');
  });

  it('redacts a non-loopback host even when it is not Supabase', () => {
    // The rule is "not loopback", not "is Supabase". A private host can be identifying too.
    expect(describeConnectionTarget('postgresql://user@db.internal/qf')).not.toContain(
      'db.internal',
    );
    expect(describeConnectionTarget('postgresql://user@db.internal/qf')).toContain(':5432/qf');
  });

  it('never echoes a string it could not parse', () => {
    expect(describeConnectionTarget('not a url with a SECRET in it')).toBe(
      '(unparseable connection target)',
    );
  });
});

describe('the loopback allowlist is exactly three hosts', () => {
  /**
   * `postgres` used to be on this list, admitted as "the Compose service name". That was wrong:
   * **it is a DNS name, not a loopback address.** It resolves to whatever the resolver says,
   * and a hostname a resolver controls is a hostname an attacker who controls the resolver
   * controls. It crosses a network, and a connection that crosses a network gets TLS.
   */
  it.each(['localhost', '127.0.0.1', '[::1]'])('treats %s as loopback', (host) => {
    expect(isLoopbackConnectionTarget(`postgresql://u:pw@${host}:5432/db`)).toBe(true);
  });

  it.each([
    ['localhost', 'postgresql://u:pw@localhost:5432/db'],
    ['127.0.0.1', 'postgresql://u:pw@127.0.0.1:5432/db'],
    ['[::1] (brackets normalised)', 'postgresql://u:pw@[::1]:5432/db'],
    ['LOCALHOST (case normalised)', 'postgresql://u:pw@LOCALHOST:5432/db'],
  ])('accepts %s with TLS disabled', (_label, url) => {
    expect(() => createDatabaseConfig({ connectionString: url, tls: TLS_DISABLED })).not.toThrow();
  });

  it.each([
    ['postgres — a Docker service name, NOT a loopback address', 'postgres'],
    ['0.0.0.0 — a bind address, not a destination', '0.0.0.0'],
    ['localhost.example.com — a suffix is not a match', 'localhost.example.com'],
    ['notlocalhost — a substring is not a match', 'notlocalhost'],
    ['sub.localhost — *.localhost is registrable', 'sub.localhost'],
    ['db.internal — a private-network hostname is still a network', 'db.internal'],
    ['10.0.0.5 — a private IP is still a network', '10.0.0.5'],
    ['a managed Supabase host', DIRECT_HOST],
    ['the Supavisor pooler', POOLER_HOST],
  ])('treats %s as NOT loopback', (_label, host) => {
    expect(isLoopbackConnectionTarget(`postgresql://u:pw@${host}:5432/db`)).toBe(false);
  });

  it.each(['postgres', '0.0.0.0', 'localhost.example.com', 'notlocalhost', 'sub.localhost'])(
    'REJECTS %s with TLS disabled — it must supply a verified CA',
    (host) => {
      expect(() =>
        createDatabaseConfig({
          connectionString: `postgresql://u:pw@${host}:5432/db`,
          tls: TLS_DISABLED,
        }),
      ).toThrow(DatabaseTlsError);
    },
  );

  it('accepts postgres:5432 once it supplies verify-full and a real CA', () => {
    // The point is not that the host is banned. The point is that it must be verified.
    expect(() =>
      createDatabaseConfig({
        connectionString: 'postgresql://u:pw@postgres:5432/db',
        tls: VERIFY_FULL,
      }),
    ).not.toThrow();
  });

  it('reveals no hostname when refusing', () => {
    try {
      createDatabaseConfig({
        connectionString: 'postgresql://u:HUNTER2@secret-internal-host.example:5432/db',
        tls: TLS_DISABLED,
      });
      expect.unreachable('expected a DatabaseTlsError');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      expect(message).not.toContain('secret-internal-host');
      expect(message).not.toContain('HUNTER2');
      expect(message).toContain('NON-LOOPBACK');
    }
  });

  it('treats an unparseable URL as NOT loopback — fail closed', () => {
    expect(isLoopbackConnectionTarget('nonsense')).toBe(false);
  });
});
