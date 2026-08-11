/**
 * RMB-B — nothing a foreign port says about itself is evidence.
 *
 * ### The hole this closes
 *
 * The boundary used to re-throw a caught `RiyaHarnessError` unchanged, on the reasoning that such an
 * error must be ours. It need not be: the class is exported, so an adapter can construct one, pick
 * whichever closed code suits it, and hang a prompt off `message` or a credential off `cause`.
 * `instanceof` says yes to all of it.
 *
 * So trust now comes from WHERE a throw arose. Everything raised by foreign code is replaced with a
 * freshly constructed error for that boundary — and the specs below hand the harness exactly the
 * forgeries that used to work.
 *
 * ### And the keys nobody looks at
 *
 * `.strict()` compares enumerable string keys, which is what a spread or a `JSON.stringify` shows. A
 * non-enumerable property and a symbol key are invisible to both, so they get their own specs here.
 */
import { syntheticDigest, syntheticSubject } from '@qf-jarvis/riya-model-benchmark/testing';
import { describe, expect, it } from 'vitest';

import { RiyaHarnessError } from '../contracts/errors.js';
import type { RiyaHarnessErrorCode } from '../contracts/errors.js';
import type {
  RiyaBenchmarkMemoryProbePort,
  RiyaBenchmarkTargetDescriptor,
} from '../contracts/ports.js';
import { createRiyaBenchmarkSuitePlan } from '../contracts/suite-plan.js';
import type {
  RiyaBenchmarkSuiteCaseV1,
  RiyaBenchmarkSuitePlanV1,
} from '../contracts/suite-plan.js';
import { callForeign, callForeignSync, parseMemoryCasePort } from '../internal/port-firewall.js';
import { runRiyaBenchmarkSuite } from '../service/run-suite.js';
import type { RunRiyaBenchmarkSuiteOptions } from '../service/run-suite.js';
import {
  FakeMemoryProbe,
  FakeTarget,
  ManualClock,
  SYNTHETIC_HARNESS_INSTANT,
} from '../testing/fakes.js';
import type { FakeTargetOptions } from '../testing/fakes.js';

/** The thing that must never come out the other side. */
const SECRET = 'sk-live-7Q2 namaste, do you deliver a 3-seater to Koregaon Park?';

/**
 * A `RiyaHarnessError` built by "foreign" code: wrong code, prompt in the message, endpoint in cause.
 *
 * Every field here is one an adapter can genuinely set, because the class is part of the public API.
 */
function taintedHarnessError(claimedCode: RiyaHarnessErrorCode): RiyaHarnessError {
  const error = new RiyaHarnessError(claimedCode);
  error.message = `${claimedCode} :: ${SECRET}`;
  error.cause = { endpoint: 'https://provider.example.invalid/v1/chat', token: SECRET };
  return error;
}

/** Assert an error is ours, freshly built, and carries nothing. */
function expectCleanHarnessError(error: unknown, code: RiyaHarnessErrorCode): void {
  expect(error).toBeInstanceOf(RiyaHarnessError);
  const harnessError = error instanceof RiyaHarnessError ? error : undefined;
  expect(harnessError?.code).toBe(code);
  expect(harnessError?.message).toBe(code);
  expect(harnessError?.cause).toBeUndefined();
  expect(
    JSON.stringify({ message: harnessError?.message, stack: harnessError?.stack }),
  ).not.toContain('sk-live');
}

const CASE = (overrides: Partial<RiyaBenchmarkSuiteCaseV1> = {}): RiyaBenchmarkSuiteCaseV1 => ({
  workloadCaseId: 'case.alpha',
  promptProfileDigest: syntheticDigest('face'),
  inputTokenCount: 512,
  maximumOutputTokens: 256,
  requestTimeoutMicros: 30_000_000,
  concurrency: 1,
  batchSize: 1,
  warmupRequestCount: 0,
  measuredRequestCount: 1,
  streaming: true,
  samplingConfigDigest: syntheticDigest('dad'),
  ...overrides,
});

const PLAN = (cases: readonly RiyaBenchmarkSuiteCaseV1[] = [CASE()]): RiyaBenchmarkSuitePlanV1 =>
  createRiyaBenchmarkSuitePlan({
    version: 1,
    benchmarkSuiteId: 'suite.alpha',
    benchmarkSuiteVersion: 1,
    cases,
  });

