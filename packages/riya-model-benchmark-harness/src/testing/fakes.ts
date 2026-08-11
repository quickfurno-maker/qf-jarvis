/**
 * Deterministic fakes for the RMB-B specs. TESTING SUBPATH ONLY.
 *
 * ### These are the only targets this package ever runs against
 *
 * No real model, no provider, no engine — in the tests or anywhere else in RMB-B. Every identifier is
 * obviously invented and every latency is a number the spec chose, so nothing here can be read as a
 * performance characteristic of anything.
 *
 * ### The clock is manual on purpose
 *
 * Latency arithmetic has to be exact and reproducible. A fake target advances a manual clock by a
 * stated number of microseconds, so a spec can assert `TTFT === 3` rather than "roughly". It also
 * means these tests have no real elapsed time in them at all.
 */
import type {
  RiyaBenchmarkEnvironmentV1,
  RiyaBenchmarkSubjectV1,
  RiyaBenchmarkWorkloadV1,
} from '@qf-jarvis/riya-model-benchmark';
import {
  syntheticHostedEnvironment,
  syntheticLocalEnvironment,
  syntheticSubject,
} from '@qf-jarvis/riya-model-benchmark/testing';

import type {
  RiyaBenchmarkInvocation,
  RiyaBenchmarkInvocationResult,
  RiyaBenchmarkMemoryProbePort,
  RiyaBenchmarkMonotonicClockPort,
  RiyaBenchmarkPreparedCase,
  RiyaBenchmarkTargetDescriptor,
  RiyaBenchmarkTargetPort,
} from '../contracts/ports.js';

/** A fixed canonical instant. Injected as `createdAt`; never derived from the manual clock. */
export const SYNTHETIC_HARNESS_INSTANT = '2026-01-01T00:00:00Z';

/** A clock the test drives by hand. Monotonic unless a spec deliberately rewinds it. */
export class ManualClock implements RiyaBenchmarkMonotonicClockPort {
  private current: number;

  public constructor(start = 1_000) {
    this.current = start;
  }

  public nowMicros = (): number => this.current;

  public advance(micros: number): void {
    this.current += micros;
  }

  /**
   * Move the clock forward TO `value`, never backward.
   *
   * This is what lets a fake model real overlap. Two requests running concurrently each finish at
   * their own start plus their own duration; if each simply ADDED its duration, eight concurrent
   * requests would consume eight durations of wall time and concurrency could never look faster than
   * serial — which would make every throughput spec vacuous.
   */
  public advanceTo(value: number): void {
    this.current = Math.max(this.current, value);
  }

  /** For the spec that proves a backwards clock aborts rather than producing negative latency. */
  public rewind(micros: number): void {
    this.current -= micros;
  }

  /** For the spec that proves a non-integer reading is refused. */
  public setRaw(value: number): void {
    this.current = value;
  }
}

/** How one fake request should behave, by ordinal. */
export interface FakeRequestScript {
  /** Micros the clock advances before the first-output callback. */
  readonly firstOutputAfterMicros: number;
  /** Micros the clock advances between first output and completion. */
  readonly completeAfterMicros: number;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly outputTokens?: number;
  /** A failure may report exact input usage. */
  readonly failureReportsInput?: boolean;
  /** Deliberate protocol violations, for the specs that prove each is refused. */
  readonly skipFirstOutput?: boolean;
  readonly doubleFirstOutput?: boolean;
  readonly wrongInputTokens?: number;
  readonly overLimitOutputTokens?: number;
  readonly throwInstead?: boolean;
}

export interface FakeTargetOptions {
  readonly subject?: RiyaBenchmarkSubjectV1;
  readonly environment?: RiyaBenchmarkEnvironmentV1;
  /** Per-ordinal behaviour; ordinals past the end reuse the last entry. */
  readonly script?: readonly FakeRequestScript[];
  /**
   * Per-case override, for suites where one case must misbehave and the others must not.
   *
   * Ordinals restart at every case and every phase, so an index into `script` cannot single out the
   * second case of a suite.
   */
  readonly scriptByCaseId?: Readonly<Record<string, readonly FakeRequestScript[]>>;
  /** Override what `prepareCase` claims, for the case-mismatch specs. */
  readonly preparedOverride?: Partial<RiyaBenchmarkPreparedCase>;
}

