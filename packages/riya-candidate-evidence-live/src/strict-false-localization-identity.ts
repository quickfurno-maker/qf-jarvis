/**
 * The DIAGNOSTIC-ONLY identity of the POST-SFD1 strict-false LOCALIZATION run (future label SFD2).
 *
 * ### There is no variable on the wire, and that is the point
 *
 * Every identity file beside this one names a variable: a model, an endpoint, an effort, a budget, a
 * strict flag. This one names NONE. SFD2 sends SFD1's candidate request byte for byte — same model,
 * same endpoint, same captured neutral messages, same projected schema under the same schema name,
 * same `json_schema` mode with `strict: false`, same `reasoning_effort='low'`, same 8,192 budget,
 * same stream/n/sampling/tool posture, same zero retry and zero fallback.
 *
 * What moves is entirely LOCAL: the probe runner is given BOTH validation authorities from the same
 * captured request, so a refusal after HTTP 2xx can be attributed to the stage that produced it.
 *
 * Every value below is therefore a REFERENCE to where the constant already lives. A literal here
 * could drift from SFD1 while the receipt still claimed an identical request, which is the one claim
 * this run cannot afford to get wrong.
 *
 * ### What SFD1 actually recorded, and what it did not
 *
 * The CANONICAL SFD1 result was HTTP 413 — a request-layer refusal. It produced no local verdict at
 * all: neither validation stage ran, because nothing came back to validate.
 *
 * There was also an unauthorized SECOND execution of SFD1's goal. It observed HTTP 200 with the
 * document refused by production. That observation is NONCANONICAL: it does not replace SFD1's
 * record, it is not evidence about the authorized run, and it is recorded here only because it is
 * the reason this run exists. It showed that a strict=false document CAN reach completion and still
 * be refused; it could not say by which stage.
 *
 * ### An ACCEPTED result here still authorizes nothing
 *
 * `RIYA_PRODUCTION_STRICT_MODE_CHANGE_AUTHORIZED`, `..._OUTPUT_BUDGET_CHANGE_AUTHORIZED` and
 * `..._REASONING_EFFORT_CHANGE_AUTHORIZED` are separate owner decisions this run does not make.
 */

import type { GroqGptOssReasoningEffort } from '@qf-jarvis/model-gateway';

import type { ProviderEndpointFamily } from './responses-differential-identity.js';
import {
  PRODUCTION_NON_STRICT_FALLBACK_MODE,
  STRICT_FALSE_CANDIDATE_STRICT,
  STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
  STRICT_FALSE_COMPLETION_BUDGET,
  STRICT_FALSE_COST_PRICING_POSTURE,
  STRICT_FALSE_ENDPOINT_FAMILY,
  STRICT_FALSE_MODEL_ID,
  STRICT_FALSE_PRICING_SNAPSHOT,
  STRICT_FALSE_REASONING_EFFORT,
  STRICT_FALSE_SMOKE_PRICED_AT_CANDIDATE_RATE,
  SMOKE_PROVES_STRICT_FALSE_ENTITLEMENT,
} from './strict-false-differential-identity.js';
import type { StructuredOutputWireMode } from './strict-false-differential-identity.js';

/** `json_schema`, HELD. Read from SFD1's own constant so the two cannot disagree. */
export const STRICT_FALSE_LOCALIZATION_STRUCTURED_MODE: StructuredOutputWireMode =
  STRICT_FALSE_CANDIDATE_STRUCTURED_MODE;

/** `false`, HELD. This run does not re-test the strict posture; it reads the refusal SFD1 produced. */
export const STRICT_FALSE_LOCALIZATION_STRICT = STRICT_FALSE_CANDIDATE_STRICT;

/** `low`, HELD. */
export const STRICT_FALSE_LOCALIZATION_REASONING_EFFORT: GroqGptOssReasoningEffort =
  STRICT_FALSE_REASONING_EFFORT;

/** 8,192, HELD. Read, never restated. */
export const STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET = STRICT_FALSE_COMPLETION_BUDGET;

