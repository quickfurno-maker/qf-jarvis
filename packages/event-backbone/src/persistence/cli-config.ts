/**
 * The **process boundary**: the one place that reads the environment and the filesystem.
 *
 * `migrate-cli.ts` and `preflight-cli.ts` both need to answer the same question — *"what
 * database am I talking to, and how do I trust it?"* — and they must answer it identically,
 * because a preflight that validates a different connection than the migration then uses has
 * validated nothing.
 *
 * So the answer lives here, once. **It is deliberately not exported from `index.ts`**: it
 * reads `process.env`, and library code must not.
 *
 * ### What it reads
 *
 * | Variable                     | When                                    |
 * | ---------------------------- | --------------------------------------- |
 * | `DATABASE_URL`               | Always. Routing and credentials **only** |
 * | `QF_JARVIS_DB_CA_CERT_PATH`  | **Mandatory** for any non-loopback host  |
 *
 * ### What it never prints
 *
 * Not the URL. Not the hostname. Not the username. Not the password. Not the CA path. Not
 * the CA contents. The errors below explain the **rule that was broken**, which is the part
 * a human can act on, and nothing about the value that broke it.
 *
 * The CA path is redacted too, and that deserves a word since a path is not obviously
 * sensitive: on a managed platform the path is frequently a mount point named after the
 * project or the environment, and an error message is the single most reliable way for a
 * string to end up in a log aggregator that a wider group can read.
 */

import { readFile } from 'node:fs/promises';

import {
  assertCaCertificateBundle,
  assertConnectionUrlIsSupported,
  createDatabaseConfig,
  DatabaseTlsError,
  isLoopbackConnectionTarget,
  type DatabaseConfig,
  type TlsConfig,
} from './database-config.js';

/** The CA certificate is deployment configuration, held outside the repository. */
const CA_CERT_PATH_VARIABLE = 'QF_JARVIS_DB_CA_CERT_PATH';

export class MissingDatabaseUrlError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MissingDatabaseUrlError';
  }
}

function missingDatabaseUrlMessage(): string {
  return [
    'DATABASE_URL is not set.',
    '',
    'The QF Jarvis event backbone requires its own PostgreSQL database. It is never',
    "QuickFurno Core's database, and never QuickFurno Core's Supabase project (ADR-0019 §2).",
    '',
    'Local development (PowerShell):',
    '  $env:QF_JARVIS_POSTGRES_PASSWORD = "<local-only password>"',
    '  docker compose up -d --wait',
    '  $env:DATABASE_URL = "postgresql://qf_jarvis_dev:<local-only password>@127.0.0.1:55432/qf_jarvis_test"',
    '',
    'See docs/engineering/development-setup.md.',
  ].join('\n');
}

/**
 * Read and validate the CA certificate for a managed connection.
 *
 * **Fails closed** when the variable is unset, the file is missing or unreadable, the file
 * is empty, or the contents are not a certificate-shaped PEM. Each of those is a real
 * deployment failure — an unset variable, a bad mount, a truncated download, a private key
 * pasted by mistake — and none of them may silently become "connect anyway".
 */
async function loadCaCertificatePem(): Promise<string> {
  const path = process.env[CA_CERT_PATH_VARIABLE];

  if (path === undefined || path.trim() === '') {
    throw new DatabaseTlsError(
      [
        `${CA_CERT_PATH_VARIABLE} is not set, and this connection is NOT loopback.`,
        '',
        'A managed database is reached across a network, and QF Jarvis verifies it against a',
        'pinned CA certificate — verify-full, rejectUnauthorized=true. There is no',
        '"encrypt but do not verify" mode, because that mode stops a passive eavesdropper and',
        'does nothing at all about an active one.',
        '',
        `Set ${CA_CERT_PATH_VARIABLE} to the provider's CA certificate file.`,
        'It is PUBLIC trust material, not a secret — but it is deployment configuration and it',
        'is deliberately NOT committed, so that a provider rotating its CA does not require a',
        'change to this repository (ADR-0024 §3).',
      ].join('\n'),
    );
  }

  let contents: string;
  try {
    contents = await readFile(path.trim(), 'utf8');
  } catch {
    // The path is NOT echoed: on a managed platform it is routinely a mount point named
    // after the project or the environment.
    throw new DatabaseTlsError(
      `The CA certificate at ${CA_CERT_PATH_VARIABLE} could not be read. ` +
        'The file is missing, unreadable, or the path is wrong. ' +
        '(The path is not echoed here, deliberately.)',
    );
  }

  // PARSED, not pattern-matched: empty, private-key, garbage-in-PEM-headers, truncated DER,
  // and a leaf-only bundle with no CA all fail here (ADR-0024 §3).
  return assertCaCertificateBundle(contents);
}

/**
 * Resolve the one connection configuration both CLIs use.
 *
 * Loopback → TLS disabled. Anything else → `verify-full` with a CA loaded from disk, and a
 * hard failure if that CA is not there.
 */
export async function resolveCliDatabaseConfig(applicationName: string): Promise<DatabaseConfig> {
  const connectionString = process.env['DATABASE_URL'];

  if (connectionString === undefined || connectionString.trim() === '') {
    throw new MissingDatabaseUrlError(missingDatabaseUrlMessage());
  }

  const url = connectionString.trim();

  // Everything knowable from the URL alone, BEFORE touching the disk: a transaction-mode
  // pooler, or a URL carrying sslmode/sslrootcert. Otherwise an operator whose URL is a
  // transaction pooler AND whose CA is missing is told about the CA, fixes it, and only then
  // discovers the pooler — two round trips for two things that were both knowable at once.
  assertConnectionUrlIsSupported(url);

  const tls: TlsConfig = isLoopbackConnectionTarget(url)
    ? { mode: 'disabled' }
    : { mode: 'verify-full', caCertificatePem: await loadCaCertificatePem() };

  // createDatabaseConfig is what actually enforces the policy — including refusing a
  // transaction-mode pooler, and refusing a URL that carries sslmode/sslrootcert (which
  // node-postgres would otherwise let silently override the ssl object we just built).
  return createDatabaseConfig({ connectionString: url, applicationName, tls });
}
