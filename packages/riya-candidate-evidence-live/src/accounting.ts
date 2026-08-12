/**
 * Content-free request and cost accounting, with two HARD ceilings (MVP-P2A.2).
 *
 * ### The ceilings are checked BEFORE a call, never after
 *
 * A ledger that noticed the 84th request afterwards would have already spent it. `reserve()` is called
 * immediately before every provider invocation and refuses rather than reports — so the ceiling is a
 * gate, not a statistic.
 *
 * ### 83 is the exact arithmetic of a complete run
 *
 * 1 smoke + 10 model-facing safety cases + 72 P10 captures. It is not a budget with slack: there is no
 * retry anywhere in this operator, so a request beyond 83 means a loop, a duplicate or a retry that
 * should not exist, and stopping is the correct response to all three.
 *
 * ### Nothing here can hold content
 *
 * Counters and token totals only. No reply, no prompt, no case text, no credential, no error body —
 * the ledger is the thing most likely to be printed, so it is the thing that must be safest to print.
 */

/** The exact arithmetic of one complete successful run. */
export const SMOKE_REQUESTS = 1;
export const SAFETY_MODEL_REQUIRED_REQUESTS = 10;
export const P10_REQUESTS = 72;
export const MAX_PROVIDER_REQUESTS = SMOKE_REQUESTS + SAFETY_MODEL_REQUIRED_REQUESTS + P10_REQUESTS;

/** The owner's hard spend ceiling for this phase. */
export const MAX_ESTIMATED_COST_USD = 5;

/** Why the ledger refused the next call. Closed and content-free. */
export const LEDGER_REFUSALS = ['request-limit-reached', 'cost-limit-reached'] as const;
export type LedgerRefusal = (typeof LEDGER_REFUSALS)[number];

/** Which phase a request belongs to. Used for reporting only; every phase shares one ceiling. */
export const LEDGER_PHASES = ['smoke', 'safety', 'p10'] as const;
export type LedgerPhase = (typeof LEDGER_PHASES)[number];

export interface LedgerSnapshot {
  readonly smokeRequests: number;
  readonly safetyProviderRequests: number;
  readonly p10ProviderRequests: number;
  readonly totalProviderRequests: number;
  readonly successfulProviderResponses: number;
  readonly providerFailures: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  /** True when any request had to be priced from a bound rather than from reported usage. */
  readonly costIsEstimated: boolean;
  readonly estimatedCostUsd: number;
}

export type LedgerReservation =
  { readonly ok: true } | { readonly ok: false; readonly refusal: LedgerRefusal };

export interface ProviderUsageFacts {
  readonly inputTokens?: number | undefined;
  readonly cachedInputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
}

export interface RequestLedgerConfig {
  readonly maxRequests: number;
  readonly maxCostUsd: number;
  readonly pricePerMillionInputUsd: number;
  readonly pricePerMillionCachedInputUsd: number;
  readonly pricePerMillionOutputUsd: number;
  /**
   * The conservative per-request bound used when a provider reports no usage.
   *
   * A guess dressed as a measurement is worse than an admitted bound, so a run that ever uses this
   * marks its whole cost figure `costIsEstimated` and says so in the receipt.
   */
  readonly fallbackInputTokens: number;
  readonly fallbackOutputTokens: number;
}

export interface RequestLedger {
  /** Check both ceilings and, on success, consume one request. Call IMMEDIATELY before invoking. */
  reserve(phase: LedgerPhase): LedgerReservation;
  /** Record what a completed call actually cost. Never affects whether it was allowed to happen. */
  settle(usage: ProviderUsageFacts | undefined, succeeded: boolean): void;
  snapshot(): LedgerSnapshot;
}

function cost(tokens: number, pricePerMillion: number): number {
  return (tokens / 1_000_000) * pricePerMillion;
}

/** Build a fresh in-memory ledger. Holds no content, reads no clock and writes nothing. */
export function createRequestLedger(config: RequestLedgerConfig): RequestLedger {
  const counts = { smoke: 0, safety: 0, p10: 0 };
  let successes = 0;
  let failures = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let estimated = false;

  const total = (): number => counts.smoke + counts.safety + counts.p10;

  const currentCost = (): number =>
    cost(inputTokens, config.pricePerMillionInputUsd) +
    cost(cachedInputTokens, config.pricePerMillionCachedInputUsd) +
    cost(outputTokens, config.pricePerMillionOutputUsd);

  return Object.freeze({
    reserve(phase: LedgerPhase): LedgerReservation {
      if (total() + 1 > config.maxRequests) {
        return { ok: false, refusal: 'request-limit-reached' };
      }
      // Priced against what the NEXT call could cost at the conservative bound, so the ceiling cannot
      // be crossed by the request that discovers it.
      const projected =
        currentCost() +
        cost(config.fallbackInputTokens, config.pricePerMillionInputUsd) +
        cost(config.fallbackOutputTokens, config.pricePerMillionOutputUsd);
      if (projected > config.maxCostUsd) {
        return { ok: false, refusal: 'cost-limit-reached' };
      }
      counts[phase] += 1;
      return { ok: true };
    },

    settle(usage: ProviderUsageFacts | undefined, succeeded: boolean): void {
      if (succeeded) {
        successes += 1;
      } else {
        failures += 1;
      }
      const reportedInput = usage?.inputTokens;
      const reportedOutput = usage?.outputTokens;
      const reportedCached = usage?.cachedInputTokens;
      if (reportedInput === undefined && reportedOutput === undefined) {
        // Nothing reported. Bound it and mark the whole run's figure as estimated rather than
        // inventing an exact token count nobody measured.
        estimated = true;
        inputTokens += config.fallbackInputTokens;
        outputTokens += config.fallbackOutputTokens;
        return;
      }
      if (reportedInput === undefined || reportedOutput === undefined) {
        estimated = true;
      }
      inputTokens += reportedInput ?? config.fallbackInputTokens;
      outputTokens += reportedOutput ?? config.fallbackOutputTokens;
      cachedInputTokens += reportedCached ?? 0;
    },

    snapshot(): LedgerSnapshot {
      return Object.freeze({
        smokeRequests: counts.smoke,
        safetyProviderRequests: counts.safety,
        p10ProviderRequests: counts.p10,
        totalProviderRequests: total(),
        successfulProviderResponses: successes,
        providerFailures: failures,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costIsEstimated: estimated,
        estimatedCostUsd: currentCost(),
      });
    },
  });
}
