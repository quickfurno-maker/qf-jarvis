/**
 * A bounded, process-local, content-free replay guard (ADR-0097).
 *
 * ### What it is for
 *
 * A signature is valid for its whole freshness window. Without a claim step, anybody who captured one
 * valid request could resend the identical bytes repeatedly inside that window and cause repeated
 * agent turns — repeated model calls, repeated Core decisions — for one thing a person said once.
 *
 * So `(caller, requestId)` is claimed exactly once per window, AFTER the signature verifies. Claiming
 * before verification would let an unauthenticated caller burn identifiers a real gateway intends to
 * use, turning a public endpoint into a denial-of-service surface.
 *
 * ### Two different failures
 *
 * - the same `requestId` with the SAME body is a **replay**: the caller is resending something
 *   already served, and the honest answer is that it was;
 * - the same `requestId` with a DIFFERENT body is a **conflict**: two genuinely different requests
 *   are claiming one identity, which is a caller defect worth naming separately because retrying
 *   will not fix it.
 *
 * Either way the service is not called a second time.
 *
 * ### It retains no content, ever
 *
 * An entry holds a key token, a digest of the raw body, and an expiry instant. It never holds
 * `normalizedText`, a reply body, an `authorizedReply`, continuity, the request JSON or the response
 * JSON. A cache of successful replies would be a transcript nobody decided to keep, and would let a
 * second caller with the same identifier receive text Core authorized for the first.
 *
 * ### Deliberate limitation
 *
 * Process-local. It is a `Map`, not a database, and it gives NO cross-replica guarantee: two ingress
 * processes behind a load balancer each keep their own view, so the same request could be served once
 * by each. That is acceptable for this slice because nothing is deployed. Before a multi-replica
 * deployment the owner must choose either a shared durable claim store or a single-ingress routing
 * guarantee — see ADR-0097. This module deliberately adds no database and no migration.
 *
 * Expiry is LAZY: entries are dropped when they are looked at or when capacity is reached. There is
 * no timer and no polling loop, so an idle process schedules nothing and holds nothing open.
 */
import { digestsEqual } from './signature.js';

/** The default capacity. Bounded so a hostile or looping caller cannot grow it without limit. */
export const DEFAULT_REPLAY_CAPACITY = 10_000;

/**
 * The default retention window, in milliseconds.
 *
 * Twice the ±60s freshness window. It must comfortably COVER freshness: an entry that expired while
 * its signature was still valid would leave exactly the gap the guard exists to close.
 */
export const DEFAULT_REPLAY_TTL_MS = 120_000;

export type ReplayClaim = 'claimed' | 'replay-detected' | 'request-conflict';

export interface ReplayGuard {
  /** Claim `(caller, requestId)` for `bodyDigest` at `now`. One call decides. */
  readonly claim: (args: {
    readonly caller: string;
    readonly requestId: string;
    readonly bodyDigest: string;
    readonly now: string;
  }) => ReplayClaim;
  /** Live entry count, for capacity proofs. Never the entries themselves. */
  readonly size: () => number;
}

export interface ReplayGuardConfig {
  readonly capacity?: number;
  readonly ttlMs?: number;
}

interface Entry {
  readonly bodyDigest: string;
  readonly expiresAtMs: number;
}

/** Build a bounded process-local guard. Invalid configuration throws at CONSTRUCTION. */
export function createReplayGuard(config: ReplayGuardConfig = {}): ReplayGuard {
  const capacity = config.capacity ?? DEFAULT_REPLAY_CAPACITY;
  const ttlMs = config.ttlMs ?? DEFAULT_REPLAY_TTL_MS;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000) {
    throw new RangeError('replay guard capacity must be a positive bounded integer');
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 1) {
    throw new RangeError('replay guard ttl must be a positive integer of milliseconds');
  }

  // Insertion-ordered, so the oldest entry is the first one a capacity eviction reaches.
  const entries = new Map<string, Entry>();

  /** Drop everything already expired at `nowMs`. Cheap, and only ever called on a claim. */
  const sweep = (nowMs: number): void => {
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) {
        entries.delete(key);
      }
    }
  };

  return Object.freeze({
    size: (): number => entries.size,
    claim: (args: {
      readonly caller: string;
      readonly requestId: string;
      readonly bodyDigest: string;
      readonly now: string;
    }): ReplayClaim => {
      const nowMs = Date.parse(args.now);
      // An unparseable clock is not a reason to admit a request. The caller of this guard has
      // already validated the instant it passes in; this is the belt to that braces.
      const effectiveNow = Number.isNaN(nowMs) ? 0 : nowMs;
      // The key is the two identifiers, length-prefixed so `a|bc` and `ab|c` cannot collide.
      const key = `${String(args.caller.length)}:${args.caller}|${args.requestId}`;

      const existing = entries.get(key);
      if (existing !== undefined) {
        if (existing.expiresAtMs > effectiveNow) {
          // Constant-time: whether two digests match is exactly what an attacker probing this
          // boundary would like to learn a byte at a time.
          return digestsEqual(existing.bodyDigest, args.bodyDigest)
            ? 'replay-detected'
            : 'request-conflict';
        }
        entries.delete(key);
      }

      if (entries.size >= capacity) {
        sweep(effectiveNow);
      }
      if (entries.size >= capacity) {
        // Still full of LIVE entries: evict the oldest rather than refuse the request. Refusing
        // would convert a burst of legitimate traffic into an outage; the eviction's only cost is
        // that one very old identifier becomes claimable again inside its window.
        const oldest = entries.keys().next();
        if (!oldest.done) {
          entries.delete(oldest.value);
        }
      }
      entries.set(key, { bodyDigest: args.bodyDigest, expiresAtMs: effectiveNow + ttlMs });
      return 'claimed';
    },
  });
}
