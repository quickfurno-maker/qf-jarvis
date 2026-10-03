/**
 * Everything that can be decided about a run before an engine exists (AS4-PREP-A).
 *
 * ### Why this is separate from `prepareCase`
 *
 * RMB-B prepares one case at a time, in the middle of a suite, and reports a disagreement as a case
 * mismatch. That is the right behaviour for a harness and the wrong experience for an operator: a plan
 * with the wrong sampling digest on its fourth case should say so before the first three are measured,
 * not after.
 *
 * So the same rules run here, over the whole plan, with no network and no engine -- and the CLI runs
 * this before it constructs a transport. A misconfigured run costs nothing to discover.
 *
 * ### What it deliberately cannot check
 *
 * The input token count. Only the engine knows what its chat template costs, so the plan's declared
 * `inputTokenCount` is proved against reality in `prepareCase`, before warmup, and a disagreement
 * refuses the case there. Reporting a token count here from a local estimate would be exactly the
 * approximation this package refuses to make.
 */
import { riyaBenchmarkWorkloadForCase } from '@qf-jarvis/riya-model-benchmark-harness';
import type {
  RiyaBenchmarkSuiteCaseV1,
  RiyaBenchmarkSuitePlanV1,
} from '@qf-jarvis/riya-model-benchmark-harness';

import type { RiyaLocalBenchmarkAdapterConfigV1 } from '../contracts/adapter-config.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';
import { riyaSyntheticPromptProfileDigest } from '../prompts/synthetic-profiles.js';

export interface RiyaLocalBenchmarkPreflightCase {
  readonly workloadCaseId: string;
  readonly promptProfileId: string;
  /** As DECLARED by the plan. Proved against the engine in `prepareCase`, never here. */
  readonly declaredInputTokenCount: number;
  readonly maximumOutputTokens: number;
  readonly concurrency: number;
  readonly warmupRequestCount: number;
  readonly measuredRequestCount: number;
  readonly requestTimeoutMillis: number;
}

export interface RiyaLocalBenchmarkPreflight {
  readonly benchmarkSuiteId: string;
  readonly benchmarkSuiteVersion: number;
  readonly cases: readonly RiyaLocalBenchmarkPreflightCase[];
  /** Requests the plan would actually issue, warmup included. What the operator is about to spend. */
  readonly totalPlannedRequests: number;
}

/** Prove one case against the configuration. Throws a closed local code. */
function preflightCase(
  plan: RiyaBenchmarkSuitePlanV1,
  suiteCase: RiyaBenchmarkSuiteCaseV1,
  config: RiyaLocalBenchmarkAdapterConfigV1,
): RiyaLocalBenchmarkPreflightCase {
  const promptProfileId = config.casePromptProfiles[suiteCase.workloadCaseId];
  if (promptProfileId === undefined) {
    throw new RiyaLocalBenchmarkError('PROMPT_PROFILE_UNKNOWN');
  }
  // Built through RMB-B rather than read off the case, so the plan is proved by its own authority and
  // the values checked below are the ones the harness will actually use.
  const workload = riyaBenchmarkWorkloadForCase(plan, suiteCase);

  if (!workload.streaming) {
    throw new RiyaLocalBenchmarkError('STREAMING_REQUIRED');
  }
  if (workload.samplingConfigDigest !== config.samplingConfigDigest) {
    throw new RiyaLocalBenchmarkError('SAMPLING_CONFIG_MISMATCH');
  }
  const timeoutMicros = workload.requestTimeoutMicros;
  if (timeoutMicros === undefined || timeoutMicros % 1_000 !== 0) {
    throw new RiyaLocalBenchmarkError('REQUEST_TIMEOUT_NOT_MILLISECOND_EXACT');
  }
  if (riyaSyntheticPromptProfileDigest(promptProfileId) !== workload.promptProfileDigest) {
    throw new RiyaLocalBenchmarkError('PROMPT_PROFILE_DIGEST_MISMATCH');
  }

  return {
    workloadCaseId: workload.workloadCaseId,
    promptProfileId,
    declaredInputTokenCount: workload.inputTokenCount,
    maximumOutputTokens: workload.maximumOutputTokens,
    concurrency: workload.concurrency,
    warmupRequestCount: workload.warmupRequestCount,
    measuredRequestCount: workload.measuredRequestCount,
    requestTimeoutMillis: timeoutMicros / 1_000,
  };
}

/** Prove a whole plan against a configuration, offline. */
export function preflightRiyaLocalBenchmark(options: {
  readonly plan: RiyaBenchmarkSuitePlanV1;
  readonly config: RiyaLocalBenchmarkAdapterConfigV1;
}): RiyaLocalBenchmarkPreflight {
  const cases = options.plan.cases.map((one) => preflightCase(options.plan, one, options.config));
  return Object.freeze({
    benchmarkSuiteId: options.plan.benchmarkSuiteId,
    benchmarkSuiteVersion: options.plan.benchmarkSuiteVersion,
    cases: Object.freeze(cases),
    totalPlannedRequests: cases.reduce(
      (total, one) => total + one.warmupRequestCount + one.measuredRequestCount,
      0,
    ),
  });
}
