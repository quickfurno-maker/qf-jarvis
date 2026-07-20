/**
 * The deterministic advisory-lock key for a projection (Stage 3.4.4, ADR-0037).
 *
 * The projection runner takes a non-blocking, transaction-scoped `pg_try_advisory_xact_lock` so that
 * only one runner processes a given projection at a time. The lock ARGUMENT must be:
 *
 *   - derived from the validated projection **name AND version** (a version bump is a distinct lock);
 *   - domain/version-prefixed, so the namespace cannot collide with any other advisory-lock user;
 *   - deterministic across processes, machines, locales and restarts;
 *   - free of any event/payload/subject/caller data;
 *   - representable EXACTLY as a PostgreSQL `bigint` — so it is computed as a signed 64-bit integer and
 *     bound to `pg_try_advisory_xact_lock($1::bigint)` as its DECIMAL STRING; it never passes through a
 *     JavaScript `number` (which cannot hold the full int8 range).
 *
 * Algorithm: `key = asIntN(64, be_uint64(SHA-256("qf-jarvis/projection-lock/v1:" + name + ":" + version)[0..7]))`.
 * Fixed vectors (see the tests):
 *   event-type-activity:1   -> -5669050953429467864
 *   daily-event-acceptance:1 ->  1246584766324522588
 *   event-type-activity:2   -> -9050093009359467535
 *
 * Residual collision risk is LIVENESS-ONLY: two distinct (name, version) pairs colliding on the 64-bit
 * key would only make one projection observe `busy` while a different projection holds the lock (it
 * simply runs next tick). Correctness is guarded by each projection's own checkpoint `FOR UPDATE` row
 * lock, not by the advisory key. The probability is ~ n^2 / 2^65 for n distinct pairs — negligible at
 * Phase-3 scale.
 *
 * Not exported from the package root — internal projection vocabulary.
 */
import { createHash } from 'node:crypto';

import { isProjectionVersion } from './projection-definition.js';
import { ProjectionInputError } from './projection-errors.js';
import { isProjectionName, type ProjectionName } from './projection-name.js';

/** The domain-separation prefix. `v1` versions the derivation itself, not the projection. */
export const PROJECTION_LOCK_KEY_DOMAIN = 'qf-jarvis/projection-lock/v1';

/**
 * The signed 64-bit advisory-lock key for `(name, version)`. Re-validates its inputs defensively — a
 * malformed name/version is an internal error and fails closed rather than producing a garbage key.
 */
export function projectionAdvisoryLockKey(name: ProjectionName, version: number): bigint {
  if (!isProjectionName(name)) {
    throw new ProjectionInputError('advisory-lock key requires a valid projection name.');
  }
  if (!isProjectionVersion(version)) {
    throw new ProjectionInputError('advisory-lock key requires a valid projection version.');
  }
  const input = `${PROJECTION_LOCK_KEY_DOMAIN}:${name}:${String(version)}`;
  const digest = createHash('sha256').update(input, 'utf8').digest();
  const unsigned64 = digest.readBigUInt64BE(0);
  return BigInt.asIntN(64, unsigned64);
}

/** The exact decimal string bound to `pg_try_advisory_xact_lock($1::bigint)`. Never a JS number. */
export function projectionAdvisoryLockKeyParameter(name: ProjectionName, version: number): string {
  return projectionAdvisoryLockKey(name, version).toString(10);
}
