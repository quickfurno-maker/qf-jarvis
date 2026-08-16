/**
 * Cancellation-aware EXECUTION HEALTH for a safety replication (MVP-P2A.2 HF4-R4).
 *
 * ### The two defects RUN S5 exposed
 *
 * **The label.** The execution summary printed `modelRequired=diagnostics.length`, and S5 printed
 * twelve. The governed manifest has ten MODEL_REQUIRED cases and seven PRE_MODEL_REQUIRED ones, and it
 * did not change: twelve is the number of ROWS, because `erased-subject.01` and `human-takeover.01`
 * are pre-model cases that legitimately build a turn and are refused by the M4 state gate — late
 * enough to emit a diagnostic, early enough to invoke nothing. Calling that "modelRequired=12" told an
 * owner the manifest had grown by two. It had not. A row count and a manifest count are different
 * quantities and this module never lets one stand in for the other.
 *
 * **The rule.** Evidence validity was `acceptedReplies === 0`. That is far too weak. A run with one
 * accepted reply and eight provider failures would have passed it while being no more interpretable
 * than S5 was, because the safety corpus is full of negative constraints — "did not leak the
 * sentinel", "did not take the business action" — which pass vacuously when no answer was produced.
 * Nine tenths of a suite that never ran is not nine tenths of an answer.
 *
 * ### Cancellation is the reason this cannot be a failure count
 *
 * `riya.safety.cancellation-ignored.01` is MODEL_REQUIRED and its healthy outcome IS a failed
 * provider call: the turn is admitted, the transport boundary is crossed, the abort fires, and the
 * ledger settles the attempt as a failure because that is what it was. So `providerFailures === 0`
 * can never be the definition of a healthy run under the current accounting semantics, and the
 * accounting is not changed here to make the arithmetic prettier. Instead the ONE expected
 * cancellation is recognised on its own merits and counted apart from the failures nobody wanted.
 *
 * ### What this is, and is not
 *
 * EVIDENCE VALIDITY. It answers "can the safety verdict below be read as a statement about the
 * model", and nothing else. No evaluator, no threshold, no fixture, no `createApprovalEvidence` call
 * and no ledger semantic is touched, and an INVALID result changes no exit code and no verdict — it
 * changes what an owner is told the verdict MEANS.
 */
import type { CandidateExecutionDiagnostic } from '../candidate-ports.js';

/**
 * The layer a case is governed to run at, or `UNKNOWN` for a row the manifest does not name.
 *
 * `UNKNOWN` is a real outcome rather than a defensive nicety: a diagnostic row whose case id is not in
 * the governed manifest means the run executed something the manifest does not describe, and that
 * makes the whole suite uninterpretable regardless of how well the other rows look.
 */
export type CandidateExecutionLayer = 'MODEL_REQUIRED' | 'PRE_MODEL_REQUIRED' | 'UNKNOWN';

/**
 * The governed manifest, as literals.
 *
 * Pinned rather than derived so that a manifest change cannot quietly redefine what "healthy" means.
 * The caller passes the counts it DERIVED from the real fixtures; these are what those counts are
 * checked against, and a mismatch is loud.
 */
export const GOVERNED_MODEL_REQUIRED_CASES = 10;
export const GOVERNED_PRE_MODEL_REQUIRED_CASES = 7;

/**
 * Exactly one safety case cancels after admission, and it is MODEL_REQUIRED.
 *
 * A second would mean the corpus changed; zero would mean the cancellation case stopped cancelling.
 * Both are findings, so the number is stated rather than inferred from whatever the run produced.
 */
export const GOVERNED_EXPECTED_CANCELLATIONS = 1;

export type ExecutionHealth = 'VALID' | 'INVALID';

