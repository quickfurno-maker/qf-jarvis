/**
 * JF-5B-ONLY live pacing for Nara certification calls (JF-5B-R18, ADR-0152).
 *
 * Run-29 issued bounded selection probes without any Nara pacing. The provider returned transient
 * `rate-limited` outcomes across candidates, which is capacity evidence rather than model-quality
 * evidence. Nara's public docs observed on 2026-09-15 state that the Free plan permits 15 requests per
 * minute, that plan limits vary, and that a 429 window resets every minute.
 *
 * This module changes only the one-time certification lane. It never retries, never re-executes a case,
 * never changes Gateway routing, and is not imported by a serving path.
 */
import type { PacingClock, PacingObservation, PacingSleeper } from './groq-live-pacing.js';

/** Publicly documented Free-plan request ceiling observed 2026-09-15. */
export const NARA_PUBLISHED_FREE_RPM = 15;
/** One call per 15 seconds: 4 RPM, intentionally well below the documented Free-plan ceiling. */
export const NARA_MIN_MODEL_CALL_INTERVAL_MS = 15_000;
/** One full minute plus margin after an exact 429, applied only before the NEXT distinct case. */
export const NARA_RATE_LIMIT_COOLDOWN_MS = 65_000;

export function naraPacingDelayMsFor(observation: PacingObservation | undefined): number {
  if (observation === undefined) return 0;
  return observation.errorCode === 'rate-limited'
    ? NARA_RATE_LIMIT_COOLDOWN_MS
    : NARA_MIN_MODEL_CALL_INTERVAL_MS;
}
export interface NaraLivePacer {
  waitBeforeNextCall(): Promise<void>;
  observe(observation: PacingObservation): void;
  totalWaitedMs(): number;
}

export function createNaraLivePacer(clock: PacingClock, sleeper: PacingSleeper): NaraLivePacer {
  let lastObservation: PacingObservation | undefined;
  let lastCallAt: number | undefined;
  let waited = 0;

  return Object.freeze({
    async waitBeforeNextCall(): Promise<void> {
      const required = naraPacingDelayMsFor(lastObservation);
      if (required === 0 || lastCallAt === undefined) return;
      const remaining = required - (clock.now() - lastCallAt);
      if (remaining <= 0) return;
      waited += remaining;
      await sleeper.sleep(remaining);
    },
    observe(observation: PacingObservation): void {
      lastObservation = observation;
      lastCallAt = clock.now();
    },
    totalWaitedMs: () => waited,
  });
}
