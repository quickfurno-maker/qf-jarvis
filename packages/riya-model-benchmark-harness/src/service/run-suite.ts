/**
 * The benchmark runner (RMB-B).
 *
 * ### It measures; RMB-A decides what is valid
 *
 * Every artifact leaves through `createRiyaBenchmarkObservation`, `createRiyaBenchmarkEvidence` and
 * `createRiyaBenchmarkResultSet`. No digest, manifest or comparison logic is reimplemented here — one
 * evidence authority, and a harness that cannot quietly relax it.
 *
 * ### Identity comes from the TARGET, never the caller
 *
 * Subject and environment are read from `target.descriptor()` and re-proved through the RMB-A
 * constructors. A caller cannot supply a competing subject, because "run against A and stamp it as B"
 * is the one forgery this package would otherwise make easy.
 *
 * ### One request, once
 *
 * No retry, no backoff, no sleep, no second attempt. A retrying benchmark measures a retry policy. If
 * a target fails, that is a failed request and the observation says so.
 *
 * ### batchSize 1 only, in V1
 *
 * Hosted APIs are one logical request per invocation, and local engines dynamic-batch concurrent
 * requests on their own — so explicit batching is not needed to produce load, and it would complicate
 * per-request TTFT and completion sampling. A plan with a larger batch is REFUSED before any target
 * work rather than silently executed as if it were one.
 *
 * ### A protocol failure invalidates the whole suite
 *
 * A target failure is data. A clock going backwards, a success with no first-output callback, a
 * mismatched input-token count — those mean the measurement is unsound, and the honest output is no
 * output. There is no partial result set, because a partial set is a set somebody will compare.
 */
import {
  createRiyaBenchmarkEnvironment,
  createRiyaBenchmarkEvidence,
  createRiyaBenchmarkObservation,
  createRiyaBenchmarkResultSet,
  createRiyaBenchmarkSubject,
} from '@qf-jarvis/riya-model-benchmark';
import type {
  RiyaBenchmarkEnvironmentV1,
  RiyaBenchmarkEvidenceV1,
  RiyaBenchmarkObservationV1,
  RiyaBenchmarkResultSetV1,
  RiyaBenchmarkSubjectV1,
  RiyaBenchmarkWorkloadV1,
} from '@qf-jarvis/riya-model-benchmark';

import { RiyaHarnessError } from '../contracts/errors.js';
import type {
  RiyaBenchmarkInvocationResult,
  RiyaBenchmarkMemoryProbePort,
  RiyaBenchmarkMonotonicClockPort,
  RiyaBenchmarkTargetPort,
} from '../contracts/ports.js';
import {
  RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE,
  riyaBenchmarkWorkloadForCase,
} from '../contracts/suite-plan.js';
import type { RiyaBenchmarkSuitePlanV1 } from '../contracts/suite-plan.js';
import { ascending, decodeMicrosPerOutputToken, nearestRankPercentile } from './percentiles.js';

export interface RunRiyaBenchmarkSuiteOptions {
  readonly plan: RiyaBenchmarkSuitePlanV1;
  readonly target: RiyaBenchmarkTargetPort;
  readonly clock: RiyaBenchmarkMonotonicClockPort;
  /** Canonical UTC instant, injected. NEVER derived from the monotonic clock. */
  readonly createdAt: string;
  readonly memoryProbe?: RiyaBenchmarkMemoryProbePort;
  readonly signal?: AbortSignal;
}

/** A monotonic reader that refuses to go backwards or return a nonsense value. */
class MonotonicReader {
  private last = Number.NEGATIVE_INFINITY;

  public constructor(private readonly clock: RiyaBenchmarkMonotonicClockPort) {}

  public read(): number {
    const now = this.clock.nowMicros();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new RiyaHarnessError('CLOCK_INVALID');
    }
    if (now < this.last) {
      // A negative latency would read as an extremely fast request rather than as a broken clock.
      throw new RiyaHarnessError('CLOCK_MOVED_BACKWARD');
    }
    this.last = now;
    return now;
  }
}

