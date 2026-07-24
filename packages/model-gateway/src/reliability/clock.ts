/**
 * The injected gateway clock (QFJ-P04.01A, ADR-0045).
 *
 * All gateway time comes from here — never `Date.now()` and never a wall-clock sleep. Tests inject a
 * deterministic clock they advance manually, so circuit cooldowns and latency are reproducible.
 */
export interface GatewayClock {
  /** The current time in milliseconds. Monotonic, injected, deterministic in tests. */
  now(): number;
}

/** A manually-advanced deterministic clock for tests and for a controlled runtime. */
export function createManualClock(startMs = 0): GatewayClock & { advance(ms: number): void } {
  let current = startMs;
  return {
    now(): number {
      return current;
    },
    advance(ms: number): void {
      current += ms;
    },
  };
}

/** The production clock (monotonic wall time). Injected at composition; never used by unit tests. */
export function createSystemClock(): GatewayClock {
  return {
    now(): number {
      return Date.now();
    },
  };
}
