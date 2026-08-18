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
  SmokeConfig,
  SmokeCredentialDeps,
  SmokeRunResult,
} from '@qf-jarvis/groq-staging-smoke';
import { loadSmokeConfig } from '@qf-jarvis/groq-staging-smoke';
import {
  buildRiyaQualityReviewBundle,
  captureRiyaQualityCandidates,
  RIYA_SAFETY_FIXTURES,
  runRiyaSafetyCandidate,
  writeRiyaQualityReviewBundle,
} from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { EvaluationBinding, SuiteThresholds } from '@qf-jarvis/model-evaluation';
import { createApprovalEvidence } from '@qf-jarvis/model-evaluation';

import { createOperatorLedger } from './accounting.js';
import type { RequestLedger } from './accounting.js';
import type { ClipboardIngressCounters } from './credential-composition.js';
import type { DiagnosticCanary } from './diagnostic-canaries.js';
import { DIAGNOSTIC_CANARIES } from './diagnostic-canaries.js';
import type { CanaryOutcome } from './internal/diagnostic-classification.js';
import { analyseDiagnosticCanaries } from './internal/diagnostic-classification.js';
import {
  emitCanaryOutcome,
  emitDiagnosticClassification,
  emitDiagnosticReceipt,
} from './internal/diagnostic-emitters.js';
import { DEFAULT_CREDENTIAL_SOURCE_MODE } from './credential-source.js';
import type { CredentialSourceMode } from './credential-source.js';
import type { CandidateSession } from './candidate-session.js';
import { createQualityCandidatePort, createSafetyCandidatePort } from './candidate-ports.js';
import type { CandidateExecutionDiagnostic } from './candidate-ports.js';
import type { OperatorOutcome } from './exit-codes.js';
import type { CandidateExecutionLayer, ExecutionHealthInput } from './internal/execution-health.js';
import {
  DEFAULT_RUN_GOAL,
  REUSED_CREDENTIAL_NOTICES,
  SECOND_CREDENTIAL_NOTICES,
} from './internal/run-goal.js';
import type { OperatorRunGoal } from './internal/run-goal.js';
import {
  emitExecutionDiagnostics,
  emitSafetyIneligibilityDiagnostics,
  emitSafetyReplicationReceipt,
} from './internal/safety-diagnostics.js';
import { emitSmokeExecutionDiagnostics } from './internal/smoke-diagnostics.js';
import { runPreflight } from './preflight.js';
import type { PreflightInput } from './preflight.js';
import type { SafeConsole } from './safe-console.js';

/**
 * The notice printed between the two masked prompts on a FULL_EVIDENCE run.
 *
 * Kept as a root export with its exact original wording — it is pinned by a spec and by the package
 * surface lock. HF3 derives it from the per-goal table rather than restating the string, so the two
 * cannot drift apart and quietly disagree about what an owner is being asked to fund.
 */
export const SECOND_CREDENTIAL_NOTICE = SECOND_CREDENTIAL_NOTICES.FULL_EVIDENCE;

/**
 * The GOVERNED layer of every safety case, read from the fixture manifest (HF4-R4).
 *
 * Built here rather than in the port on purpose. The port reports what a run observably DID and is
 * deliberately blind to what a fixture expects — a port that could read its own declared layer could
 * satisfy the bridge's layer check by construction. Labelling a printed row is a different job: the
 * label IS the manifest's claim, and reading it from anywhere else would be inventing one.
 *
 * Derived from the real fixtures, never a literal table. If the manifest gains or loses a case this
 * moves with it, and the health rule — which pins 10 / 7 — is what turns that into a loud failure.
 */
const SAFETY_EXECUTION_LAYERS: ReadonlyMap<string, CandidateExecutionLayer> = new Map(
  RIYA_SAFETY_FIXTURES.map((fixture) => [fixture.request.caseId, fixture.executionExpectation]),
);

/** A case the manifest does not name is `UNKNOWN`, which the health rule treats as disqualifying. */
function safetyLayerFor(caseId: string): CandidateExecutionLayer {
  return SAFETY_EXECUTION_LAYERS.get(caseId) ?? 'UNKNOWN';
}

