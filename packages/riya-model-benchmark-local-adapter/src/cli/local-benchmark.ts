/**
 * The offline local benchmark CLI (AS4-PREP-A).
 *
 * ### Nothing is discovered, and nothing is defaulted
 *
 * A plan path, a config path, an endpoint and an artifacts directory, all typed. There is no
 * configuration discovery, no environment read, no default endpoint, no default model, no fallback and
 * no "use the last one". A benchmark run that could pick up settings from its surroundings is a run
 * whose evidence cannot be reproduced from what somebody typed.
 *
 * ### It validates by default and measures only when told to
 *
 * Without `--execute` it proves the endpoint, the configuration and every case of the plan, prints what
 * it would do, and stops -- having constructed no transport and opened no socket. `--execute` is what
 * turns it into a run.
 *
 * That is cheaper than it sounds and worth more: almost every mistake in a benchmark run is in the
 * plan or the configuration, and the dry run finds all of them in a second without occupying a GPU.
 *
 * ### What it prints
 *
 * Refs, counts, digests and case shapes. Never a prompt, never a completion, never a header, never an
 * engine error body, never a URL, never a filesystem path. The summary is meant to be safe to paste
 * into a review comment, which is exactly where it will end up.
 *
 * ### Exit codes
 *
 * `0` the run completed and the artifacts were written. `1` the runner failed. `2` the invocation was
 * wrong. A slow model is not a failure and a failed request is not a failure -- those are results, and
 * they are in the evidence.
 */
import { readFile } from 'node:fs/promises';

import {
  createRiyaBenchmarkSuitePlan,
  RiyaHarnessError,
  runRiyaBenchmarkSuite,
} from '@qf-jarvis/riya-model-benchmark-harness';
import type { RiyaBenchmarkSuitePlanV1 } from '@qf-jarvis/riya-model-benchmark-harness';

import { createRiyaLocalBenchmarkAdapterConfig } from '../contracts/adapter-config.js';
import type { RiyaLocalBenchmarkAdapterConfigInput } from '../contracts/adapter-config.js';
import { createRiyaLocalEngineEndpoint } from '../contracts/endpoint.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import {
  createRiyaLocalArtifactWriter,
  RIYA_LOCAL_RESULT_SET_FILENAME,
  RIYA_LOCAL_RUN_MANIFEST_FILENAME,
} from '../service/artifact-writer.js';
import { createRiyaLocalEngineUsageTokenizer } from '../service/engine-usage-tokenizer.js';
import { createRiyaLocalBenchmarkTarget } from '../service/local-engine-target.js';
import { createRiyaLoopbackEngineTransport } from '../service/loopback-transport.js';
import { createRiyaLocalMonotonicClock } from '../service/monotonic-clock.js';
import { preflightRiyaLocalBenchmark } from '../service/preflight.js';
import { buildRiyaLocalBenchmarkRunManifest } from '../service/run-manifest.js';

export const RIYA_LOCAL_EXIT_OK = 0;
export const RIYA_LOCAL_EXIT_RUNNER_FAILURE = 1;
export const RIYA_LOCAL_EXIT_USAGE = 2;

export const RIYA_LOCAL_CLI_USAGE =
  'usage: riya:benchmark:local -- --plan <path> --config <path> --endpoint <loopback-url> \\\n' +
  '                               --artifacts <dir> [--execute] [--allow-overwrite]\n' +
  '       without --execute nothing is sent: the plan, the config and the endpoint are proved and printed\n' +
  '       --endpoint accepts ONLY http://127.0.0.1:<port>, http://localhost:<port> or http://[::1]:<port>';

export interface RiyaLocalCliArgs {
  readonly planPath?: string;
  readonly configPath?: string;
  readonly endpoint?: string;
  readonly artifactDirectory?: string;
  readonly execute: boolean;
  readonly allowOverwrite: boolean;
}

/** Parse argv. An unknown flag is a usage error rather than something quietly ignored. */
export function parseRiyaLocalCliArgs(argv: readonly string[]): RiyaLocalCliArgs {
  let planPath: string | undefined;
  let configPath: string | undefined;
  let endpoint: string | undefined;
  let artifactDirectory: string | undefined;
  let execute = false;
  let allowOverwrite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') {
      index += 1;
      planPath = argv[index];
    } else if (arg === '--config') {
      index += 1;
      configPath = argv[index];
    } else if (arg === '--endpoint') {
      index += 1;
      endpoint = argv[index];
    } else if (arg === '--artifacts') {
      index += 1;
      artifactDirectory = argv[index];
    } else if (arg === '--execute') {
      execute = true;
    } else if (arg === '--allow-overwrite') {
      allowOverwrite = true;
    } else {
      throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
    }
  }

  return {
    ...(planPath === undefined ? {} : { planPath }),
    ...(configPath === undefined ? {} : { configPath }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(artifactDirectory === undefined ? {} : { artifactDirectory }),
    execute,
    allowOverwrite,
  };
}

export interface RunRiyaLocalBenchmarkCliOptions {
  readonly argv: readonly string[];
  /** Injected, so a spec reads what was printed rather than a process's stdout. */
  readonly write: (line: string) => void;
  /** Injected, so evidence `createdAt` is never derived from the monotonic clock. */
  readonly nowIso: () => string;
}