/** One measured request's timings and counts, once it has terminated. */
interface RequestOutcome {
  readonly success: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly timeToFirstTokenMicros?: number;
  readonly endToEndLatencyMicros?: number;
  readonly decodeMicrosPerOutputToken?: number;
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new RiyaHarnessError('SUITE_ABORTED');
  }
}

/**
 * Execute one logical request and return its outcome, enforcing the target protocol.
 *
 * Protocol violations throw; ordinary target failures return an outcome.
 */
async function executeRequest(
  options: RunRiyaBenchmarkSuiteOptions,
  workload: RiyaBenchmarkWorkloadV1,
  clock: MonotonicReader,
  requestOrdinal: number,
  signal: AbortSignal,
): Promise<RequestOutcome> {
  let firstOutputMicros: number | undefined;
  let firstOutputCalls = 0;

  const start = clock.read();
  let result: RiyaBenchmarkInvocationResult;
  try {
    result = await options.target.invoke({
      requestOrdinal,
      // Required in a plan even though optional in RMB-A: an unbounded harness request is not a
      // measurement, it is a hang.
      requestTimeoutMicros: workload.requestTimeoutMicros ?? 0,
      signal,
      onFirstOutput: () => {
        firstOutputCalls += 1;
        firstOutputMicros ??= clock.read();
      },
    });
  } catch (error: unknown) {
    if (error instanceof RiyaHarnessError) {
      throw error;
    }
    // A target that throws instead of returning a terminal result has broken the protocol. It is not
    // recorded as a failed request, because a thrown error says nothing about what the model did.
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  const completion = clock.read();

  if (firstOutputCalls > 1) {
    // Two callbacks make the time-to-first-token sample ambiguous.
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }

  if (result.outcome === 'FAILURE') {
    // A failure may report what it consumed, and it must be exact if it does. No output is credited,
    // even if the target emitted some before failing: a partial reply is not a reply.
    if (result.inputTokens !== undefined) {
      if (!Number.isSafeInteger(result.inputTokens) || result.inputTokens < 0) {
        throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
      }
      if (result.inputTokens !== workload.inputTokenCount) {
        throw new RiyaHarnessError('INPUT_TOKEN_MISMATCH');
      }
    }
    return result.inputTokens === undefined
      ? { success: false }
      : { success: false, inputTokens: result.inputTokens };
  }

  if (firstOutputMicros === undefined) {
    // A success with no first-output callback has no time-to-first-token, and inventing one would put
    // a fabricated number in the p50.
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  if (!Number.isSafeInteger(result.outputTokens) || result.outputTokens < 1) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  if (result.outputTokens > workload.maximumOutputTokens) {
    throw new RiyaHarnessError('OUTPUT_TOKEN_LIMIT_EXCEEDED');
  }
  if (
    !Number.isSafeInteger(result.inputTokens) ||
    result.inputTokens !== workload.inputTokenCount
  ) {
    // Not averaged, not replaced with the planned count. A drift here means the tokenizer or the
    // prompt materialization changed, and that is exactly what a benchmark must not smooth over.
    throw new RiyaHarnessError('INPUT_TOKEN_MISMATCH');
  }

  return {
    success: true,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    timeToFirstTokenMicros: firstOutputMicros - start,
    endToEndLatencyMicros: completion - start,
    decodeMicrosPerOutputToken: decodeMicrosPerOutputToken(
      firstOutputMicros,
      completion,
      result.outputTokens,
    ),
  };
}

/**
 * Run `count` requests with at most `concurrency` in flight, admitting the next as a slot frees.
 *
 * No sleeps and no backoff: the harness admits as fast as slots allow, and everything after admission
 * — including the target's own queueing — is what is being measured.
 */
async function runPhase(
  options: RunRiyaBenchmarkSuiteOptions,
  workload: RiyaBenchmarkWorkloadV1,
  clock: MonotonicReader,
  count: number,
  concurrency: number,
  signal: AbortSignal,
): Promise<readonly RequestOutcome[]> {
  const outcomes: RequestOutcome[] = new Array<RequestOutcome>(count);
  let nextOrdinal = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      assertNotAborted(options.signal);
      const ordinal = nextOrdinal;
      if (ordinal >= count) {
        return;
      }
      nextOrdinal += 1;
      outcomes[ordinal] = await executeRequest(options, workload, clock, ordinal, signal);
    }
  };

  // Exactly `min(concurrency, count)` workers, each pulling the next ordinal. That IS the in-flight
  // bound: there is no separate counter to drift from reality.
  const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());
  await Promise.all(workers);
  return outcomes;
}

