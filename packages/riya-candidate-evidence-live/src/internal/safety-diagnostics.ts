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

import type { SafeConsole } from '../safe-console.js';

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
