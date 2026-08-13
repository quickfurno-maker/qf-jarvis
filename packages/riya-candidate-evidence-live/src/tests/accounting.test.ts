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
  createSafetyReplicationLedger,
  MAX_ESTIMATED_COST_USD,
  MAX_PROVIDER_REQUESTS,
  P10_REQUESTS,
  SAFETY_MODEL_REQUIRED_REQUESTS,
  SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD,
  SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS,
  SMOKE_REQUESTS,
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

describe('HF3 — the bounded SAFETY_REPLICATION ledger', () => {
  it('the FULL ledger is untouched at 83 requests and USD 5', () => {
    // First, because the thing most likely to go wrong in HF3 is narrowing the default by accident.
    expect(MAX_PROVIDER_REQUESTS).toBe(83);
    expect(MAX_ESTIMATED_COST_USD).toBe(5);
    expect(SMOKE_REQUESTS + SAFETY_MODEL_REQUIRED_REQUESTS + P10_REQUESTS).toBe(83);
  });

  it('the replication ceiling is smoke + model-facing safety, DERIVED not typed', () => {
    // Derived from the same two constants, so it cannot drift away from the split it describes.
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBe(11);
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBe(
      SMOKE_REQUESTS + SAFETY_MODEL_REQUIRED_REQUESTS,
    );
    expect(SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD).toBe(1);
    expect(SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBeLessThan(MAX_PROVIDER_REQUESTS);
    expect(SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD).toBeLessThan(MAX_ESTIMATED_COST_USD);
  });

  it('ADMITS EXACTLY 11 RESERVATIONS AND REFUSES THE 12TH BEFORE THE CALL', () => {
    const ledger = createSafetyReplicationLedger();
    ledger.reserve('smoke');
    for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
      expect(ledger.reserve('safety')).toStrictEqual({ ok: true });
    }
    expect(ledger.snapshot().totalProviderRequests).toBe(11);
    // The 12th, refused BEFORE any provider is reached — and the count does not move, so a refusal
    // cannot be mistaken for a spend.
    expect(ledger.reserve('safety')).toStrictEqual({
      ok: false,
      refusal: 'request-limit-reached',
    });
    expect(ledger.snapshot().totalProviderRequests).toBe(11);
  });

  it('A P10 SPILL IS REFUSED EVEN IF THE OPERATOR EARLY STOP WERE REMOVED', () => {
    // Defence in depth, and the reason the narrow ledger exists at all rather than just a code path.
    // The primary invariant is the operator's early return; this proves that if somebody deleted it,
    // the FIRST quality reservation is request 12 and never reaches the provider.
    const ledger = createSafetyReplicationLedger();
    ledger.reserve('smoke');
    for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
      ledger.reserve('safety');
    }
    expect(ledger.reserve('p10')).toStrictEqual({ ok: false, refusal: 'request-limit-reached' });
    expect(ledger.snapshot().p10ProviderRequests).toBe(0);
  });

  it('a complete replication needs no p10 reservation at all', () => {
    const ledger = createSafetyReplicationLedger();
    expect(ledger.reserve('smoke')).toStrictEqual({ ok: true });
    for (let index = 0; index < SAFETY_MODEL_REQUIRED_REQUESTS; index += 1) {
      expect(ledger.reserve('safety')).toStrictEqual({ ok: true });
    }
    const snapshot = ledger.snapshot();
    expect(snapshot.smokeRequests).toBe(1);
    expect(snapshot.safetyProviderRequests).toBe(10);
    expect(snapshot.p10ProviderRequests).toBe(0);
  });

  it('ELEVEN WORST-CASE REQUESTS STILL FIT INSIDE USD 1 AT TODAY’S GOVERNED PRICES', () => {
    // Arithmetic, not a wish. If a published price or a declared maximum ever rises far enough that
    // 11 worst-case calls no longer fit the USD 1 ceiling, this fails and forces a review rather
    // than letting a replication refuse itself halfway through for cost.
    expect(WORST_CASE_PER_REQUEST_USD * SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS).toBeLessThan(
      SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD,
    );
    const ledger = createSafetyReplicationLedger();
    for (let index = 0; index < SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS; index += 1) {
      // Every reservation prices the NEXT call at the hard maxima, so a cost refusal here would mean
      // the ceiling is not actually reachable.
      expect(ledger.reserve('safety'), `reservation ${String(index + 1)}`).toStrictEqual({
        ok: true,
      });
      ledger.settle(undefined, true);
    }
    expect(ledger.snapshot().estimatedCostUsd).toBeLessThan(
      SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD,
    );
  });
});
