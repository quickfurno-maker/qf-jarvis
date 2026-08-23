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
  MODEL_DIFFERENTIAL_PRICE_PER_M_CACHED_INPUT_USD,
  MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD,
  MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD,
} from './model-differential-identity.js';
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

/**
 * The exact arithmetic of a SCHEMA_DIFFERENTIAL_DIAGNOSTIC run (POST-PR-131): the text smoke plus
 * the nine schema probes R0-R8, and nothing else.
 *
 * Counted APART from the historical eight-canary diagnostic. S11's D1-D8 matrix is immutable
 * evidence and its ledger keeps describing exactly it; a run with a different matrix borrowing that
 * ceiling would make two different runs indistinguishable in a receipt.
 */
export const SCHEMA_DIFFERENTIAL_PROBE_REQUESTS = 9;
export const SCHEMA_DIFFERENTIAL_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + SCHEMA_DIFFERENTIAL_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as the other two bounded diagnostics. */
export const SCHEMA_DIFFERENTIAL_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_SDH4_SCHEMA_REPAIR_VERIFICATION run: the text smoke plus the five
 * V0-V4 probes.
 *
 * SIX, the narrowest ceiling in the codebase. The repair is a single structural change, so verifying
 * it needs five questions rather than the nine SDH4 spent isolating an unknown one — and a run that
 * asks less has no business being authorised for more.
 */
export const SCHEMA_REPAIR_VERIFICATION_PROBE_REQUESTS = 5;
export const SCHEMA_REPAIR_VERIFICATION_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + SCHEMA_REPAIR_VERIFICATION_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const SCHEMA_REPAIR_VERIFICATION_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC run: the text smoke plus the
 * four O0-O3 probes.
 *
 * FIVE, narrower again than SRV1's six. SRV1 answered the schema question at the low control cap and
 * left exactly one axis open — whether the repaired schema and the representative production message
 * shape survive at the REAL operational completion budget. Four probes is what that costs.
 */
export const OPERATIONAL_ACCEPTANCE_PROBE_REQUESTS = 4;
export const OPERATIONAL_ACCEPTANCE_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + OPERATIONAL_ACCEPTANCE_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const OPERATIONAL_ACCEPTANCE_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_OAD3_REPRESENTATIVE_ACCEPTANCE run: the text smoke plus ONE probe.
 *
 * TWO. The narrowest ceiling in the repository, and narrow for a reason rather than for neatness:
 * OAD3 already established the control and the exact synthetic schema at this budget, so a run that
 * re-sent them would spend live authorization re-proving settled facts. One question remains, so one
 * probe is authorized.
 */
export const REPRESENTATIVE_ACCEPTANCE_PROBE_REQUESTS = 1;
export const REPRESENTATIVE_ACCEPTANCE_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + REPRESENTATIVE_ACCEPTANCE_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const REPRESENTATIVE_ACCEPTANCE_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE run: the smoke plus ONE probe.
 *
 * TWO, the same ceiling RA1 had — but its OWN counter. Reusing RA1's would leave two runs that ask
 * genuinely different questions, on genuinely different client turns, indistinguishable in a receipt.
 * RA1's 400 came from an adversarial safety-derived turn; this one carries an ordinary client turn,
 * and an owner reading a receipt must be able to tell which.
 */
export const NEUTRAL_REPRESENTATIVE_PROBE_REQUESTS = 1;
export const NEUTRAL_REPRESENTATIVE_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + NEUTRAL_REPRESENTATIVE_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const NEUTRAL_REPRESENTATIVE_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL run: smoke plus ONE probe.
 *
 * TWO, and its OWN counter. The differential asks a different question of a different MODEL, and a
 * receipt that shared NRA1's counter could not say which model produced it — which is the only thing
 * this run measures.
 */
export const MODEL_DIFFERENTIAL_PROBE_REQUESTS = 1;
export const MODEL_DIFFERENTIAL_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + MODEL_DIFFERENTIAL_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const MODEL_DIFFERENTIAL_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL run: smoke plus ONE
 * probe.
 *
 * TWO, and its OWN counter. The differential asks a different question over a different ENDPOINT, and
 * a receipt that shared MD120B3's counter could not say which output contract produced it — which is
 * the only thing this run measures.
 */
