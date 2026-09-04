/**
 * The offline pilot CLI (AS3A, ADR-0143 §14).
 *
 * ### Dry run by default, and it takes two deliberate acts to change that
 *
 * Running it with a plan proves the plan, prints a sanitized summary and the ceilings, and stops. A
 * real run needs `--execute` on the command line AND `RIYA_AS3_ALLOW_REAL_CALLS=true` in the
 * environment. A credential is not a third switch and is never consulted for the decision, so a
 * machine that happens to hold two API keys still runs a dry run.
 *
 * ### There is no interactive prompt, and that is on purpose
 *
 * A yes/no question is the control people learn to answer without reading. Two independent, recorded
 * switches — one typed, one configured — say more about intent than a keystroke does, and they show
 * up in a shell history and a machine configuration where somebody can audit them afterwards.
 *
 * ### What it prints
 *
 * Refs, counts and ceilings. Credential PRESENCE as a boolean, never a value, a prefix or a length.
 * No prompt body, no conversation, no provider error text. The summary is meant to be safe to paste
 * into a review comment.
 *
 * ### Exit codes distinguish two different kinds of bad news
 *
 * A rejected candidate is a RESULT: the pilot ran, and the answer was no. That exits 0 and is
 * reported in the summary and the artifacts. A runner failure — an invalid plan, a refused artifact
 * write, an unauthorized execution attempt — exits non-zero. Collapsing them would make "did the
 * pilot work" and "did the candidates pass" the same question, and they are the two questions a
 * pilot exists to keep apart.
 */
import { readFile } from 'node:fs/promises';

import { createRiyaSyntheticPilotPlan } from '../contracts/pilot-plan.js';
import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import { createRiyaSyntheticArtifactWriter } from '../service/artifact-writer.js';
import { executeRiyaSyntheticPilot } from '../service/execute-pilot.js';
import {
  ANTHROPIC_CREDENTIAL_ENV,
  OPENAI_CREDENTIAL_ENV,
  RIYA_AS3_EXECUTE_ENV,
  readRiyaSyntheticProviderCredential,
  resolveRiyaSyntheticExecutionMode,
} from '../service/execution-guard.js';
import type { RiyaSyntheticEnvironment } from '../service/execution-guard.js';
import { preflightRiyaSyntheticPilot } from '../service/preflight.js';

/** Exit codes. `1` is a runner failure; a rejected candidate is not a failure and exits `0`. */
export const RIYA_AS3_EXIT_OK = 0;
export const RIYA_AS3_EXIT_RUNNER_FAILURE = 1;
export const RIYA_AS3_EXIT_USAGE = 2;

export interface RiyaSyntheticCliArgs {
  readonly planPath?: string;
  readonly artifactDirectory?: string;
  readonly execute: boolean;
  readonly allowOverwrite: boolean;
}

/** Parse argv. Unknown flags are a usage error rather than something quietly ignored. */
export function parseRiyaSyntheticCliArgs(argv: readonly string[]): RiyaSyntheticCliArgs {
  let planPath: string | undefined;
  let artifactDirectory: string | undefined;
  let execute = false;
  let allowOverwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      index += 1;
      planPath = argv[index];
    } else if (arg === '--artifacts') {
      index += 1;
      artifactDirectory = argv[index];
    } else if (arg === '--execute') {
      execute = true;
    } else if (arg === '--allow-overwrite') {
      allowOverwrite = true;
    } else {
      throw new RiyaSyntheticPilotError('invalid-pilot-plan');
    }
  }

  return {
    ...(planPath === undefined ? {} : { planPath }),
    ...(artifactDirectory === undefined ? {} : { artifactDirectory }),
    execute,
    allowOverwrite,
  };
}

/** `--artifacts` is required for `--execute`, and the usage line says so. */
const USAGE =
  'usage: riya:as3:pilot -- --plan <path> [--artifacts <dir>] [--execute] [--allow-overwrite]\n' +
  '       --execute REQUIRES --artifacts <dir> and RIYA_AS3_ALLOW_REAL_CALLS=true';

export interface RunCliOptions {
  readonly argv: readonly string[];
  readonly environment: RiyaSyntheticEnvironment;
  readonly now: () => number;
  /** Injected, so a spec can read what was printed instead of a process's stdout. */
  readonly write: (line: string) => void;
}

/**
 * Run the CLI and return an exit code.
 *
 * Every construction that could touch a network happens after the mode is already `EXECUTE`, so the
 * dry-run path cannot reach a transport even by accident.
 */
