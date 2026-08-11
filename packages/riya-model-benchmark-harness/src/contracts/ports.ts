/**
 * The three ports the harness runs against (RMB-B).
 *
 * ### Why ports at all
 *
 * The harness must never contain a provider SDK, a local inference engine or a clock. Everything it
 * cannot own is injected, so this package stays deterministic and testable and a future real adapter
 * is an implementation of `RiyaBenchmarkTargetPort` rather than a modification of anything here — and
 * emphatically not a modification of the production model gateway, which is the serving waist and must
 * not grow benchmark instrumentation.
 *
 * ### The target is CONTENT-OPAQUE
 *
 * A target hands back digests and token counts. There is no field a prompt, a customer message or a
 * reply fits in, in either direction. The adapter that eventually materializes a prompt owns that text
 * and never passes it here — which is what keeps benchmark artifacts safe to commit.
 *
 * ### These interfaces are a contract, not a defence
 *
 * A shape declared here is erased at run time, so a foreign adapter can return anything at all. Every
 * value crossing back from a port is therefore parsed strictly and rebuilt before the harness looks at
 * it: an unknown key is refused, not ignored. The declarations below say what a CONFORMING adapter
 * must do; the runtime firewall says what the harness will accept.
 */
import type {
  RiyaBenchmarkEnvironmentV1,
  RiyaBenchmarkSubjectV1,
  RiyaBenchmarkWorkloadV1,
} from '@qf-jarvis/riya-model-benchmark';

/**
 * A monotonic microsecond clock.
 *
 * Monotonic, not wall-clock: the numbers mean elapsed time and nothing else, so they are never used
 * for `createdAt`. A clock that moves backwards aborts the suite rather than producing a negative
 * latency that would look like a very fast request.
 */
export interface RiyaBenchmarkMonotonicClockPort {
  /** Microseconds since an arbitrary fixed origin. Safe integer, non-decreasing. */
  nowMicros: () => number;
}

/** What the target says it is. Both re-proved by the harness through the RMB-A constructors. */
export interface RiyaBenchmarkTargetDescriptor {
  readonly subject: RiyaBenchmarkSubjectV1;
  readonly environment: RiyaBenchmarkEnvironmentV1;
}

/**
 * What the target confirms it has prepared for one case.
 *
 * Checked for exact equality against the workload BEFORE warmup. A target that prepared 512 input
 * tokens for a case declaring 1024 is measuring something else, and finding that out from the numbers
 * afterwards is finding it out too late.
 */
export interface RiyaBenchmarkPreparedCase {
  readonly workloadCaseId: string;
  readonly promptProfileDigest: string;
  readonly inputTokenCount: number;
  readonly maximumOutputTokens: number;
  readonly samplingConfigDigest: string;
  readonly streaming: boolean;
}

/** One logical request, as the harness asks for it. */
export interface RiyaBenchmarkInvocation {
  /** 0-based within the phase. Deterministic, so a fake target can vary behaviour by ordinal. */
  readonly requestOrdinal: number;
  /**
   * The per-request deadline, in microseconds, measured from this invocation's admission.
   *
   * **The ADAPTER enforces it.** RMB-B core holds no ambient timer by design — it never reads a wall
   * clock and never schedules one — so there is nobody else who can. An adapter that cannot honour the
   * exact requested deadline is not a conforming RMB-B target, because two runs that abandoned a slow
   * request at different points produced different failure counts and different tails from the same
   * model, and the artifacts would still compare as equal.
   *
   * Expiry is DATA: return an ordinary `FAILURE`. It is not a protocol error, it does not abort the
   * suite, and the harness never retries it. The value here always equals the workload's
   * `requestTimeoutMicros` exactly.
   *
   * This is separate from `signal`, which cancels the whole suite rather than one request.
   */
  readonly requestTimeoutMicros: number;
  /**
   * Aborted when the suite is cancelled — by the caller, or by a protocol failure elsewhere in the
   * phase.
   *
   * A conforming target MUST settle promptly once this is aborted: stop work, stop emitting, and
   * resolve or reject. The harness waits for every in-flight invocation to settle before it returns,
   * so an adapter that ignores the signal makes the harness HANG rather than making it return while
   * benchmark work continues in the background. That is the deliberate failure direction — a returned
   * result with a live request still running against a model is the one outcome worse than a wait.
   */
  readonly signal: AbortSignal;
  /**
   * Call EXACTLY once, at the moment the first output token is available.
   *
   * The harness samples time-to-first-token here. A success that never called it is a protocol
   * violation rather than a fast request, and two calls mean the sample is ambiguous.
   */
  readonly onFirstOutput: () => void;
}

