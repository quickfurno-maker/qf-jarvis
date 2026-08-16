/**
 * Content-free diagnostics for an EVALUATED-but-ineligible safety suite (MVP-P2A.2 HF2).
 *
 * ### The live run that made this necessary
 *
 * The first successful live GPT-OSS 20B run — RUN S1 — reached the governed safety authority and
 * stopped:
 *
 *     phase=preflight status=PASS
 *     phase=smoke     status=PASS requests=1
 *     phase=safety    status=INELIGIBLE reason=evidence-blocked-threshold
 *
 * That is real model-selection evidence and it stands. What failed was not the gate but the
 * reporting: `createApprovalEvidence` had already been handed a `SuiteResult` naming exactly which
 * case, in which category, breached the threshold — and the operator printed the verdict, dropped the
 * detail, and exited. The facts existed for the length of one stack frame and were then unrecoverable,
 * because the run writes no safety artifact and the process does not survive.
 *
 * So an owner learned that the candidate failed, and could not learn what it failed.
 *
 * ### Why this is observability and nothing else
 *
 * Every value printed here is already inside `SuiteResult`, already content-free, and already
 * deterministic. Nothing is recomputed, re-judged or re-derived: no fixture, no threshold, no
 * evaluator and no line of `createApprovalEvidence` is touched, and the final `INELIGIBLE` line is
 * emitted afterwards exactly as before. A reviewer comparing behaviour should find that the run stops
 * in the same place, with the same outcome, having printed more about why.
 *
 * ### What content-free means here, precisely
 *
 * `EvaluationCaseResult` carries a scenario id, a version, a closed category, a closed severity, a
 * closed outcome and a closed reason. Every one is drawn from a fixed vocabulary or is an identifier
 * chosen by the corpus. None of them is model output, synthetic user text, governed knowledge, prompt
 * bytes, a citation body, a provider response or an error string. That is why the whole record can be
 * printed rather than filtered — the filtering was done by the contract, upstream, on purpose.
 *
 * No filesystem, no network, no credential, no clock, no root export.
 */
import type { SuiteResult, SuiteThresholds } from '@qf-jarvis/model-evaluation';

import type { LedgerSnapshot } from '../accounting.js';
import type { SafeConsole } from '../safe-console.js';

import { summariseExecutionHealth } from './execution-health.js';
import type { ExecutionHealthInput } from './execution-health.js';

/**
 * Emit the aggregate, the non-PASS cases and the threshold breaches — in that order.
 *
 * Called ONLY when the suite reached `EVALUATED` and `createApprovalEvidence` then returned `!ok`. A
 * BLOCKED suite is deliberately untouched: its cases never completed, so anything printed about them
 * would describe measurements that were never made.
 */
export function emitSafetyIneligibilityDiagnostics(
  safe: SafeConsole,
  suiteResult: SuiteResult,
  thresholds: SuiteThresholds,
): void {
  // The shape of the run, first, so the lines that follow have something to be read against.
  safe.line({
    phase: 'safety',
    status: 'SUMMARY',
    pass: suiteResult.countsByOutcome.PASS,
    fail: suiteResult.countsByOutcome.FAIL,
    inconclusive: suiteResult.countsByOutcome.INCONCLUSIVE,
    notApplicable: suiteResult.countsByOutcome.NOT_APPLICABLE,
    criticalFailures: suiteResult.criticalFailures,
    blockingInconclusive: suiteResult.blockingInconclusive,
  });

  // Every case that is not a PASS, in the suite's own order. INCONCLUSIVE and NOT_APPLICABLE are
  // included as well as FAIL: an owner diagnosing a blocked threshold needs to see a case that could
  // not be judged just as much as one that was judged badly.
  for (const result of suiteResult.caseResults) {
    if (result.outcome === 'PASS') {
      continue;
    }
    safe.line({
      phase: 'safety',
      status: 'CASE',
      caseId: result.scenarioId,
      version: result.scenarioVersion,
      category: result.category,
      severity: result.severity,
      outcome: result.outcome,
      reason: result.reason,
    });
  }

  // The breaches themselves, each with the count that was measured and the ceiling it crossed. Both
  // numbers are read from the REAL objects — the tolerance comes from the thresholds the CLI actually
  // built, never from a hard-coded zero. A hard-coded zero would print the right number today, by
  // coincidence, and silently lie the first time a category is given a tolerance.
  for (const category of suiteResult.thresholdBreaches) {
    safe.line({
      phase: 'safety',
      status: 'THRESHOLD_BREACH',
      category,
      failures: suiteResult.failuresByCategory[category],
      maxAllowed: thresholds.maxFailuresByCategory[category],
    });
  }
}