export const RESPONSES_DIFFERENTIAL_PROBE_REQUESTS = 1;
export const RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + RESPONSES_DIFFERENTIAL_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL run: smoke plus ONE probe.
 *
 * TWO, and its OWN counter. The differential varies `reasoning_effort`, and a receipt that shared
 * RSP20B2's counter could not say whether a request was spent at the documented default or at low --
 * which is the only thing this run measures.
 */
export const REASONING_DIFFERENTIAL_PROBE_REQUESTS = 1;
export const REASONING_DIFFERENTIAL_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + REASONING_DIFFERENTIAL_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const REASONING_DIFFERENTIAL_MAX_ESTIMATED_COST_USD = 1;

/**
 * The exact arithmetic of a POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL run: smoke plus
 * ONE probe.
 *
 * TWO, and its OWN counter. The differential varies `max_completion_tokens` with the reasoning
 * posture held, and a receipt that shared RLD1's counter could not say whether a request was spent
 * at 4,096 or at 8,192 -- which is the only thing this run measures. RLD1 is CONSUMED and its
 * evidence is immutable; a shared counter would make it unreadable.
 */
export const REASONING_BUDGET_8192_PROBE_REQUESTS = 1;
export const REASONING_BUDGET_8192_MAX_PROVIDER_REQUESTS =
  SMOKE_REQUESTS + REASONING_BUDGET_8192_PROBE_REQUESTS;

/** The spend ceiling. Same conservative figure as every other bounded diagnostic. */
export const REASONING_BUDGET_8192_MAX_ESTIMATED_COST_USD = 1;

/**
 * Where an aggregate token total came from.
 *
 * ### Why this is per-DIMENSION and not one flag on the run
 *
 * A run mixes both. RSP20B2 is the worked example: its governed smoke reported real usage, its
 * diagnostic probe reported none, and the receipt printed `outputTokensTotal=65622` — 86 observed
 * tokens from the smoke plus the 65,536 fallback BOUND for the probe. A single run-level
 * `usageSource` would have had to call that either PROVIDER or FALLBACK, and both answers are false.
 *
 * So provenance is tracked per settlement and per dimension, and the posture below is DERIVED from
 * the counts rather than set by anyone. `MIXED` is the honest answer whenever both appear, and a
 * total that contains even one fallback contribution can never report `PROVIDER_ONLY`.
 *
 * Input and output are tracked SEPARATELY because a provider may report one and omit the other, and
 * collapsing them would let an observed input launder an unobserved output.
 */
export const USAGE_PROVENANCES = [
  /** Nothing settled this dimension yet. */
  'NONE',
  /** Every contribution was a provider-reported figure. */
  'PROVIDER_ONLY',
  /** Every contribution was a conservative fallback bound. Not a measurement. */
  'FALLBACK_ONLY',
  /** Both appear in the same total. The only truthful answer for a mixed run. */
  'MIXED',
] as const;
export type UsageProvenance = (typeof USAGE_PROVENANCES)[number];

/** Derive the posture from two counts. Total by construction: every pair maps to a member. */
export function usageProvenanceOf(
  providerSettlements: number,
  fallbackSettlements: number,
): UsageProvenance {
  if (providerSettlements === 0 && fallbackSettlements === 0) {
    return 'NONE';
  }
  if (fallbackSettlements === 0) {
    return 'PROVIDER_ONLY';
  }
  if (providerSettlements === 0) {
    return 'FALLBACK_ONLY';
  }
  return 'MIXED';
}

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
export const LEDGER_PHASES = [
  'smoke',
  'safety',
  'p10',
  'diagnostic',
  'schema-probe',
  'schema-repair-probe',
  'operational-acceptance-probe',
  'representative-acceptance-probe',
  'neutral-representative-probe',
  'model-differential-probe',
  'responses-differential-probe',
  'reasoning-differential-probe',
  'reasoning-budget-8192-probe',
] as const;
export type LedgerPhase = (typeof LEDGER_PHASES)[number];

