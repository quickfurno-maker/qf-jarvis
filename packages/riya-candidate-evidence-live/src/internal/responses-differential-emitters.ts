/**
 * Content-free output for a POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named one
 * by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a model
 * answer, a raw provider body, a reasoning trace, an error message, a credential or a header.
 *
 * Three fields are new and all three are the point of the run. `endpointFamily` and
 * `baselineEndpoint` appear on every line so a receipt states the comparison it belongs to — MD120B3
 * was refused on Chat Completions, and a reader must never have to infer which contract produced this
 * row. `maxOutputTokens` is named for the Responses field rather than for the Chat Completions one,
 * because the whole point of §8 is that the two names must not be assumed equivalent by naming alone;
 * the VALUE is the same 4,096 and a spec asserts it on the wire.
 *
 * `localValidationCompleted` / `localValidationPassed` are emitted beside the provider fields for the
 * reason the classifier has a sixth token: on this endpoint a 2xx is not the finding. A receipt that
 * printed only the HTTP facts would let a provider acceptance read as an answer production never
 * gave. `localValidationPassed` reports the FULL production projector — not a wire-shape check — and
 * it is a boolean precisely so no part of the document it judged can ride out on it.
 *
 * `smokeEndpointCheckFamily` is printed for the opposite reason: the governed smoke runs against the
 * CHAT COMPLETIONS configuration, so a passing smoke proves the credential works there and NOT that
 * the project may call `/openai/v1/responses`. Printing the gap keeps an entitlement or beta-enrolment
 * failure from being misread as an endpoint verdict.
 *
 * The receipt also names the PRICING POSTURE and the endpoint MATURITY. This run is single-model, so
 * the production tariff is exactly right and no conservative over-estimate is needed — the opposite
 * of MD120B3, whose receipt says so in its own words. Two receipts that priced differently must be
 * able to say why. And the endpoint is beta: a receipt that did not record it could be read, later, as
 * evidence about a contract Groq had not finished shipping.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import {
  RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
  RESPONSES_DIFFERENTIAL_COST_PRICING_POSTURE,
  RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY,
  RESPONSES_DIFFERENTIAL_ENDPOINT_MATURITY,
  RESPONSES_DIFFERENTIAL_MODEL_ID,
  RESPONSES_DIFFERENTIAL_PRICING_SNAPSHOT,
  RESPONSES_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
  SMOKE_PROVES_RESPONSES_ENDPOINT_ENTITLEMENT,
  SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
} from '../responses-differential-identity.js';
import { RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET } from '../responses-differential-port.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';
import type {
  ResponsesDifferentialAnalysis,
  ResponsesDifferentialOutcome,
} from './responses-differential-classification.js';

/** The ONE probe row: what was asked, over which contract, and what came back. */
export function emitResponsesDifferentialProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: ResponsesDifferentialOutcome,
): void {
  safe.line({
    phase: 'responses-differential',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'OPERATIONAL',
    // Named for the RESPONSES field. The value is the production 4,096 and a spec pins it on the wire.
    maxOutputTokens: RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET,
    // The SAME neutral messages NRA1 and MD120B3 sent. Held constant on purpose.
    messageSource: probe.messageSource,
    // THE variable, and the contract it is being compared against.
    endpointFamily: RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY,
    baselineEndpoint: RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
    // The model that did NOT move. Read from the production candidate constant.
    candidateModel: RESPONSES_DIFFERENTIAL_MODEL_ID,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    // Preserved verbatim and NOT interpreted.
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
    // On this endpoint a provider 2xx is not the finding. Both halves, always.
    localValidationCompleted: outcome.localValidationCompleted,
    localValidationPassed: outcome.localValidationPassed,
  });
}

/** The conclusion: one closed token, with the literal observed fields beside it. */
export function emitResponsesDifferentialClassification(
  safe: SafeConsole,
  analysis: ResponsesDifferentialAnalysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'responses-differential',
    status: 'CLASSIFICATION',
    probesRun,
    completionCapClass: 'OPERATIONAL',
    maxOutputTokens: RESPONSES_DIFFERENTIAL_OUTPUT_BUDGET,
    endpointFamily: RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY,
    baselineEndpoint: RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
    candidateModel: RESPONSES_DIFFERENTIAL_MODEL_ID,
    responsesDifferentialClassification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
    localValidationCompleted: analysis.localValidationCompleted,
    localValidationPassed: analysis.localValidationPassed,
  });
}

/** The receipt. Names its OWN counter; states the other diagnostic counters and the smoke gap. */
export function emitResponsesDifferentialReceipt(
  safe: SafeConsole,
  snapshot: LedgerSnapshot,
): void {
  safe.line({
    phase: 'responses-differential',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    responsesDifferentialProbeRequests: snapshot.responsesDifferentialProbeProviderRequests,
    // Stated as zero rather than omitted: this run re-sends no earlier probe at all.
    modelDifferentialProbeRequests: snapshot.modelDifferentialProbeProviderRequests,
    neutralRepresentativeProbeRequests: snapshot.neutralRepresentativeProbeProviderRequests,
    representativeAcceptanceProbeRequests: snapshot.representativeAcceptanceProbeProviderRequests,
    endpointFamily: RESPONSES_DIFFERENTIAL_ENDPOINT_FAMILY,
    baselineEndpoint: RESPONSES_DIFFERENTIAL_BASELINE_ENDPOINT_FAMILY,
    // Groq currently ships this contract as beta. Recorded so the evidence says so on its face.
    endpointMaturity: RESPONSES_DIFFERENTIAL_ENDPOINT_MATURITY,
    candidateModel: RESPONSES_DIFFERENTIAL_MODEL_ID,
    // The gap an owner must not have to infer.
    smokeEndpointCheckFamily: SMOKE_PROVIDER_ENDPOINT_CHECK_FAMILY,
    smokeProvesEndpointEntitlement: SMOKE_PROVES_RESPONSES_ENDPOINT_ENTITLEMENT,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    // WHICH tariff produced that estimate. Both requests are the production 20B model, so the
    // production schedule is exactly right and no conservative posture is needed — the opposite of
    // MD120B3's mixed-model run, and a receipt that could not say which is which would leave the two
    // cost figures incomparable.
    costPricingPosture: RESPONSES_DIFFERENTIAL_COST_PRICING_POSTURE,
    smokePricedAtCandidateRate: RESPONSES_DIFFERENTIAL_SMOKE_PRICED_AT_CANDIDATE_RATE,
    pricingSnapshot: RESPONSES_DIFFERENTIAL_PRICING_SNAPSHOT,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