/**
 * The content-free accounting receipt for a bounded SAFETY_REPLICATION run (HF3).
 *
 * A replication produces no bundle and no artifact, so the terminal IS the record. Without this an
 * owner would have to take on trust that the run stopped where it claimed to — the receipt makes the
 * split checkable: `p10ProviderRequests` is the number that proves no quality case ran, and the
 * totals are the numbers that prove nothing looped or retried.
 *
 * Every field comes from `LedgerSnapshot`, which is counters and token totals only. No reply, no
 * prompt, no case text, no credential, no error body — the ledger is deliberately the safest thing in
 * the operator to print.
 */
export function emitSafetyReplicationReceipt(safe: SafeConsole, snapshot: LedgerSnapshot): void {
  safe.line({
    phase: 'safety-replication',
    status: 'COMPLETE',
    totalProviderRequests: snapshot.totalProviderRequests,
    smokeRequests: snapshot.smokeRequests,
    safetyProviderRequests: snapshot.safetyProviderRequests,
    // Load-bearing, and expected to be 0 forever in this run goal: a non-zero value here would mean
    // the early stop failed and the ledger cap was what saved the run.
    p10ProviderRequests: snapshot.p10ProviderRequests,
    // HF4. The two counters that make the token totals interpretable. RUN S2-B reported 1,310,914
    // input and 655,442 output, which reads like real usage but is exactly ten fallback maxima plus
    // a 194/82 smoke -- i.e. NONE of the ten candidate attempts returned usable usage facts. Without
    // these counters the receipt could not distinguish "ten gateway failures" from "ten successful
    // responses that happened to omit usage", and those demand completely different diagnoses.
    successfulProviderResponses: snapshot.successfulProviderResponses,
    providerFailures: snapshot.providerFailures,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    usageBoundViolated: snapshot.usageBoundViolated,
  });
}

/**
 * The per-case EXECUTION diagnostics for a safety replication (MVP-P2A.2 HF4).
 *
 * Separate from the evaluator diagnostics on purpose. HF2 answers "what did the authority decide";
 * this answers "what did the machinery actually do", and RUN S2-B proved the second question was
 * unanswerable: fifteen PASS and two FAIL looks like a model result, but all ten MODEL_REQUIRED
 * attempts were priced from the ledger's fallback maxima, which means none of them returned usable
 * usage facts. A negative-constraint case ("did not leak X") passes vacuously when no answer was
 * produced at all, so without these lines a broken execution path reads as a passing model.
 *
 * ### HF4-R4 — rows are not the manifest, and a cancellation is not a failure
 *
 * Two corrections, both forced by RUN S5.
 *
 * The summary used to print `modelRequired=diagnostics.length`, and S5 printed twelve. Ten cases are
 * governed MODEL_REQUIRED; the other two rows are `erased-subject.01` and `human-takeover.01`, which
 * are PRE_MODEL_REQUIRED cases that legitimately build a turn and are refused by the M4 state gate
 * with zero provider invocations. The manifest did not change and this emitter no longer says it did:
 * the governed counts and the observed row counts are now separate, differently-named fields, and the
 * layer on each row is read from the FIXTURE MANIFEST rather than guessed from what the row did.
 *
 * And every row now carries what happened at the transport boundary. S5's nine ordinary failures all
 * read `gatewayErrorCode=provider-failed`, a single code that covers a rejected request, a revoked
 * key and an unentitled model alike — three findings with three different next actions, and no way to
 * tell them apart from the terminal.
 */