/** A probe whose runtime shape its declared type would never allow. */
const forgedProbe = (value: unknown): RiyaBenchmarkMemoryProbePort =>
  value as RiyaBenchmarkMemoryProbePort;

const errorOf = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
};

interface RunShape {
  readonly cases?: readonly RiyaBenchmarkSuiteCaseV1[];
  readonly target?: FakeTargetOptions;
  readonly memoryProbe?: RunRiyaBenchmarkSuiteOptions['memoryProbe'];
  readonly clock?: ManualClock;
}

function attempt(shape: RunShape = {}): {
  readonly clock: ManualClock;
  readonly target: FakeTarget;
  readonly run: () => Promise<unknown>;
} {
  const clock = shape.clock ?? new ManualClock();
  const target = new FakeTarget(clock, shape.target ?? {});
  return {
    clock,
    target,
    run: () =>
      runRiyaBenchmarkSuite({
        plan: PLAN(shape.cases ?? [CASE()]),
        target,
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
        ...(shape.memoryProbe === undefined ? {} : { memoryProbe: shape.memoryProbe }),
      }),
  };
}

// ---------------------------------------------------------------------------
// The helper itself.
// ---------------------------------------------------------------------------

describe('the foreign-call helper trusts nothing it catches', () => {
  it('REPLACES A FOREIGN RiyaHarnessError RATHER THAN RE-THROWING IT', async () => {
    const foreign = taintedHarnessError('SUITE_ABORTED');
    const caught = await errorOf(() =>
      callForeign(() => {
        throw foreign;
      }, 'TARGET_PROTOCOL_INVALID'),
    );

    // A different object, with the code the BOUNDARY chose, not the one the adapter picked.
    expect(caught).not.toBe(foreign);
    expectCleanHarnessError(caught, 'TARGET_PROTOCOL_INVALID');
  });

  it('replaces an ordinary foreign exception the same way', async () => {
    const caught = await errorOf(() =>
      callForeign(() => Promise.reject(new TypeError(SECRET)), 'MEMORY_MEASUREMENT_INVALID'),
    );
    expect(caught).not.toBeInstanceOf(TypeError);
    expectCleanHarnessError(caught, 'MEMORY_MEASUREMENT_INVALID');
  });

  it('the synchronous twin behaves identically', () => {
    let caught: unknown;
    try {
      callForeignSync(() => {
        throw taintedHarnessError('PLAN_INVALID');
      }, 'CLOCK_INVALID');
    } catch (error: unknown) {
      caught = error;
    }
    expectCleanHarnessError(caught, 'CLOCK_INVALID');
  });

  it('passes a successful value through untouched', async () => {
    expect(await callForeign(() => 41 + 1, 'CLOCK_INVALID')).toBe(42);
    expect(callForeignSync(() => 'fine', 'CLOCK_INVALID')).toBe('fine');
  });
});

// ---------------------------------------------------------------------------
// Every port that can throw.
// ---------------------------------------------------------------------------

