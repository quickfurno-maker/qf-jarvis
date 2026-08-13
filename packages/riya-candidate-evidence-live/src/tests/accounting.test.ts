/**
 * The two hard ceilings.
 *
 * The invariant that matters is arithmetic, not policy: 83 reservations priced at the model's own
 * declared maxima must fit under $5. If a published rate rose enough to break that, the first spec
 * fails here rather than a run discovering it halfway through and stopping with partial evidence.
 *
 * The second invariant is that a reservation is a GUARANTEE. It is priced at the worst case a single
 * request can be, so "could the next call breach the ceiling" has a real answer before anything is
 * spent — rather than `settle()` noticing an overrun after the money is gone.
 */
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_PRICE_PER_M_INPUT_USD,
  CANDIDATE_PRICE_PER_M_OUTPUT_USD,
} from '../candidate-release.js';
import {
  createOperatorLedger,
  createRequestLedger,
  MAX_ESTIMATED_COST_USD,
  MAX_PROVIDER_REQUESTS,
} from '../accounting.js';

const WORST_CASE_PER_REQUEST_USD =
  (CANDIDATE_MAX_INPUT_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_INPUT_USD +
  (CANDIDATE_MAX_COMPLETION_TOKENS / 1_000_000) * CANDIDATE_PRICE_PER_M_OUTPUT_USD;

describe('the ceilings are arithmetic, not aspiration', () => {
  it('83 = 1 smoke + 10 model-facing safety + 72 P10', () => {
    expect(MAX_PROVIDER_REQUESTS).toBe(83);
    expect(MAX_ESTIMATED_COST_USD).toBe(5);
  });

  it('A FULL RUN AT THE MODEL’S OWN MAXIMA STILL FITS UNDER $5', () => {
    // ~$0.0295 per request, ~$2.45 for all 83. This is the spec that turns the ceiling from a hope
    // into a guarantee: it fails if a published rate ever rises enough to break the bound.
    expect(WORST_CASE_PER_REQUEST_USD).toBeCloseTo(0.0294912, 7);
    expect(WORST_CASE_PER_REQUEST_USD * MAX_PROVIDER_REQUESTS).toBeLessThan(MAX_ESTIMATED_COST_USD);
  });

  it('allows exactly 83 reservations and refuses the 84th BEFORE the call', () => {
    const ledger = createOperatorLedger();
    for (let index = 0; index < MAX_PROVIDER_REQUESTS; index += 1) {
      expect(ledger.reserve('p10').ok, `reservation ${String(index + 1)}`).toBe(true);
    }
    const overflow = ledger.reserve('p10');
    expect(overflow.ok).toBe(false);
    expect(overflow.ok ? undefined : overflow.refusal).toBe('request-limit-reached');
    // And nothing was consumed by the refusal.
    expect(ledger.snapshot().totalProviderRequests).toBe(MAX_PROVIDER_REQUESTS);
  });

  it('THE COST GATE IS THE RESERVATION, NOT THE SETTLEMENT', () => {
    // A ceiling so low that even the first worst-case request cannot fit. It must be refused before
    // the call rather than discovered afterwards.
    const ledger = createRequestLedger({
      maxRequests: 83,
      maxCostUsd: 0.001,
      pricePerMillionInputUsd: CANDIDATE_PRICE_PER_M_INPUT_USD,
      pricePerMillionCachedInputUsd: 0.037,
      pricePerMillionOutputUsd: CANDIDATE_PRICE_PER_M_OUTPUT_USD,
      fallbackInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      fallbackOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
      hardMaxInputTokens: CANDIDATE_MAX_INPUT_TOKENS,
      hardMaxOutputTokens: CANDIDATE_MAX_COMPLETION_TOKENS,
    });
    const first = ledger.reserve('safety');
    expect(first.ok).toBe(false);
    expect(first.ok ? undefined : first.refusal).toBe('cost-limit-reached');
    expect(ledger.snapshot().totalProviderRequests).toBe(0);
  });
});

describe('reported usage is preferred, and an impossible figure closes the run', () => {
  it('uses what the provider reported, and does not mark the run estimated', () => {
    const ledger = createOperatorLedger();
    ledger.reserve('safety');
    ledger.settle({ inputTokens: 1_000, outputTokens: 500 }, true);
    const snapshot = ledger.snapshot();
    expect(snapshot.inputTokens).toBe(1_000);
    expect(snapshot.outputTokens).toBe(500);
    expect(snapshot.costIsEstimated).toBe(false);
    expect(snapshot.successfulProviderResponses).toBe(1);
  });

  it('falls back to the bound when nothing is reported, and SAYS it is estimated', () => {
    const ledger = createOperatorLedger();
    ledger.reserve('safety');
    ledger.settle(undefined, true);
    const snapshot = ledger.snapshot();
    // The bound, not an invented exact figure.
    expect(snapshot.inputTokens).toBe(CANDIDATE_MAX_INPUT_TOKENS);
    expect(snapshot.costIsEstimated).toBe(true);
  });

  it('USAGE ABOVE THE DECLARED MAXIMA CLOSES THE RUN', () => {
    // Not an overspend — a broken premise. The reservation bound is derived from these maxima, so a
    // figure above them means the guarantee never held, and continuing would reserve against
    // arithmetic already shown to be wrong.
    const ledger = createOperatorLedger();
    ledger.reserve('safety');
    ledger.settle({ inputTokens: CANDIDATE_MAX_INPUT_TOKENS + 1, outputTokens: 10 }, true);
    expect(ledger.snapshot().usageBoundViolated).toBe(true);
    const next = ledger.reserve('safety');
    expect(next.ok).toBe(false);
    expect(next.ok ? undefined : next.refusal).toBe('usage-bound-violated');
  });

  it('an ordinary run never reports a bound violation', () => {
    const ledger = createOperatorLedger();
    ledger.reserve('p10');
    ledger.settle({ inputTokens: 2_000, outputTokens: 300 }, true);
    expect(ledger.snapshot().usageBoundViolated).toBe(false);
  });
});
