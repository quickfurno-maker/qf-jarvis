/**
 * LEDGER USAGE PROVENANCE — a bounded total must never read as a measurement.
 *
 * ### The receipt that motivated this
 *
 * RSP20B2 printed `outputTokensTotal=65622`. That is 86 tokens the governed smoke actually reported,
 * plus the 65,536-token fallback BOUND recorded for a probe whose usage was never observed: every
 * diagnostic path settles with `undefined`, so the ledger has nothing to record but the bound.
 *
 * The figure was correct as COST accounting and misleading as GENERATION LENGTH, and nothing on the
 * receipt distinguished the two.
 *
 * ### Why per-dimension counters rather than one flag
 *
 * A single run-level `usageSource` would have had to call that run either PROVIDER or FALLBACK, and
 * both answers are false. Provenance is therefore counted per settlement and per dimension, and the
 * posture is DERIVED. Input and output are independent because a provider may report one and omit
 * the other, and collapsing them would let an observed input launder an unobserved output.
 *
 * Nothing here reaches a provider, a credential or a network.
 */
import { describe, expect, it } from 'vitest';

import {
  createRequestLedger,
  MAX_ESTIMATED_COST_USD,
  MAX_PROVIDER_REQUESTS,
  usageProvenanceOf,
  USAGE_PROVENANCES,
} from '../accounting.js';
import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
  CANDIDATE_PRICE_PER_M_INPUT_USD,
  CANDIDATE_PRICE_PER_M_OUTPUT_USD,
} from '../candidate-release.js';

const FALLBACK_INPUT = 1_000;
const FALLBACK_OUTPUT = 500;

/** A ledger with small, distinctive fallback bounds so a bound is obvious in a total. */
const ledger = (): ReturnType<typeof createRequestLedger> =>
  createRequestLedger({
    maxRequests: 10,
    maxCostUsd: 100,
    pricePerMillionInputUsd: CANDIDATE_PRICE_PER_M_INPUT_USD,
    pricePerMillionCachedInputUsd: CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
    pricePerMillionOutputUsd: CANDIDATE_PRICE_PER_M_OUTPUT_USD,
    fallbackInputTokens: FALLBACK_INPUT,
    fallbackOutputTokens: FALLBACK_OUTPUT,
    hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
    hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
  });

describe('the provenance vocabulary is closed and TOTAL over the counts', () => {
  it('names exactly four postures', () => {
    expect([...USAGE_PROVENANCES]).toStrictEqual([
      'NONE',
      'PROVIDER_ONLY',
      'FALLBACK_ONLY',
      'MIXED',
    ]);
  });

  it('every count pair maps to a posture, and MIXED needs both', () => {
    expect(usageProvenanceOf(0, 0)).toBe('NONE');
    expect(usageProvenanceOf(3, 0)).toBe('PROVIDER_ONLY');
    expect(usageProvenanceOf(0, 3)).toBe('FALLBACK_ONLY');
    expect(usageProvenanceOf(1, 1)).toBe('MIXED');
    expect(usageProvenanceOf(9, 1)).toBe('MIXED');
  });
});