const DEFAULT_SCRIPT: FakeRequestScript = {
  firstOutputAfterMicros: 100,
  completeAfterMicros: 400,
  outcome: 'SUCCESS',
  outputTokens: 8,
};

/**
 * A target that does exactly what a script says, on a manual clock.
 *
 * Tracks max in-flight so a spec can prove the scheduler never exceeds `concurrency` — the property
 * that makes a concurrency sweep mean anything.
 */
export class FakeTarget implements RiyaBenchmarkTargetPort {
  public inFlight = 0;
  public maxInFlight = 0;
  public readonly invokedOrdinals: number[] = [];
  public prepareCalls = 0;

  public constructor(
    private readonly clock: ManualClock,
    private readonly options: FakeTargetOptions = {},
  ) {}

  public descriptor = (): RiyaBenchmarkTargetDescriptor => ({
    subject: this.options.subject ?? syntheticSubject(),
    environment: this.options.environment ?? syntheticLocalEnvironment(),
  });

  public prepareCase = (workload: RiyaBenchmarkWorkloadV1): Promise<RiyaBenchmarkPreparedCase> => {
    this.prepareCalls += 1;
    this.currentCaseId = workload.workloadCaseId;
    return Promise.resolve({
      workloadCaseId: workload.workloadCaseId,
      promptProfileDigest: workload.promptProfileDigest,
      inputTokenCount: workload.inputTokenCount,
      maximumOutputTokens: workload.maximumOutputTokens,
      samplingConfigDigest: workload.samplingConfigDigest,
      streaming: workload.streaming,
      ...this.options.preparedOverride,
    });
  };

  public invoke = async (
    invocation: RiyaBenchmarkInvocation,
  ): Promise<RiyaBenchmarkInvocationResult> => {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.invokedOrdinals.push(invocation.requestOrdinal);
    try {
      const script = this.scriptFor(invocation.requestOrdinal);
      if (script.throwInstead === true) {
        throw new Error('fake target failure');
      }

      // Absolute scheduling from THIS request's own start, so concurrent requests overlap in virtual
      // time instead of queueing behind each other on the shared clock.
      const startedAt = this.clock.nowMicros();
      const firstOutputAt = startedAt + script.firstOutputAfterMicros;
      const completesAt = firstOutputAt + script.completeAfterMicros;

      // Yield once so several invocations are genuinely in flight together.
      await Promise.resolve();
      this.clock.advanceTo(firstOutputAt);

      if (script.outcome === 'SUCCESS' && script.skipFirstOutput !== true) {
        invocation.onFirstOutput();
        if (script.doubleFirstOutput === true) {
          invocation.onFirstOutput();
        }
      }
      this.clock.advanceTo(completesAt);

      if (script.outcome === 'FAILURE') {
        return script.failureReportsInput === true
          ? { outcome: 'FAILURE', inputTokens: script.wrongInputTokens ?? 512 }
          : { outcome: 'FAILURE' };
      }
      return {
        outcome: 'SUCCESS',
        inputTokens: script.wrongInputTokens ?? 512,
        outputTokens: script.overLimitOutputTokens ?? script.outputTokens ?? 8,
      };
    } finally {
      this.inFlight -= 1;
    }
  };

  /** The case currently being prepared, so `scriptByCaseId` can target it. */
  private currentCaseId = '';

  private scriptFor(ordinal: number): FakeRequestScript {
    const byCase = this.options.scriptByCaseId?.[this.currentCaseId];
    const script = byCase ?? this.options.script;
    if (script === undefined || script.length === 0) {
      return DEFAULT_SCRIPT;
    }
    return script[Math.min(ordinal, script.length - 1)] ?? DEFAULT_SCRIPT;
  }
}

/** A hosted target, for the spec that proves an opaque environment is stamped as given. */
export function fakeHostedTarget(clock: ManualClock, options: FakeTargetOptions = {}): FakeTarget {
  return new FakeTarget(clock, { environment: syntheticHostedEnvironment(), ...options });
}

/** A memory probe returning whatever the spec asked for. */
export class FakeMemoryProbe implements RiyaBenchmarkMemoryProbePort {
  public constructor(
    private readonly reading: {
      readonly peakAcceleratorMemoryBytes?: number;
      readonly peakHostMemoryBytes?: number;
    },
  ) {}

  public readCaseMemory = (): Promise<{
    readonly peakAcceleratorMemoryBytes?: number;
    readonly peakHostMemoryBytes?: number;
  }> => Promise.resolve(this.reading);
}
