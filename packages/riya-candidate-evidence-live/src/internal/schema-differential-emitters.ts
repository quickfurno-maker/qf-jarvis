/**
 * Content-free output for a SCHEMA_DIFFERENTIAL_DIAGNOSTIC run (POST-PR-131).
 *
 * Every field is a closed token, a bounded integer or a boolean. There is deliberately no field here
 * that could hold a prompt, a message, a schema document, a model answer, a raw provider body, an
 * error message, a credential or a header — the same discipline HF4-R4 established for the safety
 * path, applied to a run whose whole purpose is to be pasted into a provider bug report.
 *
 * The receipt is shaped so it cannot be misread as a safety receipt OR as the historical
 * request-contract one: it names `schemaProbeProviderRequests`, states the safety and P10 counts as
 * zero explicitly rather than omitting them, and carries no verdict, case count or threshold.
 */
import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';
import { SCHEMA_PROBE_COMPLETION_CAP } from '../schema-probe-port.js';
import type { SchemaProbe } from './riya-schema-probe-matrix.js';
import type {
  SchemaDifferentialAnalysis,
  SchemaProbeOutcome,
} from './schema-differential-classification.js';

/** One probe row: what was asked, and what the boundary did. Named field by field, never spread. */
export function emitSchemaProbeOutcome(
  safe: SafeConsole,
  probe: SchemaProbe,
  outcome: SchemaProbeOutcome,
): void {
  safe.line({
    phase: 'schema-differential-diagnostic',
    status: 'PROBE',
    stepId: outcome.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    // Stated on every row, because "the cap was held fixed" is the property that makes this matrix
    // about the schema at all. A row that could not show it would be unreadable as evidence.
    completionCapClass: 'LOW_512',
    maxCompletionTokens: SCHEMA_PROBE_COMPLETION_CAP,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
  });
}

/**
 * The conclusion: one closed token, and every step id in its bucket.
 *
 * The buckets are the point. A summary alone would let a reader assume a single cause, which is the
 * precedence mistake S11 made; the three lists say exactly which probes were refused and which never
 * settled, with no ordering implied among them.
 */
export function emitSchemaDifferentialClassification(
  safe: SafeConsole,
  analysis: SchemaDifferentialAnalysis,
  probesRun: number,
): void {
  const list = (ids: readonly string[]): string => (ids.length === 0 ? 'NONE' : ids.join('+'));
  safe.line({
    phase: 'schema-differential-diagnostic',
    status: 'CLASSIFICATION',
    probesRun,
    schemaDifferentialClassification: analysis.classification,
    acceptedStepIds: list(analysis.acceptedStepIds),
    rejectedStepIds: list(analysis.rejectedStepIds),
    inconclusiveStepIds: list(analysis.inconclusiveStepIds),
  });
}

/** One verification probe row. Same closed field set, its own phase name. */
export function emitSchemaRepairProbeOutcome(
  safe: SafeConsole,
  probe: {
    readonly stepId: string;
    readonly probeKind: string;
    readonly probeDimension: string;
    readonly derivedFromPath: string;
  },
  outcome: {
    readonly providerTransportStarted: boolean;
    readonly providerHttpStatus: number;
    readonly providerHttpClass: string;
    readonly providerErrorType: string;
    readonly providerErrorCode: string;
    readonly providerCompleted: boolean;
  },
): void {
  safe.line({
    phase: 'schema-repair-verification',
    status: 'PROBE',
    stepId: probe.stepId,
    probeKind: probe.probeKind,
    probeDimension: probe.probeDimension,
    derivedFromPath: probe.derivedFromPath,
    completionCapClass: 'LOW_512',
    maxCompletionTokens: SCHEMA_PROBE_COMPLETION_CAP,
    providerTransportStarted: outcome.providerTransportStarted,
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
    providerCompleted: outcome.providerCompleted,
  });
}

/** The verification conclusion, with every step id in its bucket. */
export function emitSchemaRepairClassification(
  safe: SafeConsole,
  analysis: {
    readonly classification: string;
    readonly acceptedStepIds: readonly string[];
    readonly rejectedStepIds: readonly string[];
    readonly inconclusiveStepIds: readonly string[];
  },
  probesRun: number,
): void {
  const list = (ids: readonly string[]): string => (ids.length === 0 ? 'NONE' : ids.join('+'));
  safe.line({
    phase: 'schema-repair-verification',
    status: 'CLASSIFICATION',
    probesRun,
    schemaRepairClassification: analysis.classification,
    acceptedStepIds: list(analysis.acceptedStepIds),
    rejectedStepIds: list(analysis.rejectedStepIds),
    inconclusiveStepIds: list(analysis.inconclusiveStepIds),
  });
}

/** The verification receipt. Names its own counter; states safety and P10 as zero explicitly. */
export function emitSchemaRepairReceipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'schema-repair-verification',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    schemaRepairProbeRequests: snapshot.schemaRepairProbeProviderRequests,
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

/**
 * The receipt.
 *
 * `safetyProviderRequests` and `p10ProviderRequests` are stated as zero rather than omitted, because
 * a reader scanning for them should find the answer rather than an absence to interpret.
 */
export function emitSchemaDifferentialReceipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'schema-differential-diagnostic',
    status: 'RECEIPT',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    schemaDiagnosticRequests: snapshot.schemaProbeProviderRequests,
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
