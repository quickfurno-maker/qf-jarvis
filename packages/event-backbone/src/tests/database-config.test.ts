/**
 * Database configuration — a pure unit suite. **No database required.**
 *
 * These run everywhere, always, including on a machine with no PostgreSQL. They cover the
 * two properties that matter before a socket is ever opened: bounds are enforced, and
 * **nothing ever echoes a connection string**.
 */

import { describe, expect, it } from 'vitest';

import {
  createDatabaseConfig,
  DATABASE_CONFIG_BOUNDS,
  DATABASE_CONFIG_DEFAULTS,
  DatabaseConfigError,
  describeConnectionTarget,
  UnsupportedConnectionModeError,
} from '../index.js';

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

describe('createDatabaseConfig', () => {
  it('accepts a valid URL and applies defaults', () => {
    const config = createDatabaseConfig({ connectionString: VALID_URL });

    expect(config.connectionString).toBe(VALID_URL);
    expect(config.maxConnections).toBe(DATABASE_CONFIG_DEFAULTS.maxConnections);
    expect(config.statementTimeoutMillis).toBe(DATABASE_CONFIG_DEFAULTS.statementTimeoutMillis);
    expect(config.applicationName).toBe(DATABASE_CONFIG_DEFAULTS.applicationName);
  });

  it.each(['postgres://user@host/db', 'postgresql://user@host/db'])(
    'accepts the "%s" scheme',
    (connectionString) => {
      expect(() => createDatabaseConfig({ connectionString })).not.toThrow();
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
    ['a session-mode pooler', `postgresql://postgres.ref:pw@${POOLER_HOST}:5432/postgres`],
    ['a direct Supabase connection', `postgresql://postgres:pw@${DIRECT_HOST}:5432/postgres`],
  ])('accepts %s', (_label, url) => {
    expect(() => createDatabaseConfig({ connectionString: url })).not.toThrow();
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

describe('describeConnectionTarget', () => {
  it('reports host, port and database — and nothing else', () => {
    const described = describeConnectionTarget(
      'postgresql://qf_jarvis_dev:SUPER-SECRET@127.0.0.1:55432/qf_jarvis_test',
    );

    expect(described).toBe('127.0.0.1:55432/qf_jarvis_test');
    expect(described).not.toContain('SUPER-SECRET');
    expect(described).not.toContain('qf_jarvis_dev:');
  });

  it('defaults the port when the URL omits it', () => {
    expect(describeConnectionTarget('postgresql://user@db.internal/qf')).toBe(
      'db.internal:5432/qf',
    );
  });

  it('never echoes a string it could not parse', () => {
    expect(describeConnectionTarget('not a url with a SECRET in it')).toBe(
      '(unparseable connection target)',
    );
  });
});