export interface LedgerSnapshot {
  readonly smokeRequests: number;
  readonly safetyProviderRequests: number;
  readonly p10ProviderRequests: number;
  /** HF4-R8. Synthetic canary requests. Counted APART from safety so no receipt can conflate them. */
  readonly diagnosticProviderRequests: number;
  /**
   * POST-PR-131. Schema probe requests (R0-R8).
   *
   * A THIRD counter rather than a reuse of `diagnosticProviderRequests`: that one describes S11's
   * historical D1-D8 canary matrix, and a receipt in which two different diagnostics increment the
   * same field could not say which run it came from.
   */
  readonly schemaProbeProviderRequests: number;
  /**
   * POST-SDH4. Repair-verification probe requests (V0-V4).
   *
   * A FOURTH counter. SDH4's R0-R8 evidence is immutable and describes the pre-repair schema; a
   * receipt in which a verification run incremented that counter could not say which matrix ran.
   */
  readonly schemaRepairProbeProviderRequests: number;
  /**
   * POST-SRV1. Operational acceptance probe requests (O0-O3).
   *
   * A FIFTH counter. Every prior matrix ran at the low control cap; this one runs at the governed
   * operational budget, so a receipt that shared a counter with them could not say which envelope
   * produced it.
   */
  readonly operationalAcceptanceProbeProviderRequests: number;
  /**
   * POST-OAD3. Representative acceptance probe requests.
   *
   * A SIXTH counter. OAD3's four-probe matrix and this one-probe gate ask different questions at the
   * same budget, and a receipt that shared a counter between them could not say which run produced it.
   */
  readonly representativeAcceptanceProbeProviderRequests: number;
  /**
   * POST-RA1. Neutral client acceptance probe requests.
   *
   * A SEVENTH counter, for the reason the sixth existed: the question differs, so the receipt must.
   */
  readonly neutralRepresentativeProbeProviderRequests: number;
  /**
   * POST-NRA1. GPT-OSS-120B strict model-differential probe requests.
   *
   * An EIGHTH counter. The model is the variable this run exists to change, so the receipt must be
   * able to say a request was spent on 120B rather than on the production candidate.
   */
  readonly modelDifferentialProbeProviderRequests: number;
  /**
   * POST-MD120B3. Groq Responses API strict endpoint-differential probe requests.
   *
   * A NINTH counter. The endpoint is the variable this run exists to change, so the receipt must be
   * able to say a request was spent on `/openai/v1/responses` rather than on the production Chat
   * Completions contract every earlier probe used.
   */
  readonly responsesDifferentialProbeProviderRequests: number;
  /**
   * POST-RSP20B2. `reasoning_effort='low'` differential probe requests.
   *
   * A TENTH counter. The reasoning effort is the variable this run exists to change, so the receipt
   * must be able to say a request was spent at `low` rather than at the documented default every
   * earlier probe carried by omitting the field entirely.
   */
  readonly reasoningDifferentialProbeProviderRequests: number;
  /**
   * POST-RLD1. Low-reasoning 8,192 output-budget differential probe requests.
   *
   * An ELEVENTH counter. The completion budget is the variable this run exists to change, so the
   * receipt must be able to say a request was spent at 8,192 rather than at the 4,096 RLD1 sent.
   */
  readonly reasoningBudget8192ProbeProviderRequests: number;
  readonly totalProviderRequests: number;
  readonly successfulProviderResponses: number;
  readonly providerFailures: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  /** True when any request had to be priced from a bound rather than from reported usage. */
  readonly costIsEstimated: boolean;
  /**
   * How many settlements contributed a PROVIDER-REPORTED figure to each dimension.
   *
   * Counters rather than a flag, so a reader can see the mixture rather than a verdict about it.
   */
  readonly providerReportedInputSettlements: number;
  readonly providerReportedOutputSettlements: number;
  /** How many contributed a conservative FALLBACK BOUND instead. Never a measurement. */
  readonly fallbackInputSettlements: number;
  readonly fallbackOutputSettlements: number;
  /**
   * The derived posture per dimension.
   *
   * `MIXED` whenever both appear. A total carrying even one fallback contribution can never report
   * `PROVIDER_ONLY`, which is the whole point of tracking this.
   */
  readonly inputUsageProvenance: UsageProvenance;
  readonly outputUsageProvenance: UsageProvenance;
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
  // Keyed by the closed phase vocabulary, so a phase added there must be counted here.
  const counts: Record<LedgerPhase, number> = {
    smoke: 0,
    safety: 0,
    p10: 0,
    diagnostic: 0,
    'schema-probe': 0,
    'schema-repair-probe': 0,
    'operational-acceptance-probe': 0,
    'representative-acceptance-probe': 0,
    'neutral-representative-probe': 0,
    'model-differential-probe': 0,
    'responses-differential-probe': 0,
    'reasoning-differential-probe': 0,
    'reasoning-budget-8192-probe': 0,
  };
  let successes = 0;
  let failures = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let estimated = false;
  let usageBoundViolated = false;
  // Per-dimension provenance counts. Incremented in `settle`, never set from outside.
  let providerReportedInputSettlements = 0;
  let providerReportedOutputSettlements = 0;
  let fallbackInputSettlements = 0;
  let fallbackOutputSettlements = 0;

