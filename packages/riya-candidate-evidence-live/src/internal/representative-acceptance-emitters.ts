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
 *
 * POST-RA1 the three functions take a `phase` and, for the receipt, the counter value. Two runs share
 * this content-free discipline while remaining distinguishable on every line: RA1 emits
 * `representative-acceptance` and NRA1 emits `neutral-representative-acceptance`. Sharing the emitters
 * rather than copying them keeps one place where "what may be printed" is decided.
 */

/** Which bounded run is emitting. A closed token, printed on every line the run produces. */
export type RepresentativeEmitterPhase =
  'representative-acceptance' | 'neutral-representative-acceptance';
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import { REPRESENTATIVE_ACCEPTANCE_COMPLETION_BUDGET } from '../representative-acceptance-port.js';
import type { DiagnosticProbe } from './operational-acceptance-plan.js';
import type {
  RepresentativeAcceptanceAnalysis,
  RepresentativeAcceptanceOutcome,
} from './representative-acceptance-classification.js';

/** The ONE probe row: what was asked, at which envelope, with which messages, and what came back. */
export function emitRepresentativeProbeOutcome(
  safe: SafeConsole,
  probe: DiagnosticProbe<string>,
  outcome: RepresentativeAcceptanceOutcome,
  phase: RepresentativeEmitterPhase = 'representative-acceptance',
): void {
  safe.line({
    phase,
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
  phase: RepresentativeEmitterPhase = 'representative-acceptance',
): void {
  safe.line({
    phase,
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
export function emitRepresentativeReceipt(
  safe: SafeConsole,
  snapshot: LedgerSnapshot,
  phase: RepresentativeEmitterPhase = 'representative-acceptance',
): void {
  safe.line({
    phase,
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    // BOTH counters, always. Stating the other as zero is how a reader tells the two runs apart
    // without having to know which phase owns which counter.
    representativeAcceptanceProbeRequests: snapshot.representativeAcceptanceProbeProviderRequests,
    neutralRepresentativeProbeRequests: snapshot.neutralRepresentativeProbeProviderRequests,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    p10ProviderRequests: snapshot.p10ProviderRequests,
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    // WHERE those totals came from, per dimension. A run that mixes an observed smoke with a
    // fallback-bounded probe reports MIXED, so a bounded figure can never read as a measurement.
    inputUsageProvenance: snapshot.inputUsageProvenance,
    outputUsageProvenance: snapshot.outputUsageProvenance,
    usageBoundViolated: snapshot.usageBoundViolated,
    safetyEvaluated: false,
    reviewBundleWritten: false,
  });
}
