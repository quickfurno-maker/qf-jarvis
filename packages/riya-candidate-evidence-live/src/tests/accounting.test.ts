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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD,
  CANDIDATE_PRICE_PER_M_INPUT_USD,
  CANDIDATE_PRICE_PER_M_OUTPUT_USD,
} from '../candidate-release.js';
import {
  MODEL_DIFFERENTIAL_COST_PRICING_POSTURE,
  MODEL_DIFFERENTIAL_PRICE_PER_M_CACHED_INPUT_USD,
  MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD,
  MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD,
  MODEL_DIFFERENTIAL_PRICING_SNAPSHOT,
  MODEL_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
} from '../model-differential-identity.js';
import {
  createModelDifferentialLedger,
  MODEL_DIFFERENTIAL_MAX_ESTIMATED_COST_USD,
  MODEL_DIFFERENTIAL_MAX_PROVIDER_REQUESTS,
  createNeutralRepresentativeLedger,
  createOperationalAcceptanceDiagnosticLedger,
  createRepresentativeAcceptanceLedger,
  createOperatorLedger,
  createRequestContractDiagnosticLedger,
  createRequestLedger,
  createSafetyReplicationLedger,
  createSchemaDifferentialDiagnosticLedger,
  createSchemaRepairVerificationLedger,
  MAX_ESTIMATED_COST_USD,
  MAX_PROVIDER_REQUESTS,
  P10_REQUESTS,
  SAFETY_MODEL_REQUIRED_REQUESTS,
  SAFETY_REPLICATION_MAX_ESTIMATED_COST_USD,
  SAFETY_REPLICATION_MAX_PROVIDER_REQUESTS,
  SMOKE_REQUESTS,
} from '../accounting.js';
import type { RequestLedger } from '../accounting.js';

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

/**
 * The docblock above each bounded-diagnostic ledger must describe THAT ledger.
 *
 * This guard exists because the defect has now shipped twice, both times the same way: a new factory
 * inserted above an existing one takes the docblock that belonged to its neighbour, and every
 * comment below it shifts down by one. Nothing fails — the ceilings are still correct, the types
 * still check, the tests still pass — and the file quietly claims that the five-request ledger is the
 * ten-request one.
 *
 * That is expensive in exactly this codebase, because these comments are what an owner reads when
 * deciding how many live provider calls a run may make.
 *
 * So the pairing is asserted structurally: for each factory, the nearest docblock ABOVE it must name
 * the right run count and the right probe range. A third insertion cannot shift them silently.
 */
describe('every bounded diagnostic ledger wears its OWN docblock', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('../accounting.ts', import.meta.url)), 'utf8');

  /** The docblock immediately preceding a factory, with no other declaration in between. */
  function docblockAbove(factory: string): string {
    const index = SOURCE.indexOf(`export function ${factory}(`);
    expect(index, `${factory} must exist`).toBeGreaterThan(-1);
    const before = SOURCE.slice(0, index);
    const opened = before.lastIndexOf('/**');
    const closed = before.lastIndexOf('*/');
    // The comment must be the thing directly above: a `*/` that is not the last token before the
    // factory would mean some other declaration sits between them.
    expect(closed, `${factory} must be preceded by a docblock`).toBeGreaterThan(opened);
    expect(before.slice(closed + 2).trim()).toBe('');
    return before.slice(opened, closed);
  }

  it.each([
    ['createNeutralRepresentativeLedger', 'TWO', 'neutral client probe', 2],
    ['createRepresentativeAcceptanceLedger', 'TWO', 'representative probe', 2],
    ['createOperationalAcceptanceDiagnosticLedger', 'FIVE', 'O0-O3', 5],
    ['createSchemaRepairVerificationLedger', 'SIX', 'V0-V4', 6],
    ['createSchemaDifferentialDiagnosticLedger', 'TEN', 'R0-R8', 10],
    ['createRequestContractDiagnosticLedger', 'NINE', 'D1-D8', 9],
  ])('%s says %s and names %s', (factory, spelledCount, probeRange, requests) => {
    const doc = docblockAbove(factory);
    expect(doc).toContain(spelledCount);
    expect(doc).toContain(probeRange);
    // No OTHER diagnostic's spelled count may appear in this docblock, which is precisely what a
    // shifted comment looks like.
    for (const other of ['TWO', 'FIVE', 'SIX', 'TEN', 'NINE']) {
      if (other !== spelledCount) {
        expect(doc, `${factory} must not claim ${other}`).not.toContain(other);
      }
    }
    // And the prose count must match the ceiling the factory actually builds, which is the thing the
    // comment exists to describe.
    const ledger = ledgerFor(factory);
    for (let index = 0; index < requests; index += 1) {
      expect(ledger.reserve('smoke').ok, `reservation ${String(index + 1)}`).toBe(true);
      ledger.settle(undefined, true);
    }
    expect(ledger.reserve('smoke').ok).toBe(false);
  });

  function ledgerFor(factory: string): RequestLedger {
    switch (factory) {
      case 'createNeutralRepresentativeLedger':
        return createNeutralRepresentativeLedger();
      case 'createRepresentativeAcceptanceLedger':
        return createRepresentativeAcceptanceLedger();
      case 'createOperationalAcceptanceDiagnosticLedger':
        return createOperationalAcceptanceDiagnosticLedger();
      case 'createSchemaRepairVerificationLedger':
        return createSchemaRepairVerificationLedger();
      case 'createSchemaDifferentialDiagnosticLedger':
        return createSchemaDifferentialDiagnosticLedger();
      default:
        return createRequestContractDiagnosticLedger();
    }
  }
});

