/**
 * Content-free output for a POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named one
 * by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a model
 * answer, a raw provider body, a reasoning trace, an error message, a credential or a header.
 *
 * ### The three fields that are the point of the run
 *
 * `baselineReasoningFieldPosture` says the historical request carried NO reasoning field.
 * `baselineDocumentedDefaultEffort` says what the provider currently documents an omitted field to
 * resolve to. `candidateReasoningEffort` says what this probe sent.
 *
 * They are three fields rather than two on purpose. Collapsing the first two into
 * `baselineReasoningEffort: 'medium'` would print a wire fact nobody observed — the baseline did not
 * send `medium`, it sent nothing — and a later reader comparing receipts would have no way to tell an
 * observed field from a documented inference.
 *
 * ### Reasoning CONTENT never appears
 *
 * The adapter requests reasoning EFFORT and never reasoning capture: no `include_reasoning`, no
 * `reasoning_format`. There is correspondingly no field here that could carry a reasoning trace, a
 * chain of thought, or a token of model deliberation, and there is no reasoning-token count either —
 * the provider reports usage totals, and those are what the ledger settles.
 *
 * `localValidationCompleted` / `localValidationPassed` are emitted beside the provider fields because
 * a 2xx is not the finding: `localValidationPassed` reports the FULL production projector, and it is
 * a boolean precisely so no part of the document it judged can ride out on it.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import {
  REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT,
  REASONING_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
  REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE,
  REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
  REASONING_DIFFERENTIAL_COST_PRICING_POSTURE,
  REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
  REASONING_DIFFERENTIAL_MODEL_ID,
  REASONING_DIFFERENTIAL_PRICING_SNAPSHOT,
  REASONING_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
  SMOKE_PROVES_REASONING_DIAGNOSTIC_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
} from '../reasoning-differential-identity.js';
import { REASONING_DIFFERENTIAL_OUTPUT_BUDGET } from '../reasoning-differential-port.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';
import type {
  ReasoningDifferentialAnalysis,
  ReasoningDifferentialOutcome,
} from './reasoning-differential-classification.js';

/** The ONE probe row: what was asked, at which effort, and what came back. */
export function emitReasoningDifferentialProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: ReasoningDifferentialOutcome,
): void {
  safe.line({
    phase: 'reasoning-differential',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'OPERATIONAL',
    // HELD FIXED. Reasoning tokens are drawn from this budget, so moving it would change the very
    // quantity the effort setting competes for.
    maxCompletionTokens: REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
    // The SAME neutral messages NRA1, MD120B3 and RSP20B2 sent. Held constant on purpose.
    messageSource: probe.messageSource,
    // THE variable, stated against a baseline that carried NO reasoning field at all.
    baselineReasoningFieldPosture: REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE,
    baselineDocumentedDefaultEffort: REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT,
    candidateReasoningEffort: REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
    // The two things that did NOT move.
    endpointFamily: REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
    candidateModel: REASONING_DIFFERENTIAL_MODEL_ID,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    // Preserved verbatim and NOT interpreted here. The classifier reads it; this line reports it.
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
    // A provider 2xx is not the finding. Both halves, always.
    localValidationCompleted: outcome.localValidationCompleted,
    localValidationPassed: outcome.localValidationPassed,
  });
}

/** The conclusion: one closed token, with the literal observed fields beside it. */
export function emitReasoningDifferentialClassification(
  safe: SafeConsole,
  analysis: ReasoningDifferentialAnalysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'reasoning-differential',
    status: 'CLASSIFICATION',
    probesRun,
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
    baselineReasoningFieldPosture: REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE,
    baselineDocumentedDefaultEffort: REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT,
    candidateReasoningEffort: REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
    endpointFamily: REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
    candidateModel: REASONING_DIFFERENTIAL_MODEL_ID,
    reasoningDifferentialClassification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
    localValidationCompleted: analysis.localValidationCompleted,
    localValidationPassed: analysis.localValidationPassed,
  });
}

/** The receipt. Names its OWN counter; states the other diagnostic counters and the usage posture. */
export function emitReasoningDifferentialReceipt(
  safe: SafeConsole,
  snapshot: LedgerSnapshot,
): void {
  safe.line({
    phase: 'reasoning-differential',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    reasoningDifferentialProbeRequests: snapshot.reasoningDifferentialProbeProviderRequests,
    // Stated as zero rather than omitted: this run re-sends no earlier probe at all.
    responsesDifferentialProbeRequests: snapshot.responsesDifferentialProbeProviderRequests,
    modelDifferentialProbeRequests: snapshot.modelDifferentialProbeProviderRequests,
    neutralRepresentativeProbeRequests: snapshot.neutralRepresentativeProbeProviderRequests,
    representativeAcceptanceProbeRequests: snapshot.representativeAcceptanceProbeProviderRequests,
    // What moved, and what did not.
    baselineReasoningFieldPosture: REASONING_DIFFERENTIAL_BASELINE_FIELD_POSTURE,
    baselineDocumentedDefaultEffort: REASONING_DIFFERENTIAL_BASELINE_DOCUMENTED_DEFAULT,
    candidateReasoningEffort: REASONING_DIFFERENTIAL_CANDIDATE_EFFORT,
    endpointFamily: REASONING_DIFFERENTIAL_ENDPOINT_FAMILY,
    baselineEndpoint: REASONING_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
    candidateModel: REASONING_DIFFERENTIAL_MODEL_ID,
    maxCompletionTokens: REASONING_DIFFERENTIAL_OUTPUT_BUDGET,
    // Unlike the Responses differential, the smoke DOES cover this configuration. Recorded rather
    // than left to be inferred from the absence of a warning.
    smokeEndpointCheckFamily: SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
    smokeProvesEndpointEntitlement: SMOKE_PROVES_REASONING_DIAGNOSTIC_ENTITLEMENT,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    // WHERE those totals came from, per dimension. This lane propagates provider-reported usage, so
    // a completed probe should move these off FALLBACK_ONLY — and a bounded figure can never read as
    // a measurement either way.
    inputUsageProvenance: snapshot.inputUsageProvenance,
    outputUsageProvenance: snapshot.outputUsageProvenance,
    costPricingPosture: REASONING_DIFFERENTIAL_COST_PRICING_POSTURE,
    smokePricedAtCandidateRate: REASONING_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
    pricingSnapshot: REASONING_DIFFERENTIAL_PRICING_SNAPSHOT,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
