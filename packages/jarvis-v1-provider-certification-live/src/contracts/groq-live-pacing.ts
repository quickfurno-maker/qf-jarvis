/**
 * JF-5B-ONLY live pacing for Groq certification calls (JF-5B-R6, ADR-0152).
 *
 * ### What this is NOT
 *
 * Not a production rate limiter. Not a gateway retry policy. Not a provider behaviour. Not a QuickFurno
 * runtime feature. Nothing in `packages/model-gateway`, the Groq provider or any serving path imports
 * this module, and a containment spec asserts that. Production serving pacing — if the business ever
 * needs it — is a different decision, with a different owner, and it does not get to be decided as a
 * side effect of a one-time certification run.
 *
 * ### What it is
 *
 * Run-8 executed 45 Groq model-required rows as fast as the suite could issue them. Eight completed and
 * 37 came back transient. The owner then read the staging project's inherited organisation limits for
 * `openai/gpt-oss-20b`: **30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD**. A structured three-agent turn
 * costs on the order of a thousand prompt tokens plus its completion, so a handful of back-to-back calls
 * is the whole per-minute token lane.
 *
 * This module is the smallest thing that stops a one-time certification from bursting that lane. It
 * decides ONLY how long to wait before the next Groq call. It never retries, never re-executes a case,
 * never reorders anything, and never touches Nara.
 *
 * ### Why token-driven and not simply one call every two seconds
 *
 * The binding constraint here is TPM, not RPM: 30 requests per minute is generous next to 8,000 tokens
 * per minute when one turn can cost 1,500. So the delay is derived from what the PREVIOUS successful
 * call actually consumed — measured, not assumed — against a target below the ceiling. A fixed interval
 * would be either wastefully slow for a cheap turn or still bursty for an expensive one.
 *
 * ### Why a pessimistic target
 *
 * `PACING_TARGET_TPM` sits 25% under the observed ceiling. The ceiling is what the provider enforces;
 * the target is what we aim at, and the gap absorbs the fact that our token count is the previous call's
 * and the limiter's window is not aligned to ours. A correct one-time certification is worth minutes.
 */

/**
 * The owner-observed staging limits for `openai/gpt-oss-20b`, read from the Groq console on
 * 2026-09-12. The project declares no custom limits and inherits the organisation's.
 *
 * Recorded as OBSERVATIONS, with the date in the name of the thing that observed them. They are not a
 * contract the provider owes us and not a production policy — a certification run pacing itself against
 * what it was told is different from the platform promising anything.
 */
export const GROQ_OBSERVED_RPM = 30;
export const GROQ_OBSERVED_RPD = 1_000;
export const GROQ_OBSERVED_TPM = 8_000;
export const GROQ_OBSERVED_TPD = 200_000;

/** The target this lane aims at: 25% under the observed token ceiling. */
export const PACING_TARGET_TPM = 6_000;

/**
 * The floor between two Groq model-required calls.
 *
 * 15 s is 4 calls per minute — far under the observed 30 RPM, and deliberately so: this floor exists to
 * stop a cheap turn from letting the suite sprint back into the token lane it just drained.
 */
export const MIN_MODEL_CALL_INTERVAL_MS = 15_000;

/**
 * The one-time cool-down after an exact `rate-limited` code.
 *
 * 65 s, because the limiter's window is a minute and we do not know where in that minute we landed.
 * Slightly over one full window is the only interval that is certain to clear it. It is applied before
 * the NEXT DISTINCT case — the failed case is never retried.
 */
export const RATE_LIMIT_COOLDOWN_MS = 65_000;

const MS_PER_MINUTE = 60_000;

/** The seams, so a spec never really sleeps and CI stays fast. */
export interface PacingClock {
  now(): number;
}
export interface PacingSleeper {
  sleep(ms: number): Promise<void>;
}

/** What the previous Groq call cost, or how it failed. Nothing else influences the delay. */
export interface PacingObservation {
  readonly totalTokens: number | undefined;
  /** The gateway's exact closed code, when there was one. Only `rate-limited` changes the policy. */
  readonly errorCode: string | undefined;
}

/**
 * The delay a given observation earns, before the next Groq model-required call.
 *
 * Pure, so the arithmetic is assertable without a clock. The rate-limit cool-down WINS over the token
 * delay: being told to slow down outranks our own estimate of how fast we were going.
 */
export function pacingDelayMsFor(observation: PacingObservation | undefined): number {
  if (observation === undefined) {
    // Nothing has been spent yet. The first call pays no delay.
    return 0;
  }
  if (observation.errorCode === 'rate-limited') {
    return RATE_LIMIT_COOLDOWN_MS;
  }
  const tokens = observation.totalTokens ?? 0;
  const tokenDelayMs = Math.ceil((tokens / PACING_TARGET_TPM) * MS_PER_MINUTE);
  return Math.max(MIN_MODEL_CALL_INTERVAL_MS, tokenDelayMs);
}

/** Paces Groq model-required calls. One instance per run; Nara never sees it. */
export interface GroqLivePacer {
  /** Wait until the previous observation's delay has elapsed. A no-op before the first call. */
  waitBeforeNextCall(): Promise<void>;
  /** Record what the call just made cost, or how it failed. */
  observe(observation: PacingObservation): void;
  /** Total milliseconds this pacer has asked the run to wait. For the operator summary. */
  totalWaitedMs(): number;
}

/**
 * Build the pacer.
 *
 * It measures elapsed time rather than sleeping blindly for the full delay: the call itself takes
 * seconds, and that time already counts against the limiter's window. Sleeping the whole interval on top
 * would double the run's length for no extra safety.
 */
export function createGroqLivePacer(clock: PacingClock, sleeper: PacingSleeper): GroqLivePacer {
  let lastObservation: PacingObservation | undefined;
  let lastCallAt: number | undefined;
  let waited = 0;

  return Object.freeze({
    async waitBeforeNextCall(): Promise<void> {
      const required = pacingDelayMsFor(lastObservation);
      if (required === 0 || lastCallAt === undefined) {
        return;
      }
      const elapsed = clock.now() - lastCallAt;
      const remaining = required - elapsed;
      if (remaining <= 0) {
        return;
      }
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
