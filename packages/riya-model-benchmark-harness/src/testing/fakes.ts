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
 * means these tests contain no real elapsed time at all.
 *
 * ### Some of them are deliberately slow, and some are deliberately broken
 *
 * A target that resolves instantly can never prove that the harness waits for its siblings: the
 * failure and the drain happen in the same tick and every ordering passes. So a script entry can HOLD
 * until the spec releases it, and cancellation is cooperative — which is what makes quiescence
 * observable.
 *
 * Others return values their TypeScript signature forbids. That is the point: at run time a foreign
 * adapter is bound by nothing, and the firewall the harness runs every port value through is only
 * worth having if something actually tries to get past it.
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
  RiyaBenchmarkMemoryCasePort,
  RiyaBenchmarkMemoryProbePort,
  RiyaBenchmarkMemoryReading,
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
   * requests would consume eight durations of virtual time and concurrency could never look faster
   * than serial — which would make every throughput spec vacuous.
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

/**
 * A promise a spec opens by hand.
 *
 * The whole point of the deferred fakes: no timer, no elapsed time, and the test decides the exact
 * interleaving it wants to prove.
 */
class Gate {
  public readonly opened: Promise<void>;
  private open: () => void = () => undefined;

  public constructor() {
    this.opened = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  public unlock(): void {
    this.open();
  }
}

/** Resolves when the signal aborts — the cooperative half of a cancellable fake. */
function whenAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
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
  /**
   * Return this exact value instead of a well-formed result.
   *
   * Typed `unknown` because that is what a foreign adapter really returns — a raw reply, an extra key,
   * a null. The firewall is what decides whether it is a result.
   */
  readonly rawResult?: unknown;
  /** Hold this request until the spec releases it or the suite is cancelled. */
  readonly holdUntilReleased?: boolean;
  /** What a held request does when cancelled. Throwing is the common adapter behaviour. */
  readonly onCancel?: 'THROW' | 'FAILURE';
  /**
   * Once cancelled, do not settle until the spec says so.
   *
   * This is what makes the drain observable. A target that settles the instant it is cancelled hides
   * the difference between "the harness waited" and "the harness returned and the requests happened
   * to finish first" — both leave zero in flight by the time an assertion runs.
   */
  readonly holdOnCancel?: boolean;
  /** Bytes this request reports to a memory observer while it runs. */
  readonly peakHostMemoryBytes?: number;
}

/** The half of the fake memory probe a fake target talks to. */
export interface FakeMemoryObserver {
  observe: (bytes: number) => void;
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
  /** Return this exact value from `prepareCase`, well-formed or not. */
  readonly preparedRaw?: unknown;
  readonly prepareThrows?: boolean;
  /** Return this exact value from `descriptor()`, well-formed or not. */
  readonly descriptorRaw?: unknown;
  readonly descriptorThrows?: boolean;
  /** After this many descriptor reads, start reporting the drifted identity below. */
  readonly driftAfterDescriptorCalls?: number;
  readonly driftSubject?: RiyaBenchmarkSubjectV1;
  readonly driftEnvironment?: RiyaBenchmarkEnvironmentV1;
  /** Where a script's `peakHostMemoryBytes` is reported. */
  readonly memoryObserver?: FakeMemoryObserver;
  /**
   * Bytes reported by the Nth invocation of the whole run, warmup included.
   *
   * Ordinals restart at every phase and every case, so an index into `script` cannot tell a warmup
   * request apart from the measured request that reuses its ordinal — which is precisely the
   * distinction the memory lifecycle exists to make.
   */
  readonly memoryBytesByInvocation?: readonly number[];
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
 * that makes a concurrency sweep mean anything — and tracks admissions and settlements so a spec can
 * prove nothing was admitted after a failure and nothing was still running when the suite returned.
 */
export class FakeTarget implements RiyaBenchmarkTargetPort {
  public inFlight = 0;
  public maxInFlight = 0;
  public readonly invokedOrdinals: number[] = [];
  public readonly settledOrdinals: number[] = [];
  public readonly invokedTimeouts: number[] = [];
  public prepareCalls = 0;
  public descriptorCalls = 0;

  /** Requests that have been cancelled and are deliberately not settling yet. */
  public cancelPending = 0;