describe('provider-only, fallback-only, and the MIXED case that matters', () => {
  it('provider-reported usage on every settlement reports PROVIDER_ONLY', () => {
    const l = ledger();
    l.reserve('smoke');
    l.settle({ inputTokens: 200, outputTokens: 90 }, true);
    l.reserve('safety');
    l.settle({ inputTokens: 300, outputTokens: 110 }, true);
    const s = l.snapshot();
    expect(s.inputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(s.outputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(s.inputTokens).toBe(500);
    expect(s.outputTokens).toBe(200);
    // Nothing was bounded, so the cost is a real figure.
    expect(s.costIsEstimated).toBe(false);
  });

  it('absent usage on every settlement reports FALLBACK_ONLY and estimates the cost', () => {
    const l = ledger();
    l.reserve('smoke');
    l.settle(undefined, true);
    const s = l.snapshot();
    expect(s.inputUsageProvenance).toBe('FALLBACK_ONLY');
    expect(s.outputUsageProvenance).toBe('FALLBACK_ONLY');
    expect(s.inputTokens).toBe(FALLBACK_INPUT);
    expect(s.outputTokens).toBe(FALLBACK_OUTPUT);
    expect(s.costIsEstimated).toBe(true);
  });

  it('THE RSP20B2 SHAPE — observed smoke plus a bounded probe reports MIXED, never PROVIDER_ONLY', () => {
    // The exact scenario the receipt could not express. The total is right; calling it observed
    // would not be.
    const l = ledger();
    l.reserve('smoke');
    l.settle({ inputTokens: 194, outputTokens: 86 }, true);
    l.reserve('responses-differential-probe');
    l.settle(undefined, false);

    const s = l.snapshot();
    expect(s.inputUsageProvenance).toBe('MIXED');
    expect(s.outputUsageProvenance).toBe('MIXED');
    expect(s.inputUsageProvenance).not.toBe('PROVIDER_ONLY');
    expect(s.outputUsageProvenance).not.toBe('PROVIDER_ONLY');
    // The totals are unchanged: this repair adds truthfulness, not arithmetic.
    expect(s.inputTokens).toBe(194 + FALLBACK_INPUT);
    expect(s.outputTokens).toBe(86 + FALLBACK_OUTPUT);
    expect(s.costIsEstimated).toBe(true);
    // And the counters show the mixture rather than a verdict about it.
    expect(s.providerReportedOutputSettlements).toBe(1);
    expect(s.fallbackOutputSettlements).toBe(1);
  });

  it('one fallback contribution is enough — nine observed settlements cannot hide it', () => {
    const l = ledger();
    for (let i = 0; i < 9; i += 1) {
      l.reserve('p10');
      l.settle({ inputTokens: 10, outputTokens: 5 }, true);
    }
    l.reserve('p10');
    l.settle(undefined, true);
    const s = l.snapshot();
    expect(s.outputUsageProvenance).toBe('MIXED');
    expect(s.costIsEstimated).toBe(true);
  });
});

describe('PARTIAL usage is tracked per dimension', () => {
  it('a reported input with an absent output splits the provenance', () => {
    // The case a single flag could not express at all: half the total is measured, half is a bound.
    const l = ledger();
    l.reserve('smoke');
    l.settle({ inputTokens: 250 }, true);
    const s = l.snapshot();
    expect(s.inputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(s.outputUsageProvenance).toBe('FALLBACK_ONLY');
    expect(s.inputTokens).toBe(250);
    expect(s.outputTokens).toBe(FALLBACK_OUTPUT);
    expect(s.costIsEstimated).toBe(true);
  });

  it('a reported output with an absent input splits the other way', () => {
    const l = ledger();
    l.reserve('smoke');
    l.settle({ outputTokens: 77 }, true);
    const s = l.snapshot();
    expect(s.inputUsageProvenance).toBe('FALLBACK_ONLY');
    expect(s.outputUsageProvenance).toBe('PROVIDER_ONLY');
    expect(s.inputTokens).toBe(FALLBACK_INPUT);
    expect(s.outputTokens).toBe(77);
    expect(s.costIsEstimated).toBe(true);
  });

  it('a settlement reporting NEITHER still records cached tokens as zero', () => {
    // The old code took an early return before the cached accumulation. Unifying the branches must
    // not have changed that: both paths add nothing.
    const l = ledger();
    l.reserve('smoke');
    l.settle(undefined, true);
    expect(l.snapshot().cachedInputTokens).toBe(0);
  });
});

describe('the repair changed provenance ONLY — ceilings and arithmetic are untouched', () => {
  it('the request ceiling still refuses past its limit', () => {
    const l = createRequestLedger({
      maxRequests: 2,
      maxCostUsd: 100,
      pricePerMillionInputUsd: CANDIDATE_PRICE_PER_M_INPUT_USD,
      pricePerMillionCachedInputUsd: CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
      pricePerMillionOutputUsd: CANDIDATE_PRICE_PER_M_OUTPUT_USD,
      fallbackInputTokens: FALLBACK_INPUT,
      fallbackOutputTokens: FALLBACK_OUTPUT,
      hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    });
    expect(l.reserve('smoke').ok).toBe(true);
    expect(l.reserve('safety').ok).toBe(true);
    const third = l.reserve('safety');
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.refusal).toBe('request-limit-reached');
    }
  });

  it('the usage-bound violation still closes the run', () => {
    const l = ledger();
    l.reserve('smoke');
    l.settle({ inputTokens: CANDIDATE_MAX_INPUT_TOKENS + 1, outputTokens: 1 }, true);
    expect(l.snapshot().usageBoundViolated).toBe(true);
    const next = l.reserve('safety');
    expect(next.ok).toBe(false);
    if (!next.ok) {
      expect(next.refusal).toBe('usage-bound-violated');
    }
  });

  it('the governed full-evidence ceiling arithmetic is unchanged', () => {
    expect(MAX_PROVIDER_REQUESTS).toBe(83);
    expect(MAX_ESTIMATED_COST_USD).toBe(5);
  });

  it('a fresh ledger reports NONE rather than guessing', () => {
    const s = ledger().snapshot();
    expect(s.inputUsageProvenance).toBe('NONE');
    expect(s.outputUsageProvenance).toBe('NONE');
    expect(s.providerReportedInputSettlements).toBe(0);
    expect(s.fallbackOutputSettlements).toBe(0);
  });
});