export function emitExecutionDiagnostics(safe: SafeConsole, input: ExecutionHealthInput): void {
  const summary = summariseExecutionHealth(input);

  for (const one of input.rows) {
    safe.line({
      phase: 'safety-execution',
      status: 'CASE',
      caseId: one.caseId,
      // From the governed manifest. A pre-model case that emitted a row is still a pre-model case,
      // and this is the field that stops it being counted as anything else.
      executionLayer: input.layerFor(one.caseId),
      providerInvocations: one.providerInvocations,
      executionOutcome: one.executionOutcome,
      gatewayInvoked: one.gatewayInvoked,
      adapterReason: one.adapterReason,
      gatewayErrorCode: one.gatewayErrorCode,
      providerTransportStarted: one.providerTransportStarted,
      providerHttpStatus: one.providerHttpStatus,
      providerHttpClass: one.providerHttpClass,
      providerErrorType: one.providerErrorType,
      providerErrorCode: one.providerErrorCode,
      structuredOutputWellFormed: one.structuredOutputWellFormed,
      structuredFieldCount: one.structuredFieldCount,
      citationCount: one.citationCount,
      knowledgeUse: one.knowledgeUse,
      claimKind: one.claimKind,
      authorityTreatment: one.authorityTreatment,
      continuedAfterCancellation: one.continuedAfterCancellation,
    });
  }

  // The aggregate an owner reads first. The first two fields are the GOVERNED manifest; every field
  // after them is a count of what this run actually emitted, and the names say which is which.
  safe.line({
    phase: 'safety-execution',
    status: 'SUMMARY',
    modelRequired: summary.modelRequired,
    preModelRequired: summary.preModelRequired,
    executionDiagnosticRows: summary.executionDiagnosticRows,
    modelRequiredDiagnosticRows: summary.modelRequiredDiagnosticRows,
    preModelRequiredDiagnosticRows: summary.preModelRequiredDiagnosticRows,
    unknownLayerDiagnosticRows: summary.unknownLayerDiagnosticRows,
    providerInvokedCases: summary.providerInvokedCases,
    expectedCancellations: summary.expectedCancellations,
    unexpectedGatewayFailures: summary.unexpectedGatewayFailures,
    usableGatewayResponses: summary.usableGatewayResponses,
    acceptedReplies: summary.acceptedReplies,
  });

  // The health verdict, cancellation-aware. `providerFailures=0` is NOT the definition of a healthy
  // run and never can be: the one governed cancellation settles as a failure in the ledger by design,
  // so it is recognised on its own terms here and counted apart from the failures nobody wanted.
  safe.line({
    phase: 'safety-execution',
    status: 'EXECUTION_HEALTH',
    expectedCancellationCount: summary.expectedCancellations,
    unexpectedGatewayFailureCount: summary.unexpectedGatewayFailures,
    usableGatewayResponseCount: summary.usableGatewayResponses,
    preModelProviderInvocationViolations: summary.preModelProviderInvocationViolations,
    modelRequiredProviderInvocations: summary.modelRequiredProviderInvocations,
    executionHealth: summary.executionHealth,
  });

  // Fail-loud, not fail-silent. This is a statement about EVIDENCE VALIDITY, not a new verdict: the
  // evaluator's result is untouched and still printed below.
  //
  // The trigger is the whole health rule now, not `acceptedReplies === 0`. That old test would have
  // passed a run with one accepted reply and eight provider failures, which is no more interpretable
  // than S5 was — a corpus of negative constraints passes vacuously when no answer arrives.
  if (summary.executionHealth === 'INVALID' && input.rows.length > 0) {
    safe.line({
      phase: 'safety-execution',
      status: 'EVIDENCE_VALIDITY',
      note: 'SAFETY_VERDICT_NOT_INTERPRETABLE_AS_MODEL_QUALITY_WITHOUT_EXECUTION_HEALTH',
    });
  }
}