  // Every phase, including HF4-R8's diagnostic canaries. One ceiling covers them all, so a phase left
  // out of this sum would be a phase that spends requests nothing counts.
  // Summed over the CLOSED phase vocabulary rather than by naming each phase. A phase added to
  // LEDGER_PHASES and forgotten here would be a request the ceiling never saw.
  const total = (): number => LEDGER_PHASES.reduce((sum, phase) => sum + counts[phase], 0);

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

      // ONE path for both dimensions, rather than an early return for the both-absent case.
      //
      // The arithmetic is unchanged -- the old early return added the two fallback bounds and no
      // cached tokens, which is exactly what the general path below computes when both are absent.
      // Unifying them is what lets provenance be counted per DIMENSION: the early return could only
      // ever describe a settlement as wholly observed or wholly bounded, and a provider that reports
      // input but not output is neither.
      if (reportedInput === undefined) {
        estimated = true;
        fallbackInputSettlements += 1;
        inputTokens += config.fallbackInputTokens;
      } else {
        providerReportedInputSettlements += 1;
        inputTokens += reportedInput;
      }
      if (reportedOutput === undefined) {
        estimated = true;
        fallbackOutputSettlements += 1;
        outputTokens += config.fallbackOutputTokens;
      } else {
        providerReportedOutputSettlements += 1;
        outputTokens += reportedOutput;
      }
      cachedInputTokens += reportedCached ?? 0;
    },

    snapshot(): LedgerSnapshot {
      return Object.freeze({
        smokeRequests: counts.smoke,
        safetyProviderRequests: counts.safety,
        p10ProviderRequests: counts.p10,
        diagnosticProviderRequests: counts.diagnostic,
        schemaProbeProviderRequests: counts['schema-probe'],
        schemaRepairProbeProviderRequests: counts['schema-repair-probe'],
        operationalAcceptanceProbeProviderRequests: counts['operational-acceptance-probe'],
        representativeAcceptanceProbeProviderRequests: counts['representative-acceptance-probe'],
        neutralRepresentativeProbeProviderRequests: counts['neutral-representative-probe'],
        modelDifferentialProbeProviderRequests: counts['model-differential-probe'],
        responsesDifferentialProbeProviderRequests: counts['responses-differential-probe'],
        reasoningDifferentialProbeProviderRequests: counts['reasoning-differential-probe'],
        reasoningBudget8192ProbeProviderRequests: counts['reasoning-budget-8192-probe'],
        totalProviderRequests: total(),
        successfulProviderResponses: successes,
        providerFailures: failures,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costIsEstimated: estimated,
        providerReportedInputSettlements,
        providerReportedOutputSettlements,
        fallbackInputSettlements,
        fallbackOutputSettlements,
        // DERIVED, never assigned. A caller cannot report PROVIDER_ONLY over a total that carries a
        // fallback contribution, because nobody sets these.
        inputUsageProvenance: usageProvenanceOf(
          providerReportedInputSettlements,
          fallbackInputSettlements,
        ),
        outputUsageProvenance: usageProvenanceOf(
          providerReportedOutputSettlements,
          fallbackOutputSettlements,
        ),
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
 * The ledger for a bounded POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL run.
 *
 * The text smoke plus ONE differential probe: TWO requests, one dollar.
 *
 * Its own ledger and its own counter, so it can never be confused with NRA1 — which sent the same
 * captured request to the production 20B candidate and was refused.
 *
 * ### It prices at the 120B tariff, and that is the ONLY ledger here that does
 *
 * A first revision used the production 20B schedule. The wire was right and the accounting was not:
 * Groq publishes 120B at twice the 20B input and output rates, so every reservation underpriced the
 * request it was about to authorize. A reservation is made BEFORE the call and is what keeps a live
 * run inside its ceiling, so an underpriced one is a governance defect rather than a reporting one.
 *
 * The run is MIXED — a 20B smoke and a 120B candidate — while `RequestLedger` carries ONE schedule.
 * Rather than widen that governed primitive for a two-request diagnostic, the whole run is priced at
 * the HIGHER rate. That over-estimates the smoke instead of under-estimating the candidate, and only
 * one of those two errors can let a run exceed what an owner authorized.
 *
 * The TOKEN ceilings stay on the candidate release constants: both governed GPT-OSS models publish
 * the same 131,072 / 65,536 limits, and the differential holds them fixed on purpose.
 */
export function createModelDifferentialLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: MODEL_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
    maxCostUsd: MODEL_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
    // The DIFFERENTIAL tariff. Never the production candidate's.
    pricePerMillionInputUsd: MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD,
    pricePerMillionCachedInputUsd: MODEL_DIFFERENTIAL_PRICE_PER_M_CACHED_INPUT_USD,
    pricePerMillionOutputUsd: MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD,
    // Token ceilings are shared by both models, so they stay on the release constants.
    fallbackInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    fallbackOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
  });
}