/** Fold terminated measured requests into an RMB-A observation. */
function observationFor(
  outcomes: readonly RequestOutcome[],
  measuredWindowMicros: number,
  memory: { readonly peakAcceleratorMemoryBytes?: number; readonly peakHostMemoryBytes?: number },
): RiyaBenchmarkObservationV1 {
  const successes = outcomes.filter((one) => one.success);
  const ttft = ascending(successes.map((one) => one.timeToFirstTokenMicros ?? 0));
  const e2e = ascending(successes.map((one) => one.endToEndLatencyMicros ?? 0));
  const decode = ascending(successes.map((one) => one.decodeMicrosPerOutputToken ?? 0));

  const ttftP50 = nearestRankPercentile(ttft, 0.5);
  const ttftP95 = nearestRankPercentile(ttft, 0.95);
  const e2eP50 = nearestRankPercentile(e2e, 0.5);
  const e2eP95 = nearestRankPercentile(e2e, 0.95);
  const decodeP50 = nearestRankPercentile(decode, 0.5);
  const decodeP95 = nearestRankPercentile(decode, 0.95);

  return createRiyaBenchmarkObservation({
    version: 1,
    attemptedRequests: outcomes.length,
    successfulRequests: successes.length,
    failedRequests: outcomes.length - successes.length,
    // Every terminated request that reported input usage counts, success or not.
    inputTokensTotal: outcomes.reduce((total, one) => total + (one.inputTokens ?? 0), 0),
    outputTokensTotal: successes.reduce((total, one) => total + (one.outputTokens ?? 0), 0),
    ...(ttftP50 === undefined || ttftP95 === undefined
      ? {}
      : { timeToFirstTokenMicrosP50: ttftP50, timeToFirstTokenMicrosP95: ttftP95 }),
    ...(e2eP50 === undefined || e2eP95 === undefined
      ? {}
      : { endToEndLatencyMicrosP50: e2eP50, endToEndLatencyMicrosP95: e2eP95 }),
    ...(decodeP50 === undefined || decodeP95 === undefined
      ? {}
      : { decodeMicrosPerOutputTokenP50: decodeP50, decodeMicrosPerOutputTokenP95: decodeP95 }),
    ...(memory.peakAcceleratorMemoryBytes === undefined
      ? {}
      : { peakAcceleratorMemoryBytes: memory.peakAcceleratorMemoryBytes }),
    ...(memory.peakHostMemoryBytes === undefined
      ? {}
      : { peakHostMemoryBytes: memory.peakHostMemoryBytes }),
    measuredWindowMicros,
  });
}

/** Read the optional memory probe, refusing an implausible reading rather than recording it. */
async function readMemory(probe: RiyaBenchmarkMemoryProbePort | undefined): Promise<{
  readonly peakAcceleratorMemoryBytes?: number;
  readonly peakHostMemoryBytes?: number;
}> {
  if (probe === undefined) {
    // Absent means not measured. A fabricated zero would sit in a table beside real readings.
    return {};
  }
  const reading = await probe.readCaseMemory();
  for (const value of [reading.peakAcceleratorMemoryBytes, reading.peakHostMemoryBytes]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
      throw new RiyaHarnessError('MEMORY_MEASUREMENT_INVALID');
    }
  }
  return reading;
}

