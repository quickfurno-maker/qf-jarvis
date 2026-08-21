/**
 * The DIAGNOSTIC-ONLY Groq Responses API endpoint identity, for the POST-MD120B3 differential.
 *
 * ### The variable is the ENDPOINT, and the model is deliberately not touched
 *
 * MD120B1 moved the model and held everything else. It answered its question: MD120B3 sent the same
 * neutral production-built request to `openai/gpt-oss-120b` and received the same HTTP 400 with
 * `JSON_VALIDATE_FAILED` that NRA1 met on `openai/gpt-oss-20b`. The strict Chat Completions failure
 * reproduces across both governed GPT-OSS models, so the model is no longer the open axis.
 *
 * This run therefore moves the OUTPUT CONTRACT instead, and moves nothing else. The model stays the
 * production candidate — `CANDIDATE_MODEL_ID` is read directly rather than restated here, so "the
 * same model" is a property of the code and not a claim in a comment. There is no diagnostic model id
 * in this file, on purpose: one existing would be one thing a future edit could quietly change.
 *
 * ### What is NOT established, and the tariff consequence
 *
 * MD120B1 needed its own price schedule because it was a MIXED-model run: a 20B smoke and a 120B
 * candidate against a ledger that carries one tariff, priced conservatively at the higher rate.
 *
 * This run is SINGLE-model. Both requests are 20B, so the production schedule is exactly right and no
 * conservative posture is needed — the ledger reads `CANDIDATE_PRICE_PER_M_*` unchanged. The posture
 * is still NAMED on the receipt, because a cost figure whose schedule was invisible would be a number
 * nobody could check, and because a reader comparing this receipt against MD120B3's must be able to
 * see that the two were priced differently and why.
 *
 * ### The Responses API is BETA, and this is a measurement rather than a selection
 *
 * Groq's current documentation states that strict Structured Outputs are intended to guarantee schema
 * adherence on supported models, and explicitly asks developers to file repros when strict mode
 * returns 400. It also documents the Responses API as available and currently in beta, with
 * structured-output support and published GPT-OSS examples on both governed models.
 *
 * So the endpoint is worth measuring and is NOT worth adopting on this evidence. Nothing here selects
 * a production endpoint, and a spec asserts production routing still composes Chat Completions.
 */

import { CANDIDATE_MODEL_ID } from './candidate-release.js';

/** Which output contract a probe used. Closed, and printable on a receipt. */
export const PROVIDER_ENDPOINT_FAMILIES = [
  /** The production serving contract. Everything before this run used it. */
  'CHAT_COMPLETIONS',
  /** Groq's second documented output contract, at `/openai/v1/responses`. Currently beta. */
  'RESPONSES_API',
] as const;
export type ProviderEndpointFamily = (typeof PROVIDER_ENDPOINT_FAMILIES)[number];

/** The endpoint under test. THE one variable. */
export const RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY: ProviderEndpointFamily = 'RESPONSES_API';

/** The endpoint it is being compared against — the one MD120B3 and NRA1 both used. */
export const RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY: ProviderEndpointFamily =
  'CHAT_COMPLETIONS';

/**
 * The model, restated as a REFERENCE rather than a literal.
 *
 * This is `CANDIDATE_MODEL_ID` itself. A separate constant with the same value would be a place for
 * the two to drift apart, and "the model did not move" is the property this whole run rests on.
 */
export const RESPONSES_DIFFERENTIAL_MODEL_ID = CANDIDATE_MODEL_ID;

/**
 * The schema NAME the Responses envelope requires.
 *
 * The envelope demands a name where Chat Completions' `response_format.json_schema` also carries one,
 * so this is not a new degree of freedom — it is the same field under a different path. It is a
 * stable identifier chosen once: a name derived from anything about the request would be a way for
 * request content to reach the wire twice, and a name that varied between runs would make two
 * receipts incomparable.
 *
 * It names the DIAGNOSTIC, not a production schema revision, because that is what it identifies.
 */
export const RESPONSES_DIFFERENTIAL_SCHEMA_NAME = 'qfj_riya_structured_reply_diagnostic';

/**
 * The maturity Groq currently publishes for this endpoint.
 *
 * Recorded as a first-class constant and printed on the receipt so that "we measured a beta contract"
 * is a fact on the evidence rather than something a reader has to remember. An `RESPONSES_20B_STRICT_ACCEPTED`
 * result on a beta endpoint is a diagnostic finding; it is not a production readiness statement, and
 * the receipt should not be readable as one.
 */
export const RESPONSES_DIFFERENTIAL_ENDPOINT_MATURITY = 'BETA';

/**
 * Whether the governed staging SMOKE establishes that this endpoint is reachable for the account.
 *
 * It does not, and this constant exists so that fact is impossible to skip past — the same trap
 * MD120B1 recorded for model entitlement, in its endpoint form. The smoke runs against the 20B Chat
 * Completions configuration: a passing smoke says the credential works on THAT contract, and says
 * nothing about whether the project may call `/openai/v1/responses` at all.
 *
 * The consequence is written into the classifier: a 401, 403 or 404 on the Responses probe is
 * INCONCLUSIVE — an entitlement, beta-enrolment or routing answer — and must never be read as the
 * endpoint rejecting the request contract.
 */
export const SMOKE_PROVES_RESPONSES_ENDPOINT_ENTITLEMENT = false;

/** What the smoke actually checked, printed so the gap is visible rather than implied. */
export const SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY: ProviderEndpointFamily = 'CHAT_COMPLETIONS';

/**
 * How this run is priced.
 *
 * SINGLE-model, so the production schedule applies to both requests and no conservative over-estimate
 * is needed. Named rather than left implicit precisely because MD120B3's receipt names a different
 * posture: two receipts that priced differently must say so.
 */
export const RESPONSES_DIFFERENTIAL_COST_PRICING_POSTURE =
  'PRODUCTION_20B_RATES_FOR_SINGLE_MODEL_RUN';

/** Stated explicitly, as the mixed-model flag is on the differential receipt. */
export const RESPONSES_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE = true;

/**
 * When the rates behind this run's estimate were read.
 *
 * A SNAPSHOT LABEL, exactly as the catalog snapshot is. The rates themselves are the production
 * candidate's and are NOT restated here — the ledger reads them from `candidate-release.ts`, so a
 * published price change moves this run with every other one.
 */
export const RESPONSES_DIFFERENTIAL_PRICING_SNAPSHOT = 'groq-pricing-snapshot-2026-08-20';