export async function runRiyaSyntheticPilotCli(options: RunCliOptions): Promise<number> {
  const { environment, write } = options;

  let args: RiyaSyntheticCliArgs;
  try {
    args = parseRiyaSyntheticCliArgs(options.argv);
  } catch {
    write(USAGE);
    return RIYA_AS3_EXIT_USAGE;
  }
  if (args.planPath === undefined) {
    write(USAGE);
    return RIYA_AS3_EXIT_USAGE;
  }

  try {
    const raw = await readFile(args.planPath, 'utf8');
    const plan = createRiyaSyntheticPilotPlan(JSON.parse(raw) as unknown);
    const preflight = preflightRiyaSyntheticPilot({ plan, environment });
    const mode = resolveRiyaSyntheticExecutionMode({
      executeFlagPresent: args.execute,
      environment,
    });

    write(`plan: ${plan.planRef}`);
    write(`mode: ${mode}`);
    write(`scheduled scenarios: ${String(preflight.scheduledScenarios)}`);
    write(`planned candidates: ${String(preflight.plannedCandidates)}`);
    for (const config of preflight.configs) {
      write(
        `config ${config.configRef}: family=${config.providerFamilyRef} model=${config.modelRef} instruction=${config.instructionRef}`,
      );
    }
    write(`ceiling candidates: ${String(plan.budget.maxCandidates)}`);
    write(`ceiling provider requests: ${String(plan.budget.maxProviderRequests)}`);
    // HARD controls and OBSERVED thresholds are printed under different words, because a reader
    // planning a spend must not have to guess which of these is a wall.
    write(`ceiling request input bytes: ${String(plan.budget.maxRequestInputUtf8Bytes)}`);
    write(`ceiling reserved output tokens: ${String(plan.budget.maxReservedOutputTokens)}`);
    write(`ceiling wall clock ms: ${String(plan.budget.maxWallClockMs)}`);
    write(`observed threshold input tokens: ${String(plan.budget.maxObservedInputTokens)}`);
    write(`observed threshold output tokens: ${String(plan.budget.maxObservedOutputTokens)}`);
    write(`observed threshold total tokens: ${String(plan.budget.maxObservedTotalTokens)}`);
    // PRESENCE. Never a value, never a length.
    write(`OPENAI_CREDENTIAL_PRESENT=${String(preflight.credentials.openaiCredentialPresent)}`);
    write(
      `ANTHROPIC_CREDENTIAL_PRESENT=${String(preflight.credentials.anthropicCredentialPresent)}`,
    );

    // BEFORE the credential read, before an SDK is constructed, and before a transport exists.
    //
    // A paid run whose candidates live only in memory is the run nobody can review: the process
    // exits, the money is spent, and there is nothing to look at. DRY_RUN may omit it, because a dry
    // run produces nothing to keep.
    const artifactDirectory = args.artifactDirectory;
    if (mode === 'EXECUTE' && artifactDirectory === undefined) {
      throw new RiyaSyntheticPilotError('artifact-destination-required');
    }

    if (mode === 'DRY_RUN') {
      write(
        `DRY RUN — no provider call was made. Real execution needs BOTH --execute and ${RIYA_AS3_EXECUTE_ENV}=true.`,
      );
      const dry = await executeRiyaSyntheticPilot({ plan, preflight, mode, now: options.now });
      write(`provider requests: ${String(dry.ledger.providerRequests)}`);
      return RIYA_AS3_EXIT_OK;
    }

    // EXECUTE from here, with a destination already proved present. Credentials are read below and
    // nowhere earlier.
    /* c8 ignore next -- proved above; the guard is the check, this narrows the type */
    if (artifactDirectory === undefined) {
      throw new RiyaSyntheticPilotError('artifact-destination-required');
    }
    const transports: Parameters<typeof executeRiyaSyntheticPilot>[0] = {
      plan,
      preflight,
      mode,
      now: options.now,
      // Proved present above, so this is a plain construction rather than a conditional one.
      writer: createRiyaSyntheticArtifactWriter({
        baseDirectory: artifactDirectory,
        allowOverwrite: args.allowOverwrite,
      }),
      ...(preflight.requiresOpenaiCredential
        ? {
            openaiTransport: await buildOpenAiTransport(
              readRiyaSyntheticProviderCredential(environment, OPENAI_CREDENTIAL_ENV),
            ),
          }
        : {}),
      ...(preflight.requiresAnthropicCredential
        ? {
            anthropicTransport: await buildAnthropicTransport(
              readRiyaSyntheticProviderCredential(environment, ANTHROPIC_CREDENTIAL_ENV),
            ),
          }
        : {}),
    };

    const result = await executeRiyaSyntheticPilot(transports);

    write(`generated: ${String(result.generatedCandidates)}`);
    write(`failed: ${String(result.failedCandidates)}`);
    write(`not started: ${String(result.notStartedCandidates)}`);
    write(`accepted evidence: ${String(result.acceptedEvidenceCount)}`);
    write(`findings: ${String(result.blockingFindings)}`);
    write(`corpus eligible: ${String(result.corpusEligible)}`);
    write(`provider requests: ${String(result.ledger.providerRequests)}`);
    write(
      `tokens in/out: ${String(result.ledger.inputTokens)}/${String(result.ledger.outputTokens)}`,
    );
    if (result.stopReason !== undefined) write(`stopped: ${result.stopReason}`);
    for (const artifact of result.artifacts) write(`artifact ${artifact.name} ${artifact.sha256}`);

    // A pilot whose candidates were rejected still RAN. That is a result, not a runner failure.
    return RIYA_AS3_EXIT_OK;
  } catch (error) {
    // A closed code, never a provider message and never a stack that could carry a path or a key.
    const code = error instanceof RiyaSyntheticPilotError ? error.code : 'runner-failure';
    write(`FAILED: ${code}`);
    return RIYA_AS3_EXIT_RUNNER_FAILURE;
  }
}

/**
 * Construct the OpenAI transport.
 *
 * Dynamically imported so the SDK is loaded only on a run that is already authorized to spend — a
 * dry run never even evaluates the module.
 */
async function buildOpenAiTransport(
  apiKey: string,
): Promise<NonNullable<Parameters<typeof executeRiyaSyntheticPilot>[0]['openaiTransport']>> {
  const [{ default: OpenAI }, { createOpenAiSdkTransport }] = await Promise.all([
    import('openai'),
    import('../adapters/openai-sdk-transport.js'),
  ]);
  return createOpenAiSdkTransport(new OpenAI({ apiKey }));
}

async function buildAnthropicTransport(
  apiKey: string,
): Promise<NonNullable<Parameters<typeof executeRiyaSyntheticPilot>[0]['anthropicTransport']>> {
  const [{ default: Anthropic }, { createAnthropicSdkTransport }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('../adapters/anthropic-sdk-transport.js'),
  ]);
  return createAnthropicSdkTransport(new Anthropic({ apiKey }));
}
