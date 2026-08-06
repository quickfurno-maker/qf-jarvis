/**
 * Bounded login-attempt limiter (JOS-01C, ADR-0087).
 *
 * ### What this is, and what it explicitly is not
 *
 * It is defense in depth inside one process: a small, fixed-size table of recent failures that
 * slows a burst of guesses against the login form. It is NOT a distributed rate limiter, and the
 * documentation says so plainly rather than implying protection it cannot give — with more than
 * one instance each would keep its own counters, and a restart clears them.
 *
 * The real perimeter limit belongs at the reverse proxy, and JOS-01D added it: a Traefik middleware
 * of five login attempts per minute with an 8 KiB body cap, scoped to the login route. Saying that
 * here matters more than the code below, because the reverse is the dangerous belief -- a team that
 * thinks the application is rate-limited will not check that the edge still is.
 *
 * ### Bounded by construction
 *
 * A plain `Map` keyed by client identity is a memory-exhaustion primitive: an attacker varies the
 * key and the process grows until it dies. This table has a hard entry ceiling and evicts the
 * oldest entry when full, so the worst case is fixed and known. A global counter sits alongside the
 * per-client ones, so spreading attempts across many keys still hits a wall.
 */

export interface LimiterOptions {
  /** Failures allowed per client key within the window before refusal. */
  readonly perClientLimit: number;
  /** Failures allowed across ALL keys within the window. Catches key-spraying. */
  readonly globalLimit: number;
  readonly windowSeconds: number;
  /** Hard ceiling on tracked keys. Exceeding it evicts the oldest. */
  readonly maxEntries: number;
}

export const DEFAULT_LIMITER_OPTIONS: LimiterOptions = Object.freeze({
  perClientLimit: 10,
  globalLimit: 60,
  windowSeconds: 300,
  maxEntries: 256,
});

export interface LimiterDecision {
  readonly allowed: boolean;
  /** Seconds a refused caller should wait. Surfaced as `Retry-After`. */
  readonly retryAfterSeconds: number;
}

interface Bucket {
  failures: number;
  windowStartSeconds: number;
}

export class LoginAttemptLimiter {
  readonly #options: LimiterOptions;
  readonly #buckets = new Map<string, Bucket>();
  #global: Bucket = { failures: 0, windowStartSeconds: 0 };

  public constructor(options: LimiterOptions = DEFAULT_LIMITER_OPTIONS) {
    this.#options = options;
  }

  /**
   * May this client attempt a login now?
   *
   * `nowSeconds` is injected rather than read, so the window behaviour is testable without waiting
   * five real minutes — and so this module reads no clock, matching every other auth primitive.
   */
  public check(clientKey: string, nowSeconds: number): LimiterDecision {
    this.#rollGlobal(nowSeconds);
    if (this.#global.failures >= this.#options.globalLimit) {
      return { allowed: false, retryAfterSeconds: this.#remaining(this.#global, nowSeconds) };
    }

    const bucket = this.#buckets.get(clientKey);
    if (bucket === undefined) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (nowSeconds - bucket.windowStartSeconds >= this.#options.windowSeconds) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.failures >= this.#options.perClientLimit) {
      return { allowed: false, retryAfterSeconds: this.#remaining(bucket, nowSeconds) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  public recordFailure(clientKey: string, nowSeconds: number): void {
    this.#rollGlobal(nowSeconds);
    this.#global.failures += 1;

    const existing = this.#buckets.get(clientKey);
    if (
      existing === undefined ||
      nowSeconds - existing.windowStartSeconds >= this.#options.windowSeconds
    ) {
      this.#evictIfFull();
      this.#buckets.set(clientKey, { failures: 1, windowStartSeconds: nowSeconds });
      return;
    }
    existing.failures += 1;
  }

  /**
   * A successful login clears that client's failures.
   *
   * The global counter is deliberately NOT cleared: one operator succeeding does not mean the
   * spray from everyone else was legitimate.
   */
  public recordSuccess(clientKey: string): void {
    this.#buckets.delete(clientKey);
  }

  public get trackedKeys(): number {
    return this.#buckets.size;
  }

  #remaining(bucket: Bucket, nowSeconds: number): number {
    return Math.max(1, this.#options.windowSeconds - (nowSeconds - bucket.windowStartSeconds));
  }

  #rollGlobal(nowSeconds: number): void {
    if (nowSeconds - this.#global.windowStartSeconds >= this.#options.windowSeconds) {
      this.#global = { failures: 0, windowStartSeconds: nowSeconds };
    }
  }

  /** Evict the oldest entry. Map preserves insertion order, so the first key is the oldest. */
  #evictIfFull(): void {
    if (this.#buckets.size < this.#options.maxEntries) {
      return;
    }
    const oldest = this.#buckets.keys().next();
    if (!oldest.done) {
      this.#buckets.delete(oldest.value);
    }
  }
}

/**
 * Resolve a client key WITHOUT trusting a forwarding header.
 *
 * `X-Forwarded-For` is caller-controlled until a trusted proxy sanitises it. Honouring it now would
 * let an attacker mint a fresh limiter bucket per request by varying one header, which is worse
 * than having no per-client limit at all because it looks like protection.
 *
 * So JOS-01C uses a single fixed key: every attempt shares one bucket. That is a blunt instrument
 * and it is the honest one for an owner-only surface with exactly one legitimate client.
 * A trusted-proxy resolver remains unadopted. JOS-01D established the preconditions -- the
 * container publishes no host port and is reachable only through Traefik -- but forwarding headers
 * are still not sanitised at the edge, and per-client keying is worthless until they are.
 */
export const SINGLE_OPERATOR_CLIENT_KEY = 'operator';

export function resolveClientKey(): string {
  return SINGLE_OPERATOR_CLIENT_KEY;
}
