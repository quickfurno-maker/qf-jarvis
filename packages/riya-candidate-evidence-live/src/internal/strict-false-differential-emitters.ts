/**
 * Content-free output for a POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named one
 * by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a model
 * answer, a raw provider body, a reasoning trace, an error message, a credential or a header.
 *
 * ### The comparison is printed, including the half that did NOT move
 *
 * `baselineStrict` / `candidateStrict` are the experiment. `baselineStructuredOutputMode` and
 * `candidateStructuredOutputMode` are printed BESIDE them and are both `json_schema` — because the
 * single most likely misreading of this run is that it turned structured output off. It did not: the
 * mode, the schema name and the schema body are all held, and only constrained decoding changed.
 *
 * `productionNonStrictFallbackMode` states what production's `buildResponseFormat(schema, false)`
 * would have sent instead — `json_object`, which drops the schema entirely. Printing the trap is how
 * a later reader can see it was avoided rather than having to take it on trust.
 *
 * `reasoningEffort` and `maxCompletionTokens` are printed because they are HELD. A receipt showing
 * only the strict flag would leave a reader unable to tell this from a fourth budget run.
 *
 * ### The two fields that stop a hypothesis being read as a proof
 *
 * `priorFailedProbeUsageObserved` and `priorTruncationProven` are both `false`.
 *
 * RLD1 and RBD1 both settled their failed probes from the ledger's CONFIGURED CEILINGS, so their
 * token totals were conservative bounds and never generation lengths. Nobody has observed what either
 * failed probe consumed, and truncation was never proven at 4,096 or at 8,192. An ACCEPTED result
 * here says something about the strict posture; it says nothing retroactive about those.
 *
 * ### Reasoning CONTENT never appears
 *
 * The adapter requests reasoning EFFORT and never reasoning capture. There is correspondingly no
 * field here that could carry a reasoning trace, and no reasoning-token count.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import {
  PRIOR_FAILED_PROBE_USAGE_OBSERVED,
  PRIOR_TRUNCATION_PROVEN,
  PRODUCTION_NON_STRICT_FALLBACK_MODE,
  SMOKE_PROVES_STRICT_FALSE_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
  STRICT_FALSE_BASELINE_CLASSIFICATION,
  STRICT_FALSE_BASELINE_STRICT,
  STRICT_FALSE_BASELINE_STRUCTURED_MODE,
  STRICT_FALSE_CANDIDATE_STRICT,
  STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
  STRICT_FALSE_COMPLETION_BUDGET,
  STRICT_FALSE_COST_PRICING_POSTURE,
  STRICT_FALSE_ENDPOINT_FAMILY,
  STRICT_FALSE_MODEL_ID,
  STRICT_FALSE_PRICING_SNAPSHOT,
  STRICT_FALSE_REASONING_EFFORT,
  STRICT_FALSE_SMOKE_PRICED_AT_CANDIDATE_RATE,
} from '../strict-false-differential-identity.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';
import type {
  StrictFalseAnalysis,
  StrictFalseOutcome,
} from './strict-false-differential-classification.js';

/** The ONE probe row: what was asked, under which strict posture, and what came back. */
export function emitStrictFalseDifferentialProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: StrictFalseOutcome,
): void {
  safe.line({
    phase: 'strict-false-differential',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'DIAGNOSTIC_WIDENED',
    // THE variable, printed beside the mode that did NOT move.
    baselineStructuredOutputMode: STRICT_FALSE_BASELINE_STRUCTURED_MODE,
    candidateStructuredOutputMode: STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
    baselineStrict: STRICT_FALSE_BASELINE_STRICT,
    candidateStrict: STRICT_FALSE_CANDIDATE_STRICT,
    // What production's non-strict branch WOULD have sent, and deliberately did not.
    productionNonStrictFallbackMode: PRODUCTION_NON_STRICT_FALLBACK_MODE,
    // HELD, all four.
    reasoningEffort: STRICT_FALSE_REASONING_EFFORT,
    maxCompletionTokens: STRICT_FALSE_COMPLETION_BUDGET,
    endpointFamily: STRICT_FALSE_ENDPOINT_FAMILY,
    candidateModel: STRICT_FALSE_MODEL_ID,
    messageSource: probe.messageSource,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    // Preserved verbatim and NOT interpreted here. The classifier reads it; this line reports it.
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
    // On this run above all, a provider 2xx is not the finding. Both halves, always.
    localValidationCompleted: outcome.localValidationCompleted,
    localValidationPassed: outcome.localValidationPassed,
  });
}

