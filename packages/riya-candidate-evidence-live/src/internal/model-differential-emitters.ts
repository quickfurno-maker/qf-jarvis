/**
 * Content-free output for a POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named one
 * by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a model
 * answer, a raw provider body, an error message, a credential or a header.
 *
 * Two fields are new and both are the point of the run. `candidateModel` and `baselineModel` appear on
 * every line so a receipt states the comparison it belongs to — NRA1 refused on the baseline, and a
 * reader must never have to infer which model produced this row.
 *
 * `smokeCredentialCheckModel` is printed on the receipt for the opposite reason: the governed smoke
 * runs against the baseline configuration, so a passing smoke proves the credential works and NOT that
 * the account may call the differential model. Printing the gap keeps an entitlement failure from
 * being misread as a model verdict.
 *
 * The receipt also names the PRICING POSTURE. This run is mixed — a baseline smoke and a differential
 * candidate — while the ledger carries one schedule, so it is priced entirely at the higher tariff.
 * That over-estimates the smoke on purpose, and a cost figure whose schedule was invisible would be a
 * number nobody could check.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import {
  MODEL_DIFFERENTIAL_BASELINE_MODEL_ID,
  MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
  MODEL_DIFFERENTIAL_COST_PRICING_POSTURE,
  MODEL_DIFFERENTIAL_PRICING_SNAPSHOT,
  MODEL_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
  SMOKE_PROVES_DIFFERENTIAL_MODEL_ENTITLEMENT,
  SMOKE_PROVIDER_CREDENTIAL_CHECK_MODEL,
} from '../model-differential-identity.js';
import { MODEL_DIFFERENTIAL_COMPLETION_BUDGET } from '../model-differential-port.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';
import type {
  ModelDifferentialAnalysis,
  ModelDifferentialOutcome,
} from './model-differential-classification.js';

/** The ONE probe row: what was asked, of which model, and what came back. */
export function emitModelDifferentialProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: ModelDifferentialOutcome,
): void {
  safe.line({
    phase: 'model-differential',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: MODEL_DIFFERENTIAL_COMPLETION_BUDGET,
    // The SAME neutral messages NRA1 sent. The message source is held constant on purpose.
    messageSource: probe.messageSource,
    // THE variable, and the model it is being compared against.
    candidateModel: MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
    baselineModel: MODEL_DIFFERENTIAL_BASELINE_MODEL_ID,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    // Preserved verbatim and NOT interpreted.
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
  });
}

/** The conclusion: one closed token, with the literal observed fields beside it. */
export function emitModelDifferentialClassification(
  safe: SafeConsole,
  analysis: ModelDifferentialAnalysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'model-differential',
    status: 'CLASSIFICATION',
    probesRun,
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: MODEL_DIFFERENTIAL_COMPLETION_BUDGET,
    candidateModel: MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
    baselineModel: MODEL_DIFFERENTIAL_BASELINE_MODEL_ID,
    modelDifferentialClassification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
  });
}

/** The receipt. Names its OWN counter; states the other diagnostic counters and the smoke gap. */
export function emitModelDifferentialReceipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'model-differential',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    modelDifferentialProbeRequests: snapshot.modelDifferentialProbeProviderRequests,
    // Stated as zero rather than omitted: this run sends no baseline candidate request at all.
    neutralRepresentativeProbeRequests: snapshot.neutralRepresentativeProbeProviderRequests,
    representativeAcceptanceProbeRequests: snapshot.representativeAcceptanceProbeProviderRequests,
    candidateModel: MODEL_DIFFERENTIAL_CANDIDATE_MODEL_ID,
    baselineModel: MODEL_DIFFERENTIAL_BASELINE_MODEL_ID,
    // The gap an owner must not have to infer.
    smokeCredentialCheckModel: SMOKE_PROVIDER_CREDENTIAL_CHECK_MODEL,
    smokeProvesCandidateModelEntitlement: SMOKE_PROVES_DIFFERENTIAL_MODEL_ENTITLEMENT,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    // WHICH tariff produced that estimate, and on what terms. The run is mixed — a 20B smoke and a
    // 120B candidate — against a ledger that carries one schedule, so the whole run is priced at the
    // higher rate. Printing the posture keeps the over-estimate a stated decision rather than a
    // number an owner has to reverse-engineer.
    costPricingPosture: MODEL_DIFFERENTIAL_COST_PRICING_POSTURE,
    smokePricedAtCandidateRate: MODEL_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
    pricingSnapshot: MODEL_DIFFERENTIAL_PRICING_SNAPSHOT,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
