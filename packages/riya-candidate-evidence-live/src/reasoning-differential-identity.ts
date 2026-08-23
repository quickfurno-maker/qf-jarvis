/**
 * The DIAGNOSTIC-ONLY reasoning-effort identity, for the POST-RSP20B2 differential.
 *
 * ### The variable is `reasoning_effort`, and nothing else moves
 *
 * NRA1 sent the neutral production-built request to `openai/gpt-oss-20b` over Chat Completions, at
 * the 4,096 budget, in strict mode, and received HTTP 400 with `json_validate_failed`. MD120B3
 * reproduced it on 120B; RSP20B2 reproduced it over the Responses API. Model and endpoint are both
 * closed as axes.
 *
 * What every one of those runs shares is a request that carried **no reasoning field at all**. GPT-OSS
 * reasoning tokens are drawn from the same completion budget the structured answer needs, so a model
 * reasoning at the documented default has less of that budget left for the JSON it was asked to
 * produce. That is the open axis, and this run moves exactly it.
 *
 * ### The baseline carried ABSENT, not `medium`
 *
 * Stated as its own constant because the distinction decides how the evidence reads. The historical
 * request **omitted** the field. It did not send `'medium'`. Current Groq documentation defines the
 * omitted GPT-OSS default as medium, and that is a fact about the provider today rather than a field
 * that was ever on the wire — a receipt that printed `baselineReasoningEffort: 'medium'` would be
 * asserting a wire fact nobody observed.
 *
 * So two constants: the POSTURE the baseline actually had, and the DOCUMENTED default that posture
 * currently resolves to. Both are printed.
 *
 * ### The model, the endpoint and the budget are references, not literals
 *
 * `CANDIDATE_MODEL_ID` is read directly, and the endpoint family is the production one. There is no
 * diagnostic model id and no diagnostic endpoint in this file, on purpose: each would be one more
 * thing a future edit could quietly move while the receipt kept claiming a one-variable run.
 *
 * The output budget is likewise NOT restated here — the port re-exports the same constant every
 * earlier gate used. Moving it would add a second variable to a one-variable differential, and it
 * would do so in the exact dimension the reasoning tokens are drawn from, which would make the
 * result uninterpretable.
 */

import { GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT } from '@qf-jarvis/model-gateway';
import type { GroqGptOssReasoningEffort } from '@qf-jarvis/model-gateway';

import { CANDIDATE_MODEL_ID } from './candidate-release.js';
import type { ProviderEndpointFamily } from './responses-differential-identity.js';

/**
 * Whether the baseline request carried a reasoning field.
 *
 * A closed two-member posture rather than a nullable effort value, so a receipt can never print an
 * effort the baseline did not send. `ABSENT` is a statement about the wire; it is deliberately not
 * spelled `'medium'`.
 */
export const REASONING_FIELD_POSTURES = ['ABSENT', 'EXPLICIT'] as const;
export type ReasoningFieldPosture = (typeof REASONING_FIELD_POSTURES)[number];

/** What NRA1, MD120B3 and RSP20B2 all sent: no reasoning field of any spelling. */
export const REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE: ReasoningFieldPosture = 'ABSENT';

/**
 * What the provider currently documents an omitted GPT-OSS `reasoning_effort` to resolve to.
 *
 * Read from the gateway rather than restated, so the diagnostic and the adapter cannot disagree
 * about what the baseline was competing against. It describes provider behaviour TODAY and is not a
 * field anyone observed on the historical wire — which is why it is printed beside the posture above
 * rather than instead of it.
 */
export const REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT: GroqGptOssReasoningEffort =
  GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT;

/** THE one variable. The narrowest reasoning setting the provider documents. */
export const REASONING_DIFFERENTIAL_CANDIDATE_EFFORT: GroqGptOssReasoningEffort = 'low';

/**
 * The model, restated as a REFERENCE rather than a literal.
 *
 * This is `CANDIDATE_MODEL_ID` itself. A separate constant with the same value would be a place for
 * the two to drift apart, and "the model did not move" is a property this run rests on.
 */
export const REASONING_DIFFERENTIAL_MODEL_ID = CANDIDATE_MODEL_ID;

/**
 * The endpoint. The PRODUCTION serving contract, and the same one the baseline used.
 *
 * RSP20B2 already measured the other documented contract. Moving the endpoint here as well would
 * make a `reasoning_effort` result unattributable — two variables, one observation.
 */
export const REASONING_DIFFERENTIAL_ENDPOINT_FAMILY: ProviderEndpointFamily = 'CHAT_COMPLETIONS';

/** The contract the baseline used. The SAME one, stated so the receipt shows the comparison. */
export const REASONING_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY: ProviderEndpointFamily =
  'CHAT_COMPLETIONS';

/**
 * Whether the governed staging smoke establishes entitlement for this probe.
 *
 * Unlike the Responses differential, it DOES — and this constant records that rather than leaving a
 * reader to infer it from the absence of a warning. The smoke runs against the 20B Chat Completions
 * configuration, which is exactly the configuration this probe uses; `reasoning_effort` is a body
 * field on an endpoint the credential has already been proved against, not a separate product
 * surface requiring its own enrolment.
 *
 * The consequence for the classifier is narrower, not absent: a 401, 403 or 404 here is still
 * INCONCLUSIVE, because a credential can be revoked between two requests and a permission answer is
 * never evidence about a request contract.
 */
export const SMOKE_PROVES_REASONING_DIAGNOSTIC_ENTITLEMENT = true;

/** What the smoke actually checked. The SAME contract this probe uses. */
export const SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY: ProviderEndpointFamily = 'CHAT_COMPLETIONS';

/**
 * How this run is priced.
 *
 * SINGLE-model: both requests go to `CANDIDATE_MODEL_ID`, so the production schedule is exactly right
 * and no conservative over-estimate is needed. Named rather than left implicit because MD120B3's
 * receipt names a different posture, and two receipts that priced differently must say so.
 */
export const REASONING_DIFFERENTIAL_COST_PRICING_POSTURE =
  'PRODUCTION_20B_RATES_FOR_SINGLE_MODEL_RUN';

/** Stated explicitly, as it is on every receipt beside this one. */
export const REASONING_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE = true;

/**
 * When the rates behind this run's estimate were read.
 *
 * A SNAPSHOT LABEL. The rates themselves are the production candidate's and are NOT restated here —
 * the ledger reads them from `candidate-release.ts`, so a published price change moves this run with
 * every other one.
 */
export const REASONING_DIFFERENTIAL_PRICING_SNAPSHOT = 'groq-pricing-snapshot-2026-08-20';
