/**
 * The one bounded sequence an owner runs (MVP-P2A.2).
 *
 * ### The order IS the safety property
 *
 * Precheck, then a masked credential, then one smoke request, then — only if it passed — a second
 * masked credential, then safety, then P10 only if safety is eligible, then a bundle only if all 72
 * captures completed. Every arrow is a gate that can only be crossed forwards. There is no flag to
 * skip one, because a skip flag is a thing somebody uses at 2am to get a number.
 *
 * ### Two prompts, and that is the cheap option
 *
 * The smoke resolver and the candidate resolver are separate one-shot reads. Reusing the first
 * credential would mean holding it across the whole run, and persisting it anywhere would mean it
 * outlived the process. Asking twice costs an owner ten seconds and removes both.
 *
 * ### Every dependency is injected
 *
 * Not for elegance — so a spec can prove the sequence without a terminal, a key or a network. The
 * fakes count resolver constructions and provider calls, which is how "smoke failure creates no
 * candidate resolver" becomes a fact rather than a claim.
 */
import type {
  MaskedSecretSource,
  SmokeConfig,
  SmokeRunResult,
} from '@qf-jarvis/groq-staging-smoke';
import { loadSmokeConfig } from '@qf-jarvis/groq-staging-smoke';
import {
  buildRiyaQualityReviewBundle,
  captureRiyaQualityCandidates,
  runRiyaSafetyCandidate,
  writeRiyaQualityReviewBundle,
} from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { EvaluationBinding, SuiteThresholds } from '@qf-jarvis/model-evaluation';
import { createApprovalEvidence } from '@qf-jarvis/model-evaluation';

import { createOperatorLedger } from './accounting.js';
import type { RequestLedger } from './accounting.js';
import type { CandidateSession } from './candidate-session.js';
import { createQualityCandidatePort, createSafetyCandidatePort } from './candidate-ports.js';
import type { OperatorOutcome } from './exit-codes.js';
import { runPreflight } from './preflight.js';
import type { PreflightInput } from './preflight.js';
import type { SafeConsole } from './safe-console.js';

/** The notice printed between the two masked prompts. Content-free, and the only prose printed. */
export const SECOND_CREDENTIAL_NOTICE =
  'Smoke passed. Enter the same Groq credential again for the bounded candidate evidence run.';

/**
 * What the operator needs from the outside world.
 *
 * A "credential session" is a resolver that has already been constructed. The operator counts how
 * many it asks for, and a spec asserts the count — which is the only way to prove the second one is
 * never created after a failed smoke.
 */
export interface OperatorDeps {
  readonly console: SafeConsole;
  readonly preflight: PreflightInput;
  /**
   * Construct the ONE masked secret source the smoke will read from.
   *
   * Called at most once, and only after precheck passed. It returns the SOURCE rather than a resolved
   * credential because `runGroqStagingSmokeOnce` already owns the TTY gate, the resolver, the single
   * read and the single bind — handing it a different source than the one counted here would mean the
   * count described an object nobody used.
   */
  readonly openSmokeSecretSource: () => Promise<MaskedSecretSource>;
  /** Run the existing one-shot smoke against EXACTLY that source. */
  readonly runSmoke: (config: SmokeConfig, source: MaskedSecretSource) => Promise<SmokeRunResult>;
  /**
   * Resolve the candidate credential through the EXISTING masked resolver.
   *
   * Not a raw `readOnce`: the resolver owns the length and charset bounds, the one-shot guarantee and
   * the sanitized refusal codes, and reimplementing any of that here would be a second credential
   * policy. It receives the governed opaque reference from the smoke configuration — the same account
   * context the smoke just proved reachable.
   */
  readonly openCandidateCredential: (reference: { readonly ref: string }) => Promise<unknown>;
  /** Build the in-memory candidate composition. Returns per-turn deps and per-case attempt counts. */
  readonly openCandidate: (credential: unknown) => Promise<CandidateSession>;
  readonly binding: EvaluationBinding;
  readonly thresholds: SuiteThresholds;
  readonly repoRoot: string;
  readonly ledger?: RequestLedger;
}

export interface OperatorResult {
  readonly outcome: OperatorOutcome;
  readonly reviewBundlePath?: string;
  readonly reviewCaseCount?: number;
}

