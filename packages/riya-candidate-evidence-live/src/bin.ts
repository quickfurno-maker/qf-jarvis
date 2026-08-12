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
import { createCandidateGateway } from './evaluation-gateway.js';
import { createOperatorLedger } from './accounting.js';
import { OPERATOR_EXIT_CODES } from './exit-codes.js';
import { runCandidateEvidenceOperator } from './operator.js';
import { createStdoutSafeConsole } from './safe-console.js';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';

/** The only two flags. Anything else is a refusal, never a default. */
export interface CliArgs {
  readonly smokeConfig?: string;
  readonly reviewOutput?: string;
}

export type CliParse =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly reason: 'unknown-argument' | 'missing-value' };

/** Parse argv. Pure, so a spec can prove the refusals without spawning a process. */
export function parseCliArgs(argv: readonly string[]): CliParse {
  let smokeConfig: string | undefined;
  let reviewOutput: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
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
    },
  };
}

/** The repository root, four levels up from this module. Used only to keep the bundle outside it. */
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

  const ledger = createOperatorLedger();
  const result = await runCandidateEvidenceOperator({
    console: safe,
    preflight: {
      smokeConfigPath: parsed.args.smokeConfig,
      reviewOutputPath: parsed.args.reviewOutput,
      repoRoot: repoRoot(),
      interactive,
    },
    ledger,
    // ONE source, created only after preflight passed, and handed straight to the smoke harness
    // below. The harness owns the TTY gate, the resolver, the single read and the single bind.
    openSmokeSecretSource: () => Promise.resolve(createNodeMaskedSecretSource()),
    runSmoke: (config, source) =>
      runGroqStagingSmokeOnce(config, {
        transport: createFetchGroqTransport(),
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

      // DEFECT 7: the cancellation case gets a gateway whose TRANSPORT is instrumented. Same release,
      // same config, same credential — only the transport differs, so this is not a second model, a
      // second provider or a second credential.
      const abort = createTransportBoundaryAbort();
      const cancellationTransport = createTransportStartHook(
        createFetchGroqTransport(),
        abort.onTransportStarted,
      );

      const session = createAccountedSession({
        gateway: createCandidateGateway({ apiKey }),
        cancellationGateway: createCandidateGateway({ apiKey, transport: cancellationTransport }),
        cancellation: {
          arm: () => undefined,
          transportStarts: abort.started,
          // Nothing accepted a reply after the abort: the adapter refuses a cancelled attempt, so a
          // completed user-visible answer is the only thing that could make this true.
          continuedAfterCancellation: () => false,
        },
        ledger,
        clock,
        phase: 'safety',
      });
      return Promise.resolve(session.session);
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
