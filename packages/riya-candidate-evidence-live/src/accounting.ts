/**
 * Content-free request and cost accounting, with two HARD ceilings (MVP-P2A.2).
 *
 * ### The ceilings are checked BEFORE a call, never after
 *
 * A ledger that noticed the 84th request afterwards would have already spent it. `reserve()` is called
 * immediately before every provider invocation and refuses rather than reports — so the ceiling is a
 * gate, not a statistic.
 *
 * ### Each ceiling is the exact arithmetic of the run it bounds
 *
 * FULL_EVIDENCE is 83: 1 smoke + 10 model-facing safety cases + 72 P10 captures, at USD 5.
 * SAFETY_REPLICATION is 11: 1 smoke + 10 model-facing safety cases, at USD 1 — it stops after the
 * safety authority, so the 72 are not merely unused, they are unreachable.
 *
 * Neither is a budget with slack. There is no retry anywhere in this operator, so a request past a
 * ceiling means a loop, a duplicate or a retry that should not exist, and stopping is the correct
 * response to all three. The narrower ceiling is a SECOND line of defence for a replication run: the
 * operator already returns before P10, and if that early return were ever removed, the first quality
 * reservation would be request 12 and the ledger would refuse it before the provider was reached.
 *
 * ### Nothing here can hold content
 *
 * Counters and token totals only. No reply, no prompt, no case text, no credential, no error body —
 * the ledger is the thing most likely to be printed, so it is the thing that must be safest to print.
 */

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
  CANDIDATE_PRICE_PER_M_INPUT_USD,
  CANDIDATE_PRICE_PER_M_OUTPUT_USD,
} from './candidate-release.js';

/** The exact arithmetic of one complete successful run. */
export const SMOKE_REQUESTS = 1;
export const SAFETY_MODEL_REQUIRED_REQUESTS = 10;
export const P10_REQUESTS = 72;
export const MAX_PROVIDER_REQUESTS = SMOKE_REQUESTS + SAFETY_MODEL_REQUIRED_REQUESTS + P10_REQUESTS;

/** The owner's hard spend ceiling for a FULL_EVIDENCE run. */
export const MAX_ESTIMATED_COST_USD = 5;

/**
 * The exact arithmetic of a SAFETY_REPLICATION run: smoke plus the model-facing safety cases.
 *
 * Derived from the same two constants rather than typed as 11, so it cannot drift away from the split
 * it claims to describe.
 */
export const SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + SAFETY_MODEL_REQUIRED_REQUESTS;

/**
 * The spend ceiling for a replication. A fifth of the full-run ceiling, because a run that can make
 * at most 11 calls has no business being authorised for 83 calls' worth of spend.
 */
export const SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a REQUEST_CONTRACT_DIAGNOSTIC run (MVP-P2A.2 HF4-R8): the text smoke plus
 * the eight canaries, and nothing else.
 *
 * NINE, which is deliberately BELOW the replication's eleven. A diagnostic that isolates a request
 * dimension has no business being authorised for more calls than the run it is diagnosing.
 */
export const DIAGNOSTIC_CANARY_REQUESTS = 8;
export const REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + DIAGNOSTIC_CANARY_REQUESTS;

/** The spend ceiling for a diagnostic. Same conservative figure as a replication. */
export const REQUEST_CONTRACT_DIAGNOSTIC_MAX_ESTIMATED_COST_USD = 1;

/** Why the ledger refused the next call. Closed and content-free. */
export const LEDGER_REFUSALS = [
  'request-limit-reached',
  'cost-limit-reached',
  /**
   * A provider reported more tokens than the model can physically process.
   *
   * That is not an overspend, it is a broken premise: the reservation bound is derived from the
   * declared maxima, so a figure above them means the bound never guaranteed anything. The run stops
   * rather than continuing to reserve against arithmetic that has been shown to be wrong.
   */
  'usage-bound-violated',
] as const;
export type LedgerRefusal = (typeof LEDGER_REFUSALS)[number];

/** Which phase a request belongs to. Used for reporting only; every phase shares one ceiling. */
export const LEDGER_PHASES = ['smoke', 'safety', 'p10', 'diagnostic'] as const;
export type LedgerPhase = (typeof LEDGER_PHASES)[number];

export interface LedgerSnapshot {
  readonly smokeRequests: number;
  readonly safetyProviderRequests: number;
  readonly p10ProviderRequests: number;
  /** HF4-R8. Synthetic canary requests. Counted APART from safety so no receipt can conflate them. */
  readonly diagnosticProviderRequests: number;
  readonly totalProviderRequests: number;
  readonly successfulProviderResponses: number;
  readonly providerFailures: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  /** True when any request had to be priced from a bound rather than from reported usage. */
  readonly costIsEstimated: boolean;
  readonly estimatedCostUsd: number;
  /** True once a provider reported usage above the declared hard maxima. Closes the run. */
  readonly usageBoundViolated: boolean;
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
  /**
   * The declared provider maxima. Reported usage above either is a closed invariant violation.
   *
   * These are what make the reservation a GUARANTEE rather than an estimate: no single request can
   * cost more than these two figures priced at the current rates, so 83 reservations have a real
   * upper bound that can be checked against the ceiling before anything is spent.
   */
  readonly hardMaxInputTokens: number;
  readonly hardMaxOutputTokens: number;
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
  const counts = { smoke: 0, safety: 0, p10: 0, diagnostic: 0 };
  let successes = 0;
  let failures = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let estimated = false;
  let usageBoundViolated = false;

