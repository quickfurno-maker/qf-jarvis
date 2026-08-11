/**
 * The benchmark runner (RMB-B).
 *
 * ### It measures; RMB-A decides what is valid
 *
 * Every artifact leaves through `createRiyaBenchmarkObservation`, `createRiyaBenchmarkEvidence` and
 * `createRiyaBenchmarkResultSet`. No digest, manifest or comparison logic is reimplemented here — one
 * evidence authority, and a harness that cannot quietly relax it.
 *
 * ### The plan is re-proved at this boundary
 *
 * A typed plan is not a proven plan: a caller can reach this function through JavaScript, through
 * deserialization or through a cast, and the type would be a comment. So the first thing that happens
 * is `createRiyaBenchmarkSuitePlan`, and everything downstream reads the value it returns. The batch
 * check follows immediately — both BEFORE the target is touched at all, so an unrunnable plan costs
 * nothing to discover and cannot leave a target half-prepared.
 *
 * ### Identity comes from the TARGET, never the caller — and it is locked
 *
 * Subject and environment are read from `target.descriptor()` and re-proved through the RMB-A
 * constructors. A caller cannot supply a competing subject, because "run against A and stamp it as B"
 * is the one forgery this package would otherwise make easy. The first proven pair is then LOCKED and
 * re-proved around every case, so a target that changes underneath the suite fails it instead of
 * producing artifacts stamped with what it used to be.
 *
 * ### One request, once
 *
 * No backoff, no sleep, no second attempt. A harness that asked twice would measure a recovery policy.
 * If a target fails, that is a failed request and the observation says so.
 *
 * ### batchSize 1 only, in V1
 *
 * Hosted APIs are one logical request per invocation, and local engines dynamic-batch concurrent
 * requests on their own — so explicit batching is not needed to produce load, and it would complicate
 * per-request TTFT and completion sampling. A plan with a larger batch is REFUSED before any target
 * work rather than silently executed as if it were one.
 *
 * ### A protocol failure invalidates the whole suite, and nothing outlives the call
 *
 * A target failure is data. A clock going backwards, a success with no first-output callback, a
 * mismatched input-token count — those mean the measurement is unsound, and the honest output is no
 * output. There is no partial result set, because a partial set is a set somebody will compare.
 *
 * When one worker fails, the internal controller is aborted, no further ordinal is admitted, and every
 * sibling is awaited to settlement before this function returns or throws. The ORIGINAL failure is the
 * one that surfaces; the cancellation errors it causes never overwrite it.
 */
import {
  createRiyaBenchmarkEnvironment,
  createRiyaBenchmarkEvidence,
  createRiyaBenchmarkObservation,
  createRiyaBenchmarkResultSet,
  createRiyaBenchmarkSubject,
} from '@qf-jarvis/riya-model-benchmark';
import type {
  RiyaBenchmarkEvidenceV1,
  RiyaBenchmarkObservationV1,
  RiyaBenchmarkResultSetV1,
  RiyaBenchmarkWorkloadV1,
} from '@qf-jarvis/riya-model-benchmark';

import { RiyaHarnessError } from '../contracts/errors.js';
import type {
  RiyaBenchmarkMemoryCasePort,
  RiyaBenchmarkMemoryProbePort,
  RiyaBenchmarkMemoryReading,
  RiyaBenchmarkMonotonicClockPort,
  RiyaBenchmarkTargetPort,
} from '../contracts/ports.js';
import {
  createRiyaBenchmarkSuitePlan,
  RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE,
  riyaBenchmarkWorkloadForCase,
} from '../contracts/suite-plan.js';
import type { RiyaBenchmarkSuitePlanV1 } from '../contracts/suite-plan.js';
import { suiteIdentityLockKey } from '../internal/identity-lock.js';
import type { RiyaBenchmarkSuiteIdentity } from '../internal/identity-lock.js';
import {
  callForeign,
  parseInvocationResult,
  parseMemoryReading,
  parsePreparedCase,
  parseTargetDescriptor,
} from '../internal/port-firewall.js';
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

/**
 * The suite's single cancellation authority.
 *
 * One controller for the whole run, so a failure anywhere stops admissions everywhere. The FIRST
 * recorded failure wins: everything that follows is a consequence of it, and surfacing a consequential
 * `SUITE_ABORTED` in place of the input-token mismatch that caused it would send whoever reads the
 * error looking in the wrong place.
 */