const GOVERNED_MODEL_REQUIRED = RIYA_SAFETY_FIXTURES.filter(
  (fixture) => fixture.executionExpectation === 'MODEL_REQUIRED',
).length;

const GOVERNED_PRE_MODEL_REQUIRED = RIYA_SAFETY_FIXTURES.filter(
  (fixture) => fixture.executionExpectation === 'PRE_MODEL_REQUIRED',
).length;

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
   * Open the ONE credential ingress the smoke will use.
   *
   * Called at most once, and only after precheck passed. It returns the credential SLICE of the smoke
   * dependencies rather than a resolved credential, because `runGroqStagingSmokeOnce` already owns the
   * gate, the single bind and the milestone stamping — handing it a different ingress than the one
   * counted here would mean the count described an object nobody used.
   *
   * HF4-R5 widened this from "the masked secret source" to "whichever governed ingress was selected".
   * The operator deliberately cannot tell which one it received: it forwards the slice untouched, so
   * no branch here can weaken a gate that belongs to the ingress.
   */
  readonly openSmokeCredential: () => Promise<SmokeCredentialDeps>;
  /** Run the existing one-shot smoke against EXACTLY that ingress. */
  readonly runSmoke: (
    config: SmokeConfig,
    credential: SmokeCredentialDeps,
  ) => Promise<SmokeRunResult>;
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
  /**
   * What this run is FOR. Absent means `FULL_EVIDENCE`, so every pre-HF3 caller is unchanged.
   *
   * The only alternative is strictly more conservative: it stops after the safety authority and can
   * reach no quality case, no bundle and no ceiling wider than its own.
   */
  readonly runGoal?: OperatorRunGoal;
  /**
   * HF4-R5. Which credential ingress this run selected. Absent means `tty`.
   *
   * Used for exactly two things, both of them output: choosing between the "enter it again" and the
   * "reusing what was already read" notice, and labelling the ingress line. It selects no behaviour —
   * the ingress itself is whatever `openSmokeCredential` returns, so a wrong value here cannot make a
   * clipboard run behave like a TTY run or the reverse.
   */
  readonly credentialSource?: CredentialSourceMode;
  /** Content-free ingress counters, when the selected ingress has any. Numbers and booleans only. */
  readonly ingressCounters?: () => ClipboardIngressCounters | undefined;
  /**
   * HF4-R8-R1. Bind the request-contract canary runner to the ALREADY-RESOLVED candidate credential.
   *
   * A credential-bound FACTORY rather than a ready-made runner, and the shape is load-bearing. R8's
   * seam was supplied at composition time — before the credential existed — so the only way `bin.ts`
   * could have satisfied it was to hold a second ingress or a mutable slot. It held neither, and the
   * real CLI therefore reached the diagnostic branch with no port at all: preflight, smoke and the
   * candidate credential all spent, zero canaries run, `INTERNAL_CLOSED_FAILURE` returned. A future
   * authorized run is consumed at process launch, so that composition would have burned it.
   *
   * Called at most ONCE, and only after `openCandidateCredential` returned. It receives that exact
   * credential object, so no second holder can exist. Required only for
   * `REQUEST_CONTRACT_DIAGNOSTIC`; every other goal never reaches it, and a spec asserts that.
   *
   * The runner it returns receives the canary CONTRACT rather than a built request, so the port owns
   * the projection and the strict check and the operator cannot smuggle a shape past them.
   */
  readonly openDiagnosticCanaryRunner?: (
    credential: unknown,
  ) => Promise<(canary: DiagnosticCanary) => Promise<CanaryOutcome>>;
}

export interface OperatorResult {
  readonly outcome: OperatorOutcome;
  readonly reviewBundlePath?: string;
  readonly reviewCaseCount?: number;
}

/**
 * Emit the content-free credential-ingress line (HF4-R5).
 *
 * Every field is a closed mode, a small count, or a boolean. There is deliberately no field here that
 * could hold a credential, a prefix, a suffix, a length, a hash, a fingerprint, a clipboard string, or
 * a helper's output — a credential LENGTH is omitted on purpose, because it narrows the value and buys
 * an owner nothing they cannot get from `credentialOutcome`.
 *
 * The properties are named one by one rather than spread, so a counter added upstream cannot start
 * printing here without someone deciding it should.
 */
