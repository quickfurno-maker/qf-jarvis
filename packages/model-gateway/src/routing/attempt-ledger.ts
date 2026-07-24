/**
 * The single per-run attempt ledger (QFJ-P04.01D, ADR-0048).
 *
 * One ledger governs a whole gateway run: bounded primary retries plus AT MOST ONE fallback provider,
 * under one shared total budget. A fallback does NOT reset the budget. Once a response is accepted no
 * further attempt is permitted. Counters are never negative and never exceed the bound. Snapshots are
 * frozen and content-free (provider ids and counts only) — safe for events and tests.
 */

export interface AttemptLedgerSnapshot {
  readonly totalAttempts: number;
  readonly maxTotalAttempts: number;
  readonly perProvider: Readonly<Record<string, number>>;
  readonly providersUsed: number;
  readonly accepted: boolean;
  readonly fallbackUsed: boolean;
}

export class AttemptLedger {
  readonly #max: number;
  #total = 0;
  #accepted = false;
  #fallbackUsed = false;
  readonly #perProvider = new Map<string, number>();

  public constructor(maxTotalAttempts: number) {
    if (!Number.isInteger(maxTotalAttempts) || maxTotalAttempts < 1) {
      throw new Error('An attempt ledger requires a positive integer bound.');
    }
    this.#max = maxTotalAttempts;
  }

  /** Provider invocations still permitted (never negative). */
  public remaining(): number {
    return Math.max(0, this.#max - this.#total);
  }

  /** Whether another provider invocation is permitted: budget remains and nothing is accepted yet. */
  public canAttempt(): boolean {
    return !this.#accepted && this.remaining() > 0;
  }

  /**
   * Record one provider invocation. `isFallbackProvider` marks the transition to the (single) fallback
   * provider. Throws if a response was already accepted, if the budget is exhausted, or if a second
   * distinct fallback provider is attempted.
   */
  public record(providerId: string, isFallbackProvider: boolean): void {
    if (this.#accepted) {
      throw new Error('No attempt is permitted after a response was accepted.');
    }
    if (this.remaining() <= 0) {
      throw new Error('The attempt budget is exhausted.');
    }
    if (isFallbackProvider) {
      if (this.#fallbackUsed && !this.#perProvider.has(providerId)) {
        throw new Error('At most one fallback provider is permitted.');
      }
      this.#fallbackUsed = true;
    }
    this.#total += 1;
    this.#perProvider.set(providerId, (this.#perProvider.get(providerId) ?? 0) + 1);
  }

  /** Mark the accepted response. Idempotent-safe: a second call throws. */
  public markAccepted(): void {
    if (this.#accepted) {
      throw new Error('A response was already accepted.');
    }
    this.#accepted = true;
  }

  public get accepted(): boolean {
    return this.#accepted;
  }

  public get fallbackUsed(): boolean {
    return this.#fallbackUsed;
  }

  public get totalAttempts(): number {
    return this.#total;
  }

  /** A frozen, content-free snapshot for observability and tests. */
  public snapshot(): AttemptLedgerSnapshot {
    return Object.freeze({
      totalAttempts: this.#total,
      maxTotalAttempts: this.#max,
      perProvider: Object.freeze(Object.fromEntries(this.#perProvider)),
      providersUsed: this.#perProvider.size,
      accepted: this.#accepted,
      fallbackUsed: this.#fallbackUsed,
    });
  }
}
