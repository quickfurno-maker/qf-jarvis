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
  readonly requestTimeoutMicros: number;
  /** Aborted when the suite is aborted. A target must stop promptly. */
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
  /** The exact subject and environment this evidence will be stamped with. */
  descriptor: () => RiyaBenchmarkTargetDescriptor;
  /** Confirm what has been prepared for a case. Called once per case, before warmup. */
  prepareCase: (workload: RiyaBenchmarkWorkloadV1) => Promise<RiyaBenchmarkPreparedCase>;
  /** Execute one logical request exactly once. The harness never retries. */
  invoke: (invocation: RiyaBenchmarkInvocation) => Promise<RiyaBenchmarkInvocationResult>;
}

/**
 * Optional peak-memory readings for one case.
 *
 * Optional because most environments cannot supply them honestly, and a fabricated zero would sit in a
 * comparison table beside real readings. Absent means not measured.
 */
export interface RiyaBenchmarkMemoryProbePort {
  /** Called once per case, after the measured window closes. */
  readCaseMemory: () => Promise<{
    readonly peakAcceleratorMemoryBytes?: number;
    readonly peakHostMemoryBytes?: number;
  }>;
}