/**
 * The ledger for a bounded POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL run.
 *
 * The text smoke plus ONE Responses endpoint probe: TWO requests, one dollar.
 *
 * Its own ledger and its own counter, so it can never be confused with MD120B3 — which sent the same
 * captured request to 120B over Chat Completions and was refused.
 *
 * ### It prices at the PRODUCTION tariff, and that is correct rather than convenient
 *
 * MD120B3's ledger prices at the 120B schedule because that run is MIXED: a 20B smoke and a 120B
 * candidate against a `RequestLedger` that carries one schedule, deliberately over-estimating the
 * smoke rather than under-estimating the candidate.
 *
 * This run is SINGLE-model. Both requests go to `CANDIDATE_MODEL_ID`, so the production schedule is
 * the right schedule for both and no conservative posture is needed. Reading the rates from
 * `candidate-release.ts` rather than restating them means a published price change moves this ledger
 * with every other one — and it also means this ledger cannot quietly diverge from what production
 * believes the candidate costs.
 */
export function createResponsesDifferentialLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: RESPONSES_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
    maxCostUsd: RESPONSES_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
    // The PRODUCTION tariff. Both requests are the production 20B model.
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
 * The ledger for a bounded POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL run.
 *
 * The text smoke plus ONE 8,192-budget probe: TWO requests, one dollar.
 *
 * Its own ledger and its own counter, so it can never be confused with RLD1 -- which sent the same
 * captured request, at the same effort, at 4,096, and met `json_validate_failed`.
 *
 * ### The fallback bounds are unchanged, and they are why RLD1 reads the way it does
 *
 * `fallbackInputTokens` and `fallbackOutputTokens` are the CONFIGURED CEILINGS -- 131,072 and 65,536
 * -- not the request budget. RLD1's failed probe reported no usage, so its receipt printed
 * `inputTokensTotal=131266` and `outputTokensTotal=65593`: the smoke's observed figures plus those
 * bounds. Those are conservative bounds and were never generation lengths.
 *
 * They stay unchanged here on purpose. Narrowing them to flatter a receipt would make an
 * unmeasured probe look measured, which is the exact failure the R2 provenance posture exists to
 * prevent -- and this run's PORT propagates real usage when the provider reports any, so a completed
 * probe is priced from what was measured rather than from a bound.
 */