  private readonly cancelGate = new Gate();
  private readonly cancelWaiters: { readonly count: number; readonly gate: Gate }[] = [];
  private readonly gates = new Map<number, Gate>();
  private readonly admissionIndex = new Map<RiyaBenchmarkInvocation, number>();
  private readonly inFlightWaiters: { readonly count: number; readonly gate: Gate }[] = [];
  private currentCaseId = '';

  public constructor(
    private readonly clock: ManualClock,
    private readonly options: FakeTargetOptions = {},
  ) {}

  public descriptor = (): RiyaBenchmarkTargetDescriptor => {
    this.descriptorCalls += 1;
    if (this.options.descriptorThrows === true) {
      throw new Error('descriptor exploded');
    }
    if (this.options.descriptorRaw !== undefined) {
      // A forged descriptor is exactly what the firewall exists to refuse; the assertion IS the test.
      return this.options.descriptorRaw as RiyaBenchmarkTargetDescriptor;
    }
    const drift = this.options.driftAfterDescriptorCalls;
    const drifted = drift !== undefined && this.descriptorCalls > drift;
    return {
      subject:
        (drifted ? this.options.driftSubject : undefined) ??
        this.options.subject ??
        syntheticSubject(),
      environment:
        (drifted ? this.options.driftEnvironment : undefined) ??
        this.options.environment ??
        syntheticLocalEnvironment(),
    };
  };

  public prepareCase = (workload: RiyaBenchmarkWorkloadV1): Promise<RiyaBenchmarkPreparedCase> => {
    this.prepareCalls += 1;
    this.currentCaseId = workload.workloadCaseId;
    if (this.options.prepareThrows === true) {
      return Promise.reject(new Error('prepare exploded'));
    }
    if (this.options.preparedRaw !== undefined) {
      return Promise.resolve(this.options.preparedRaw as RiyaBenchmarkPreparedCase);
    }
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
    this.enter(invocation);
    try {
      const script = this.scriptFor(invocation.requestOrdinal);

      if (script.holdUntilReleased === true) {
        await Promise.race([
          this.gateFor(invocation.requestOrdinal).opened,
          whenAborted(invocation.signal),
        ]);
        if (invocation.signal.aborted) {
          if (script.holdOnCancel === true) {
            this.cancelPending += 1;
            for (const waiter of this.cancelWaiters) {
              if (this.cancelPending >= waiter.count) {
                waiter.gate.unlock();
              }
            }
            await this.cancelGate.opened;
            this.cancelPending -= 1;
          }
          // A conforming adapter settles promptly once cancelled. Throwing is what most of them do,
          // and the harness must read that as cancellation rather than as a broken target.
          if (script.onCancel === 'FAILURE') {
            return { outcome: 'FAILURE' };
          }
          throw new Error('cancelled by the caller');
        }
      }

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

      const bytes =
        this.options.memoryBytesByInvocation?.[this.invocationIndex(invocation)] ??
        script.peakHostMemoryBytes;
      if (bytes !== undefined) {
        this.options.memoryObserver?.observe(bytes);
      }

      if (script.outcome === 'SUCCESS' && script.skipFirstOutput !== true) {
        invocation.onFirstOutput();
        if (script.doubleFirstOutput === true) {
          invocation.onFirstOutput();
        }
      }
      this.clock.advanceTo(completesAt);

      if (script.rawResult !== undefined) {
        return script.rawResult as RiyaBenchmarkInvocationResult;
      }
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
      this.settledOrdinals.push(invocation.requestOrdinal);
    }
  };

  /** Let a held request finish. */
  public release(ordinal: number): void {
    this.gateFor(ordinal).unlock();
  }

  /** Let every request that is stuck mid-cancellation settle. */
  public releaseCancels(): void {
    this.cancelGate.unlock();
  }

  /** Resolves once `count` requests have been cancelled and are refusing to settle yet. */
  public whenCancelPending(count: number): Promise<void> {
    if (this.cancelPending >= count) {
      return Promise.resolve();
    }
    const gate = new Gate();
    this.cancelWaiters.push({ count, gate });
    return gate.opened;
  }

  /** Resolves once `count` invocations are simultaneously in flight. */
  public whenInFlight(count: number): Promise<void> {
    if (this.inFlight >= count) {
      return Promise.resolve();
    }
    const gate = new Gate();
    this.inFlightWaiters.push({ count, gate });
    return gate.opened;
  }

  /** Position of this invocation in the whole run, assigned at admission. */
  private invocationIndex(invocation: RiyaBenchmarkInvocation): number {
    return this.admissionIndex.get(invocation) ?? 0;
  }

