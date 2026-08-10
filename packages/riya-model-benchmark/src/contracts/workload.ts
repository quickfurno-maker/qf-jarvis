/**
 * The WORKLOAD: what was asked of the model, as counts and digests (RMB-A).
 *
 * ### Zero raw text, structurally
 *
 * A prompt reaches this package as `promptProfileDigest` and `inputTokenCount`. There is no field a
 * sentence fits in, so a benchmark artifact cannot carry a customer message, a Human Gold trajectory
 * or a P10 fixture body — not by policy, by shape.
 *
 * That is deliberate at two levels. Performance work naturally wants realistic prompts, and the most
 * realistic prompts available are the exam and the Gold corpus; a benchmark record that could hold
 * their text would be a second, ungoverned copy of both, sitting outside every firewall built for
 * them.
 *
 * ### Every knob that changes the number is here
 *
 * Concurrency, batch size, output cap, warmup and measured counts, streaming, sampling config. Two
 * runs that differ on any of these are measuring different things, and the comparison layer refuses
 * them rather than reporting a delta that means nothing. Putting them in the workload identity is
 * what makes that refusal possible.
 */
import { z } from 'zod';

import { RiyaBenchmarkError } from './errors.js';
import { isExactGovernedIdentity } from '../internal/exact-identity.js';
import {
  RIYA_BENCHMARK_MAX_CONCURRENCY,
  RIYA_BENCHMARK_MAX_REQUESTS,
  RIYA_BENCHMARK_MAX_TOKENS,
} from './vocabularies.js';

export interface RiyaBenchmarkWorkloadV1 {
  readonly version: 1;
  readonly benchmarkSuiteId: string;
  readonly benchmarkSuiteVersion: number;
  /** Which harness produced the numbers. Two harnesses are two measurements. */
  readonly benchmarkImplementationId: string;
  readonly benchmarkImplementationVersion: number;
  readonly workloadCaseId: string;
  /** A digest of the prompt profile. NEVER the prompt. */
  readonly promptProfileDigest: string;
  readonly inputTokenCount: number;
  readonly maximumOutputTokens: number;
  readonly concurrency: number;
  readonly batchSize: number;
  readonly warmupRequestCount: number;
  readonly measuredRequestCount: number;
  readonly streaming: boolean;
  /** A digest of the sampling/decoding configuration. Never the configuration itself. */
  readonly samplingConfigDigest: string;
  /**
   * Which measurement rules the harness followed — how percentiles are computed, what counts as a
   * failure, whether warmups are excluded.
   *
   * Two harnesses can agree on every number above and still disagree about what a p95 is. Naming the
   * policy is what lets the comparison layer refuse that case instead of subtracting two definitions.
   */
  readonly measurementPolicyRef: string;
}

export type RiyaBenchmarkWorkloadInput = RiyaBenchmarkWorkloadV1;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const VERSION = z.int().min(1).max(1_000_000);

const workloadSchema = z
  .object({
    version: z.literal(1),
    benchmarkSuiteId: IDENTIFIER,
    benchmarkSuiteVersion: VERSION,
    benchmarkImplementationId: IDENTIFIER,
    benchmarkImplementationVersion: VERSION,
    workloadCaseId: IDENTIFIER,
    promptProfileDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    inputTokenCount: z.int().min(1).max(RIYA_BENCHMARK_MAX_TOKENS),
    maximumOutputTokens: z.int().min(1).max(RIYA_BENCHMARK_MAX_TOKENS),
    concurrency: z.int().min(1).max(RIYA_BENCHMARK_MAX_CONCURRENCY),
    batchSize: z.int().min(1).max(RIYA_BENCHMARK_MAX_CONCURRENCY),
    // Zero warmups is legitimate — cold-start behaviour is a real thing to measure.
    warmupRequestCount: z.int().min(0).max(RIYA_BENCHMARK_MAX_REQUESTS),
    measuredRequestCount: z.int().min(1).max(RIYA_BENCHMARK_MAX_REQUESTS),
    streaming: z.boolean(),
    samplingConfigDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    measurementPolicyRef: IDENTIFIER,
  })
  .strict();

/** Validate and freeze a workload profile. Throws `WORKLOAD_INVALID`. */
export function createRiyaBenchmarkWorkload(
  input: RiyaBenchmarkWorkloadInput,
): RiyaBenchmarkWorkloadV1 {
  const parsed = workloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('WORKLOAD_INVALID');
  }
  // The four DURABLE refs must be exact, for the same reason the release must be. A workload naming
  // `measurementPolicyRef: 'latest'` describes rules that have since changed, and the number it
  // accompanies then means something nobody can recover. Same predicate as the release and the subject
  // refs -- one definition of "exact" in the repository, imported rather than restated.
  //
  // Versions and digests are deliberately NOT run through it: a numeric version cannot be an alias,
  // and a SHA-256 already names exact content.
  for (const ref of [
    parsed.data.benchmarkSuiteId,
    parsed.data.benchmarkImplementationId,
    parsed.data.workloadCaseId,
    parsed.data.measurementPolicyRef,
  ]) {
    if (!isExactGovernedIdentity(ref)) {
      throw new RiyaBenchmarkError('WORKLOAD_INVALID');
    }
  }
  return Object.freeze({ ...parsed.data, version: 1 as const });
}

/**
 * What every case in ONE result set must share: the harness and the rules it measured by.
 *
 * Deliberately NOT the case shape. A benchmark suite exists to vary prompt size, output cap,
 * concurrency and batch — `short/c1`, `long/c1`, `short/c8`, `short/c32` are four cases of one suite,
 * and the owner goal is throughput under RISING concurrency, which is unmeasurable if a set may hold
 * only one concurrency. What must not vary is who measured and how.
 */
export function workloadSuiteKey(workload: RiyaBenchmarkWorkloadV1): string {
  return [
    workload.benchmarkSuiteId,
    String(workload.benchmarkSuiteVersion),
    workload.benchmarkImplementationId,
    String(workload.benchmarkImplementationVersion),
    workload.measurementPolicyRef,
  ].join('|');
}

/**
 * The exact tuple that must match for two runs to be measuring the same thing.
 *
 * This is an INTER-SET check, applied per matched `workloadCaseId`: A's `short/c8` against B's
 * `short/c8`. It is deliberately not an intra-set requirement — see `workloadSuiteKey`.
 *
 * Excludes `workloadCaseId` on purpose: the comparison layer pairs cases by id first, then asks
 * whether everything else about the pair agrees.
 */
export function workloadParityKey(workload: RiyaBenchmarkWorkloadV1): string {
  return [
    workload.benchmarkSuiteId,
    String(workload.benchmarkSuiteVersion),
    workload.benchmarkImplementationId,
    String(workload.benchmarkImplementationVersion),
    workload.promptProfileDigest,
    String(workload.inputTokenCount),
    String(workload.maximumOutputTokens),
    String(workload.concurrency),
    String(workload.batchSize),
    String(workload.warmupRequestCount),
    String(workload.measuredRequestCount),
    String(workload.streaming),
    workload.samplingConfigDigest,
    workload.measurementPolicyRef,
  ].join('|');
}