/**
 * Run a suite and return an RMB-A result set.
 *
 * Throws a closed harness code on any protocol, identity, clock or abort failure — and produces no
 * partial result set when it does.
 */
export async function runRiyaBenchmarkSuite(
  options: RunRiyaBenchmarkSuiteOptions,
): Promise<RiyaBenchmarkResultSetV1> {
  assertNotAborted(options.signal);

  // Identity FIRST, from the target, deeply re-proved. Nothing runs against an unidentifiable target.
  const descriptor = options.target.descriptor();
  let subject: RiyaBenchmarkSubjectV1;
  let environment: RiyaBenchmarkEnvironmentV1;
  try {
    subject = createRiyaBenchmarkSubject(descriptor.subject);
  } catch {
    throw new RiyaHarnessError('TARGET_SUBJECT_INVALID');
  }
  try {
    environment = createRiyaBenchmarkEnvironment(descriptor.environment);
  } catch {
    throw new RiyaHarnessError('TARGET_ENVIRONMENT_INVALID');
  }

  for (const suiteCase of options.plan.cases) {
    if (suiteCase.batchSize !== RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE) {
      // Refused before any target work, so an unsupported plan costs nothing to discover.
      throw new RiyaHarnessError('UNSUPPORTED_BATCH_SIZE');
    }
  }

  const clock = new MonotonicReader(options.clock);
  const controller = new AbortController();
  const onAbort = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const results: RiyaBenchmarkEvidenceV1[] = [];

    for (const suiteCase of options.plan.cases) {
      assertNotAborted(options.signal);
      const workload = riyaBenchmarkWorkloadForCase(options.plan, suiteCase);

      // What the target actually prepared must match what the plan asked for, BEFORE warmup. Finding
      // a token-count disagreement in the numbers afterwards is finding it too late.
      const prepared = await options.target.prepareCase(workload);
      if (
        prepared.workloadCaseId !== workload.workloadCaseId ||
        prepared.promptProfileDigest !== workload.promptProfileDigest ||
        prepared.inputTokenCount !== workload.inputTokenCount ||
        prepared.maximumOutputTokens !== workload.maximumOutputTokens ||
        prepared.samplingConfigDigest !== workload.samplingConfigDigest ||
        prepared.streaming !== workload.streaming
      ) {
        throw new RiyaHarnessError('TARGET_CASE_MISMATCH');
      }

      // Warmup: same scheduler, same protocol enforcement, and excluded from every number below.
      if (suiteCase.warmupRequestCount > 0) {
        await runPhase(
          options,
          workload,
          clock,
          suiteCase.warmupRequestCount,
          suiteCase.concurrency,
          controller.signal,
        );
      }

      assertNotAborted(options.signal);
      const windowStart = clock.read();
      const outcomes = await runPhase(
        options,
        workload,
        clock,
        suiteCase.measuredRequestCount,
        suiteCase.concurrency,
        controller.signal,
      );
      const windowEnd = clock.read();
      if (windowEnd <= windowStart) {
        // A window of zero would make throughput infinite. A clock too coarse to separate the start
        // from the end cannot measure this suite.
        throw new RiyaHarnessError('CLOCK_INVALID');
      }

      const memory = await readMemory(options.memoryProbe);
      results.push(
        createRiyaBenchmarkEvidence({
          version: 1,
          subject,
          environment,
          workload,
          observation: observationFor(outcomes, windowEnd - windowStart, memory),
          createdAt: options.createdAt,
        }),
      );
    }

    return createRiyaBenchmarkResultSet({
      version: 1,
      results,
      expectedCaseIds: options.plan.cases.map((one) => one.workloadCaseId),
    });
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    // Nothing keeps running after this function returns: every worker was awaited, and there is no
    // timer, no interval and no detached promise anywhere in the harness.
    controller.abort();
  }
}
