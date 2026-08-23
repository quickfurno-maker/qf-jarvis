/**
 * Content-free output for a REQUEST_CONTRACT_DIAGNOSTIC run (MVP-P2A.2 HF4-R8).
 *
 * Every field is a closed token, a bounded integer or a boolean. There is deliberately no field here
 * that could hold a prompt, a message, a schema document, a model answer, a raw provider body, an
 * error message, a `failed_generation`, a credential or a header — the same discipline HF4-R4
 * established for the safety path, applied to a run whose whole purpose is to be pasted into a bug
 * report.
 *
 * The receipt is deliberately shaped so it CANNOT be misread as a safety receipt: it names
 * `diagnosticProviderRequests`, states `safetyProviderRequests=0` and `p10ProviderRequests=0`
 * explicitly rather than omitting them, and carries no verdict, no case count and no threshold.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { DiagnosticCanary } from '../diagnostic-canaries.js';
import type { SafeConsole } from '../safe-console.js';
import type { CanaryOutcome, DiagnosticAnalysis } from './diagnostic-classification.js';

/** One canary row: what was asked, and what the boundary did. Named field by field, never spread. */
export function emitCanaryOutcome(
  safe: SafeConsole,
  canary: DiagnosticCanary,
  outcome: CanaryOutcome,
): void {
  safe.line({
    phase: 'request-contract-diagnostic',
    status: 'CANARY',
    canaryId: outcome.canaryId,
    requestClass: canary.requestClass,
    completionCapClass: canary.completionCapClass,
    maxCompletionTokens: canary.maxCompletionTokens,
    schemaSource: canary.schemaSource,
    messageSource: canary.messageSource,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
    localValidationAccepted: outcome.localValidationAccepted ?? 'NOT_APPLICABLE',
  });
}

/**
 * The differential conclusion: one closed token, the findings behind it, and the count.
 *
 * POST-S11 adds `diagnosticFindings`. `MIXED_OR_INCONCLUSIVE` is honest but says nothing about WHICH
 * findings collided, and S11 is exactly the matrix where that matters — completion-cap sensitivity
 * and an independent real-schema rejection are two pieces of work, not one. Every entry is a member
 * of the same closed vocabulary as the classification, so this carries no content.
 */
export function emitDiagnosticClassification(
  safe: SafeConsole,
  analysis: DiagnosticAnalysis,
  canariesRun: number,
): void {
  safe.line({
    phase: 'request-contract-diagnostic',
    status: 'CLASSIFICATION',
    canariesRun,
    diagnosticClassification: analysis.classification,
    diagnosticFindings: analysis.findings.length === 0 ? 'NONE' : analysis.findings.join('+'),
  });
}

/**
 * The diagnostic receipt.
 *
 * `safetyProviderRequests` and `p10ProviderRequests` are stated as zero rather than omitted, because
 * a reader scanning for them should find the answer rather than an absence they have to interpret.
 */
export function emitDiagnosticReceipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'request-contract-diagnostic',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    diagnosticProviderRequests: snapshot.diagnosticProviderRequests,
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