/** The conclusion: one closed token, with the literal observed fields beside it. */
export function emitStrictFalseDifferentialClassification(
  safe: SafeConsole,
  analysis: StrictFalseAnalysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'strict-false-differential',
    status: 'CLASSIFICATION',
    probesRun,
    baselineStructuredOutputMode: STRICT_FALSE_BASELINE_STRUCTURED_MODE,
    candidateStructuredOutputMode: STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
    baselineStrict: STRICT_FALSE_BASELINE_STRICT,
    candidateStrict: STRICT_FALSE_CANDIDATE_STRICT,
    reasoningEffort: STRICT_FALSE_REASONING_EFFORT,
    maxCompletionTokens: STRICT_FALSE_COMPLETION_BUDGET,
    endpointFamily: STRICT_FALSE_ENDPOINT_FAMILY,
    candidateModel: STRICT_FALSE_MODEL_ID,
    // What RBD1 observed under strict, so the comparison is on the line that concludes.
    baselineClassification: STRICT_FALSE_BASELINE_CLASSIFICATION,
    strictFalseClassification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
    localValidationCompleted: analysis.localValidationCompleted,
    localValidationPassed: analysis.localValidationPassed,
  });
}

/** The receipt. Names its OWN counter; states the other counters, the gap, and the usage posture. */
export function emitStrictFalseDifferentialReceipt(
  safe: SafeConsole,
  snapshot: LedgerSnapshot,
): void {
  safe.line({
    phase: 'strict-false-differential',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    strictFalseProbeRequests: snapshot.strictFalseProbeProviderRequests,
    // Stated as zero rather than omitted: this run re-sends no earlier probe, and in particular does
    // NOT replay RBD1's strict=true request.
    reasoningBudget8192ProbeRequests: snapshot.reasoningBudget8192ProbeProviderRequests,
    reasoningDifferentialProbeRequests: snapshot.reasoningDifferentialProbeProviderRequests,
    responsesDifferentialProbeRequests: snapshot.responsesDifferentialProbeProviderRequests,
    modelDifferentialProbeRequests: snapshot.modelDifferentialProbeProviderRequests,
    // What moved, and what did not.
    baselineStructuredOutputMode: STRICT_FALSE_BASELINE_STRUCTURED_MODE,
    candidateStructuredOutputMode: STRICT_FALSE_CANDIDATE_STRUCTURED_MODE,
    baselineStrict: STRICT_FALSE_BASELINE_STRICT,
    candidateStrict: STRICT_FALSE_CANDIDATE_STRICT,
    productionNonStrictFallbackMode: PRODUCTION_NON_STRICT_FALLBACK_MODE,
    reasoningEffort: STRICT_FALSE_REASONING_EFFORT,
    maxCompletionTokens: STRICT_FALSE_COMPLETION_BUDGET,
    endpointFamily: STRICT_FALSE_ENDPOINT_FAMILY,
    candidateModel: STRICT_FALSE_MODEL_ID,
    baselineClassification: STRICT_FALSE_BASELINE_CLASSIFICATION,
    // The gap an owner must not have to remember: neither prior failed probe's usage was observed,
    // and truncation was never proven at either budget.
    priorFailedProbeUsageObserved: PRIOR_FAILED_PROBE_USAGE_OBSERVED,
    priorTruncationProven: PRIOR_TRUNCATION_PROVEN,
    smokeEndpointCheckFamily: SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
    smokeProvesEndpointEntitlement: SMOKE_PROVES_STRICT_FALSE_ENTITLEMENT,
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
    costPricingPosture: STRICT_FALSE_COST_PRICING_POSTURE,
    smokePricedAtCandidateRate: STRICT_FALSE_SMOKE_PRICED_AT_CANDIDATE_RATE,
    pricingSnapshot: STRICT_FALSE_PRICING_SNAPSHOT,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
