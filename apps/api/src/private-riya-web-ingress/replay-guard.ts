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
 * ### It never fails open
 *
 * That is the whole contract, and it drives all three rules below.
 *
 * **Retention outlives signature validity.** Authentication accepts `issuedAt` within ±60s, so a
 * request first received at `T` may legally carry `issuedAt = T + 60s` — and that signature stays
 * fresh until roughly `T + 120s`. A claim retained for less than that would expire while the very
 * signature it guards was still usable, which is a replay window wearing the costume of a cache
 * setting. The minimum retention is therefore **120,000 ms**, and a shorter value is refused at
 * construction rather than silently clamped: a deployment that asked for 30 seconds should be told,
 * not quietly given something else.
 *
 * **A live claim is never evicted.** If the map is still full of unexpired entries after sweeping,
 * the request is REFUSED. Evicting the oldest live claim would trade replay protection for
 * availability under exactly the load an attacker can manufacture — and the evicted identifier would
 * become claimable again inside its own valid window. Capacity saturation is reported as its own
 * outcome, never as `replay-detected` or `request-conflict`, because a full guard and a repeated
 * request are different facts and an operator needs to tell them apart.
 *
 * **Time comes from the caller, already validated.** `claim` takes `nowMs` as a number the handler
 * has already parsed from its ONE clock snapshot. It substitutes nothing for an unusable clock: a
 * guard that fell back to epoch zero would expire every entry immediately and admit every replay.
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
 * The MINIMUM — and default — retention window, in milliseconds.
 *
 * Twice the ±60s freshness window, because a future-skewed signature first seen at `T` can carry
 * `issuedAt = T + 60s` and stay fresh until `T + 120s`. Anything shorter is a replay hole.
 */
export const MIN_REPLAY_TTL_MS = 120_000;
export const DEFAULT_REPLAY_TTL_MS = MIN_REPLAY_TTL_MS;

/**
 * The claim outcomes.
 *
 * `capacity-exhausted` is deliberately its OWN value. Folding it into `replay-detected` would tell an
 * operator that a caller repeated itself when in fact the guard ran out of room, and would tell a
 * caller to stop retrying when retrying later is exactly the right response.
 */
export type ReplayClaim = 'claimed' | 'replay-detected' | 'request-conflict' | 'capacity-exhausted';

export interface ReplayGuard {
  /**
   * Claim `(caller, requestId)` for `bodyDigest` at `nowMs`. One call decides.
   *
   * `nowMs` is a finite epoch-millisecond value the CALLER has already validated. Passing anything
   * else is a programming error and throws — it is never treated as a time.
   */
  readonly claim: (args: {
    readonly caller: string;
    readonly requestId: string;
    readonly bodyDigest: string;
    readonly nowMs: number;
  }) => ReplayClaim;
  /** Live entry count, for capacity proofs. Never the entries themselves. */
  readonly size: () => number;
}

export interface ReplayGuardConfig {
  readonly capacity?: number;
  /** Retention in milliseconds. Must be at least {@link MIN_REPLAY_TTL_MS}. */
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
  if (!Number.isInteger(ttlMs) || ttlMs < MIN_REPLAY_TTL_MS) {
    // REFUSED, not clamped. A deployment that asked for a shorter window has made an assumption
    // about signature lifetime that is wrong, and silently substituting a different number would
    // leave that assumption in place everywhere else it was made.
    throw new RangeError(
      'replay guard ttl must be at least the full signature-validity window in milliseconds',
    );
  }

  // Insertion-ordered, so a sweep visits the oldest entries first.
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
      readonly nowMs: number;
    }): ReplayClaim => {
      if (!Number.isFinite(args.nowMs)) {
        // Never a substituted instant. Epoch zero would expire every entry on the next claim and
        // turn an unusable clock into an open replay window.
        throw new RangeError('replay guard requires a finite instant');
      }
      const nowMs = args.nowMs;
      // The key is the two identifiers, length-prefixed so `a|bc` and `ab|c` cannot collide.
      const key = `${String(args.caller.length)}:${args.caller}|${args.requestId}`;

      const existing = entries.get(key);
      if (existing !== undefined) {
        if (existing.expiresAtMs > nowMs) {
          // Constant-time: whether two digests match is exactly what an attacker probing this
          // boundary would like to learn a byte at a time.
          return digestsEqual(existing.bodyDigest, args.bodyDigest)
            ? 'replay-detected'
            : 'request-conflict';
        }
        entries.delete(key);
      }

      if (entries.size >= capacity) {
        sweep(nowMs);
      }
      if (entries.size >= capacity) {
        // Still full of LIVE claims. FAIL CLOSED. Evicting the oldest would hand an attacker a way
        // to make a specific identifier claimable again inside its own valid window simply by
        // generating traffic, which is availability pressure buying a replay.
        return 'capacity-exhausted';
      }
      entries.set(key, { bodyDigest: args.bodyDigest, expiresAtMs: nowMs + ttlMs });
      return 'claimed';
    },
  });
}
