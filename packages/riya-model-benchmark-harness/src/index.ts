/**
 * `@qf-jarvis/riya-model-benchmark-harness` — the operational benchmark harness (RMB-B).
 *
 * ### It measures. It does not decide what a measurement means
 *
 * RMB-A owns evidence: the contracts, the digests, the manifest, the comparison, and the rule that a
 * benchmark authorizes nothing. This package owns the scheduler that produces the numbers, and hands
 * them straight to those constructors. Nothing here recomputes a digest or builds an artifact by hand.
 *
 * ### It benchmarks no real model
 *
 * Execution happens only against an injected `RiyaBenchmarkTargetPort`, and every target in this
 * package's tests is a deterministic fake. There is no provider SDK, no model-gateway invocation, no
 * local inference engine, no model download, no HTTP, no `child_process`, no environment lookup, no
 * filesystem discovery, no database and no training framework.
 *
 * A real provider or local-engine adapter is a LATER slice, implemented behind the target port — and
 * emphatically not by adding benchmark instrumentation to the production model gateway, which is the
 * serving waist.
 *
 * ### It carries no content
 *
 * A prompt reaches the harness as a digest and a token count, in both directions. No customer message,
 * Riya reply, system prompt, Human Gold trajectory or P10 fixture body can enter, by shape.
 *
 * ### What it measures, precisely
 *
 * Warmup excluded from every number. At most `concurrency` requests in flight, admitted as slots free,
 * with no sleep, no backoff and no retry. Nearest-rank percentiles over successful requests only. A
 * measured window from just before the first measured admission to just after the last terminal
 * result — which is what makes aggregate throughput a measurement rather than `concurrency / p50`.
 *
 * A target failure is data. A protocol, identity or clock failure invalidates the whole suite and
 * produces no result set at all.
 */

// Errors.
export { RiyaHarnessError, RIYA_HARNESS_ERROR_CODES } from './contracts/errors.js';
export type { RiyaHarnessErrorCode } from './contracts/errors.js';

// Ports — everything the harness cannot own.
export type {
  RiyaBenchmarkMonotonicClockPort,
  RiyaBenchmarkTargetPort,
  RiyaBenchmarkTargetDescriptor,
  RiyaBenchmarkPreparedCase,
  RiyaBenchmarkInvocation,
  RiyaBenchmarkInvocationResult,
  RiyaBenchmarkInvocationSuccess,
  RiyaBenchmarkInvocationFailure,
  RiyaBenchmarkMemoryProbePort,
  RiyaBenchmarkMemoryCasePort,
  RiyaBenchmarkMemoryReading,
} from './contracts/ports.js';

// The suite plan, and the three identities this harness stamps rather than accepts.
export {
  createRiyaBenchmarkSuitePlan,
  riyaBenchmarkWorkloadForCase,
  RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_ID,
  RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_VERSION,
  RIYA_BENCHMARK_MEASUREMENT_POLICY_REF,
  RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE,
} from './contracts/suite-plan.js';
export type {
  RiyaBenchmarkSuitePlanV1,
  RiyaBenchmarkSuitePlanInput,
  RiyaBenchmarkSuiteCaseV1,
} from './contracts/suite-plan.js';

// The runner.
export { runRiyaBenchmarkSuite } from './service/run-suite.js';
export type { RunRiyaBenchmarkSuiteOptions } from './service/run-suite.js';