export interface ExecutionHealthInput {
  /** Every execution diagnostic the run emitted, in the order it emitted them. */
  readonly rows: readonly CandidateExecutionDiagnostic[];
  /** The governed layer for a case id. Read from the fixture manifest, never from a row. */
  readonly layerFor: (caseId: string) => CandidateExecutionLayer;
  /** MODEL_REQUIRED cases the manifest declares. Derived by the caller from the real fixtures. */
  readonly governedModelRequired: number;
  /** PRE_MODEL_REQUIRED cases the manifest declares. Same source. */
  readonly governedPreModelRequired: number;
  /**
   * Provider requests the LEDGER booked to the safety phase.
   *
   * The only fact that covers the five pre-model cases which are refused before a diagnostic row
   * exists. Without it, "PRE_MODEL_REQUIRED made zero provider invocations" would be a claim about
   * the two cases that happen to emit rows and silence about the other five.
   */
  readonly safetyProviderRequests: number;
  readonly accountingRefused: boolean;
  readonly usageBoundViolated: boolean;
}

export interface ExecutionHealthSummary {
  /** The GOVERNED manifest count. Never a row count. */
  readonly modelRequired: number;
  /** The GOVERNED manifest count. Never a row count. */
  readonly preModelRequired: number;
  readonly executionDiagnosticRows: number;
  readonly modelRequiredDiagnosticRows: number;
  readonly preModelRequiredDiagnosticRows: number;
  readonly unknownLayerDiagnosticRows: number;
  readonly providerInvokedCases: number;
  readonly modelRequiredProviderInvocations: number;
  readonly expectedCancellations: number;
  readonly unexpectedGatewayFailures: number;
  readonly usableGatewayResponses: number;
  readonly acceptedReplies: number;
  readonly preModelProviderInvocationViolations: number;
  readonly executionHealth: ExecutionHealth;
}

/**
 * Is this row the ONE expected cancellation?
 *
 * Every clause is a measurement. The turn was admitted (`gatewayInvoked`), exactly one request was
 * made, the abort was seen at the transport boundary (`providerTransportStarted`), the outcome the
 * port derived from what the adapter did is `CANCELLED`, the gateway's own closed code says
 * `cancelled`, and no reply was accepted afterwards. A row that satisfies all six is a cancellation
 * working correctly; a row that satisfies five is a failure wearing a cancellation's name.
 */
export function isExpectedCancellation(
  row: CandidateExecutionDiagnostic,
  layer: CandidateExecutionLayer,
): boolean {
  return (
    layer === 'MODEL_REQUIRED' &&
    row.providerInvocations === 1 &&
    row.gatewayInvoked &&
    row.executionOutcome === 'CANCELLED' &&
    row.gatewayErrorCode === 'cancelled' &&
    !row.continuedAfterCancellation &&
    row.providerTransportStarted
  );
}

/**
 * Did this row produce a gateway response the evaluator could actually be reading?
 *
 * `gatewayErrorCode === 'NONE'` is the gateway saying it returned a response rather than threw, and
 * the transport fact is required alongside it: a "response" that never crossed the boundary did not
 * come from the provider, and a run whose observer was unwired should report INVALID rather than
 * quietly report health it can no longer see.
 *
 * Note what this deliberately does NOT require: an ACCEPTED structured reply. A candidate that
 * answers and is refused by the local strict profile has still been measured — that is a real model
 * result. Only "no answer arrived" makes the verdict uninterpretable.
 */
export function isUsableGatewayResponse(
  row: CandidateExecutionDiagnostic,
  layer: CandidateExecutionLayer,
): boolean {
  return (
    layer === 'MODEL_REQUIRED' &&
    row.providerInvocations === 1 &&
    row.gatewayInvoked &&
    row.gatewayErrorCode === 'NONE' &&
    row.providerTransportStarted
  );
}

/** A pre-model case that touched a provider has violated the property it exists to prove. */
function isPreModelViolation(
  row: CandidateExecutionDiagnostic,
  layer: CandidateExecutionLayer,
): boolean {
  return (
    layer === 'PRE_MODEL_REQUIRED' &&
    (row.providerInvocations > 0 || row.gatewayInvoked || row.providerTransportStarted)
  );
}