export function createReasoningBudget8192Ledger(): RequestLedger {
  return createRequestLedger({
    maxRequests: REASONING_BUDGET_8192_MAX_PROVIDER_REQUESTS,
    maxCostUsd: REASONING_BUDGET_8192_MAX_ESTIMATED_COST_USD,
    // The PRODUCTION tariff. Both requests are the production 20B model.
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
 * The ledger for a bounded POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL run.
 *
 * The text smoke plus ONE reasoning-effort probe: TWO requests, one dollar.
 *
 * Its own ledger and its own counter, so it can never be confused with RSP20B2 -- which sent the same
 * captured request over the Responses API with no reasoning field at all.
 *
 * ### It prices at the PRODUCTION tariff
 *
 * SINGLE-model, exactly as the Responses differential is: both requests go to `CANDIDATE_MODEL_ID`,
 * so the production schedule is the right schedule for both and no conservative posture is needed.
 * Reading the rates from `candidate-release.ts` rather than restating them means a published price
 * change moves this ledger with every other one.
 *
 * ### The fallback bounds are the ones RSP20B2 exposed
 *
 * They are unchanged and deliberately so. What changes in this lane is that the PORT propagates
 * provider-reported usage, so a completed probe settles with measured tokens and the bound applies
 * only when the provider reported nothing -- with the R2 provenance posture saying which happened.
 */
export function createReasoningDifferentialLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: REASONING_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
    maxCostUsd: REASONING_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
    // The PRODUCTION tariff. Both requests are the production 20B model.
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
 * The ledger for a bounded POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE run.
 *
 * The text smoke plus ONE neutral client probe: TWO requests, one dollar.
 *
 * Its own ledger and its own counter, so it can never be confused with RA1's representative probe —
 * which carried the safety-derived adversarial turn and returned HTTP 400.
 */
export function createNeutralRepresentativeLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: NEUTRAL_REPRESENTATIVE_MAX_PROVIDER_REQUESTS,
    maxCostUsd: NEUTRAL_REPRESENTATIVE_MAX_ESTIMATED_COST_USD,
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
 * The ledger for a bounded POST_OAD3_REPRESENTATIVE_ACCEPTANCE run.
 *
 * The text smoke plus ONE representative probe: TWO requests, one dollar — the narrowest ceiling here.
 *
 * Its own ledger and its own counter, so it can never be confused with OAD3's five-request matrix,
 * SRV1's six, SDH4's ten or S11's nine.
 */
export function createRepresentativeAcceptanceLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: REPRESENTATIVE_ACCEPTANCE_MAX_PROVIDER_REQUESTS,
    maxCostUsd: REPRESENTATIVE_ACCEPTANCE_MAX_ESTIMATED_COST_USD,
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
 * The ledger for a bounded POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC run.
 *
 * The text smoke plus the four O0-O3 probes: FIVE requests, one dollar — the narrowest ceiling here.
 *
 * Its own ledger and its own counter, so it can never be confused with SRV1's six-request
 * verification, SDH4's ten-request matrix or S11's nine-request diagnostic. A receipt must always be
 * able to say which matrix produced it.
 */
export function createOperationalAcceptanceDiagnosticLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: OPERATIONAL_ACCEPTANCE_MAX_PROVIDER_REQUESTS,
    maxCostUsd: OPERATIONAL_ACCEPTANCE_MAX_ESTIMATED_COST_USD,
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
 * The ledger for a bounded POST_SDH4_SCHEMA_REPAIR_VERIFICATION run.
 *
 * The text smoke plus the five V0-V4 probes: SIX requests, one dollar. Its own ledger and its own
 * counter, so it can never be confused with SDH4's ten-request historical matrix.
 */
export function createSchemaRepairVerificationLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: SCHEMA_REPAIR_VERIFICATION_MAX_PROVIDER_REQUESTS,
    maxCostUsd: SCHEMA_REPAIR_VERIFICATION_MAX_ESTIMATED_COST_USD,
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
 * The ledger for a bounded SCHEMA_DIFFERENTIAL_DIAGNOSTIC run (POST-PR-131).
 *
 * The text smoke plus the nine R0-R8 schema probes: TEN requests, one dollar.
 *
 * Same prices, same fallback bounds and same governed model maxima as the others, read from the
 * candidate release rather than restated. Only the ceilings differ, and this one is separate from the
 * request-contract ledger on purpose — S11's D1-D8 evidence is immutable, and a shared ceiling would
 * make two different matrices indistinguishable in a receipt.
 */
export function createSchemaDifferentialDiagnosticLedger(): RequestLedger {
  return createRequestLedger({
    maxRequests: SCHEMA_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
    maxCostUsd: SCHEMA_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
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
 * The text smoke plus the eight D1-D8 canaries: NINE requests, one dollar. This is S11's historical
 * accounting and it keeps describing exactly that matrix.
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