/** The PRODUCTION candidate model, HELD. */
export const STRICT_FALSE_LOCALIZATION_MODEL_ID = STRICT_FALSE_MODEL_ID;

/** Chat Completions — the production serving contract, HELD. */
export const STRICT_FALSE_LOCALIZATION_ENDPOINT_FAMILY: ProviderEndpointFamily =
  STRICT_FALSE_ENDPOINT_FAMILY;

/**
 * What production's non-strict branch would have sent instead: `json_object`, which drops the
 * schema. Carried onto this receipt for the same reason SFD1 carried it — printing the trap is how a
 * reader sees it was avoided rather than taking it on trust.
 */
export const STRICT_FALSE_LOCALIZATION_PRODUCTION_NON_STRICT_FALLBACK_MODE: StructuredOutputWireMode =
  PRODUCTION_NON_STRICT_FALLBACK_MODE;

/**
 * The CANONICAL SFD1 classification. Immutable, and printed as this run's baseline.
 *
 * A request-layer refusal, in SFD1's own vocabulary. Nothing here reinterprets it.
 */
export const SFD1_CANONICAL_CLASSIFICATION =
  'REASONING_LOW_8192_BEST_EFFORT_PROVIDER_REQUEST_REJECTED';

/** The CANONICAL SFD1 HTTP status. A request-layer result, and no local verdict at all. */
export const SFD1_CANONICAL_HTTP_STATUS = 413;

/**
 * Whether the unauthorized duplicate observation is canonical. It is NOT.
 *
 * Printed as a first-class `false` so no receipt can be read as promoting it. It is the reason this
 * run exists and it is not evidence about the authorized run.
 */
export const SFD1_DUPLICATE_OBSERVATION_IS_CANONICAL = false;

/**
 * Whether SFD2 changes any provider-wire field relative to SFD1's candidate request. It does not.
 *
 * A spec proves this by byte-comparing the two serialized bodies at the transport boundary, so this
 * constant is a LABEL for the receipt and the proof lives in the test.
 */
export const STRICT_FALSE_LOCALIZATION_WIRE_FIELDS_CHANGED = 0;

/** The two local stages, in the order they are read. Closed, and named on the receipt. */
export const LOCAL_VALIDATION_STAGES = ['WIRE_SCHEMA', 'PRODUCTION_PROJECTOR'] as const;
export type LocalValidationStage = (typeof LOCAL_VALIDATION_STAGES)[number];

/**
 * Where each stage's authority comes from. Neither is written here, and neither may ever be.
 *
 * A hand-authored second Riya validator would drift from production and start reporting refusals
 * production would not make — which would be worse than the ambiguity this run exists to remove.
 */
export const WIRE_STAGE_AUTHORITY = 'CAPTURED_GATEWAY_STRUCTURED_WIRE_SCHEMA';
export const PRODUCTION_STAGE_AUTHORITY = 'CAPTURED_PRODUCTION_PROJECT_STRUCTURED_RESULT';

/** The smoke covers this configuration: same model, same endpoint, same account. */
export const SMOKE_PROVES_LOCALIZATION_ENTITLEMENT = SMOKE_PROVES_STRICT_FALSE_ENTITLEMENT;

/** What the smoke actually checked. The SAME contract this probe uses. */
export const SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY: ProviderEndpointFamily =
  STRICT_FALSE_ENDPOINT_FAMILY;

/** SINGLE-model, so the production schedule is exactly right for both requests. */
export const STRICT_FALSE_LOCALIZATION_COST_PRICING_POSTURE = STRICT_FALSE_COST_PRICING_POSTURE;

/** Stated explicitly, as it is on every receipt beside this one. */
export const STRICT_FALSE_LOCALIZATION_SMOKE_PRICED_AT_CANDIDATE_RATE =
  STRICT_FALSE_SMOKE_PRICED_AT_CANDIDATE_RATE;

/** A SNAPSHOT LABEL. The rates themselves are read from `candidate-release.ts`. */
export const STRICT_FALSE_LOCALIZATION_PRICING_SNAPSHOT = STRICT_FALSE_PRICING_SNAPSHOT;