describe('a tainted RiyaHarnessError from any port is discarded', () => {
  it('descriptor()', async () => {
    const { run } = attempt({
      target: { descriptorThrowValue: taintedHarnessError('MEMORY_MEASUREMENT_INVALID') },
    });
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('prepareCase()', async () => {
    const { run } = attempt({
      target: { prepareThrowValue: taintedHarnessError('CLOCK_MOVED_BACKWARD') },
    });
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('invoke()', async () => {
    const { run } = attempt({
      target: {
        script: [
          {
            firstOutputAfterMicros: 100,
            completeAfterMicros: 400,
            outcome: 'SUCCESS',
            throwValue: taintedHarnessError('SUITE_ABORTED'),
          },
        ],
      },
    });
    // The adapter claimed the suite was aborted. It was not, and saying so would have hidden a
    // broken target behind a clean-looking cancellation.
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('invoke(), on the cancellation path, still reports cancellation', async () => {
    const controller = new AbortController();
    const clock = new ManualClock();
    const target = new FakeTarget(clock, {
      script: [
        {
          firstOutputAfterMicros: 100,
          completeAfterMicros: 400,
          outcome: 'SUCCESS',
          holdUntilReleased: true,
          throwValue: taintedHarnessError('PLAN_INVALID'),
        },
      ],
    });
    const run = runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ concurrency: 2, measuredRequestCount: 2 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      signal: controller.signal,
    });
    void run.catch(() => undefined);
    await target.whenInFlight(2);
    controller.abort();
    expectCleanHarnessError(await errorOf(() => run), 'SUITE_ABORTED');
  });

  it('beginMeasuredCase()', async () => {
    const clock = new ManualClock();
    const { run } = attempt({
      clock,
      memoryProbe: new FakeMemoryProbe(clock, {
        beginThrowValue: taintedHarnessError('PLAN_INVALID'),
      }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
  });

  it('memory finish()', async () => {
    const clock = new ManualClock();
    const { run } = attempt({
      clock,
      memoryProbe: new FakeMemoryProbe(clock, {
        finishThrowValue: taintedHarnessError('TARGET_CASE_MISMATCH'),
      }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
  });
});

// ---------------------------------------------------------------------------
// The clock is a port too.
// ---------------------------------------------------------------------------

describe('the clock is a foreign port, and its throws are normalized', () => {
  it('A THROWING CLOCK IS CLOCK_INVALID, NOT A RAW EXCEPTION', async () => {
    const clock = new ManualClock();
    // Read 1 is the measured window opening.
    clock.failAtRead(1, new TypeError(`nvml handle lost :: ${SECRET}`));
    const { run } = attempt({ clock });
    const caught = await errorOf(run);
    expect(caught).not.toBeInstanceOf(TypeError);
    expectCleanHarnessError(caught, 'CLOCK_INVALID');
  });

  it('a valid-but-backwards reading is still CLOCK_MOVED_BACKWARD, not CLOCK_INVALID', async () => {
    // Normalizing throws must not collapse the two clock faults into one. A clock that RETURNS a
    // smaller number has not failed; it has gone backwards, and that is a different bug to report.
    let readings = 0;
    const rewinding = {
      nowMicros: (): number => {
        readings += 1;
        return readings === 1 ? 10_000 : 9_000;
      },
    };
    const clock = new ManualClock();
    const caught = await errorOf(() =>
      runRiyaBenchmarkSuite({
        plan: PLAN(),
        target: new FakeTarget(clock),
        clock: rewinding,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
      }),
    );
    expectCleanHarnessError(caught, 'CLOCK_MOVED_BACKWARD');
  });

  it('A CLOCK FAILURE INSIDE onFirstOutput OUTRANKS THE ADAPTER', async () => {
    // The callback is harness code that foreign code runs. If the adapter then rejects — as one that
    // saw an exception would — the boundary must not relabel a broken clock as a broken target.
    const clock = new ManualClock();
    // Read 3 is the callback: 1 = window start, 2 = request start, 3 = first output.
    clock.failAtRead(3, new Error(`clock device gone :: ${SECRET}`));
    const { run } = attempt({
      clock,
      target: {
        script: [
          {
            firstOutputAfterMicros: 100,
            completeAfterMicros: 400,
            outcome: 'SUCCESS',
            throwAfterFirstOutput: taintedHarnessError('TARGET_CASE_MISMATCH'),
          },
        ],
      },
    });
    expectCleanHarnessError(await errorOf(run), 'CLOCK_INVALID');
  });

  it('and outranks a target that carries on as though nothing happened', async () => {
    const clock = new ManualClock();
    clock.failAtRead(3, new Error('clock device gone'));
    const { run } = attempt({ clock });
    expectCleanHarnessError(await errorOf(run), 'CLOCK_INVALID');
  });
});

// ---------------------------------------------------------------------------
// The memory-case handle.
// ---------------------------------------------------------------------------

describe('the memory-case handle is rebuilt, not stored', () => {
  it('A HANDLE CARRYING CONTENT IS REFUSED BEFORE ANY MEASURED REQUEST', async () => {
    const clock = new ManualClock();
    const { target, run } = attempt({
      clock,
      cases: [CASE({ warmupRequestCount: 1, measuredRequestCount: 2 })],
      memoryProbe: forgedProbe({
        beginMeasuredCase: () =>
          Promise.resolve({
            finish: () => Promise.resolve({}),
            abort: () => Promise.resolve(undefined),
            transcript: SECRET,
          }),
      }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
    // The warmup request ran; the two measured ones never did.
    expect(target.invokedOrdinals).toStrictEqual([0]);
  });

  it.each([
    ['a missing finish', { abort: () => Promise.resolve(undefined) }],
    ['a missing abort', { finish: () => Promise.resolve({}) }],
    ['a non-callable finish', { finish: 'soon', abort: () => Promise.resolve(undefined) }],
    ['nothing at all', {}],
  ])('a handle with %s is refused', (_name, handle) => {
    expect(() => parseMemoryCasePort(handle)).toThrow(RiyaHarnessError);
  });

  it('keeps only the two capabilities — the foreign object does not come through', () => {
    const foreign = {
      finish: () => Promise.resolve({ peakHostMemoryBytes: 4_096 }),
      abort: () => Promise.resolve(undefined),
    };
    const rebuilt = parseMemoryCasePort(foreign);
    expect(rebuilt).not.toBe(foreign);
    expect(Object.isFrozen(rebuilt)).toBe(true);
    expect(Reflect.ownKeys(rebuilt).sort()).toStrictEqual(['abort', 'finish']);
  });

  it('rebuilds the reading that finish returns', async () => {
    const rebuilt = parseMemoryCasePort({
      finish: () => Promise.resolve({ peakHostMemoryBytes: 4_096, devicePath: '/dev/x' }),
      abort: () => Promise.resolve(undefined),
    });
    expectCleanHarnessError(await errorOf(() => rebuilt.finish()), 'MEMORY_MEASUREMENT_INVALID');
  });

  it('A NON-VOID abort COMPLETION IS REFUSED — cleanup is not a data channel', async () => {
    const rebuilt = parseMemoryCasePort({
      finish: () => Promise.resolve({}),
      abort: () => Promise.resolve({ freedBytes: 4_096, lastPrompt: SECRET }),
    });
    expectCleanHarnessError(await errorOf(() => rebuilt.abort()), 'MEMORY_MEASUREMENT_INVALID');
  });

  it('but a refused cleanup STILL does not replace the failure that caused it', async () => {
    // The outer rule is unchanged and load-bearing: the original error is the one that explains the
    // run, and a cleanup complaint on top of it would send somebody to the wrong place.
    const clock = new ManualClock();
    const { run } = attempt({
      clock,
      target: {
        script: [
          {
            firstOutputAfterMicros: 100,
            completeAfterMicros: 400,
            outcome: 'SUCCESS',
            wrongInputTokens: 1_024,
          },
        ],
      },
      memoryProbe: forgedProbe({
        beginMeasuredCase: () =>
          Promise.resolve({
            finish: () => Promise.resolve({}),
            abort: () => Promise.resolve({ freedBytes: 4_096 }),
          }),
      }),
    });
    expectCleanHarnessError(await errorOf(run), 'INPUT_TOKEN_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// Keys that a spread would not show.
// ---------------------------------------------------------------------------

describe('a hidden own key is an unknown key', () => {
  /** A property no spread, no `Object.keys` and no `JSON.stringify` will ever mention. */
  function withHiddenSecret<T extends object>(value: T, key: string): T {
    Object.defineProperty(value, key, { value: SECRET, enumerable: false, writable: true });
    return value;
  }

  it('a descriptor with a SYMBOL key is refused', async () => {
    const descriptorRaw: Record<string | symbol, unknown> = {
      subject: syntheticSubject(),
      environment: undefined,
    };
    descriptorRaw['environment'] = new FakeTarget(new ManualClock()).descriptor().environment;
    descriptorRaw[Symbol.for('transcript')] = SECRET;
    const { run } = attempt({ target: { descriptorRaw } });
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('a descriptor with a NON-ENUMERABLE key is refused', async () => {
    const base: RiyaBenchmarkTargetDescriptor = new FakeTarget(new ManualClock()).descriptor();
    const { run } = attempt({
      target: { descriptorRaw: withHiddenSecret({ ...base }, 'transcript') },
    });
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('a prepared case with a non-enumerable key is refused', async () => {
    const { run } = attempt({
      target: {
        preparedRaw: withHiddenSecret(
          {
            workloadCaseId: 'case.alpha',
            promptProfileDigest: syntheticDigest('face'),
            inputTokenCount: 512,
            maximumOutputTokens: 256,
            samplingConfigDigest: syntheticDigest('dad'),
            streaming: true,
          },
          'promptText',
        ),
      },
    });
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('a terminal result with a non-enumerable key is refused', async () => {
    const { run } = attempt({
      target: {
        script: [
          {
            firstOutputAfterMicros: 100,
            completeAfterMicros: 400,
            outcome: 'SUCCESS',
            rawResult: withHiddenSecret(
              { outcome: 'SUCCESS', inputTokens: 512, outputTokens: 8 },
              'text',
            ),
          },
        ],
      },
    });
    expectCleanHarnessError(await errorOf(run), 'TARGET_PROTOCOL_INVALID');
  });

  it('a memory reading with a symbol key is refused', async () => {
    const clock = new ManualClock();
    const readingRaw: Record<string | symbol, unknown> = { peakHostMemoryBytes: 4_294_967_296 };
    readingRaw[Symbol.for('lastPrompt')] = SECRET;
    const { run } = attempt({ clock, memoryProbe: new FakeMemoryProbe(clock, { readingRaw }) });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
  });

  it('a memory-case handle with a non-enumerable key is refused', () => {
    const handle = withHiddenSecret(
      { finish: () => Promise.resolve({}), abort: () => Promise.resolve(undefined) },
      'transcript',
    );
    expect(() => parseMemoryCasePort(handle)).toThrow(RiyaHarnessError);
  });
});

// ---------------------------------------------------------------------------
// And the ordinary path still works.
// ---------------------------------------------------------------------------

describe('a well-behaved target and probe are unaffected', () => {
  it('produces evidence with a measured window and a per-case peak', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    const target = new FakeTarget(clock, {
      memoryObserver: probe,
      memoryBytesByInvocation: [9_000_000_000, 3_000_000_000, 3_500_000_000],
    });
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ warmupRequestCount: 1, measuredRequestCount: 2 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
    });
    expect(set.results).toHaveLength(1);
    expect(set.results[0]?.observation.successfulRequests).toBe(2);
    expect(set.results[0]?.observation.peakHostMemoryBytes).toBe(3_500_000_000);
    expect(set.results[0]?.observation.measuredWindowMicros).toBe(1_000);
    expect(probe.finishedCaseIds).toStrictEqual(['case.alpha']);
    expect(probe.abortedCaseIds).toStrictEqual([]);
    expect(set.results[0]?.syntheticWorkload).toBe(true);
    expect(set.results[0]?.productionApproval).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// An opened case is closed, even when its handle turns out to be unusable.
// ---------------------------------------------------------------------------

/** A promise the spec opens by hand. No timers here either. */
function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let resolveOpened: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    resolveOpened = resolve;
  });
  return {
    opened,
    open: (): void => {
      resolveOpened();
    },
  };
}

/** Let pending microtasks run, so "still pending" means pending and not merely unscheduled. */
const settleMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
};

interface CleanupRecord {
  abortCalls: number;
  openCases: number;
  abortCompleted: boolean;
}

describe('a case that was OPENED is closed, even if its handle cannot be proved', () => {
  it('BEST-EFFORT ABORTS A MALFORMED HANDLE, AND WAITS FOR IT', async () => {
    // `beginMeasuredCase` resolved, so the probe has already opened something. Rejecting on the
    // malformed handle without trying to close it would strand that resource for the life of the
    // process — the exact leak the begin/finish lifecycle exists to prevent.
    const record: CleanupRecord = { abortCalls: 0, openCases: 0, abortCompleted: false };
    const entered = gate();
    const release = gate();
    const clock = new ManualClock();
    const target = new FakeTarget(clock);

    const run = runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ warmupRequestCount: 1, measuredRequestCount: 2 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: forgedProbe({
        beginMeasuredCase: () => {
          record.openCases += 1;
          return Promise.resolve({
            finish: () => Promise.resolve({}),
            abort: async (): Promise<void> => {
              record.abortCalls += 1;
              entered.open();
              await release.opened;
              record.openCases -= 1;
              record.abortCompleted = true;
            },
            transcript: SECRET,
          });
        },
      }),
    });
    void run.catch(() => undefined);
    const settled = run.then(
      () => 'RESOLVED',
      () => 'REJECTED',
    );

    // Raced rather than awaited, so a harness that skipped the cleanup fails an assertion here
    // instead of hanging on a gate nothing will ever open.
    expect(await Promise.race([entered.opened.then(() => 'ENTERED'), settled])).toBe('ENTERED');
    await settleMicrotasks();
    // The cleanup is outstanding, and the suite has not returned.
    expect(record.abortCompleted).toBe(false);
    expect(await Promise.race([settled, Promise.resolve('PENDING')])).toBe('PENDING');

    release.open();
    expectCleanHarnessError(await errorOf(() => run), 'MEMORY_MEASUREMENT_INVALID');
    expect(record.abortCalls).toBe(1);
    expect(record.abortCompleted).toBe(true);
    expect(record.openCases).toBe(0);
    // Warmup ran; the measured phase never opened.
    expect(target.invokedOrdinals).toStrictEqual([0]);
  });

  it.each([
    [
      'a rejecting abort',
      (): unknown => Promise.reject(taintedHarnessError('TARGET_CASE_MISMATCH')),
    ],
    [
      'a throwing abort',
      (): unknown => {
        throw new TypeError(`teardown exploded :: ${SECRET}`);
      },
    ],
    ['an abort that resolves data', (): unknown => Promise.resolve({ freedBytes: 4_096, SECRET })],
  ])('%s does not replace the handle-validation failure', async (_name, abort) => {
    const clock = new ManualClock();
    const { run } = attempt({
      clock,
      memoryProbe: forgedProbe({
        beginMeasuredCase: () =>
          Promise.resolve({ finish: () => Promise.resolve({}), abort, transcript: SECRET }),
      }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
  });

  it('RECOVERY DOES NOT FIRE AN ABORT GETTER — it looks by descriptor', async () => {
    // Reading `handle.abort` would run foreign code outside every normalization boundary. That would
    // make the cleanup path a new hole of exactly the kind it exists to clean up after.
    let getterFired = false;
    const handle: Record<string, unknown> = {
      finish: () => Promise.resolve({}),
      transcript: SECRET,
    };
    Object.defineProperty(handle, 'abort', {
      get: (): never => {
        getterFired = true;
        throw new Error(`abort getter fired :: ${SECRET}`);
      },
      enumerable: true,
      configurable: true,
    });

    const clock = new ManualClock();
    const { target, run } = attempt({
      clock,
      memoryProbe: forgedProbe({ beginMeasuredCase: () => Promise.resolve(handle) }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
    expect(getterFired).toBe(false);
    expect(target.invokedOrdinals).toStrictEqual([]);
  });

  it('and VALIDATION does not fire one either', async () => {
    // The same hazard one step earlier: a handle with no extra key reaches the property reads inside
    // the parser, so those are descriptor lookups too.
    let getterFired = false;
    const handle: Record<string, unknown> = { abort: () => Promise.resolve(undefined) };
    Object.defineProperty(handle, 'finish', {
      get: (): never => {
        getterFired = true;
        throw new Error(`finish getter fired :: ${SECRET}`);
      },
      enumerable: true,
      configurable: true,
    });

    expect(() => parseMemoryCasePort(handle)).toThrow(RiyaHarnessError);
    expect(getterFired).toBe(false);

    const clock = new ManualClock();
    const { run } = attempt({
      clock,
      memoryProbe: forgedProbe({ beginMeasuredCase: () => Promise.resolve(handle) }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
    expect(getterFired).toBe(false);
  });

  it('an inherited abort is not a capability an unproved handle has earned', async () => {
    // Conservative on purpose: the governed handle contract is exact OWN shape, so recovery accepts
    // nothing from a prototype either.
    let inheritedCalls = 0;
    const prototype = {
      abort: (): Promise<void> => {
        inheritedCalls += 1;
        return Promise.resolve();
      },
    };
    const handle = Object.create(prototype) as Record<string, unknown>;
    handle['finish'] = (): Promise<unknown> => Promise.resolve({});
    handle['transcript'] = SECRET;

    const clock = new ManualClock();
    const { run } = attempt({
      clock,
      memoryProbe: forgedProbe({ beginMeasuredCase: () => Promise.resolve(handle) }),
    });
    expectCleanHarnessError(await errorOf(run), 'MEMORY_MEASUREMENT_INVALID');
    expect(inheritedCalls).toBe(0);
  });

  it('a well-formed handle is never sent through the recovery path', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN(),
      target: new FakeTarget(clock),
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
    });
    expect(set.results).toHaveLength(1);
    expect(probe.finishedCaseIds).toStrictEqual(['case.alpha']);
    expect(probe.abortedCaseIds).toStrictEqual([]);
    expect(probe.openCases).toBe(0);
  });
});
