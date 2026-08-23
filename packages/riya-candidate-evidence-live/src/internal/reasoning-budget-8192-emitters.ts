/**
 * Content-free output for a POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named one
 * by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a model
 * answer, a raw provider body, a reasoning trace, an error message, a credential or a header.
 *
 * ### The comparison is printed, not left to be remembered
 *
 * `baselineCompletionBudget` and `candidateCompletionBudget` appear on every line, so a receipt
 * states the two numbers whose difference IS the experiment. `baselineClassification` names what
 * RLD1 observed, so a reader can see which result this run was built to follow without going and
 * finding RLD1's transcript. `reasoningEffort` is printed because it is HELD — a receipt that showed
 * only the budget would leave a reader unable to tell a budget differential from a second reasoning
 * one.
 *
 * ### The two fields that stop a hypothesis being read as a proof
 *
 * `baselineFailedProbeUsageObserved` and `baselineTruncationProven` are both `false`, and they are
 * printed rather than omitted.
 *
 * RLD1's receipt reported `inputTokensTotal=131266` / `outputTokensTotal=65593`, both `MIXED` —
 * totals that carry the ledger's fallback BOUNDS for the failed probe. Nobody has ever observed how
 * many tokens that probe actually consumed, and truncation at 4,096 was never proven. A receipt that
 * printed a budget comparison without printing that gap would invite exactly the inference this run
 * exists to test rather than assume.
 *
 * ### Reasoning CONTENT never appears
 *
 * The adapter requests reasoning EFFORT and never reasoning capture: no `include_reasoning`, no
 * `reasoning_format`. There is correspondingly no field here that could carry a reasoning trace, and
 * no reasoning-token count — the provider reports usage totals, and those are what the ledger settles.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import {
  REASONING_BUDGET_8192_BASELINE_BUDGET,
  REASONING_BUDGET_8192_BASELINE_CLASSIFICATION,
  REASONING_BUDGET_8192_CANDIDATE_BUDGET,
  REASONING_BUDGET_8192_COST_PRICING_POSTURE,
  REASONING_BUDGET_8192_ENDPOINT_FAMILY,
  REASONING_BUDGET_8192_MODEL_ID,
  REASONING_BUDGET_8192_PRICING_SNAPSHOT,
  REASONING_BUDGET_8192_REASONING_EFFORT,
  REASONING_BUDGET_8192_SMOKE_PRICED_AT_CANDIDATE_RATE,
  RLD1_FAILED_PROBE_USAGE_OBSERVED,
  RLD1_TRUNCATION_AT_BASELINE_PROVEN,
  SMOKE_PROVES_BUDGET_DIAGNOSTIC_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
} from '../reasoning-budget-8192-identity.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';
import type {
  ReasoningBudget8192Analysis,
  ReasoningBudget8192Outcome,
} from './reasoning-budget-8192-classification.js';

/** The ONE probe row: what was asked, at which budget, and what came back. */
export function emitReasoningBudget8192ProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: ReasoningBudget8192Outcome,
): void {
  safe.line({
    phase: 'reasoning-budget-8192',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'DIAGNOSTIC_WIDENED',
    // THE variable, printed beside the number it is being compared against.
    baselineCompletionBudget: REASONING_BUDGET_8192_BASELINE_BUDGET,
    candidateCompletionBudget: REASONING_BUDGET_8192_CANDIDATE_BUDGET,
    // HELD. RLD1 settled this posture; printing it keeps a budget run readable as a budget run.
    reasoningEffort: REASONING_BUDGET_8192_REASONING_EFFORT,
    // The SAME neutral messages every gate since NRA1 has sent.
    messageSource: probe.messageSource,
    // The two other things that did NOT move.
    endpointFamily: REASONING_BUDGET_8192_ENDPOINT_FAMILY,
    candidateModel: REASONING_BUDGET_8192_MODEL_ID,
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
export function emitReasoningBudget8192Classification(
  safe: SafeConsole,
  analysis: ReasoningBudget8192Analysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'reasoning-budget-8192',
    status: 'CLASSIFICATION',
    probesRun,
    completionCapClass: 'DIAGNOSTIC_WIDENED',
    baselineCompletionBudget: REASONING_BUDGET_8192_BASELINE_BUDGET,
    candidateCompletionBudget: REASONING_BUDGET_8192_CANDIDATE_BUDGET,
    reasoningEffort: REASONING_BUDGET_8192_REASONING_EFFORT,
    endpointFamily: REASONING_BUDGET_8192_ENDPOINT_FAMILY,
    candidateModel: REASONING_BUDGET_8192_MODEL_ID,
    // What RLD1 observed at the baseline budget, so the comparison is on the line that concludes.
    baselineClassification: REASONING_BUDGET_8192_BASELINE_CLASSIFICATION,
    reasoningBudget8192Classification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
    localValidationCompleted: analysis.localValidationCompleted,
    localValidationPassed: analysis.localValidationPassed,
  });
}

/** The receipt. Names its OWN counter; states the other counters, the gap, and the usage posture. */
export function emitReasoningBudget8192Receipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'reasoning-budget-8192',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    reasoningBudget8192ProbeRequests: snapshot.reasoningBudget8192ProbeProviderRequests,
    // Stated as zero rather than omitted: this run re-sends no earlier probe at all, and in
    // particular does NOT replay RLD1's 4,096 request.
    reasoningDifferentialProbeRequests: snapshot.reasoningDifferentialProbeProviderRequests,
    responsesDifferentialProbeRequests: snapshot.responsesDifferentialProbeProviderRequests,
    modelDifferentialProbeRequests: snapshot.modelDifferentialProbeProviderRequests,
    neutralRepresentativeProbeRequests: snapshot.neutralRepresentativeProbeProviderRequests,
    // What moved, and what did not.
    baselineCompletionBudget: REASONING_BUDGET_8192_BASELINE_BUDGET,
    candidateCompletionBudget: REASONING_BUDGET_8192_CANDIDATE_BUDGET,
    reasoningEffort: REASONING_BUDGET_8192_REASONING_EFFORT,
    endpointFamily: REASONING_BUDGET_8192_ENDPOINT_FAMILY,
    candidateModel: REASONING_BUDGET_8192_MODEL_ID,
    baselineClassification: REASONING_BUDGET_8192_BASELINE_CLASSIFICATION,
    // The gap an owner must not have to remember: RLD1's failed-probe usage was never observed, and
    // truncation at the baseline was never proven. Both totals in that receipt carried bounds.
    baselineFailedProbeUsageObserved: RLD1_FAILED_PROBE_USAGE_OBSERVED,
    baselineTruncationProven: RLD1_TRUNCATION_AT_BASELINE_PROVEN,
    smokeEndpointCheckFamily: SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
    smokeProvesEndpointEntitlement: SMOKE_PROVES_BUDGET_DIAGNOSTIC_ENTITLEMENT,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    // WHERE those totals came from, per dimension. A total carrying even one fallback contribution
    // can never report PROVIDER_ONLY — which is the control that makes RLD1's 65,593 readable as a
    // bound rather than as a generation length.
    inputUsageProvenance: snapshot.inputUsageProvenance,
    outputUsageProvenance: snapshot.outputUsageProvenance,
    costPricingPosture: REASONING_BUDGET_8192_COST_PRICING_POSTURE,
    smokePricedAtCandidateRate: REASONING_BUDGET_8192_SMOKE_PRICED_AT_CANDIDATE_RATE,
    pricingSnapshot: REASONING_BUDGET_8192_PRICING_SNAPSHOT,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
