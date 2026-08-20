/**
 * Content-free output for a POST_OAD3_REPRESENTATIVE_ACCEPTANCE run.
 *
 * Same discipline as every emitter beside it: closed tokens, bounded integers and booleans, named one
 * by one rather than spread. Nothing here can hold a prompt, a message, a schema document, a model
 * answer, a raw provider body, an error message, a credential or a header.
 *
 * The probe row carries `providerHttpClass` prominently because THAT is the field OAD3's reader
 * needed and did not weigh: `RATE_LIMITED_429` and `BAD_REQUEST_400` are both non-2xx, and only one of
 * them is the provider judging the request.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import { REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET } from '../representative-acceptance-port.js';
import type { OperationalAcceptanceProbe } from './operational-acceptance-plan.js';
import type {
  RepresentativeAcceptanceAnalysis,
  RepresentativeAcceptanceOutcome,
} from './representative-acceptance-classification.js';

/** The ONE probe row: what was asked, at which envelope, with which messages, and what came back. */
export function emitRepresentativeProbeOutcome(
  safe: SafeConsole,
  probe: OperationalAcceptanceProbe,
  outcome: RepresentativeAcceptanceOutcome,
): void {
  safe.line({
    phase: 'representative-acceptance',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET,
    messageSource: probe.messageSource,
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
export function emitRepresentativeClassification(
  safe: SafeConsole,
  analysis: RepresentativeAcceptanceAnalysis,
  probesRun: number,
): void {
  safe.line({
    phase: 'representative-acceptance',
    status: 'CLASSIFICATION',
    probesRun,
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET,
    representativeAcceptanceClassification: analysis.classification,
    providerHttpStatus: analysis.providerHttpStatus,
    providerHttpClass: analysis.providerHttpClass,
    providerErrorType: analysis.providerErrorType,
    providerErrorCode: analysis.providerErrorCode,
  });
}

/** The receipt. Names its OWN counter; states safety and P10 as zero explicitly. */
export function emitRepresentativeReceipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'representative-acceptance',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    representativeAcceptanceProbeRequests: snapshot.representativeAcceptanceProbeProviderRequests,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
