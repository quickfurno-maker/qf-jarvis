#!/usr/bin/env node
/**
 * The one command an owner runs (MVP-P2A.2).
 *
 * Two arguments, both explicit paths, and nothing else. There is no `--api-key`, because a key on a
 * command line is a key in shell history. There is no `--model`, `--provider` or `--prompt`, because
 * evidence is about ONE named candidate behind ONE reviewed prompt and an override would make the
 * artifact describe something nobody approved. There is no `--skip-smoke`, `--skip-safety` or
 * `--force-pass`, because a skip flag is what somebody reaches for when the gate is inconvenient,
 * which is exactly when it is doing its job.
 *
 * Unknown flags are refused rather than ignored: a typo in `--review-output` that silently fell back
 * to a default would write seventy-two client turns and seventy-two candidate replies somewhere
 * nobody chose.
 */
import { fileURLToPath } from 'node:url';

import {
  createMaskedTtyCredentialResolver,
  createNodeMaskedSecretSource,
  createSystemSmokeTimer,
  createSystemSmokeWireDeps,
  runGroqStagingSmokeOnce,
} from '@qf-jarvis/groq-staging-smoke';
import type { GroqApiKey } from '@qf-jarvis/model-gateway';
import { createFetchGroqTransport, createSystemClock } from '@qf-jarvis/model-gateway';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import {
  RIYA_SAFETY_FIXTURE_MANIFEST_ID,
  RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
  RIYA_SAFETY_SUITE_ID,
  RIYA_SAFETY_SUITE_VERSION,
} from '@qf-jarvis/riya-candidate-evaluation-runner';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from './candidate-release.js';
import { createAccountedSession } from './candidate-session.js';
import {
  createTransportBoundaryAbort,
  createTransportStartHook,
} from './cancellation-transport.js';
import { createCandidateTransportObservations } from './candidate-transport-observation.js';
import { createCandidateGateway } from './evaluation-gateway.js';
import { createOperatorLedger, createSafetyReplicationLedger } from './accounting.js';
import type { RequestLedger } from './accounting.js';
import { DEFAULT_RUN_GOAL } from './internal/run-goal.js';
import type { OperatorRunGoal } from './internal/run-goal.js';
import { OPERATOR_EXIT_CODES } from './exit-codes.js';
import { runCandidateEvidenceOperator } from './operator.js';
import { createStdoutSafeConsole } from './safe-console.js';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';

/** Two path flags and one optional governed goal. Anything else is a refusal, never a default. */
export interface CliArgs {
  readonly smokeConfig?: string;
  readonly reviewOutput?: string;
  /** Absent means FULL_EVIDENCE, so the old two-flag command behaves exactly as it did before HF3. */
  readonly runGoal?: OperatorRunGoal;
}

export type CliParse =
  | { readonly ok: true; readonly args: CliArgs }
  | {
      readonly ok: false;
      readonly reason:
        'unknown-argument' | 'missing-value' | 'invalid-run-goal' | 'duplicate-run-goal';
    };

/**
 * Parse argv. Pure, so a spec can prove the refusals without spawning a process.
 *
 * HF3 adds exactly one flag. `--run-goal SAFETY_REPLICATION` names a pre-reviewed PURPOSE, not a
 * bypass: it makes the run strictly more conservative by stopping after the safety authority. There
 * is deliberately no `--skip-p10`, `--skip-safety`, `--force`, `--max-requests`, `--max-cost`,
 * `--model`, `--provider` or `--api-key` — an operator selects a governed goal, never a bound
 * and never a verdict.
 *
 * `FULL_EVIDENCE` is refused as a VALUE even though it is a real goal, because absence already
 * means it and two spellings of one default is surface for no benefit.
 */
export function parseCliArgs(argv: readonly string[]): CliParse {
  let smokeConfig: string | undefined;
  let reviewOutput: string | undefined;
  let runGoal: OperatorRunGoal | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--run-goal') {
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, reason: 'missing-value' };
      }
      // Fail closed rather than letting the last spelling win: an ambiguous goal is precisely the
      // kind of thing that silently becomes the wrong run.
      if (runGoal !== undefined) {
        return { ok: false, reason: 'duplicate-run-goal' };
      }
      if (value !== 'SAFETY_REPLICATION') {
        return { ok: false, reason: 'invalid-run-goal' };
      }
      runGoal = 'SAFETY_REPLICATION';
      index += 1;
      continue;
    }
    if (flag === '--smoke-config' || flag === '--review-output') {
      if (value === undefined || value.startsWith('--')) {
        return { ok: false, reason: 'missing-value' };
      }
      if (flag === '--smoke-config') {
        smokeConfig = value;
      } else {
        reviewOutput = value;
      }
      index += 1;
      continue;
    }
    return { ok: false, reason: 'unknown-argument' };
  }
  return {
    ok: true,
    args: {
      ...(smokeConfig === undefined ? {} : { smokeConfig }),
      ...(reviewOutput === undefined ? {} : { reviewOutput }),
      ...(runGoal === undefined ? {} : { runGoal }),
    },
  };
}

/** The repository root, four levels up from this module. Used only to keep the bundle outside it. */
/**
 * The ledger a goal is entitled to. The owner supplies a GOAL, never a number.
 *
 * Named and exported rather than inlined because a mutation campaign found the inline form: swapping
 * the replication ledger for the full one changed nothing any test could see, since `main()` needs a
 * real terminal and a real provider to run. A bounded run whose bound is untested is not bounded.
 */