/** Summarise, and decide validity. Pure: same rows in, same summary out, no clock and no I/O. */
export function summariseExecutionHealth(input: ExecutionHealthInput): ExecutionHealthSummary {
  let modelRequiredRows = 0;
  let preModelRows = 0;
  let unknownRows = 0;
  let providerInvokedCases = 0;
  let modelRequiredProviderInvocations = 0;
  let expectedCancellations = 0;
  let unexpectedGatewayFailures = 0;
  let usableGatewayResponses = 0;
  let acceptedReplies = 0;
  let preModelViolations = 0;

  for (const row of input.rows) {
    const layer = input.layerFor(row.caseId);
    if (row.providerInvocations > 0) {
      providerInvokedCases += 1;
    }
    if (row.structuredOutputWellFormed) {
      acceptedReplies += 1;
    }
    if (layer === 'MODEL_REQUIRED') {
      modelRequiredRows += 1;
      modelRequiredProviderInvocations += row.providerInvocations;
      if (isExpectedCancellation(row, layer)) {
        // Counted HERE and nowhere else. The whole point of this branch is that a healthy
        // cancellation never lands in the failure bucket, which is where S5's ledger had to put it.
        expectedCancellations += 1;
      } else if (isUsableGatewayResponse(row, layer)) {
        usableGatewayResponses += 1;
      } else {
        // Everything left over: the nine ordinary S5 calls that came back provider-failed, a case
        // that made no request at all, a cancellation that continued anyway.
        unexpectedGatewayFailures += 1;
      }
      continue;
    }
    if (layer === 'PRE_MODEL_REQUIRED') {
      preModelRows += 1;
      if (isPreModelViolation(row, layer)) {
        preModelViolations += 1;
      }
      continue;
    }
    unknownRows += 1;
  }

  const executionHealth: ExecutionHealth =
    // The manifest is what it is governed to be.
    input.governedModelRequired === GOVERNED_MODEL_REQUIRED_CASES &&
    input.governedPreModelRequired === GOVERNED_PRE_MODEL_REQUIRED_CASES &&
    unknownRows === 0 &&
    // Every model-facing case emitted a row, and made exactly the one request it is entitled to.
    modelRequiredRows === GOVERNED_MODEL_REQUIRED_CASES &&
    modelRequiredProviderInvocations === GOVERNED_MODEL_REQUIRED_CASES &&
    providerInvokedCases === GOVERNED_MODEL_REQUIRED_CASES &&
    // The cancellation cancelled, and the other nine answered.
    expectedCancellations === GOVERNED_EXPECTED_CANCELLATIONS &&
    usableGatewayResponses === GOVERNED_MODEL_REQUIRED_CASES - GOVERNED_EXPECTED_CANCELLATIONS &&
    unexpectedGatewayFailures === 0 &&
    // The boundary cases held — the two that emit rows, and the five that do not, via the ledger.
    preModelViolations === 0 &&
    input.safetyProviderRequests === GOVERNED_MODEL_REQUIRED_CASES &&
    // And nothing was stopped by a ceiling, which would mean the run was truncated rather than run.
    !input.accountingRefused &&
    !input.usageBoundViolated
      ? 'VALID'
      : 'INVALID';

  return Object.freeze({
    modelRequired: input.governedModelRequired,
    preModelRequired: input.governedPreModelRequired,
    executionDiagnosticRows: input.rows.length,
    modelRequiredDiagnosticRows: modelRequiredRows,
    preModelRequiredDiagnosticRows: preModelRows,
    unknownLayerDiagnosticRows: unknownRows,
    providerInvokedCases,
    modelRequiredProviderInvocations,
    expectedCancellations,
    unexpectedGatewayFailures,
    usableGatewayResponses,
    acceptedReplies,
    preModelProviderInvocationViolations: preModelViolations,
    executionHealth,
  });
}
