/**
 * A deterministic per-provider circuit breaker (QFJ-P04.01A, ADR-0045).
 *
 * After `failureThreshold` consecutive failures a provider's circuit OPENS and further attempts are
 * refused until `cooldownMs` has elapsed (measured by the injected clock), at which point one HALF-OPEN
 * trial is allowed; a success CLOSES it, a failure re-OPENS it. No timer, no background work — state
 * transitions are computed from the injected clock at each decision.
 */
import type { GatewayClock } from './clock.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitEntry {
  consecutiveFailures: number;
  openedAtMs: number | null;
}

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
}

export class CircuitBreaker {
  private readonly clock: GatewayClock;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly entries = new Map<string, CircuitEntry>();

  public constructor(clock: GatewayClock, config: CircuitBreakerConfig) {
    if (!Number.isInteger(config.failureThreshold) || config.failureThreshold < 1) {
      throw new Error('failureThreshold must be a positive integer');
    }
    if (!Number.isInteger(config.cooldownMs) || config.cooldownMs < 0) {
      throw new Error('cooldownMs must be a non-negative integer');
    }
    this.clock = clock;
    this.failureThreshold = config.failureThreshold;
    this.cooldownMs = config.cooldownMs;
  }

  private entry(providerId: string): CircuitEntry {
    let entry = this.entries.get(providerId);
    if (entry === undefined) {
      entry = { consecutiveFailures: 0, openedAtMs: null };
      this.entries.set(providerId, entry);
    }
    return entry;
  }

  /** The current, clock-derived state for a provider. */
  public stateOf(providerId: string): CircuitState {
    const entry = this.entry(providerId);
    if (entry.openedAtMs === null) {
      return 'closed';
    }
    return this.clock.now() - entry.openedAtMs >= this.cooldownMs ? 'half-open' : 'open';
  }

  /** True iff an attempt may proceed now (closed, or half-open for a single trial). */
  public canAttempt(providerId: string): boolean {
    return this.stateOf(providerId) !== 'open';
  }

  public recordSuccess(providerId: string): void {
    const entry = this.entry(providerId);
    entry.consecutiveFailures = 0;
    entry.openedAtMs = null;
  }

  public recordFailure(providerId: string): void {
    const entry = this.entry(providerId);
    if (this.stateOf(providerId) === 'half-open') {
      // A failed half-open trial re-opens the circuit from now.
      entry.consecutiveFailures = this.failureThreshold;
      entry.openedAtMs = this.clock.now();
      return;
    }
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= this.failureThreshold && entry.openedAtMs === null) {
      entry.openedAtMs = this.clock.now();
    }
  }
}