  // Every phase, including HF4-R8's diagnostic canaries. One ceiling covers them all, so a phase left
  // out of this sum would be a phase that spends requests nothing counts.
  const total = (): number => counts.smoke + counts.safety + counts.p10 + counts.diagnostic;

  const currentCost = (): number =>
    cost(inputTokens, config.pricePerMillionInputUsd) +
    cost(cachedInputTokens, config.pricePerMillionCachedInputUsd) +
    cost(outputTokens, config.pricePerMillionOutputUsd);

  return Object.freeze({
    reserve(phase: LedgerPhase): LedgerReservation {
      // A broken bound closes the run before anything else is considered. Continuing would mean
      // reserving against a guarantee that has already been disproved.
      if (usageBoundViolated) {
        return { ok: false, refusal: 'usage-bound-violated' };
      }
      if (total() + 1 > config.maxRequests) {
        return { ok: false, refusal: 'request-limit-reached' };
      }
      // Priced against what the NEXT call could cost at the conservative bound, so the ceiling cannot
      // be crossed by the request that discovers it.
      // Priced at the HARD MAXIMA, not at a typical request. The question a ceiling has to answer is
      // "could the next call breach it", and only the worst case answers that.
      const projected =
        currentCost() +
        cost(config.hardMaxInputTokens, config.pricePerMillionInputUsd) +
        cost(config.hardMaxOutputTokens, config.pricePerMillionOutputUsd);
      if (projected > config.maxCostUsd) {
        return { ok: false, refusal: 'cost-limit-reached' };
      }
      counts[phase] += 1;
      return { ok: true };
    },

    settle(usage: ProviderUsageFacts | undefined, succeeded: boolean): void {
      // Checked before the figures are accumulated: a report above the declared maxima is not a
      // larger measurement, it is evidence the declaration is wrong.
      if (
        (usage?.inputTokens ?? 0) > config.hardMaxInputTokens ||
        (usage?.outputTokens ?? 0) > config.hardMaxOutputTokens
      ) {
        usageBoundViolated = true;
      }
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
        diagnosticProviderRequests: counts.diagnostic,
        totalProviderRequests: total(),
        successfulProviderResponses: successes,
        providerFailures: failures,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costIsEstimated: estimated,
        estimatedCostUsd: currentCost(),
        usageBoundViolated,
      });
    },
  });
}

/**
 * The operator's ledger configuration.
 *
 * The reservation bound is the model's OWN declared maxima, so a reserved request cannot cost more
 * than it claims to. At the current published rates that is about $0.0295 per request and about
 * $2.45 across all 83 — comfortably inside the $5 ceiling, and a spec asserts the arithmetic rather
 * than trusting this comment. If either price rose enough to break it, the spec fails and preflight
 * refuses before a credential is ever read.
 */
export function createOperatorLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: MAX_PROVIDER_REQUESTS,
    maxCostUsd: MAX_ESTIMATED_COST_USD,
    pricePerMillionInputUsd: CANDIDATE_PRICE_PER_M_INPUT_USD,
    pricePerMillionCachedInputUsd: CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
    pricePerMillionOutputUsd: CANDIDATE_PRICE_PER_M_OUTPUT_USD,
    fallbackInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    fallbackOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
  });
}

/**
 * The ledger for a bounded SAFETY_REPLICATION run.
 *
 * Same prices, same fallback token bounds, same hard model maxima — all read from the governed
 * candidate release, never restated here, so a published price change moves both ledgers together.
 * Only the two ceilings differ, and both are narrower.
 */
export function createSafetyReplicationLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS,
    maxCostUsd: SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD,
    pricePerMillionInputUsd: CANDIDATE_PRICE_PER_M_INPUT_USD,
    pricePerMillionCachedInputUsd: CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
    pricePerMillionOutputUsd: CANDIDATE_PRICE_PER_M_OUTPUT_USD,
    fallbackInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    fallbackOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
  });
}

/**
 * The ledger for a bounded REQUEST_CONTRACT_DIAGNOSTIC run (MVP-P2A.2 HF4-R8).
 *
 * Same prices, same fallback bounds, same governed model maxima as the other two — read from the
 * candidate release rather than restated, so a published price change moves all three together. Only
 * the ceilings differ, and both are the narrowest in the codebase: nine requests, one dollar.
 *
 * Nine is deliberately fewer than the replication's eleven. A run whose entire purpose is to isolate a
 * request dimension should not be authorised for more calls than the run it is diagnosing.
 */
export function createRequestContractDiagnosticLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: REQUEST_CONTRACT_DIAGNOSTIC_MAX_PROVIDER_REQUESTS,
    maxCostUsd: REQUEST_CONTRACT_DIAGNOSTIC_MAX_ESTIMATED_COST_USD,
    pricePerMillionInputUsd: CANDIDATE_PRICE_PER_M_INPUT_USD,
    pricePerMillionCachedInputUsd: CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
    pricePerMillionOutputUsd: CANDIDATE_PRICE_PER_M_OUTPUT_USD,
    fallbackInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    fallbackOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
  });
}
