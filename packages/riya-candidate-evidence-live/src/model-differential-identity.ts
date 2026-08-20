/**
 * The DIAGNOSTIC-ONLY GPT-OSS-120B identity, for the POST-NRA1 model differential.
 *
 * ### Why this is a separate module rather than a changed constant
 *
 * The obvious way to run a 120B probe is to point `CANDIDATE_MODEL_ID` somewhere else. That would be
 * wrong twice over: it would change what every OTHER governed run sends, and it would make the
 * production candidate identity a thing a diagnostic can move. `CANDIDATE_MODEL_ID` stays
 * `openai/gpt-oss-20b`, and a spec asserts it.
 *
 * So the differential model lives here, declared once, used by exactly one run goal, and never
 * exported into any production path.
 *
 * ### The differential is ONE variable
 *
 * NRA1 sent the neutral production-built request to 20B and received HTTP 400 with
 * `JSON_VALIDATE_FAILED`. MD120B1 re-sends **the same captured request** — same case, same user turn,
 * same prompt bytes, same raw schema, same projected schema, same 4,096 budget, same strict mode, same
 * timeout and retry posture — changing only the model id on the wire.
 *
 * Everything else being equal is a property of reusing NRA1's capture rather than a claim, and an
 * offline spec proves the bytes match.
 *
 * ### What the capability numbers are, and are not
 *
 * Groq documents both GPT-OSS models with a 131,072-token context and a 65,536-token max output, so
 * the capability ceiling does NOT move between them. Keeping it fixed is deliberate: a differential
 * that changed two things would answer neither question.
 *
 * These figures are provider-capability CONTEXT. They are not a guarantee that this exact Jarvis
 * request succeeds on 120B — which is the entire thing MD120B1 exists to find out.
 */

/** The production candidate, restated here ONLY as the differential's baseline label. */
export const MODEL_DIFFERENTIAL_BASELINE_MODEL_ID = 'openai/gpt-oss-20b';

/**
 * The diagnostic model under test.
 *
 * Never read by production routing, never exported through a production surface, and used by exactly
 * one run goal.
 */
export const MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID = 'openai/gpt-oss-120b';

/**
 * The catalog snapshot label for the differential model.
 *
 * A snapshot LABEL, exactly as `CANDIDATE_CATALOG_SNAPSHOT` is — not a weight hash, and not a claim
 * that the provider pinned anything for us.
 */
export const MODEL_DIFFERENTIAL_CATALOG_SNAPSHOT = 'groq-catalog-snapshot-2026-08-20';

/**
 * Whether the SMOKE proves entitlement to the differential model.
 *
 * It does not, and this constant exists so that fact is impossible to skip past. The governed staging
 * smoke runs against the 20B configuration; a passing smoke says the credential works, not that the
 * account may call 120B.
 *
 * The consequence is written into the classifier: a 401, 403 or 404 on the differential probe is
 * INCONCLUSIVE — an entitlement or configuration answer — and must never be read as the model
 * rejecting the request contract.
 */
export const SMOKE_PROVES_DIFFERENTIAL_MODEL_ENTITLEMENT = false;

/** What the smoke actually checked, printed on the receipt so the gap is visible rather than implied. */
export const SMOKE_PROVIDER_CREDENTIAL_CHECK_MODEL = MODEL_DIFFERENTIAL_BASELINE_MODEL_ID;

/**
 * The DIFFERENTIAL model's published tariff.
 *
 * A first revision of this bridge priced the whole run with the production 20B schedule, which
 * underprices a 120B request by roughly half. The wire was correct; the LEDGER was not — and a ledger
 * that underprices what it is about to send is a governance defect, because the spend reservation is
 * made BEFORE the request and is the thing that keeps a live run bounded.
 *
 * Groq publishes 120B at twice the 20B input and output rates. These constants sit beside the model
 * identity rather than in `candidate-release.ts` for the same reason the model id does: they are
 * diagnostic-only, and the production schedule must not move.
 */
export const MODEL_DIFFERENTIAL_PRICE_PER_M_INPUT_USD = 0.15;
export const MODEL_DIFFERENTIAL_PRICE_PER_M_CACHED_INPUT_USD = 0.075;
export const MODEL_DIFFERENTIAL_PRICE_PER_M_OUTPUT_USD = 0.6;

/**
 * When these rates were read from the provider's published pricing.
 *
 * A SNAPSHOT LABEL, exactly as the catalog snapshot is. Prices move; a receipt that could not say
 * which schedule produced its estimate would leave an owner unable to check it.
 */
export const MODEL_DIFFERENTIAL_PRICING_SNAPSHOT = 'groq-pricing-snapshot-2026-08-20';

/**
 * How a MIXED-MODEL run is priced.
 *
 * MD120B1 sends a 20B smoke and a 120B candidate, while `RequestLedger` carries ONE price schedule.
 * Widening that API for a two-request diagnostic would be a large change to a governed accounting
 * primitive, so the whole run is priced at the HIGHER 120B tariff instead.
 *
 * That deliberately OVER-estimates the smoke rather than UNDER-estimating the candidate. Both errors
 * are possible; only one of them can let a live run exceed its authorized ceiling.
 */
export const MODEL_DIFFERENTIAL_COST_PRICING_POSTURE =
  'CONSERVATIVE_120B_RATES_FOR_MIXED_MODEL_RUN';

/** Stated explicitly so the over-estimate is a recorded decision rather than an unexplained number. */
export const MODEL_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE = true;
