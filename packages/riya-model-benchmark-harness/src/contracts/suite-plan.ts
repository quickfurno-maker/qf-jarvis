/**
 * The suite PLAN: what to measure, before anything is measured (RMB-B).
 *
 * ### Content-free, like everything else in this workstream
 *
 * A case is ids, digests, counts and timing. There is no field a prompt fits in, so a plan can be
 * committed, reviewed and diffed without carrying a customer message, a Human Gold trajectory or a P10
 * fixture body.
 *
 * ### Cases are meant to differ
 *
 * `short/c1`, `long/c1`, `short/c8`, `short/c32` are four cases of one suite. RMB-A allows exactly
 * this, and the objective — maximum useful throughput under RISING concurrency — is unmeasurable
 * without it. A plan makes the sweep the normal thing to write.
 *
 * ### No production distribution is claimed
 *
 * There is no default case list, no "typical Riya prompt size" and no "production concurrency". We do
 * not have those distributions, and a constant asserting one would be quoted as though we did. The
 * real candidate matrix is a later owner-reviewed artifact.
 *
 * ### The harness owns three fields
 *
 * `benchmarkImplementationId`, `benchmarkImplementationVersion` and `measurementPolicyRef` are stamped
 * by this package, not supplied by a caller. They say WHO measured and by WHAT RULES, and a caller who
 * could set them could claim a run followed measurement rules it did not.
 */
import { createRiyaBenchmarkWorkload } from '@qf-jarvis/riya-model-benchmark';
import type { RiyaBenchmarkWorkloadV1 } from '@qf-jarvis/riya-model-benchmark';
import { z } from 'zod';

import { RiyaHarnessError } from './errors.js';

/** Who measured. Stamped by this package into every workload it builds. */
export const RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_ID = 'riya-benchmark-harness';
export const RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_VERSION = 1;

/**
 * By what rules. Bump this — and the implementation version — if the percentile math, the failure
 * definition, the warmup treatment or the window boundaries ever change.
 *
 * A number computed under different rules is a different number, and evidence that shared a policy ref
 * across a rules change would be silently incomparable.
 */
export const RIYA_BENCHMARK_MEASUREMENT_POLICY_REF = 'riya-benchmark-measurement.v1';

/** The only batch size this harness version executes. See the runner header. */
export const RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE = 1;

export interface RiyaBenchmarkSuiteCaseV1 {
  readonly workloadCaseId: string;
  readonly promptProfileDigest: string;
  readonly inputTokenCount: number;
  readonly maximumOutputTokens: number;
  /** REQUIRED here, though optional in RMB-A: a harness run without a deadline is unbounded. */
  readonly requestTimeoutMicros: number;
  readonly concurrency: number;
  readonly batchSize: number;
  readonly warmupRequestCount: number;
  readonly measuredRequestCount: number;
  readonly streaming: boolean;
  readonly samplingConfigDigest: string;
}

export interface RiyaBenchmarkSuitePlanV1 {
  readonly version: 1;
  readonly benchmarkSuiteId: string;
  readonly benchmarkSuiteVersion: number;
  /** Sorted by `workloadCaseId`. Two orderings of one plan are one plan. */
  readonly cases: readonly RiyaBenchmarkSuiteCaseV1[];
}

export type RiyaBenchmarkSuitePlanInput = RiyaBenchmarkSuitePlanV1;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const DIGEST = z.string().regex(/^[0-9a-f]{64}$/u);

const caseSchema = z
  .object({
    workloadCaseId: IDENTIFIER,
    promptProfileDigest: DIGEST,
    inputTokenCount: z.int().min(1),
    maximumOutputTokens: z.int().min(1),
    requestTimeoutMicros: z.int().min(1),
    concurrency: z.int().min(1),
    batchSize: z.int().min(1),
    warmupRequestCount: z.int().min(0),
    measuredRequestCount: z.int().min(1),
    streaming: z.boolean(),
    samplingConfigDigest: DIGEST,
  })
  .strict();

const planSchema = z
  .object({
    version: z.literal(1),
    benchmarkSuiteId: IDENTIFIER,
    benchmarkSuiteVersion: z.int().min(1).max(1_000_000),
    cases: z.array(caseSchema).min(1).max(4_096),
  })
  .strict();

/** Validate, sort and freeze a suite plan. Throws `PLAN_INVALID`. */
export function createRiyaBenchmarkSuitePlan(
  input: RiyaBenchmarkSuitePlanInput,
): RiyaBenchmarkSuitePlanV1 {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaHarnessError('PLAN_INVALID');
  }
  const ids = parsed.data.cases.map((one) => one.workloadCaseId);
  if (new Set(ids).size !== ids.length) {
    throw new RiyaHarnessError('PLAN_INVALID');
  }
  // Every case is proved through the RMB-A workload constructor here rather than at run time, so a
  // plan that cannot produce valid evidence fails while it is still a plan.
  for (const one of parsed.data.cases) {
    riyaBenchmarkWorkloadForCase(parsed.data, one);
  }
  return Object.freeze({
    version: 1 as const,
    benchmarkSuiteId: parsed.data.benchmarkSuiteId,
    benchmarkSuiteVersion: parsed.data.benchmarkSuiteVersion,
    cases: Object.freeze(
      [...parsed.data.cases]
        .sort((a, b) => (a.workloadCaseId < b.workloadCaseId ? -1 : 1))
        .map((one) => Object.freeze({ ...one })),
    ),
  });
}

/**
 * The RMB-A workload for one planned case.
 *
 * Built through `createRiyaBenchmarkWorkload`, never by copying its schema — RMB-A owns what a valid
 * workload is, and a second definition here would drift from it the first time either changed.
 */
export function riyaBenchmarkWorkloadForCase(
  plan: Pick<RiyaBenchmarkSuitePlanV1, 'benchmarkSuiteId' | 'benchmarkSuiteVersion'>,
  suiteCase: RiyaBenchmarkSuiteCaseV1,
): RiyaBenchmarkWorkloadV1 {
  try {
    return createRiyaBenchmarkWorkload({
      version: 1,
      benchmarkSuiteId: plan.benchmarkSuiteId,
      benchmarkSuiteVersion: plan.benchmarkSuiteVersion,
      benchmarkImplementationId: RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_ID,
      benchmarkImplementationVersion: RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_VERSION,
      workloadCaseId: suiteCase.workloadCaseId,
      promptProfileDigest: suiteCase.promptProfileDigest,
      inputTokenCount: suiteCase.inputTokenCount,
      maximumOutputTokens: suiteCase.maximumOutputTokens,
      concurrency: suiteCase.concurrency,
      batchSize: suiteCase.batchSize,
      warmupRequestCount: suiteCase.warmupRequestCount,
      measuredRequestCount: suiteCase.measuredRequestCount,
      streaming: suiteCase.streaming,
      requestTimeoutMicros: suiteCase.requestTimeoutMicros,
      samplingConfigDigest: suiteCase.samplingConfigDigest,
      measurementPolicyRef: RIYA_BENCHMARK_MEASUREMENT_POLICY_REF,
    });
  } catch {
    // RMB-A's own refusal, translated to this package's vocabulary. A caller building a plan should
    // not have to catch a benchmark-package error.
    throw new RiyaHarnessError('PLAN_INVALID');
  }
}
