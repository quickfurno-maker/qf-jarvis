/**
 * The DIAGNOSTIC-ONLY strict-posture identity, for the POST-RBD1 differential.
 *
 * ### The variable is `response_format.json_schema.strict`, and everything else is HELD
 *
 * RLD1 sent the neutral production request at `reasoning_effort='low'` and 4,096 with
 * `json_schema.strict: true` and met HTTP 400 `json_validate_failed`. RBD1 sent it at 8,192 and met
 * the same. Neither the effort attempt nor the budget attempt repaired the exact neutral path.
 *
 * What every one of those requests shares is CONSTRAINED DECODING: `strict: true`. That is the open
 * axis, and this run moves exactly it — to `false`, which Groq documents as best-effort JSON Schema.
 *
 * ### Why the production non-strict path could not have answered this
 *
 * `buildResponseFormat(schema, false)` returns `{ type: 'json_object' }`. Using it would change FOUR
 * things at once: the response-format type, the schema name, the strict flag, and the schema body,
 * which disappears entirely. That answers "what happens with no schema at all" — a different and much
 * weaker question, and one whose result could not be compared with RBD1's.
 *
 * The candidate keeps `json_schema` mode, the same name and the same schema, and turns only the
 * constrained decoding off. `buildResponseFormat` is untouched and still returns `json_object` on its
 * non-strict branch; a spec asserts both halves of that.
 *
 * ### What is still NOT established
 *
 * RBD1's receipt was `MIXED` on both dimensions: its totals carry the ledger's configured ceilings as
 * fallback bounds for the failed probe. Nobody has observed how many tokens either failed probe
 * consumed, and truncation was never proven at 4,096 or at 8,192. This run does not assume it, and
 * does not test it.
 *
 * If this run ACCEPTS, what is proven is that turning constrained decoding off — while holding the
 * governed request otherwise fixed — changed this exact neutral path. Not that Groq strict mode is
 * globally broken, not that `strict: false` is generally better, and not that production should move.
 *
 * ### Best-effort mode may still return a schema 400, and that is a real outcome
 *
 * Groq documents that best-effort mode can still refuse a document that does not satisfy the schema.
 * So `json_validate_failed` under `strict: false` is a legitimate experimental result and is
 * classified as an OUTPUT failure, exactly as it is under strict — never as a request rejection.
 *
 * ### The model, endpoint, effort and budget are references, not literals
 *
 * Each is read from where it already lives, so there is no constant in this file that a future edit
 * could move while the receipt still claimed a one-variable run.
 */

import type { GroqGptOssReasoningEffort } from '@qf-jarvis/model-gateway';

import { CANDIDATE_MODEL_ID } from './candidate-release.js';
import {
  REASONING_BUDGET_8192_CANDIDATE_BUDGET,
  REASONING_BUDGET_8192_ENDPOINT_FAMILY,
  REASONING_BUDGET_8192_REASONING_EFFORT,
} from './reasoning-budget-8192-identity.js';
import type { ProviderEndpointFamily } from './responses-differential-identity.js';

/** The structured-output mode. HELD: both sides send `json_schema`, and the schema stays. */
export const STRUCTURED_OUTPUT_WIRE_MODES = ['json_schema', 'json_object'] as const;
export type StructuredOutputWireMode = (typeof STRUCTURED_OUTPUT_WIRE_MODES)[number];

/** What RBD1 sent, and what this run sends. The SAME mode — this is not a mode change. */
export const STRICT_FALSE_BASELINE_STRUCTURED_MODE: StructuredOutputWireMode = 'json_schema';
export const STRICT_FALSE_CANDIDATE_STRUCTURED_MODE: StructuredOutputWireMode = 'json_schema';

/** THE one variable. RBD1 sent `true`; this run sends `false`. */
export const STRICT_FALSE_BASELINE_STRICT = true;
export const STRICT_FALSE_CANDIDATE_STRICT = false;

/**
 * What production's non-strict branch would have sent instead.
 *
 * Recorded as a first-class constant so the receipt states the trap rather than leaving a reader to
 * infer that it was avoided: `buildResponseFormat(schema, false)` returns `json_object`, which drops
 * the schema. A spec asserts that the diagnostic does NOT send this.
 */
export const PRODUCTION_NON_STRICT_FALLBACK_MODE: StructuredOutputWireMode = 'json_object';

/** The reasoning effort, HELD. Read from RBD1's constant so the two runs cannot disagree. */
export const STRICT_FALSE_REASONING_EFFORT: GroqGptOssReasoningEffort =
  REASONING_BUDGET_8192_REASONING_EFFORT;

/** The completion budget, HELD at RBD1's 8,192. Read, never restated. */
export const STRICT_FALSE_COMPLETION_BUDGET = REASONING_BUDGET_8192_CANDIDATE_BUDGET;

/** The model, restated as a REFERENCE. */
export const STRICT_FALSE_MODEL_ID = CANDIDATE_MODEL_ID;

/** The endpoint. The PRODUCTION serving contract, and the same one RBD1 used. */
export const STRICT_FALSE_ENDPOINT_FAMILY: ProviderEndpointFamily =
  REASONING_BUDGET_8192_ENDPOINT_FAMILY;

/** What the prior run observed, so the receipt states its own baseline. */
export const STRICT_FALSE_BASELINE_CLASSIFICATION =
  'REASONING_LOW_8192_STRICT_PROVIDER_OUTPUT_INVALID';

/**
 * Whether either failed probe's usage was OBSERVED. It was not.
 *
 * RLD1 and RBD1 both settled their failed probes from the ledger's configured ceilings, so their
 * token totals are conservative bounds and were never generation lengths. Printed so the gap cannot
 * be skipped past, and so an ACCEPTED result here is not read as retroactive evidence about them.
 */
export const PRIOR_FAILED_PROBE_USAGE_OBSERVED = false;

/** Whether truncation was ever proven, at 4,096 or 8,192. It was not. */
export const PRIOR_TRUNCATION_PROVEN = false;

/** The smoke covers this configuration: same model, same endpoint, same account. */
export const SMOKE_PROVES_STRICT_FALSE_ENTITLEMENT = true;

/** What the smoke actually checked. The SAME contract this probe uses. */
export const SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY: ProviderEndpointFamily =
  REASONING_BUDGET_8192_ENDPOINT_FAMILY;

/** SINGLE-model, so the production schedule is exactly right for both requests. */
export const STRICT_FALSE_COST_PRICING_POSTURE = 'PRODUCTION_20B_RATES_FOR_SINGLE_MODEL_RUN';

/** Stated explicitly, as it is on every receipt beside this one. */
export const STRICT_FALSE_SMOKE_PRICED_AT_CANDIDATE_RATE = true;

/** A SNAPSHOT LABEL. The rates themselves are read from `candidate-release.ts`. */
export const STRICT_FALSE_PRICING_SNAPSHOT = 'groq-pricing-snapshot-2026-08-20';