/**
 * POST-NRA1 — the model-differential ledger prices its OWN model.
 *
 * ### The defect this proves is gone
 *
 * The first revision of the differential ledger reused the production 20B price schedule while the
 * run sends its candidate request to 120B, which Groq publishes at twice the input and output rates.
 * The wire was correct; the accounting was not.
 *
 * That matters more than a wrong number in a report. A reservation is priced and checked BEFORE the
 * request is made — it is the mechanism that keeps a live run inside the dollar ceiling an owner
 * authorized — so a schedule that underprices by half is a governance defect.
 *
 * ### And the run is mixed
 *
 * MD120B1 sends a 20B smoke and a 120B candidate, while `RequestLedger` carries ONE schedule. Rather
 * than widen a governed accounting primitive for a two-request diagnostic, the whole run is priced at
 * the higher tariff. These specs pin that as a deliberate over-estimate: the arithmetic is checked
 * against the published 120B rates, and the conservative two-request worst case is proved to sit far
 * under the ceiling.
 */
describe('the model-differential ledger prices at the 120B tariff', () => {
  it('the PRODUCTION 20B schedule is unchanged', () => {
    // The differential must never move production pricing. Pinned first, because a "fix" that
    // achieved the right differential cost by editing these would be the worse bug.
    expect(CANDIDATE_PRICE_PER_M_INPUT_USD).toBe(0.075);
    expect(CANDIDATE_PRICE_PER_M_CACHED_INPUT_USD).toBe(0.037);
    expect(CANDIDATE_PRICE_PER_M_OUTPUT_USD).toBe(0.3);
  });

  it('the DIFFERENTIAL schedule is the published 120B tariff', () => {
    expect(MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD).toBe(0.15);
    expect(MODEL_DIFFERENTIAL_PRICE_PER_M_CACHED_INPUT_USD).toBe(0.075);
    expect(MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD).toBe(0.6);
    expect(MODEL_DIFFERENTIAL_PRICING_SNAPSHOT).toBe('groq-pricing-snapshot-2026-08-20');
    // Twice the production rates, which is exactly why reusing them underpriced by half.
    expect(MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD).toBe(CANDIDATE_PRICE_PER_M_INPUT_USD * 2);
    expect(MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD).toBe(CANDIDATE_PRICE_PER_M_OUTPUT_USD * 2);
  });

  it('the pricing posture is recorded, not implied', () => {
    expect(MODEL_DIFFERENTIAL_COST_PRICING_POSTURE).toBe(
      'CONSERVATIVE_120B_RATES_FOR_MIXED_MODEL_RUN',
    );
    expect(MODEL_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE).toBe(true);
  });

  it('one hard-max 120B request costs the published arithmetic', () => {
    // 131,072 input at $0.15/1M plus 65,536 output at $0.60/1M.
    const expectedOne =
      (CANDIDATE_MAX_INPUT_TOKENS / 1e6) * MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD +
      (CANDIDATE_MAX_COMPLETION_TOKENS / 1e6) * MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD;
    expect(expectedOne).toBeCloseTo(0.0589824, 10);

    // The ledger charges that per RESERVATION, so the ceiling is reachable arithmetic rather than a
    // hope. Two requests priced conservatively at the candidate rate:
    const expectedTwo = expectedOne * MODEL_DIFFERENTIAL_MAX_PROVIDER_REQUESTS;
    expect(expectedTwo).toBeCloseTo(0.1179648, 10);
    expect(expectedTwo).toBeLessThan(MODEL_DIFFERENTIAL_MAX_ESTIMATED_COST_USD);
    expect(MODEL_DIFFERENTIAL_MAX_ESTIMATED_COST_USD).toBe(1);
  });

  it('the ledger actually charges the 120B schedule, and admits exactly two requests', () => {
    const ledger = createModelDifferentialLedger();

    // The SMOKE is priced at the candidate rate too — the deliberate over-estimate.
    expect(ledger.reserve('smoke').ok).toBe(true);
    ledger.settle(undefined, true);
    const afterSmoke = ledger.snapshot().estimatedCostUsd;
    expect(afterSmoke).toBeCloseTo(0.0589824, 10);
    // Not the production tariff, which would have been half.
    expect(afterSmoke).not.toBeCloseTo(0.0294912, 10);

    expect(ledger.reserve('model-differential-probe').ok).toBe(true);
    ledger.settle(undefined, true);
    expect(ledger.snapshot().estimatedCostUsd).toBeCloseTo(0.1179648, 10);
    expect(ledger.snapshot().totalProviderRequests).toBe(2);
    expect(ledger.snapshot().modelDifferentialProbeProviderRequests).toBe(1);

    // A THIRD reservation is refused BEFORE it is spent.
    const third = ledger.reserve('model-differential-probe');
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.refusal).toBe('request-limit-reached');
    }
    expect(ledger.snapshot().usageBoundViolated).toBe(false);
  });

  it('unreported differential usage keeps the cost flagged as an ESTIMATE', () => {
    const ledger = createModelDifferentialLedger();
    expect(ledger.reserve('smoke').ok).toBe(true);
    // The smoke reports real usage; the differential request does not.
    ledger.settle({ inputTokens: 120, outputTokens: 40 }, true);
    expect(ledger.reserve('model-differential-probe').ok).toBe(true);
    ledger.settle(undefined, false);
    // A run that silently presented a partly-guessed figure as measured would be unauditable.
    expect(ledger.snapshot().costIsEstimated).toBe(true);
  });

  it('no OTHER ledger factory moved to the 120B schedule', () => {
    // Every other bounded run still sends to the production candidate, so every other ledger must
    // still price at the production tariff. One smoke reservation each is enough to tell them apart.
    const productionRate =
      (CANDIDATE_MAX_INPUT_TOKENS / 1e6) * CANDIDATE_PRICE_PER_M_INPUT_USD +
      (CANDIDATE_MAX_COMPLETION_TOKENS / 1e6) * CANDIDATE_PRICE_PER_M_OUTPUT_USD;
    for (const [label, make] of [
      ['neutral', createNeutralRepresentativeLedger],
      ['representative', createRepresentativeAcceptanceLedger],
      ['operational', createOperationalAcceptanceDiagnosticLedger],
      ['schemaRepair', createSchemaRepairVerificationLedger],
      ['schemaDifferential', createSchemaDifferentialDiagnosticLedger],
      ['requestContract', createRequestContractDiagnosticLedger],
    ] as const) {
      const ledger = make();
      expect(ledger.reserve('smoke').ok, label).toBe(true);
      ledger.settle(undefined, true);
      expect(ledger.snapshot().estimatedCostUsd, label).toBeCloseTo(productionRate, 10);
    }
  });
});
