import {
  type ExecutionReplayGuard,
  type ReplayClaimInput,
  type ReplayClaimOutcome,
} from '../../replay/replay-guard.js';

/**
 * A deterministic in-memory replay guard. TEST-ONLY.
 *
 * `src/tests/**` is excluded from `tsconfig.build.json`, so this cannot reach `dist/`. That
 * exclusion is the point: a production in-memory guard would pass every test, lose its state on
 * every restart, and produce the duplicate provider effect the whole boundary exists to prevent.
 *
 * The semantics mirror what a real single-conditional-write store must provide:
 *
 * - the FIRST claim for a triple is `first-seen`;
 * - an identical triple is `exact-replay`;
 * - anything that contradicts what is already stored is `conflict` — the same intent under a
 *   different key, the same intent with different bytes, or a key already bound to another intent.
 *
 * It is synchronous because it needs no I/O; the interface allows either, and the async path is
 * covered separately.
 */
export class InMemoryReplayGuard implements ExecutionReplayGuard {
  /** executionIntentId -> what was claimed for it. */
  readonly #byIntent = new Map<string, { key: string; digest: string }>();
  /** idempotencyKey -> the intent it is bound to. */
  readonly #byKey = new Map<string, string>();

  /** How many distinct intents have been claimed. Lets a test assert no hidden extra claim. */
  public get claimedCount(): number {
    return this.#byIntent.size;
  }

  public claim(input: ReplayClaimInput): ReplayClaimOutcome {
    const existing = this.#byIntent.get(input.executionIntentId);

    if (existing === undefined) {
      // A key already bound to a DIFFERENT intent is a conflict even though this intent is new:
      // reusing one idempotency key across intents is how two decisions collapse into one effect.
      const boundTo = this.#byKey.get(input.idempotencyKey);
      if (boundTo !== undefined && boundTo !== input.executionIntentId) {
        return 'conflict';
      }
      this.#byIntent.set(input.executionIntentId, {
        key: input.idempotencyKey,
        digest: input.bodyDigestHex,
      });
      this.#byKey.set(input.idempotencyKey, input.executionIntentId);
      return 'first-seen';
    }

    if (existing.key === input.idempotencyKey && existing.digest === input.bodyDigestHex) {
      return 'exact-replay';
    }

    // Same intent id, but a different key or different bytes. Either is a contradiction, and a
    // contradiction at an execution boundary fails closed rather than being treated as a duplicate.
    return 'conflict';
  }
}

/** A guard that always throws, to prove the boundary fails closed when the store is unavailable. */
export class UnavailableReplayGuard implements ExecutionReplayGuard {
  public claim(): never {
    throw new Error('replay store unavailable at /srv/secrets/store — token=abc123');
  }
}

/** A guard that answers outside the closed set, to prove the boundary refuses rather than trusts. */
export class NonsenseReplayGuard implements ExecutionReplayGuard {
  public claim(): ReplayClaimOutcome {
    return 'probably-fine' as ReplayClaimOutcome;
  }
}
