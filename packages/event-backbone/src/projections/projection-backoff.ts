/**
 * Deterministic bounded backoff with equal jitter (Stage 3.4.4, ADR-0037).
 *
 * ADR-0034 §7 defers the exact `next_attempt_at` constants to this slice. They are LOCKED here:
 *
 *   BASE_MS = 1000, MULTIPLIER = 8, MAX_MS = 300000 (5 minutes).
 *   For failure n in 1..4:
 *     upperMs = min(MAX_MS, BASE_MS * MULTIPLIER^(n-1))
 *     lowerMs = ceil(upperMs / 2)                         (EQUAL jitter — the lower half-window)
 *     u32     = SHA-256("qf-jarvis/projection-backoff/v1:" + name + ":" + version + ":" + position
 *                       + ":" + failure)[0..3]  (big-endian UNSIGNED)
 *     delayMs = lowerMs + (u32 mod (upperMs - lowerMs + 1))
 *   Failure 5 BLOCKS the projection and schedules nothing.
 *
 * The jitter is DETERMINISTIC — a SHA-256 of a validated, repository-owned input — so it is fully
 * test-vectored and reproducible, and it uses NO `Math.random`, no RNG dependency, no mutable `Date`,
 * and no caller-derived text. Ranges: n1 500-1000, n2 4000-8000, n3 32000-64000, n4 150000-300000; the
 * 5-minute cap BINDS at n=4 (1000*8^3 = 512000 > 300000).
 *
 * `now` is the injected canonical UTC instant; the result's `nextAttemptAt` is `now + delayMs` as
 * another canonical instant. If adding the delay cannot produce a valid canonical instant, this fails
 * closed with a {@link ProjectionInputError} rather than storing a bad timestamp.
 *
 * Not exported from the package root.
 */
import { createHash } from 'node:crypto';

import {
  isCanonicalInstant,
  isProjectionVersion,
  toCanonicalInstant,
  type CanonicalInstant,
} from './projection-definition.js';
import { ProjectionInputError } from './projection-errors.js';
import { isProjectionName, type ProjectionName } from './projection-name.js';
import { MAX_PROJECTION_ATTEMPTS } from './projection-status.js';

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MULTIPLIER = 8;
export const BACKOFF_MAX_MS = 300000;
export const PROJECTION_BACKOFF_DOMAIN = 'qf-jarvis/projection-backoff/v1';

/** The highest failure number that SCHEDULES a retry (1..MAX-1). The MAX-th failure blocks instead. */
export const MAX_SCHEDULED_FAILURE = MAX_PROJECTION_ATTEMPTS - 1; // 4

export interface ProjectionBackoffInput {
  readonly name: ProjectionName;
  readonly version: number;
  readonly position: bigint;
  /** The failure number just recorded, 1..MAX-1 (a MAX-th failure blocks and calls no backoff). */
  readonly failureNumber: number;
  readonly now: CanonicalInstant;
}

export interface ProjectionBackoff {
  readonly delayMs: number;
  readonly nextAttemptAt: CanonicalInstant;
}

/** Ceil(value / 2) for a non-negative integer, without floating point. */
function halfCeil(value: number): number {
  return (value + (value % 2)) / 2;
}

/**
 * Compute the deterministic equal-jitter delay and the resulting canonical `next_attempt_at`.
 * Rejects a failure number outside 1..MAX-1 and a non-canonical `now` BEFORE hashing.
 */
export function projectionRetryBackoff(input: ProjectionBackoffInput): ProjectionBackoff {
  // Every hash component is validated repository vocabulary BEFORE hashing: a malformed/colon-injected
  // name and an unsafe/out-of-range version fail closed rather than seeding the digest with garbage.
  if (!isProjectionName(input.name)) {
    throw new ProjectionInputError('backoff requires a valid projection name.');
  }
  if (!isProjectionVersion(input.version)) {
    throw new ProjectionInputError('backoff requires a valid projection version.');
  }
  if (
    !Number.isInteger(input.failureNumber) ||
    input.failureNumber < 1 ||
    input.failureNumber > MAX_SCHEDULED_FAILURE
  ) {
    throw new ProjectionInputError(
      `a backoff failure number must be between 1 and ${String(MAX_SCHEDULED_FAILURE)}.`,
    );
  }
  if (!isCanonicalInstant(input.now)) {
    throw new ProjectionInputError('backoff requires a canonical UTC instant for now.');
  }
  if (typeof input.position !== 'bigint' || input.position <= 0n) {
    throw new ProjectionInputError('backoff requires a positive projection position.');
  }

  // Integer arithmetic only; MULTIPLIER^(n-1) for n<=4 is at most 512, so no overflow is possible.
  const uncapped = BACKOFF_BASE_MS * BACKOFF_MULTIPLIER ** (input.failureNumber - 1);
  const upperMs = Math.min(BACKOFF_MAX_MS, uncapped);
  const lowerMs = halfCeil(upperMs);
  const range = upperMs - lowerMs + 1;

  const hashInput = `${PROJECTION_BACKOFF_DOMAIN}:${input.name}:${String(input.version)}:${input.position.toString()}:${String(input.failureNumber)}`;
  const u32 = createHash('sha256').update(hashInput, 'utf8').digest().readUInt32BE(0);
  const delayMs = lowerMs + (u32 % range);

  // now + delay as a canonical instant; fail closed if the sum is not representable.
  const nextMs = Date.parse(input.now) + delayMs;
  let nextAttemptAt: CanonicalInstant;
  try {
    nextAttemptAt = toCanonicalInstant(new Date(nextMs));
  } catch {
    throw new ProjectionInputError(
      'backoff produced a next-attempt instant that is not a valid canonical UTC instant.',
    );
  }
  return { delayMs, nextAttemptAt };
}