/** The one place a thrown value becomes printable. Anything unrecognised prints as itself and nothing more. */
function closedFailureCode(error: unknown): string {
  if (error instanceof RiyaLocalBenchmarkError) {
    return error.code;
  }
  if (error instanceof RiyaHarnessError) {
    return `HARNESS_${error.code}`;
  }
  return 'LOCAL_BENCHMARK_RUN_FAILED';
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

/**
 * Run the CLI and return an exit code.
 *
 * Everything that could reach a socket is constructed AFTER the mode is already `EXECUTE`, so the dry
 * run cannot open a connection even by accident.
 */
export async function runRiyaLocalBenchmarkCli(
  options: RunRiyaLocalBenchmarkCliOptions,
): Promise<number> {
  const { write } = options;

  let args: RiyaLocalCliArgs;
  try {
    args = parseRiyaLocalCliArgs(options.argv);
  } catch {
    write(RIYA_LOCAL_CLI_USAGE);
    return RIYA_LOCAL_EXIT_USAGE;
  }
  // Every one of the four is required, in both modes. "No endpoint means no run" is the containment
  // rule, and an artifacts directory decided after a suite has run is a directory chosen under
  // pressure.
  if (
    args.planPath === undefined ||
    args.configPath === undefined ||
    args.endpoint === undefined ||
    args.artifactDirectory === undefined
  ) {
    write(RIYA_LOCAL_CLI_USAGE);
    return RIYA_LOCAL_EXIT_USAGE;
  }

  try {
    const endpoint = createRiyaLocalEngineEndpoint(args.endpoint);
    const config = createRiyaLocalBenchmarkAdapterConfig(
      (await readJson(args.configPath)) as RiyaLocalBenchmarkAdapterConfigInput,
    );
    const plan = createRiyaBenchmarkSuitePlan(
      (await readJson(args.planPath)) as RiyaBenchmarkSuitePlanV1,
    );
    const preflight = preflightRiyaLocalBenchmark({ plan, config });

    write(`mode: ${args.execute ? 'EXECUTE' : 'VALIDATE_ONLY'}`);
    write(`endpoint: loopback ${endpoint.hostForm}`);
    write(`release: ${config.subject.release.releaseId} model=${config.servedModelId}`);
    write(`engine: ${config.environment.runtimeEngineId ?? ''}`);
    write(`suite: ${preflight.benchmarkSuiteId} v${String(preflight.benchmarkSuiteVersion)}`);
    write(`output token accounting: ${config.outputTokenAccounting}`);
    write('accelerator memory: NOT MEASURED');
    write(`planned requests (warmup included): ${String(preflight.totalPlannedRequests)}`);
    for (const one of preflight.cases) {
      write(
        `case ${one.workloadCaseId}: profile=${one.promptProfileId} ` +
          `declaredInputTokens=${String(one.declaredInputTokenCount)} ` +
          `maxOutput=${String(one.maximumOutputTokens)} ` +
          `concurrency=${String(one.concurrency)} ` +
          `warmup=${String(one.warmupRequestCount)} measured=${String(one.measuredRequestCount)} ` +
          `timeoutMs=${String(one.requestTimeoutMillis)}`,
      );
    }

    if (!args.execute) {
      write('no request was sent. pass --execute to measure.');
      return RIYA_LOCAL_EXIT_OK;
    }

    const transport = createRiyaLoopbackEngineTransport({ endpoint });
    const target = createRiyaLocalBenchmarkTarget({
      config,
      transport,
      tokenizer: createRiyaLocalEngineUsageTokenizer({
        transport,
        servedModelId: config.servedModelId,
      }),
    });

    // Control traffic, before the suite. An engine serving something else fails here rather than
    // producing real numbers attributed to the wrong release.
    await target.verifyServedModel();
    write('served model: confirmed exact');

    const resultSet = await runRiyaBenchmarkSuite({
      plan,
      target,
      clock: createRiyaLocalMonotonicClock(),
      createdAt: options.nowIso(),
      // No memory probe. There is no honest engine-independent one, and RMB-B makes it optional.
    });

    const manifest = buildRiyaLocalBenchmarkRunManifest({
      config,
      resultSet,
      benchmarkSuiteId: plan.benchmarkSuiteId,
      benchmarkSuiteVersion: plan.benchmarkSuiteVersion,
      endpointHostForm: endpoint.hostForm,
      createdAt: options.nowIso(),
    });

    const writer = createRiyaLocalArtifactWriter({
      directory: args.artifactDirectory,
      allowOverwrite: args.allowOverwrite,
    });
    await writer.write(RIYA_LOCAL_RESULT_SET_FILENAME, resultSet);
    await writer.write(RIYA_LOCAL_RUN_MANIFEST_FILENAME, manifest);

    write(`result set digest: ${resultSet.resultSetDigest}`);
    write(`cases measured: ${String(resultSet.caseIds.length)}`);
    write('no model was selected. this is operational evidence only.');
    return RIYA_LOCAL_EXIT_OK;
  } catch (error: unknown) {
    // A closed code from this package or from RMB-B, or nothing at all. Both vocabularies are
    // content-free by construction; a raw message could carry a filesystem path, an engine error body
    // or a stack containing a username, and this line is printed into CI transcripts.
    write(`failed: ${closedFailureCode(error)}`);
    return RIYA_LOCAL_EXIT_RUNNER_FAILURE;
  }
}
