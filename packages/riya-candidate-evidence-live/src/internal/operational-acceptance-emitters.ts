/**
 * Content-free output for a POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC run.
 *
 * Same discipline as every diagnostic emitter beside it: every field is a closed token, a bounded
 * integer or a boolean, and the properties are named one by one rather than spread, so a counter added
 * upstream cannot start printing here without someone deciding it should. Nothing here can hold a
 * prompt, a message, a schema document, a model answer, a raw provider body, an error message, a
 * credential or a header.
 *
 * Two fields are new and both are load-bearing. `completionCapClass: 'OPERATIONAL'` and the budget
 * beside it exist because every prior matrix printed `LOW_512`, and a reader comparing an OAD1 row to
 * an SRV1 row must be able to see the envelope changed. `messageSource` exists because O2 and O3 carry
 * the same schema bytes and are authored to differ there — a row that could not show which messages it
 * carried would leave the pair unreadable.
 *
 * A row states what was SENT and what came back. It draws no inference: the production body carries no
 * `temperature`, `top_p` or `seed`, so two rows are two independent generation draws and no pair of
 * them isolates a variable.
 */
import { OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET } from '../operational-acceptance-port.js';
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import type { OperationalAcceptanceProbe } from './operational-acceptance-plan.js';
import type {
  OperationalAcceptanceAnalysis,
  OperationalAcceptanceOutcome,
} from './operational-acceptance-classification.js';

/** One probe row: what was asked, at which envelope, with which messages, and what the boundary did. */
export function emitOperationalAcceptanceProbeOutcome(
  safe: SafeConsole,
  probe: OperationalAcceptanceProbe,
  outcome: OperationalAcceptanceOutcome,
): void {
  safe.line({
    phase: 'operational-acceptance-diagnostic',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    // The axis this whole run varies. NOT 'LOW_512'.
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET,
    // Which messages this probe carried. The authored axis O2 and O3 vary — not a controlled one.
    messageSource: probe.messageSource,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    // Preserved verbatim from the observer, and NOT interpreted: this says Groq returned that literal
    // code, so `400 + JSON_VALIDATE_FAILED` is distinguishable from `400 + OTHER_OR_ABSENT`. What the
    // provider did internally to produce it is undocumented and is not claimed here.
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
  });
}

/**
 * The conclusion: one closed token, every step id in its bucket, and the rejected codes.
 *
 * `rejectedErrorCodes` is printed alongside the buckets because a rejected step id alone does not say
 * WHICH literal provider code came back, and an owner deciding whether to authorize another live run
 * needs to tell one code from another without any provider content being printed. The codes are
 * reported, not interpreted.
 */
export function emitOperationalAcceptanceClassification(
  safe: SafeConsole,
  analysis: OperationalAcceptanceAnalysis,
  probesRun: number,
): void {
  const list = (ids: readonly string[]): string => (ids.length === 0 ? 'NONE' : ids.join('+'));
  safe.line({
    phase: 'operational-acceptance-diagnostic',
    status: 'CLASSIFICATION',
    probesRun,
    completionCapClass: 'OPERATIONAL',
    maxCompletionTokens: OPERATIONAL_ACCEPTANCE_COMPLETION_BUDGET,
    operationalAcceptanceClassification: analysis.classification,
    acceptedStepIds: list(analysis.acceptedStepIds),
    rejectedStepIds: list(analysis.rejectedStepIds),
    inconclusiveStepIds: list(analysis.inconclusiveStepIds),
    rejectedErrorCodes:
      analysis.rejectedErrorCodes.length === 0
        ? 'NONE'
        : analysis.rejectedErrorCodes
            .map((one) => `${one.stepId}=${one.providerErrorCode}`)
            .join('+'),
  });
}

/** The receipt. Names its OWN counter; states safety and P10 as zero explicitly rather than omitting. */
export function emitOperationalAcceptanceReceipt(
  safe: SafeConsole,
  snapshot: LedgerSnapshot,
): void {
  safe.line({
    phase: 'operational-acceptance-diagnostic',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    operationalAcceptanceProbeRequests: snapshot.operationalAcceptanceProbeProviderRequests,
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