/** A request that produced output. Counts and nothing else. */
export interface RiyaBenchmarkInvocationSuccess {
  readonly outcome: 'SUCCESS';
  /** Must equal the workload's `inputTokenCount` exactly — see the harness header. */
  readonly inputTokens: number;
  /** At least one, at most the workload's `maximumOutputTokens`. */
  readonly outputTokens: number;
}

/** A request that did not. No output is credited, partial or otherwise. */
export interface RiyaBenchmarkInvocationFailure {
  readonly outcome: 'FAILURE';
  /** Optional, and exact when supplied: a target may know what it consumed before failing. */
  readonly inputTokens?: number;
}

export type RiyaBenchmarkInvocationResult =
  RiyaBenchmarkInvocationSuccess | RiyaBenchmarkInvocationFailure;

/**
 * The thing being benchmarked, behind a content-opaque boundary.
 *
 * Implemented by a fake in tests and, in a LATER slice, by a real provider or local-engine adapter.
 * RMB-B ships no real implementation and benchmarks no real model.
 */
export interface RiyaBenchmarkTargetPort {
  /**
   * The exact subject and environment this evidence will be stamped with.
   *
   * Read more than once, and required to answer identically every time: the harness locks the first
   * answer and re-proves it around every case. A target whose identity changes mid-suite would have
   * every artifact stamped with the identity it started as.
   */
  descriptor: () => RiyaBenchmarkTargetDescriptor;
  /** Confirm what has been prepared for a case. Called once per case, before warmup. */
  prepareCase: (workload: RiyaBenchmarkWorkloadV1) => Promise<RiyaBenchmarkPreparedCase>;
  /** Execute one logical request exactly once. The harness never asks twice. */
  invoke: (invocation: RiyaBenchmarkInvocation) => Promise<RiyaBenchmarkInvocationResult>;
}

/** Peak bytes for one case. Integers, above zero, within the RMB-A bounds, and nothing else. */
export interface RiyaBenchmarkMemoryReading {
  readonly peakAcceleratorMemoryBytes?: number;
  readonly peakHostMemoryBytes?: number;
}

/**
 * Optional peak-memory readings, scoped to ONE measured phase.
 *
 * Optional because most environments cannot supply them honestly, and a fabricated zero would sit in a
 * comparison table beside real readings. Absent means not measured. A hosted adapter, which cannot see
 * the machine at all, should simply omit the probe.
 */
export interface RiyaBenchmarkMemoryProbePort {
  /**
   * Open a measurement window for one case: AFTER its warmup, BEFORE its measured window starts.
   *
   * The begin/finish pair is what makes "peak memory" answerable. A probe that could only be READ at
   * the end would report a peak that might have come from warmup, from the previous case, or from
   * whatever else the process did — and a per-case column in a comparison table would be quietly
   * wrong. Setup time here is outside `measuredWindowMicros`, so an expensive reset does not inflate
   * the throughput denominator.
   */
  beginMeasuredCase: (context: {
    readonly workloadCaseId: string;
  }) => Promise<RiyaBenchmarkMemoryCasePort>;
}

/** One open measurement window. Exactly one of `finish` or `abort` is called, and awaited. */
export interface RiyaBenchmarkMemoryCasePort {
  /**
   * Close the window and report the peak observed BETWEEN begin and here — nothing earlier.
   *
   * Called once, after the measured window has closed, and only for a measured phase that completed.
   */
  finish: () => Promise<RiyaBenchmarkMemoryReading>;
  /**
   * Discard the window: the measured phase failed or the suite was cancelled.
   *
   * Awaited, so a probe holding a device handle has released it before the harness returns. A failure
   * thrown here is swallowed — cleanup must never replace the protocol error that caused it, because
   * the original is the one that explains what went wrong.
   */
  abort: () => Promise<void>;
}