class SuiteCancellation {
  private readonly controller = new AbortController();
  private failure: RiyaHarnessError | undefined;

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  public get firstFailure(): RiyaHarnessError | undefined {
    return this.failure;
  }

  /** Record a load-bearing failure and stop the suite. Idempotent in the failure it keeps. */
  public fail(error: RiyaHarnessError): void {
    this.failure ??= error;
    this.controller.abort();
  }

  /** The CALLER cancelled. Only becomes the surfaced error if nothing had already failed. */
  public cancelExternally(): void {
    this.fail(new RiyaHarnessError('SUITE_ABORTED'));
  }

  /**
   * Throw if the suite has already stopped, with the failure that stopped it.
   *
   * One method rather than a repeated check, so the reason a suite is over is read from one place and
   * a caller cancellation can never be reported as something else.
   */
  public throwIfStopped(): void {
    if (this.controller.signal.aborted) {
      throw this.failure ?? new RiyaHarnessError('SUITE_ABORTED');
    }
  }

  /** Stop admissions at the end of the run. Records nothing: a finished suite has not failed. */
  public close(): void {
    this.controller.abort();
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

/** Everything a phase needs, so the worker loop reads as the scheduler it is. */
interface PhaseContext {
  readonly target: RiyaBenchmarkTargetPort;
  readonly workload: RiyaBenchmarkWorkloadV1;
  readonly requestTimeoutMicros: number;
  readonly clock: MonotonicReader;
  readonly cancellation: SuiteCancellation;
}

/** A thrown value, reduced to this package's closed vocabulary. */
function asHarnessError(error: unknown): RiyaHarnessError {
  return error instanceof RiyaHarnessError
    ? error
    : new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
}

/**
 * Execute one logical request and return its outcome, enforcing the target protocol.
 *
 * Protocol violations throw; ordinary target failures return an outcome.
 */
async function executeRequest(
  context: PhaseContext,
  requestOrdinal: number,
): Promise<RequestOutcome> {
  const { workload, clock, cancellation } = context;
  let firstOutputMicros: number | undefined;
  let firstOutputCalls = 0;

  const start = clock.read();
  let result;
  try {
    result = parseInvocationResult(
      await context.target.invoke({
        requestOrdinal,
        requestTimeoutMicros: context.requestTimeoutMicros,
        signal: cancellation.signal,
        onFirstOutput: () => {
          firstOutputCalls += 1;
          firstOutputMicros ??= clock.read();
        },
      }),
    );
  } catch (error: unknown) {
    if (error instanceof RiyaHarnessError) {
      throw error;
    }
    // A target that throws BECAUSE it was cancelled has not broken any protocol — it did exactly what
    // the port asks. Calling that a protocol violation would let a clean cancellation masquerade as a
    // broken adapter, and in the log it would look like the target's fault.
    if (cancellation.aborted) {
      throw new RiyaHarnessError('SUITE_ABORTED');
    }
    // Otherwise: a thrown error says nothing about what the model did, so it is not recorded as a
    // failed request either.
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  const completion = clock.read();

  if (firstOutputCalls > 1) {
    // Two callbacks make the time-to-first-token sample ambiguous.
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }

  if (result.outcome === 'FAILURE') {
    // A failure may report what it consumed, and it must be exact if it does. No output is credited,
    // even if the target emitted some before failing: a partial reply is not a reply. A deadline that
    // expired arrives here too — a timeout is measurement data, not a protocol error.
    if (result.inputTokens !== undefined && result.inputTokens !== workload.inputTokenCount) {
      throw new RiyaHarnessError('INPUT_TOKEN_MISMATCH');
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
  if (result.outputTokens < 1) {
    throw new RiyaHarnessError('TARGET_PROTOCOL_INVALID');
  }
  if (result.outputTokens > workload.maximumOutputTokens) {
    throw new RiyaHarnessError('OUTPUT_TOKEN_LIMIT_EXCEEDED');
  }
  if (result.inputTokens !== workload.inputTokenCount) {
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
 *
 * ### Quiescence
 *
 * Every worker consults the INTERNAL signal before each admission, so once anything fails, nothing new
 * starts. A worker never propagates its own rejection: it records the failure and returns, and the
 * phase waits for ALL of them to settle. A fail-fast join would hand control back while siblings were
 * still executing requests against the target, which is the one thing a benchmark harness must not do
 * — the caller would see a rejected promise while load continued against a model.
 */
async function runPhase(
  context: PhaseContext,
  count: number,
  concurrency: number,
): Promise<readonly RequestOutcome[]> {
  const outcomes: RequestOutcome[] = new Array<RequestOutcome>(count);
  const { cancellation } = context;
  let nextOrdinal = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      // The INTERNAL signal, not the caller's: a protocol failure in a sibling must stop admissions
      // even when the caller supplied no signal at all.
      if (cancellation.aborted) {
        return;
      }
      const ordinal = nextOrdinal;
      if (ordinal >= count) {
        return;
      }
      nextOrdinal += 1;
      try {
        outcomes[ordinal] = await executeRequest(context, ordinal);
      } catch (error: unknown) {
        cancellation.fail(asHarnessError(error));
        return;
      }
    }
  };

  // Exactly `min(concurrency, count)` workers, each pulling the next ordinal. That IS the in-flight
  // bound: there is no separate counter to drift from reality.
  const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());
  // Settlement of every worker, unconditionally. This is the drain.
  await Promise.allSettled(workers);

  const failure = cancellation.firstFailure;
  if (failure !== undefined) {
    throw failure;
  }
  return outcomes;
}

/** Fold terminated measured requests into an RMB-A observation. */
function observationFor(
  outcomes: readonly RequestOutcome[],
  measuredWindowMicros: number,
  memory: RiyaBenchmarkMemoryReading,
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

/**
 * Read and re-prove what the target says it is.
 *
 * Three refusals, three codes: an unusable outer shape, an unprovable subject, an unprovable
 * environment. RMB-A decides the last two; this function only decides which code to say it in.
 */
async function proveTargetIdentity(
  target: RiyaBenchmarkTargetPort,
): Promise<RiyaBenchmarkSuiteIdentity> {
  const raw = await callForeign(() => target.descriptor(), 'TARGET_PROTOCOL_INVALID');
  const descriptor = parseTargetDescriptor(raw);

  let subject;
  try {
    subject = createRiyaBenchmarkSubject(descriptor.subject);
  } catch {
    throw new RiyaHarnessError('TARGET_SUBJECT_INVALID');
  }

  let environment;
  try {
    environment = createRiyaBenchmarkEnvironment(descriptor.environment);
  } catch {
    throw new RiyaHarnessError('TARGET_ENVIRONMENT_INVALID');
  }

  return { subject, environment, lockKey: suiteIdentityLockKey(subject, environment) };
}

/** Re-prove the target against the locked identity. Any difference fails the whole suite. */
async function assertIdentityUnchanged(
  target: RiyaBenchmarkTargetPort,
  lock: RiyaBenchmarkSuiteIdentity,
): Promise<void> {
  const current = await proveTargetIdentity(target);
  if (current.lockKey !== lock.lockKey) {
    throw new RiyaHarnessError('TARGET_IDENTITY_CHANGED');
  }
}

/** Release an open memory case. A cleanup failure never replaces the failure that caused it. */
async function abortMemoryCase(memoryCase: RiyaBenchmarkMemoryCasePort): Promise<void> {
  try {
    await memoryCase.abort();
  } catch {
    // Deliberately swallowed: the original protocol failure is the one that explains the run.
  }
}

/**
 * Hand a finished measurement to RMB-A.
 *
 * RMB-A refusing something the harness assembled is a harness bug, not a caller error — but the public
 * boundary promises ONE error type, so a `RiyaBenchmarkError` surfacing here would break that promise
 * at the least convenient moment. Precise input failures were caught upstream with their own codes;
 * this is the backstop, and it never rewrites an error that is already ours.
 */
function viaEvidenceAuthority<T>(build: () => T): T {
  try {
    return build();
  } catch (error: unknown) {
    if (error instanceof RiyaHarnessError) {
      throw error;
    }
    throw new RiyaHarnessError('EVIDENCE_CONSTRUCTION_INVALID');
  }
}

/**
 * Run a suite and return an RMB-A result set.
 *
 * Throws a closed harness code on any plan, protocol, identity, clock, memory or abort failure — and
 * produces no partial result set when it does.
 */
export async function runRiyaBenchmarkSuite(
  options: RunRiyaBenchmarkSuiteOptions,
): Promise<RiyaBenchmarkResultSetV1> {
  // The plan, re-proved at the boundary and used in place of the caller's value from here on. Nothing
  // has touched the target yet, and nothing will until this and the batch check have passed.
  const plan = createRiyaBenchmarkSuitePlan(options.plan);
  for (const suiteCase of plan.cases) {
    if (suiteCase.batchSize !== RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE) {
      throw new RiyaHarnessError('UNSUPPORTED_BATCH_SIZE');
    }
  }

  const cancellation = new SuiteCancellation();
  if (options.signal?.aborted === true) {
    cancellation.cancelExternally();
  }
  const onAbort = (): void => {
    cancellation.cancelExternally();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const clock = new MonotonicReader(options.clock);
  const { target } = options;

  try {
    cancellation.throwIfStopped();

    // The identity every artifact in this run will be stamped with, and the value the target is held
    // to for the rest of the suite.
    const lock = await proveTargetIdentity(target);
    const results: RiyaBenchmarkEvidenceV1[] = [];

    for (const suiteCase of plan.cases) {
      cancellation.throwIfStopped();
      await assertIdentityUnchanged(target, lock);

      const workload = riyaBenchmarkWorkloadForCase(plan, suiteCase);
      const requestTimeoutMicros = workload.requestTimeoutMicros;
      if (requestTimeoutMicros === undefined) {
        // Unreachable through the plan constructor, which requires it. Refusing rather than
        // substituting a zero keeps "the adapter enforces the exact deadline" true.
        throw new RiyaHarnessError('PLAN_INVALID');
      }
      const context: PhaseContext = {
        target,
        workload,
        requestTimeoutMicros,
        clock,
        cancellation,
      };

      // What the target actually prepared must match what the plan asked for, BEFORE warmup. Finding
      // a token-count disagreement in the numbers afterwards is finding it too late.
      const prepared = parsePreparedCase(
        await callForeign(() => target.prepareCase(workload), 'TARGET_PROTOCOL_INVALID'),
      );
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
        await runPhase(context, suiteCase.warmupRequestCount, suiteCase.concurrency);
      }

      // The memory window opens AFTER warmup and BEFORE the measured window, so a peak can only have
      // come from the measured phase — and the probe's own setup cost stays out of the denominator.
      const probe = options.memoryProbe;
      let openMemoryCase: RiyaBenchmarkMemoryCasePort | undefined;
      if (probe !== undefined) {
        openMemoryCase = await callForeign(
          () => probe.beginMeasuredCase({ workloadCaseId: workload.workloadCaseId }),
          'MEMORY_MEASUREMENT_INVALID',
        );
      }

      try {
        const windowStart = clock.read();
        const outcomes = await runPhase(
          context,
          suiteCase.measuredRequestCount,
          suiteCase.concurrency,
        );
        const windowEnd = clock.read();
        if (windowEnd <= windowStart) {
          // A window of zero would make throughput infinite. A clock too coarse to separate the start
          // from the end cannot measure this suite.
          throw new RiyaHarnessError('CLOCK_INVALID');
        }

        let memory: RiyaBenchmarkMemoryReading = {};
        if (openMemoryCase !== undefined) {
          const closing = openMemoryCase;
          memory = parseMemoryReading(
            await callForeign(() => closing.finish(), 'MEMORY_MEASUREMENT_INVALID'),
          );
          openMemoryCase = undefined;
        }

        // Re-proved after the measurement, before the evidence is accepted: a target that drifted
        // DURING the case is caught here rather than stamped with what it used to be.
        await assertIdentityUnchanged(target, lock);

        const observation = viaEvidenceAuthority(() =>
          observationFor(outcomes, windowEnd - windowStart, memory),
        );
        results.push(
          viaEvidenceAuthority(() =>
            createRiyaBenchmarkEvidence({
              version: 1,
              subject: lock.subject,
              environment: lock.environment,
              workload,
              observation,
              createdAt: options.createdAt,
            }),
          ),
        );
      } catch (error: unknown) {
        if (openMemoryCase !== undefined) {
          await abortMemoryCase(openMemoryCase);
        }
        throw error;
      }
    }

    return viaEvidenceAuthority(() =>
      createRiyaBenchmarkResultSet({
        version: 1,
        results,
        expectedCaseIds: plan.cases.map((one) => one.workloadCaseId),
      }),
    );
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    // Nothing keeps running after this function returns: every worker settled inside its phase, every
    // memory case was finished or aborted, and there is no timer, no interval and no detached promise
    // anywhere in the harness.
    cancellation.close();
  }
}
