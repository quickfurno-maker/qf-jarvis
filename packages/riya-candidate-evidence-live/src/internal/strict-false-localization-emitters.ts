/**
 * Content-free output for a POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named
 * one by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a
 * model answer, a raw provider body, a reasoning trace, an error message, a credential, a header,
 * a zod issue, a zod path or a projector exception.
 *
 * ### What is printed is the STAGE PAIR, and both halves always
 *
 * `wireValidationCompleted` / `wireValidationPassed` and `productionValidationCompleted` /
 * `productionValidationPassed` are four booleans rather than one verdict, because the pair is the
 * finding. `false`/`false` on a 413 means neither stage ran — which is exactly what SFD1's canonical
 * result produced, and is a different statement from "the wire schema refused".
 *
 * ### The wire posture is printed even though it did not move
 *
 * `structuredOutputMode`, `strict`, `reasoningEffort`, `maxCompletionTokens`, `endpointFamily` and
 * `candidateModel` are all HELD at SFD1's values. A receipt showing only the stage booleans would
 * leave a reader unable to tell which request produced them, and this run's whole claim is that the
 * request is SFD1's. `wireFieldsChangedVsSfd1` states that as a number, and a spec proves it by
 * byte-comparing the two serialized bodies.
 *
 * ### The two fields that stop the duplicate being read as evidence
 *
 * `baselineClassification` is SFD1's CANONICAL token and `baselineHttpStatus` is 413.
 * `duplicateObservationIsCanonical` is `false`. The unauthorized second execution is the reason this
 * run exists and is not evidence about the authorized one, and a receipt that omitted the
 * distinction would let a reader promote it by accident.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import {
  LOCAL_VALIDATION_STAGES,
  PRODUCTION_STAGE_AUTHORITY,
  SFD1_CANONICAL_CLASSIFICATION,
  SFD1_CANONICAL_HTTP_STATUS,
  SFD1_DUPLICATE_OBSERVATION_IS_CANONICAL,
  SMOKE_PROVES_LOCALIZATION_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
  STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET,
  STRICT_FALSE_LOCALIZATION_COST_PRICING_POSTURE,
  STRICT_FALSE_LOCALIZATION_ENDPOINT_FAMILY,
  STRICT_FALSE_LOCALIZATION_MODEL_ID,
  STRICT_FALSE_LOCALIZATION_PRICING_SNAPSHOT,
  STRICT_FALSE_LOCALIZATION_PRODUCTION_NON_STRICT_FALLBACK_MODE,
  STRICT_FALSE_LOCALIZATION_REASONING_EFFORT,
  STRICT_FALSE_LOCALIZATION_SMOKE_PRICED_AT_CANDIDATE_RATE,
  STRICT_FALSE_LOCALIZATION_STRICT,
  STRICT_FALSE_LOCALIZATION_STRUCTURED_MODE,
  STRICT_FALSE_LOCALIZATION_WIRE_FIELDS_CHANGED,
  WIRE_STAGE_AUTHORITY,
} from '../strict-false-localization-identity.js';
import type { LocalizedStructuredReplyAnalysis } from './localized-structured-reply-classification.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';

/** The four content-free stage booleans a localization outcome carries. */
export interface LocalValidationProvenance {
  readonly wireValidationCompleted: boolean;
  readonly wireValidationPassed: boolean;
  readonly productionValidationCompleted: boolean;
  readonly productionValidationPassed: boolean;
}

/** What the ONE probe observed, in the shape these emitters print. */
export interface StrictFalseLocalizationProbeOutcome extends LocalValidationProvenance {
  readonly stepId: string;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: string;
  readonly providerErrorType: string;
  readonly providerErrorCode: string;
  readonly providerCompleted: boolean;
}

/** The ONE probe row: what was asked, and what BOTH local stages said about what came back. */
export function emitStrictFalseLocalizationProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: StrictFalseLocalizationProbeOutcome,
): void {
  safe.line({
    phase: 'strict-false-localization',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    messageSource: probe.messageSource,
    completionCapClass: 'DIAGNOSTIC_WIDENED',
    // The wire posture, HELD at SFD1's. Printed so this receipt names the request it sent.
    structuredOutputMode: STRICT_FALSE_LOCALIZATION_STRUCTURED_MODE,
    strict: STRICT_FALSE_LOCALIZATION_STRICT,
    reasoningEffort: STRICT_FALSE_LOCALIZATION_REASONING_EFFORT,
    maxCompletionTokens: STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET,
    endpointFamily: STRICT_FALSE_LOCALIZATION_ENDPOINT_FAMILY,
    candidateModel: STRICT_FALSE_LOCALIZATION_MODEL_ID,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    // Preserved verbatim and NOT interpreted here. The classifier reads it; this line reports it.
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
    // THE FINDING. Four booleans, never collapsed: `false`/`false` on both stages means neither ran.
    wireValidationCompleted: outcome.wireValidationCompleted,
    wireValidationPassed: outcome.wireValidationPassed,
    productionValidationCompleted: outcome.productionValidationCompleted,
    productionValidationPassed: outcome.productionValidationPassed,
  });
}

