import { lstatSync, openSync, readSync, closeSync } from 'node:fs';

import { AuthFailure } from '../errors';

import { MAX_AUTH_CONFIG_BYTES, authConfigV1Schema } from './schema';
import type { AuthConfigV1 } from './schema';

/**
 * The authentication configuration boundary (JOS-01C, ADR-0087).
 *
 * ### This is the ONLY module in the application that reads `process.env` or the filesystem
 *
 * JOS-01B forbade both outright across the Jarvis OS source, and the containment tests enforce
 * that. JOS-01C narrows the rule rather than removing it: `QFJ_JOS_AUTH_CONFIG_FILE` may be read
 * here and nowhere else, `node:fs` may be imported here, in the bootstrap CLI, and in tests, and
 * nowhere else. One reviewed file is a boundary; two is a pattern, and a pattern spreads.
 *
 * The environment variable holds a PATH and never secret material. That distinction matters: an
 * env var is visible in `/proc`, in a process listing, in a container inspect, and in a crash
 * dump. A path leaking is an inconvenience; a session key leaking is a compromise.
 *
 * ### Read on every verification, deliberately
 *
 * There is no cache. Rotation — a new key, an incremented revision, a changed password — must take
 * effect on the next request without a rebuild or a restart, because rotation IS the emergency
 * revocation mechanism in a stateless session model. A cache with a few seconds of staleness would
 * put a bound on how fast an owner can lock an attacker out, and the cost avoided is one small
 * synchronous read of a file the OS already has in page cache.
 */

/** The one environment variable this application reads. It contains a path, never a secret. */
export const AUTH_CONFIG_PATH_VAR = 'QFJ_JOS_AUTH_CONFIG_FILE';

export interface LoaderOptions {
  /** Injected for tests. Production passes nothing and the real environment is read. */
  readonly path?: string | undefined;
  /** Injected for tests: the platform to apply POSIX permission rules for. */
  readonly platform?: NodeJS.Platform | undefined;
}

/**
 * Load, validate and return the authentication configuration.
 *
 * Fails closed at every step. There is no default path, no repository-relative fallback, no search
 * of likely locations and no built-in credential: an unset variable is an error, not an invitation
 * to guess. A deployment that forgets to mount the secret gets "secure access unavailable" and a
 * locked door, which is the correct outcome.
 */
export function loadAuthConfig(options: LoaderOptions = {}): AuthConfigV1 {
  const path = options.path ?? readConfigPathFromEnvironment();
  if (path === undefined || path.trim() === '') {
    throw new AuthFailure('config-path-unset');
  }

  const raw = readBoundedRegularFile(path, options.platform ?? process.platform);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The JSON parse error names an offset and often quotes surrounding text. Neither belongs
    // anywhere near a secret file.
    throw new AuthFailure('config-malformed');
  }

  const result = authConfigV1Schema.safeParse(parsed);
  if (!result.success) {
    // Zod's issues would name paths like `session.keys.0.key` and, for some checks, the received
    // value. Discarded entirely: the operator debugs against the schema, not against an echo.
    throw new AuthFailure('config-invalid');
  }

  return result.data;
}

/**
 * Read `process.env` — the single permitted occurrence in the application.
 *
 * Kept as its own named function so the containment test can allow exactly this one line by
 * reference, and so a reviewer sees every environment read in one place.
 */
function readConfigPathFromEnvironment(): string | undefined {
  return process.env[AUTH_CONFIG_PATH_VAR];
}

/**
 * Open and read the file with the checks that matter, in the order that matters.
 *
 * `lstat` before `open`, so a SYMLINK is rejected rather than followed. That check is worth the
 * awkwardness: a symlink at the configured path is how a compromised container turns "read my
 * config" into "read anything the process can reach", and `stat` would follow it silently.
 *
 * Size is bounded BEFORE the content is parsed. An unbounded read of a path an attacker can
 * influence is a denial of service with extra steps.
 */
function readBoundedRegularFile(path: string, platform: NodeJS.Platform): string {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    throw new AuthFailure('config-unreadable');
  }

  if (stats.isSymbolicLink()) {
    throw new AuthFailure('config-not-regular-file');
  }
  if (!stats.isFile()) {
    throw new AuthFailure('config-not-regular-file');
  }
  if (stats.size > MAX_AUTH_CONFIG_BYTES) {
    throw new AuthFailure('config-too-large');
  }

  // POSIX permission check. Windows does not model these bits meaningfully, so applying the rule
  // there would fail every local development setup for no security gain -- production is Linux.
  if (platform !== 'win32') {
    const groupOrWorldReadable = (stats.mode & 0o077) !== 0;
    if (groupOrWorldReadable) {
      throw new AuthFailure('config-permissions-too-open');
    }
  }

  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(MAX_AUTH_CONFIG_BYTES + 1);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > MAX_AUTH_CONFIG_BYTES) {
      // The file grew between lstat and read. Refuse rather than truncate-and-parse.
      throw new AuthFailure('config-too-large');
    }
    return buffer.subarray(0, bytes).toString('utf8');
  } catch (error) {
    throw error instanceof AuthFailure ? error : new AuthFailure('config-unreadable');
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