/**
 * Run the sequence.
 *
 * Returns a closed outcome; it never throws for a governed refusal, because a refusal is a result.
 * An unexpected throw is caught by the CLI and reported as a closed internal failure with nothing
 * from the original error.
 */
export async function runCandidateEvidenceOperator(deps: OperatorDeps): Promise<OperatorResult> {
  const ledger = deps.ledger ?? createOperatorLedger();
  const safe = deps.console;

  // A. PRECHECK — before any secret source exists.
  const precheck = runPreflight(deps.preflight);
  if (!precheck.ok) {
    safe.line({ phase: 'preflight', status: 'FAILED', reason: precheck.failure });
    return { outcome: precheck.failure === 'tty-unavailable' ? 'TTY_REQUIRED' : 'PRECHECK_FAILED' };
  }
  safe.line({ phase: 'preflight', status: 'PASS' });

  const loaded = loadSmokeConfig(deps.preflight.smokeConfigPath ?? '');
  if (!loaded.ok) {
    safe.line({ phase: 'preflight', status: 'FAILED', reason: 'smoke-config-unreadable' });
    return { outcome: 'PRECHECK_FAILED' };
  }

  // B/C. SMOKE — one credential, one request.
  if (!ledger.reserve('smoke').ok) {
    safe.line({ phase: 'smoke', status: 'REFUSED', reason: 'request-limit-reached' });
    return { outcome: 'REQUEST_LIMIT_REACHED' };
  }
  // ONE source, constructed here and handed straight to the smoke harness. Its own counters then
  // prove at most one credential read happened.
  const smokeSource = await deps.openSmokeSecretSource();
  const smoke = await deps.runSmoke(loaded.config, smokeSource);
  ledger.settle(
    smoke.ok
      ? { inputTokens: smoke.usage.inputTokens, outputTokens: smoke.usage.outputTokens }
      : undefined,
    smoke.ok,
  );
  if (!smoke.ok) {
    // STOP. No second prompt, no safety, no P10 — a candidate that cannot be reached has not been
    // measured, and every later number would be about nothing.
    safe.line({ phase: 'smoke', status: 'FAILED', reason: smoke.reason, requests: 1 });
    return { outcome: 'SMOKE_FAILED' };
  }
  safe.line({ phase: 'smoke', status: 'PASS', requests: 1 });

  // D/E. THE CANDIDATE — a fresh one-shot credential, and an in-memory composition.
  safe.notice(SECOND_CREDENTIAL_NOTICE);
  // The governed opaque reference from the approved configuration — never a key, and never a value
  // this operator invented.
  const candidateCredential = await deps.openCandidateCredential({
    ref: loaded.config.credentialReference,
  });
  let session: CandidateSession;
  try {
    session = await deps.openCandidate(candidateCredential);
  } catch {
    safe.line({ phase: 'candidate', status: 'BIND_FAILED' });
    return { outcome: 'CANDIDATE_BIND_FAILED' };
  }

  // F. SAFETY — all seventeen, at the layer each declares.
  // No reservation here. Two boundary cases legitimately BUILD a turn and are then refused by the M4
  // state gate before the invoker runs, so charging them at construction would bill a request that
  // never happened. The accounted invoker reserves at the only moment a call is certain.
  const safetyPort = createSafetyCandidatePort({
    turnDeps: session.safetyTurnDeps,
    cancellationTurnDeps: session.safetyCancellationTurnDeps,
    invocationsFor: session.invocationsFor,
    cancellationObservedFor: session.cancellationObservedFor,
  });
  const safety = await runRiyaSafetyCandidate({
    port: safetyPort,
    binding: deps.binding,
    thresholds: deps.thresholds,
  });
  // An accounting refusal is not a statement about the model. If a ceiling or a usage bound stopped
  // the run, the outcome says so rather than blaming the candidate for evidence nobody collected.
  const accountingOutcome = (): OperatorOutcome | undefined => {
    switch (session.accountingRefusal()) {
      case 'request-limit-reached':
        return 'REQUEST_LIMIT_REACHED';
      case 'cost-limit-reached':
        return 'COST_LIMIT_REACHED';
      case 'usage-bound-violated':
        // Its own outcome. The bound the reservation was derived from turned out to be wrong, which
        // is a different failure from running out of requests, and calling it either a request-limit
        // stop or a safety verdict would misdescribe it.
        return 'USAGE_BOUND_VIOLATED';
      default:
        return undefined;
    }
  };

  if (safety.status === 'BLOCKED') {
    const accounting = accountingOutcome();
    if (accounting !== undefined) {
      safe.line({ phase: 'safety', status: 'ACCOUNTING_REFUSED', reason: accounting });
      return { outcome: accounting };
    }
    for (const blocked of safety.blocked) {
      safe.line({
        phase: 'safety',
        status: 'BLOCKED',
        caseId: blocked.caseId,
        reason: blocked.reason,
      });
    }
    return { outcome: 'SAFETY_EVIDENCE_BLOCKED' };
  }
  // Eligibility is the AUTHORITY's answer, produced by its own evidence constructor. The operator
  // does not read a pass rate and decide.
  const evidence = createApprovalEvidence(safety.suiteResult, 'SHADOW_ELIGIBILITY', {
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  if (!evidence.ok) {
    safe.line({ phase: 'safety', status: 'INELIGIBLE', reason: evidence.code });
    return { outcome: 'SAFETY_INELIGIBLE' };
  }
  safe.line({
    phase: 'safety',
    status: 'ELIGIBLE',
    cases: 17,
    providerRequests: ledger.snapshot().safetyProviderRequests,
  });

  // G. P10 — only now, and all seventy-two.
  // The QUALITY accessor, so all 72 are booked to the p10 phase. A single shared accessor booked
  // them as safety, and the advertised 1 / 10 / 72 split was unreachable.
  const qualityPort = createQualityCandidatePort({
    turnDeps: session.qualityTurnDeps,
    invocationsFor: session.invocationsFor,
    admissionBlocked: (caseId) => {
      safe.line({ phase: 'p10', status: 'ADMISSION_BLOCKED', caseId });
    },
  });
  const capture = await captureRiyaQualityCandidates({ port: qualityPort });
  if (!capture.ok) {
    const accounting = accountingOutcome();
    if (accounting !== undefined) {
      safe.line({ phase: 'p10', status: 'ACCOUNTING_REFUSED', reason: accounting });
      return { outcome: accounting };
    }
    for (const incomplete of capture.incomplete) {
      safe.line({
        phase: 'p10',
        status: 'BLOCKED',
        caseId: incomplete.fixtureId,
        reason: incomplete.reason,
      });
    }
    // No partial bundle. A bundle two humans read must describe a whole run or it describes nothing.
    return { outcome: 'P10_CAPTURE_BLOCKED' };
  }
  safe.line({
    phase: 'p10',
    status: 'CAPTURE_COMPLETE',
    cases: capture.captures.length,
    providerRequests: ledger.snapshot().p10ProviderRequests,
  });

  // H. THE BLINDED BUNDLE — the one content-bearing artifact, written outside the repository.
  const bundle = buildRiyaQualityReviewBundle({ captures: capture.captures });
  let receipt;
  try {
    receipt = writeRiyaQualityReviewBundle({
      bundle,
      outputPath: deps.preflight.reviewOutputPath ?? '',
      repoRoot: deps.repoRoot,
    });
  } catch {
    safe.line({ phase: 'review', status: 'OUTPUT_REFUSED' });
    return { outcome: 'REVIEW_OUTPUT_REFUSED' };
  }

  const snapshot = ledger.snapshot();
  safe.line({ reviewBundlePath: receipt.outputPath, reviewCaseCount: receipt.caseCount });
  safe.line({
    totalProviderRequests: snapshot.totalProviderRequests,
    inputTokensTotal: snapshot.inputTokens,
    outputTokensTotal: snapshot.outputTokens,
    estimatedCostUsd: snapshot.estimatedCostUsd,
    costIsEstimated: snapshot.costIsEstimated,
    usageBoundViolated: snapshot.usageBoundViolated,
  });
  // I. STOP. Two humans have not read it yet, and nothing here may stand in for them.
  safe.line({ finalStatus: 'AWAITING_P10_HUMAN_REVIEW' });
  return {
    outcome: 'AWAITING_P10_HUMAN_REVIEW',
    reviewBundlePath: receipt.outputPath,
    reviewCaseCount: receipt.caseCount,
  };
}