  private enter(invocation: RiyaBenchmarkInvocation): void {
    this.admissionIndex.set(invocation, this.invokedOrdinals.length);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.invokedOrdinals.push(invocation.requestOrdinal);
    this.invokedTimeouts.push(invocation.requestTimeoutMicros);
    for (const waiter of this.inFlightWaiters) {
      if (this.inFlight >= waiter.count) {
        waiter.gate.unlock();
      }
    }
  }

  private gateFor(ordinal: number): Gate {
    const existing = this.gates.get(ordinal);
    if (existing !== undefined) {
      return existing;
    }
    const gate = new Gate();
    this.gates.set(ordinal, gate);
    return gate;
  }

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

export interface FakeMemoryProbeOptions {
  /** Advanced during `beginMeasuredCase`, to prove probe setup is outside the measured window. */
  readonly beginAdvanceMicros?: number;
  /** Advanced during `finish`, to prove the window had already closed. */
  readonly finishAdvanceMicros?: number;
  /** Return this exact value from `finish`, well-formed or not. */
  readonly readingRaw?: unknown;
  readonly throwOnBegin?: boolean;
  readonly throwOnFinish?: boolean;
  /** Hold `abort` until the spec releases it, to prove the harness awaits cleanup. */
  readonly holdAbort?: boolean;
  /** Called at the moment a measured case opens, so a spec can snapshot what has run so far. */
  readonly onBegin?: () => void;
}

/**
 * A memory probe with a real per-case lifecycle.
 *
 * It records a PEAK, and only while a case is open — which is what makes "the warmup peak is excluded"
 * and "the previous case did not contaminate this one" answerable rather than asserted.
 */
export class FakeMemoryProbe implements RiyaBenchmarkMemoryProbePort, FakeMemoryObserver {
  public readonly beganCaseIds: string[] = [];
  public readonly finishedCaseIds: string[] = [];
  public readonly abortedCaseIds: string[] = [];
  public openCases = 0;
  public abortCompleted = false;

  private peak = 0;
  private open = false;
  private readonly abortGate = new Gate();
  private readonly abortStarted = new Gate();

  public constructor(
    private readonly clock: ManualClock,
    private readonly options: FakeMemoryProbeOptions = {},
  ) {}

  /** Ignored unless a case is open. That IS the isolation the lifecycle exists to provide. */
  public observe(bytes: number): void {
    if (this.open) {
      this.peak = Math.max(this.peak, bytes);
    }
  }

  public beginMeasuredCase = (context: {
    readonly workloadCaseId: string;
  }): Promise<RiyaBenchmarkMemoryCasePort> => {
    if (this.options.throwOnBegin === true) {
      return Promise.reject(new Error('probe setup exploded'));
    }
    this.beganCaseIds.push(context.workloadCaseId);
    this.openCases += 1;
    this.open = true;
    this.peak = 0;
    this.options.onBegin?.();
    this.clock.advance(this.options.beginAdvanceMicros ?? 0);
    return Promise.resolve(this.caseFor(context.workloadCaseId));
  };

  /** Resolves once `abort` has been entered, so a spec can prove the harness is waiting on it. */
  public whenAbortStarted(): Promise<void> {
    return this.abortStarted.opened;
  }

  public releaseAbort(): void {
    this.abortGate.unlock();
  }

  private caseFor(workloadCaseId: string): RiyaBenchmarkMemoryCasePort {
    return {
      finish: async (): Promise<RiyaBenchmarkMemoryReading> => {
        this.open = false;
        this.openCases -= 1;
        this.finishedCaseIds.push(workloadCaseId);
        this.clock.advance(this.options.finishAdvanceMicros ?? 0);
        if (this.options.throwOnFinish === true) {
          throw new Error('probe read exploded');
        }
        if (this.options.readingRaw !== undefined) {
          return this.options.readingRaw as RiyaBenchmarkMemoryReading;
        }
        await Promise.resolve();
        return this.peak > 0 ? { peakHostMemoryBytes: this.peak } : {};
      },
      abort: async (): Promise<void> => {
        this.open = false;
        this.openCases -= 1;
        this.abortedCaseIds.push(workloadCaseId);
        this.abortStarted.unlock();
        if (this.options.holdAbort === true) {
          await this.abortGate.opened;
        }
        this.abortCompleted = true;
      },
    };
  }
}
