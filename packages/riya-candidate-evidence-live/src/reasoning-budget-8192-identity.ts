/**
 * The DIAGNOSTIC-ONLY output-budget identity, for the POST-RLD1 differential.
 *
 * ### The variable is `max_completion_tokens`, and the reasoning posture is now HELD
 *
 * RLD1 sent the neutral production request on `openai/gpt-oss-20b`, over Chat Completions, at
 * `max_completion_tokens=4096`, with `reasoning_effort='low'`, and received HTTP 400 with
 * `json_validate_failed` — `REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID`. Explicit low
 * reasoning effort did **not** repair the exact neutral path.
 *
 * So the effort axis is now settled the way the model and endpoint axes were settled before it, and
 * this run holds it: `low`, exactly as RLD1 sent. What moves is the budget, and only the budget.
 *
 * ### What RLD1 did NOT establish, stated because it is easy to assume
 *
 * RLD1's receipt reported `inputTokensTotal=131266` and `outputTokensTotal=65593`, both `MIXED`.
 * Those totals carry the ledger's FALLBACK BOUNDS for the failed probe — 131,072 input and 65,536
 * output, the configured ceilings — plus the smoke's observed 194/57. They are not observed
 * generation lengths, and nothing in this repository knows how many tokens the failed probe actually
 * consumed.
 *
 * Truncation at 4,096 is therefore PLAUSIBLE and NOT PROVEN, and this run is built to test it rather
 * than to assume it. If 8,192 accepts, what is proven is that raising the budget while holding every
 * other governed field changed the outcome — not that 4,096 was the exact cliff, not that 8,192 is
 * required in general, and not that production should move.
 *
 * ### The production budget is NOT this constant
 *
 * `RIYA_COMPLETION_BUDGET_TOKENS` stays 4,096 and is untouched. The 8,192 lives here, in a
 * diagnostic identity, and reaches only the request this goal sends. A spec asserts the production
 * constant is unchanged, because a bridge that quietly widened production would be answering the
 * question by changing it.
 *
 * ### The model, the endpoint and the effort are references, not literals
 *
 * Each is read from where it already lives — `CANDIDATE_MODEL_ID`, the Chat Completions family, and
 * RLD1's own effort constant. There is no diagnostic model id, endpoint or effort in this file, on
 * purpose: each would be one more thing a future edit could move while the receipt still claimed a
 * one-variable run.
 */

import type { GroqGptOssReasoningEffort } from '@qf-jarvis/model-gateway';

import { CANDIDATE_MODEL_ID } from './candidate-release.js';
import {
  REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
  REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
} from './reasoning-differential-identity.js';
import type { ProviderEndpointFamily } from './responses-differential-identity.js';

/**
 * The budget RLD1 sent, and the one this run is measured against.
 *
 * Read from the RLD1 port rather than restated, so the baseline this receipt names is the number
 * that run actually put on the wire.
 */
export { REASONING_DIFFERENTIAL_OUTPUT_BUDGET as REASONING_BUDGET_8192_BASELINE_BUDGET } from './reasoning-differential-port.js';

/**
 * THE one variable: the per-request completion bound this run asks for.
 *
 * Exactly double the baseline, which is the smallest step that is unambiguously a different budget
 * rather than a rounding of the same one. It is a REQUEST bound and is nowhere near the model
 * capability ceiling (`CANDIDATE_MAX_COMPLETION_TOKENS`, 65,536), so the config is unchanged and the
 * adapter's clamp is not engaged — a diagnostic may narrow the request, never widen the ceiling.
 */
export const REASONING_BUDGET_8192_CANDIDATE_BUDGET = 8192;

/**
 * The reasoning effort, restated as a REFERENCE to RLD1's.
 *
 * This run holds what RLD1 varied. Reading the constant rather than writing `'low'` again means the
 * two runs cannot disagree about the posture being held, which is the whole basis for calling this a
 * one-variable differential.
 */
export const REASONING_BUDGET_8192_REASONING_EFFORT: GroqGptOssReasoningEffort =
  REASONING_DIFFERENTIAL_CANDIDATE_EFFORT;

/** The model, restated as a REFERENCE. A second constant would be somewhere for the two to drift. */
export const REASONING_BUDGET_8192_MODEL_ID = CANDIDATE_MODEL_ID;

/** The endpoint. The PRODUCTION serving contract, and the same one RLD1 used. */
export const REASONING_BUDGET_8192_ENDPOINT_FAMILY: ProviderEndpointFamily =
  REASONING_DIFFERENTIAL_ENDPOINT_FAMILY;

/**
 * What the prior run observed, recorded so the receipt states its own baseline.
 *
 * A closed token rather than prose: a reader comparing two receipts must be able to see which result
 * this run was built to follow, without going and finding RLD1's transcript.
 */
export const REASONING_BUDGET_8192_BASELINE_CLASSIFICATION =
  'REASONING_LOW_20B_STRICT_PROVIDER_OUTPUT_INVALID';

/**
 * Whether RLD1's failed probe usage was OBSERVED.
 *
 * It was not, and this constant exists so that fact is impossible to skip past. RLD1's totals carry
 * fallback bounds for the failed probe, so the output-budget hypothesis rests on the provider's
 * error code and on reasoning about how GPT-OSS spends a completion budget — not on a measured
 * generation length. Printing the gap keeps a plausible hypothesis from being read as a proven one.
 */
export const RLD1_FAILED_PROBE_USAGE_OBSERVED = false;

/** Whether truncation at the 4,096 baseline was ever proven. It was not. */
export const RLD1_TRUNCATION_AT_BASELINE_PROVEN = false;

/**
 * Whether the governed staging smoke establishes entitlement for this probe.
 *
 * It does. The smoke runs against the 20B Chat Completions configuration, which is exactly the
 * configuration this probe uses; a per-request completion bound is a body field on an endpoint the
 * credential has already been proved against, not a separate product surface.
 *
 * The classifier is narrower rather than laxer for it: a 401, 403 or 404 is still INCONCLUSIVE,
 * because a credential can be revoked between two requests and a permission answer is never evidence
 * about a request contract.
 */
export const SMOKE_PROVES_BUDGET_DIAGNOSTIC_ENTITLEMENT = true;

/** What the smoke actually checked. The SAME contract this probe uses. */
export const SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY: ProviderEndpointFamily =
  REASONING_DIFFERENTIAL_ENDPOINT_FAMILY;

/**
 * How this run is priced.
 *
 * SINGLE-model: both requests go to `CANDIDATE_MODEL_ID`, so the production schedule is exactly right
 * and no conservative over-estimate is needed. Named rather than left implicit because MD120B3's
 * receipt names a different posture, and two receipts that priced differently must say so.
 */
export const REASONING_BUDGET_8192_COST_PRICING_POSTURE =
  'PRODUCTION_20B_RATES_FOR_SINGLE_MODEL_RUN';

/** Stated explicitly, as it is on every receipt beside this one. */
export const REASONING_BUDGET_8192_SMOKE_PRICED_AT_CANDIDATE_RATE = true;

/**
 * When the rates behind this run's estimate were read.
 *
 * A SNAPSHOT LABEL. The rates themselves are the production candidate's and are NOT restated here —
 * the ledger reads them from `candidate-release.ts`, so a published price change moves this run with
 * every other one.
 */
export const REASONING_BUDGET_8192_PRICING_SNAPSHOT = 'groq-pricing-snapshot-2026-08-20';