/** The conclusion: one closed run-neutral token, with the literal observed fields beside it. */
export function emitStrictFalseLocalizationClassification(
  safe: SafeConsole,
  analysis: LocalizedStructuredReplyAnalysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'strict-false-localization',
    status: 'CLASSIFICATION',
    probesRun,
    structuredOutputMode: STRICT_FALSE_LOCALIZATION_STRUCTURED_MODE,
    strict: STRICT_FALSE_LOCALIZATION_STRICT,
    reasoningEffort: STRICT_FALSE_LOCALIZATION_REASONING_EFFORT,
    maxCompletionTokens: STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET,
    endpointFamily: STRICT_FALSE_LOCALIZATION_ENDPOINT_FAMILY,
    candidateModel: STRICT_FALSE_LOCALIZATION_MODEL_ID,
    // SFD1's CANONICAL result, so the comparison is on the line that concludes.
    baselineClassification: SFD1_CANONICAL_CLASSIFICATION,
    baselineHttpStatus: SFD1_CANONICAL_HTTP_STATUS,
    duplicateObservationIsCanonical: SFD1_DUPLICATE_OBSERVATION_IS_CANONICAL,
    localizedClassification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
    wireValidationCompleted: analysis.wireValidationCompleted,
    wireValidationPassed: analysis.wireValidationPassed,
    productionValidationCompleted: analysis.productionValidationCompleted,
    productionValidationPassed: analysis.productionValidationPassed,
  });
}

/** The receipt. Names its OWN counter, states the other counters, the baseline and the posture. */
export function emitStrictFalseLocalizationReceipt(
  safe: SafeConsole,
  snapshot: LedgerSnapshot,
): void {
  safe.line({
    phase: 'strict-false-localization',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    localizationProbeRequests: snapshot.strictFalseLocalizationProbeProviderRequests,
    // Stated as zero rather than omitted: this run re-sends no earlier probe, and in particular does
    // NOT replay SFD1's own request under SFD1's step id.
    strictFalseProbeRequests: snapshot.strictFalseProbeProviderRequests,
    reasoningBudget8192ProbeRequests: snapshot.reasoningBudget8192ProbeProviderRequests,
    reasoningDifferentialProbeRequests: snapshot.reasoningDifferentialProbeProviderRequests,
    // The wire posture, and the claim that none of it moved.
    structuredOutputMode: STRICT_FALSE_LOCALIZATION_STRUCTURED_MODE,
    strict: STRICT_FALSE_LOCALIZATION_STRICT,
    productionNonStrictFallbackMode: STRICT_FALSE_LOCALIZATION_PRODUCTION_NON_STRICT_FALLBACK_MODE,
    reasoningEffort: STRICT_FALSE_LOCALIZATION_REASONING_EFFORT,
    maxCompletionTokens: STRICT_FALSE_LOCALIZATION_COMPLETION_BUDGET,
    endpointFamily: STRICT_FALSE_LOCALIZATION_ENDPOINT_FAMILY,
    candidateModel: STRICT_FALSE_LOCALIZATION_MODEL_ID,
    wireFieldsChangedVsSfd1: STRICT_FALSE_LOCALIZATION_WIRE_FIELDS_CHANGED,
    // WHERE each local verdict came from. Neither authority is written in this repository's
    // diagnostic layer; both travel with the captured production request.
    localValidationStages: LOCAL_VALIDATION_STAGES.join('+'),
    wireStageAuthority: WIRE_STAGE_AUTHORITY,
    productionStageAuthority: PRODUCTION_STAGE_AUTHORITY,
    baselineClassification: SFD1_CANONICAL_CLASSIFICATION,
    baselineHttpStatus: SFD1_CANONICAL_HTTP_STATUS,
    duplicateObservationIsCanonical: SFD1_DUPLICATE_OBSERVATION_IS_CANONICAL,
    smokeEndpointCheckFamily: SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
    smokeProvesEndpointEntitlement: SMOKE_PROVES_LOCALIZATION_ENTITLEMENT,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    // WHERE those totals came from, per dimension. A total carrying even one fallback contribution
    // can never report PROVIDER_ONLY — the control that keeps a bound from reading as a measurement.
    inputUsageProvenance: snapshot.inputUsageProvenance,
    outputUsageProvenance: snapshot.outputUsageProvenance,
    costPricingPosture: STRICT_FALSE_LOCALIZATION_COST_PRICING_POSTURE,
    smokePricedAtCandidateRate: STRICT_FALSE_LOCALIZATION_SMOKE_PRICED_AT_CANDIDATE_RATE,
    pricingSnapshot: STRICT_FALSE_LOCALIZATION_PRICING_SNAPSHOT,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