export function ledgerForRunGoal(goal: OperatorRunGoal): RequestLedger {
  return goal === 'SAFETY_REPLICATION' ? createSafetyReplicationLedger() : createOperatorLedger();
}

function repoRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

async function main(): Promise<number> {
  const safe = createStdoutSafeConsole();
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    safe.line({ phase: 'cli', status: 'FAILED', reason: parsed.reason });
    return OPERATOR_EXIT_CODES.PRECHECK_FAILED;
  }

  // DEFECT 1: the TTY fact is read from the process directly. Constructing a masked secret source
  // merely to ask `isInteractive()` would mean a secret source existed before preflight had run,
  // which is exactly the ordering this operator claims to guarantee.
  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  const runGoal = parsed.args.runGoal ?? DEFAULT_RUN_GOAL;
  const ledger = ledgerForRunGoal(runGoal);
  const result = await runCandidateEvidenceOperator({
    console: safe,
    preflight: {
      smokeConfigPath: parsed.args.smokeConfig,
      reviewOutputPath: parsed.args.reviewOutput,
      repoRoot: repoRoot(),
      interactive,
    },
    ledger,
    runGoal,
    // ONE source, created only after preflight passed, and handed straight to the smoke harness
    // below. The harness owns the TTY gate, the resolver, the single read and the single bind.
    openSmokeSecretSource: () => Promise.resolve(createNodeMaskedSecretSource()),
    // HF4-R4. The INSTRUMENTED transport and the recorder that owns its milestones, paired by the
    // smoke package itself. This call site used to pass a plain transport and no recorder, so the
    // harness built a private recorder nothing on the wire could reach — which is why RUN S5's smoke
    // PASSED while printing fetchStarted / headersReceived / responseBody* / networkElapsed as
    // ABSENT. Same request, same timer, same credential policy, same zero retries.
    runSmoke: (config, source) =>
      runGroqStagingSmokeOnce(config, {
        ...createSystemSmokeWireDeps(),
        credentialSource: source,
        clock: createSystemClock(),
        timer: createSystemSmokeTimer(),
      }),
    // DEFECT 3: through the EXISTING masked resolver, against the governed opaque reference. A bare
    // `readOnce` would bypass the resolver's bounds, charset and one-shot guarantees and become a
    // second credential policy.
    openCandidateCredential: (reference) =>
      createMaskedTtyCredentialResolver(createNodeMaskedSecretSource()).resolve(reference),
    openCandidate: (credential) => {
      const apiKey = credential as GroqApiKey;
      const clock = (): string => new Date().toISOString();

      // ONE controller. Its signal is handed to `gateway.invoke` for the cancelling turn, and the
      // instrumented transport aborts THAT controller once the request boundary is crossed — so the
      // signal the underlying transport is holding is the one that gets cancelled.
      const abort = createTransportBoundaryAbort();

      // HF4-R4. ONE recorder for the whole candidate run, shared by both gateways so a case's
      // observation is claimed by the case that made the request regardless of which transport
      // served it. It observes and delegates: the response object and any thrown error pass through
      // unchanged, so the gateway's normalization, the ledger and the safety verdict are untouched.
      const observations = createCandidateTransportObservations();

      // The observer sits OUTSIDE the abort hook, so the cancellation case records the boundary
      // crossing that the abort then interrupts — `providerTransportStarted=true` with a transport
      // throw, which is the shape a healthy cancellation has.
      const cancellationTransport = observations.observe(
        createTransportStartHook(createFetchGroqTransport(), abort.onTransportStarted),
      );

      // Same release, same config, same credential. Only the transport differs, so this is not a
      // second model, a second provider or a second credential.
      return Promise.resolve(
        createAccountedSession({
          gateway: createCandidateGateway({
            apiKey,
            transport: observations.observe(createFetchGroqTransport()),
          }),
          cancellationGateway: createCandidateGateway({ apiKey, transport: cancellationTransport }),
          cancellationController: abort.controller,
          transportStarts: abort.started,
          transportObservations: observations,
          ledger,
          clock,
        }),
      );
    },
    binding: createEvaluationBinding({
      evaluationSuiteId: RIYA_SAFETY_SUITE_ID,
      evaluationSuiteVersion: RIYA_SAFETY_SUITE_VERSION,
      fixtureManifestId: RIYA_SAFETY_FIXTURE_MANIFEST_ID,
      fixtureManifestVersion: RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
      evaluatorImplId: 'qfj.eval.deterministic',
      evaluatorImplVersion: 1,
      release: CANDIDATE_RELEASE,
      promptFamily: RIYA_CLIENT_SALES_PROMPT_ID,
      promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
      promptDigest: RIYA_CLIENT_PROMPT_DIGEST,
      capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
      knowledgeRevision: 'know.rev.synthetic.evaluation.1',
      policyContractRevision: 'policy.rev.synthetic.evaluation.1',
      createdAt: new Date().toISOString(),
    }),
    thresholds: createSuiteThresholds({
      thresholdsId: 'riya.candidate.safety.thresholds.v1',
      thresholdsVersion: 1,
    }),
    repoRoot: repoRoot(),
  });
  return OPERATOR_EXIT_CODES[result.outcome];
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    // Nothing from the original error reaches a terminal: a raw throw is the most likely way a
    // credential, a prompt or a reply ends up printed.
    createStdoutSafeConsole().line({ finalStatus: 'INTERNAL_CLOSED_FAILURE' });
    process.exitCode = OPERATOR_EXIT_CODES.INTERNAL_CLOSED_FAILURE;
  });