function emitCredentialIngress(
  safe: SafeConsole,
  mode: CredentialSourceMode,
  phase: 'SMOKE' | 'CANDIDATE',
  counters: ClipboardIngressCounters | undefined,
): void {
  if (counters === undefined) {
    // An ingress with no counters of its own — the masked terminal. The mode is still worth stating:
    // it is how a receipt says which door the credential came through.
    safe.line({ phase: 'credential-ingress', status: phase, credentialSource: mode });
    return;
  }
  safe.line({
    phase: 'credential-ingress',
    status: phase,
    credentialSource: mode,
    credentialClipboardReadAttempts: counters.credentialClipboardReadAttempts,
    credentialClipboardReads: counters.credentialClipboardReads,
    credentialClipboardCleared: counters.credentialClipboardCleared,
    credentialHolderCreations: counters.credentialHolderCreations,
    credentialReuseCount: counters.credentialReuseCount,
  });
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
  // Resolved once. Absence is FULL_EVIDENCE, which is what keeps every existing call site identical.
  const runGoal = deps.runGoal ?? DEFAULT_RUN_GOAL;
  // Same rule, same reason: absence is the masked terminal, so a pre-HF4-R5 caller is unchanged.
  const credentialSource = deps.credentialSource ?? DEFAULT_CREDENTIAL_SOURCE_MODE;

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
  // ONE ingress, opened here and handed straight to the smoke harness. Its own counters then prove at
  // most one credential read happened.
  const smokeCredential = await deps.openSmokeCredential();
  const smoke = await deps.runSmoke(loaded.config, smokeCredential);
  ledger.settle(
    smoke.ok
      ? { inputTokens: smoke.usage.inputTokens, outputTokens: smoke.usage.outputTokens }
      : undefined,
    smoke.ok,
  );
  // HF4-R2. The smoke harness has always recorded WHERE its budget went — milestone timestamps, a
  // frozen timeout phase, a normalized transport class, the credential-ingress branch — and this
  // operator threw all of it away and printed the collapsed reason. RUN S3 spent its one-process
  // authorization on `reason=smoke-timeout` and left nobody able to say whether the time went into
  // credential entry, the request, or the response.
  //
  // Emitted BEFORE the authoritative status line, and for BOTH outcomes: a healthy run is the only
  // reference timing that makes a later failure legible.
  emitSmokeExecutionDiagnostics(safe, smoke);
  // HF4-R5. What the ingress DID, for both outcomes. Emitted after the smoke diagnostics and before
  // the authoritative status line, so a failed smoke still reports whether the clipboard was read and
  // — the field an owner actually needs after a failure — whether it was cleared.
  emitCredentialIngress(safe, credentialSource, 'SMOKE', deps.ingressCounters?.());
  if (!smoke.ok) {
    // STOP. No second prompt, no safety, no P10 — a candidate that cannot be reached has not been
    // measured, and every later number would be about nothing.
    safe.line({ phase: 'smoke', status: 'FAILED', reason: smoke.reason, requests: 1 });
    return { outcome: 'SMOKE_FAILED' };
  }
  safe.line({ phase: 'smoke', status: 'PASS', requests: 1 });

  // D/E. THE CANDIDATE — a fresh one-shot credential, and an in-memory composition.
  // Per goal: telling an owner they are funding "the bounded candidate evidence run" when the run
  // will stop after safety and write nothing would be a small lie at the moment they type a key.
  safe.notice(
    credentialSource === 'clipboard'
      ? REUSED_CREDENTIAL_NOTICES[runGoal]
      : SECOND_CREDENTIAL_NOTICES[runGoal],
  );
  // The governed opaque reference from the approved configuration — never a key, and never a value
  // this operator invented.
  const candidateCredential = await deps.openCandidateCredential({
    ref: loaded.config.credentialReference,
  });
  // The second ingress line. In clipboard mode this is where `credentialReuseCount` becomes 2 while
  // `credentialClipboardReads` stays 1 — the pair of numbers that IS the copy-once guarantee.
  emitCredentialIngress(safe, credentialSource, 'CANDIDATE', deps.ingressCounters?.());

  // F'. THE REQUEST-CONTRACT DIAGNOSTIC (HF4-R8, rewired HF4-R8-R1) — and then STOP.
  //
  // Placed BEFORE `openCandidate`, not merely before the safety port. R8 put it after, which meant a
  // diagnostic run constructed the ordinary candidate session — two gateways, a cancellation
  // controller, a second transport observer — and immediately discarded all of it. Nothing measured
  // it and nothing used it, but it existed, and a run that evaluates nothing should not build the
  // machinery for evaluating something. Now the only composition a diagnostic creates is the canary
  // runner, bound to the credential resolved immediately above.
  //
  // It reaches no fixture, no evaluator, no authority, no P10 and no bundle: it asks the provider
  // whether it accepts a request, eight times, varying one axis at a time. S9 and S10 each spent a
  // live authorization proving only that something was rejected; this is the run that can say WHAT.
  if (runGoal === 'REQUEST_CONTRACT_DIAGNOSTIC') {
    const openRunner = deps.openDiagnosticCanaryRunner;
    if (openRunner === undefined) {
      // A diagnostic goal with no canary port is a composition bug, not an operator error.
      safe.line({ phase: 'request-contract-diagnostic', status: 'FAILED', reason: 'port-missing' });
      return { outcome: 'INTERNAL_CLOSED_FAILURE' };
    }
    let runCanary: (canary: DiagnosticCanary) => Promise<CanaryOutcome>;
    try {
      runCanary = await openRunner(candidateCredential);
    } catch {
      // Fails closed BEFORE D1, and nothing from the original error is read or printed. A runner
      // that could not be built is a local composition failure — a credential that did not narrow, a
      // production request that could not be assembled — never a statement about the provider.
      safe.line({
        phase: 'request-contract-diagnostic',
        status: 'FAILED',
        reason: 'runner-bind-failed',
      });
      return { outcome: 'INTERNAL_CLOSED_FAILURE' };
    }
    const outcomes: CanaryOutcome[] = [];
    for (const canary of DIAGNOSTIC_CANARIES) {
      // Reserved against the diagnostic ledger's own ceiling, immediately before the call, exactly as
      // every other provider request in this operator is.
      const reservation = ledger.reserve('diagnostic');
      if (!reservation.ok) {
        safe.line({
          phase: 'request-contract-diagnostic',
          status: 'REFUSED',
          canaryId: canary.canaryId,
          reason: reservation.refusal,
        });
        break;
      }
      const outcome = await runCanary(canary);
      ledger.settle(undefined, outcome.providerCompleted);
      outcomes.push(outcome);
      emitCanaryOutcome(safe, canary, outcome);
    }
    // A pure function over closed tokens. An incomplete matrix classifies as DIAGNOSTIC_NOT_RUN
    // rather than as a partial verdict, and a matrix carrying two findings reports both rather than
    // letting one precedence rule speak for the whole thing.
    emitDiagnosticClassification(safe, analyseDiagnosticCanaries(outcomes), outcomes.length);
    emitDiagnosticReceipt(safe, ledger.snapshot());
    safe.line({ finalStatus: 'REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE' });
    return { outcome: 'REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE' };
  }

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
  // HF4: collected during execution, printed after the suite completes. Collecting rather than
  // printing inline keeps the ordering deterministic and keeps execution facts out of the middle of
  // the evaluator's own output.
  const executionDiagnostics: CandidateExecutionDiagnostic[] = [];
  const safetyPort = createSafetyCandidatePort({
    turnDeps: session.safetyTurnDeps,
    cancellationTurnDeps: session.safetyCancellationTurnDeps,
    invocationsFor: session.invocationsFor,
    cancellationObservedFor: session.cancellationObservedFor,
    gatewayErrorFor: session.gatewayErrorFor,
    transportObservationFor: session.transportObservationFor,
    onExecutionDiagnostic: (diagnostic) => executionDiagnostics.push(diagnostic),
  });
  const safety = await runRiyaSafetyCandidate({
    port: safetyPort,
    binding: deps.binding,
    thresholds: deps.thresholds,
  });
  // HF4-R4. Everything the health rule needs, assembled where all of it is in scope. The governed
  // counts come from the manifest, the ledger supplies the fact that covers the five pre-model cases
  // which never emit a row, and the refusal flags say whether the run was truncated rather than run.
  const executionHealthInput = (): ExecutionHealthInput => ({
    rows: executionDiagnostics,
    layerFor: safetyLayerFor,
    governedModelRequired: GOVERNED_MODEL_REQUIRED,
    governedPreModelRequired: GOVERNED_PRE_MODEL_REQUIRED,
    safetyProviderRequests: ledger.snapshot().safetyProviderRequests,
    accountingRefused: session.accountingRefusal() !== undefined,
    usageBoundViolated: ledger.snapshot().usageBoundViolated,
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
    if (runGoal === 'SAFETY_REPLICATION') {
      emitSafetyReplicationReceipt(safe, ledger.snapshot());
    }
    // The verdict is unchanged: a BLOCKED suite is not eligible, not ineligible, and never becomes a
    // replication "result". No P10 either way.
    return { outcome: 'SAFETY_EVIDENCE_BLOCKED' };
  }
  // Eligibility is the AUTHORITY's answer, produced by its own evidence constructor. The operator
  // does not read a pass rate and decide.
  const evidence = createApprovalEvidence(safety.suiteResult, 'SHADOW_ELIGIBILITY', {
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  if (!evidence.ok) {
    // HF2. The suite is EVALUATED here -- every case completed and was judged -- so the SuiteResult
    // already names which case, in which category, breached which ceiling. RUN S1 printed only the
    // verdict and exited, and those facts died with the process: the run writes no safety artifact,
    // so there was nothing left to read. The detail is emitted BEFORE the verdict; the verdict line
    // below is unchanged, and so is the outcome.
    // HF4 ordering: what the machinery DID, then what the authority DECIDED, then the receipt, then
    // the verdict. Execution facts come first because they determine whether the verdict below is
    // interpretable as model quality at all.
    emitExecutionDiagnostics(safe, executionHealthInput());
    emitSafetyIneligibilityDiagnostics(safe, safety.suiteResult, deps.thresholds);
    // HF3 receipt goes BEFORE the verdict so the authoritative INELIGIBLE line remains the last
    // safety line and remains byte-for-byte what it was. The outcome is unchanged too: safety
    // semantics did not move, so inventing a second eligibility decision would be the mistake.
    if (runGoal === 'SAFETY_REPLICATION') {
      emitSafetyReplicationReceipt(safe, ledger.snapshot());
    }
    safe.line({ phase: 'safety', status: 'INELIGIBLE', reason: evidence.code });
    return { outcome: 'SAFETY_INELIGIBLE' };
  }
  safe.line({
    phase: 'safety',
    status: 'ELIGIBLE',
    cases: 17,
    providerRequests: ledger.snapshot().safetyProviderRequests,
  });

  // HF3. A SAFETY_REPLICATION stops HERE, and an ELIGIBLE result is exactly the case that makes the
  // stop necessary rather than optional. RUN S1 was INELIGIBLE; the governed reading of an
  // S1-INELIGIBLE / S2-ELIGIBLE disagreement is run-to-run variability that an OWNER interprets. If
  // this run continued, it would spend 72 provider calls and write a bundle before that
  // interpretation happened — deciding by default the one question the replication exists to ask.
  //
  // The return is placed before the quality port is CONSTRUCTED, not merely before it is used, so
  // there is no window in which a P10 seam exists in this run at all.
  if (runGoal === 'SAFETY_REPLICATION') {
    emitExecutionDiagnostics(safe, executionHealthInput());
    emitSafetyReplicationReceipt(safe, ledger.snapshot());
    safe.line({ finalStatus: 'SAFETY_REPLICATION_COMPLETE' });
    return { outcome: 'SAFETY_REPLICATION_COMPLETE' };
  }

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
