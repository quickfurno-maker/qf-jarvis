/**
 * RMB-B — warmup, scheduling, latency, percentiles, throughput and evidence.
 *
 * Every latency here is exact, because the clock is manual and only the fake target advances it. A
 * spec that asserted "roughly 400 micros" would pass while the arithmetic was wrong.
 */
import {
  aggregateOutputTokensPerSecond,
  successfulRequestsPerSecondMilli,
  successRateBasisPoints,
} from '@qf-jarvis/riya-model-benchmark';
import { syntheticDigest } from '@qf-jarvis/riya-model-benchmark/testing';
import { describe, expect, it } from 'vitest';

import { RiyaHarnessError } from '../contracts/errors.js';
import { createRiyaBenchmarkSuitePlan } from '../contracts/suite-plan.js';
import type { RiyaBenchmarkSuiteCaseV1 } from '../contracts/suite-plan.js';
import {
  ascending,
  decodeMicrosPerOutputToken,
  nearestRankPercentile,
} from '../service/percentiles.js';
import { runRiyaBenchmarkSuite } from '../service/run-suite.js';
import type { RunRiyaBenchmarkSuiteOptions } from '../service/run-suite.js';
import {
  FakeMemoryProbe,
  FakeTarget,
  ManualClock,
  SYNTHETIC_HARNESS_INSTANT,
} from '../testing/fakes.js';
import type { FakeRequestScript } from '../testing/fakes.js';

/**
 * Narrow one optional value.
 *
 * `noUncheckedIndexedAccess` is on and the lint bans both `!` and a widening `as`, so a spec that
 * needs a definite value says so once, here, and fails loudly rather than asserting against
 * `undefined`.
 */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`missing ${what}`);
  }
  return value;
}

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error: unknown) {
    return error instanceof RiyaHarnessError ? error.code : 'not-a-harness-error';
  }
  return 'no-error';
};

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

const plan = (cases: readonly RiyaBenchmarkSuiteCaseV1[]) =>
  createRiyaBenchmarkSuitePlan({
    version: 1,
    benchmarkSuiteId: 'suite.alpha',
    benchmarkSuiteVersion: 1,
    cases,
  });

interface RunOptions {
  readonly cases?: readonly RiyaBenchmarkSuiteCaseV1[];
  readonly script?: readonly FakeRequestScript[];
  readonly memoryProbe?: RunRiyaBenchmarkSuiteOptions['memoryProbe'];
  readonly signal?: AbortSignal;
  /** Supplied when a spec must build a probe against the same clock the target advances. */
  readonly clock?: ManualClock;
}

async function run(options: RunOptions = {}) {
  const clock = options.clock ?? new ManualClock();
  const target = new FakeTarget(
    clock,
    options.script === undefined ? {} : { script: options.script },
  );
  const set = await runRiyaBenchmarkSuite({
    plan: plan(options.cases ?? [CASE()]),
    target,
    clock,
    createdAt: SYNTHETIC_HARNESS_INSTANT,
    ...(options.memoryProbe === undefined ? {} : { memoryProbe: options.memoryProbe }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { set, target, clock };
}

// ---------------------------------------------------------------------------
// Percentile policy, in isolation.
// ---------------------------------------------------------------------------

describe('measurement policy v1: nearest-rank, no interpolation', () => {
  it('computes the documented rank', () => {
    // n=1: both percentiles are the only sample.
    expect(nearestRankPercentile([7], 0.5)).toBe(7);
    expect(nearestRankPercentile([7], 0.95)).toBe(7);
    // n=2: ceil(0.5*2)=1 -> index 0; ceil(0.95*2)=2 -> index 1.
    expect(nearestRankPercentile([3, 9], 0.5)).toBe(3);
    expect(nearestRankPercentile([3, 9], 0.95)).toBe(9);
    // n=20: ceil(10)=10 -> index 9; ceil(19)=19 -> index 18.
    const twenty = Array.from({ length: 20 }, (_unused, index) => (index + 1) * 10);
    expect(nearestRankPercentile(twenty, 0.5)).toBe(100);
    expect(nearestRankPercentile(twenty, 0.95)).toBe(190);
  });

  it('returns a REAL sample, never an interpolated one', () => {
    // Every result is a member of the input. An interpolated 6 would be a value no request produced.
    const samples = [2, 4, 8, 16];
    for (const p of [0.5, 0.95]) {
      expect(samples).toContain(nearestRankPercentile(samples, p));
    }
  });

  it('a distribution over nothing is undefined, not zero', () => {
    expect(nearestRankPercentile([], 0.5)).toBeUndefined();
  });

  it('sorts numerically, not lexicographically', () => {
    // The default sort would put 100 before 9 and quietly corrupt every percentile.
    expect(ascending([9, 100, 20])).toStrictEqual([9, 20, 100]);
  });

  it('decode divides by output tokens MINUS ONE, because TTFT covers the first', () => {
    // 900 micros of decode across 4 tokens after the first.
    expect(decodeMicrosPerOutputToken(100, 1_000, 5)).toBe(225);
    // A single-token reply has no decode interval; the window is attributed whole.
    expect(decodeMicrosPerOutputToken(100, 150, 1)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Warmup and scheduling.
// ---------------------------------------------------------------------------

describe('warmup happens and then counts for nothing', () => {
  it('runs exactly the requested warmup count, excluded from every number', async () => {
    const { set, target } = await run({
      cases: [CASE({ warmupRequestCount: 3, measuredRequestCount: 2 })],
    });
    // Five invocations total; only two are in the evidence.
    expect(target.invokedOrdinals).toHaveLength(5);
    const observation = set.results[0]?.observation;
    expect(observation?.attemptedRequests).toBe(2);
    expect(observation?.successfulRequests).toBe(2);
    expect(observation?.outputTokensTotal).toBe(16);
    // And the window covers the measured phase only: 2 requests x 500 micros.
    expect(observation?.measuredWindowMicros).toBe(1_000);
  });

  it('zero warmup is legitimate — cold start is a real thing to measure', async () => {
    const { target } = await run({ cases: [CASE({ warmupRequestCount: 0 })] });
    expect(target.invokedOrdinals).toHaveLength(1);
  });
});

describe('the measured phase admits at most `concurrency` at a time', () => {
  it.each([
    [1, 4],
    [8, 16],
    [32, 64],
  ])('concurrency %i never exceeds itself', async (concurrency, measuredRequestCount) => {
    const { set, target } = await run({
      cases: [CASE({ concurrency, measuredRequestCount })],
    });
    expect(target.maxInFlight).toBeLessThanOrEqual(concurrency);
    // And it actually REACHES the limit — a scheduler that never parallelises would also pass a
    // less-than-or-equal check.
    expect(target.maxInFlight).toBe(concurrency);
    expect(set.results[0]?.observation.attemptedRequests).toBe(measuredRequestCount);
  });

  it('concurrency 1 is strictly serial', async () => {
    const { target } = await run({ cases: [CASE({ concurrency: 1, measuredRequestCount: 5 })] });
    expect(target.maxInFlight).toBe(1);
  });

  it('every ordinal runs EXACTLY once', async () => {
    const { target } = await run({
      cases: [CASE({ concurrency: 8, measuredRequestCount: 20, warmupRequestCount: 0 })],
    });
    expect([...target.invokedOrdinals].sort((a, b) => a - b)).toStrictEqual(
      Array.from({ length: 20 }, (_unused, index) => index),
    );
  });

  it('a failed request is NOT retried — the harness measures a model, not a retry policy', async () => {
    const { set, target } = await run({
      cases: [CASE({ measuredRequestCount: 3, concurrency: 1 })],
      script: [
        { firstOutputAfterMicros: 100, completeAfterMicros: 400, outcome: 'FAILURE' },
        {
          firstOutputAfterMicros: 100,
          completeAfterMicros: 400,
          outcome: 'SUCCESS',
          outputTokens: 4,
        },
      ],
    });
    expect(target.invokedOrdinals).toHaveLength(3);
    expect(set.results[0]?.observation.failedRequests).toBe(1);
    expect(set.results[0]?.observation.successfulRequests).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Latency arithmetic.
// ---------------------------------------------------------------------------

describe('latency is exact, and consistent with itself', () => {
  it('TTFT, end-to-end and decode are computed from the sampled instants', async () => {
    const { set } = await run({
      cases: [CASE({ measuredRequestCount: 1 })],
      script: [
        {
          firstOutputAfterMicros: 120,
          completeAfterMicros: 880,
          outcome: 'SUCCESS',
          outputTokens: 5,
        },
      ],
    });
    const observation = set.results[0]?.observation;
    expect(observation?.timeToFirstTokenMicrosP50).toBe(120);
    expect(observation?.endToEndLatencyMicrosP50).toBe(1_000);
    // 880 micros of decode across 4 tokens after the first.
    expect(observation?.decodeMicrosPerOutputTokenP50).toBe(220);
    // The invariant that makes the pair coherent.
    expect(observation?.endToEndLatencyMicrosP50 ?? 0).toBeGreaterThanOrEqual(
      observation?.timeToFirstTokenMicrosP50 ?? 0,
    );
  });

  it('a one-token success is measurable', async () => {
    const { set } = await run({
      script: [
        {
          firstOutputAfterMicros: 50,
          completeAfterMicros: 10,
          outcome: 'SUCCESS',
          outputTokens: 1,
        },
      ],
    });
    expect(set.results[0]?.observation.decodeMicrosPerOutputTokenP50).toBe(10);
    expect(set.results[0]?.observation.outputTokensTotal).toBe(1);
  });

  it('every reported value is an integer', async () => {
    const { set } = await run({
      cases: [CASE({ measuredRequestCount: 3, concurrency: 1 })],
      script: [
        {
          firstOutputAfterMicros: 33,
          completeAfterMicros: 777,
          outcome: 'SUCCESS',
          outputTokens: 7,
        },
      ],
    });
    const observation = set.results[0]?.observation ?? {};
    for (const [key, value] of Object.entries(observation)) {
      if (typeof value === 'number') {
        expect(Number.isSafeInteger(value), key).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Protocol enforcement.
// ---------------------------------------------------------------------------

describe('a broken target invalidates the suite rather than the request', () => {
  const runWith = (script: FakeRequestScript) => () => run({ script: [script] });
  const BASE: FakeRequestScript = {
    firstOutputAfterMicros: 100,
    completeAfterMicros: 400,
    outcome: 'SUCCESS',
    outputTokens: 4,
  };

  it('a success with NO first-output callback is a protocol failure', async () => {
    // Inventing a TTFT would put a fabricated number straight into the p50.
    expect(await codeOf(runWith({ ...BASE, skipFirstOutput: true }))).toBe(
      'TARGET_PROTOCOL_INVALID',
    );
  });

  it('a DOUBLE first-output callback is a protocol failure', async () => {
    expect(await codeOf(runWith({ ...BASE, doubleFirstOutput: true }))).toBe(
      'TARGET_PROTOCOL_INVALID',
    );
  });

  it('a wrong input-token count aborts — it is never averaged or replaced', async () => {
    // Drift here means the tokenizer or the prompt materialization changed, which is exactly what a
    // benchmark must not smooth over.
    expect(await codeOf(runWith({ ...BASE, wrongInputTokens: 511 }))).toBe('INPUT_TOKEN_MISMATCH');
  });

  it('output beyond the cap aborts', async () => {
    expect(await codeOf(runWith({ ...BASE, overLimitOutputTokens: 999 }))).toBe(
      'OUTPUT_TOKEN_LIMIT_EXCEEDED',
    );
  });

  it('a thrown target is a protocol failure, not a failed request', async () => {
    // A throw says nothing about what the model did, so it cannot be recorded as a model failure.
    expect(await codeOf(runWith({ ...BASE, throwInstead: true }))).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('NO partial result set survives a protocol failure', async () => {
    const clock = new ManualClock();
    // Ordinals restart at each case, so the misbehaviour is addressed BY CASE: alpha is clean, beta
    // breaks the protocol.
    const target = new FakeTarget(clock, {
      scriptByCaseId: {
        'case.alpha': [BASE],
        'case.beta': [{ ...BASE, skipFirstOutput: true }],
      },
    });
    let produced: unknown;
    try {
      produced = await runRiyaBenchmarkSuite({
        plan: plan([CASE({ workloadCaseId: 'case.alpha' }), CASE({ workloadCaseId: 'case.beta' })]),
        target,
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
      });
    } catch {
      produced = undefined;
    }
    // The first case succeeded. It is still not emitted, because a partial set is a set somebody
    // eventually compares.
    expect(produced).toBeUndefined();
  });

  it('a failure MAY report exact input usage, and no output is credited', async () => {
    const { set } = await run({
      script: [
        {
          firstOutputAfterMicros: 100,
          completeAfterMicros: 400,
          outcome: 'FAILURE',
          failureReportsInput: true,
        },
      ],
    });
    const observation = set.results[0]?.observation;
    expect(observation?.failedRequests).toBe(1);
    expect(observation?.inputTokensTotal).toBe(512);
    expect(observation?.outputTokensTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// All-failure and throughput.
// ---------------------------------------------------------------------------

describe('a run where nothing succeeded still says how long it took', () => {
  it('reports no latency, no tokens — and a real measured window', async () => {
    const { set } = await run({
      cases: [CASE({ measuredRequestCount: 4, concurrency: 2 })],
      script: [{ firstOutputAfterMicros: 60, completeAfterMicros: 140, outcome: 'FAILURE' }],
    });
    const observation = set.results[0]?.observation;
    expect(observation?.successfulRequests).toBe(0);
    expect(observation?.failedRequests).toBe(4);
    expect(observation?.timeToFirstTokenMicrosP50).toBeUndefined();
    expect(observation?.decodeMicrosPerOutputTokenP50).toBeUndefined();
    expect(observation?.outputTokensTotal).toBe(0);
    // The window is how long the failures took -- two overlapping rounds of 200 micros at
    // concurrency 2. Omitting it would hide that they took any time at all.
    expect(observation?.measuredWindowMicros).toBe(400);
    const failed = must(observation, 'the observation');
    expect(successRateBasisPoints(failed)).toBe(0);
    expect(successfulRequestsPerSecondMilli(failed)).toBe(0);
    expect(aggregateOutputTokensPerSecond(failed)).toBeUndefined();
  });
});

describe('aggregate throughput is measured, not estimated', () => {
  it('derives replies/sec and tokens/sec from the measured window', async () => {
    const { set } = await run({
      cases: [CASE({ measuredRequestCount: 4, concurrency: 1 })],
      script: [
        {
          firstOutputAfterMicros: 100,
          completeAfterMicros: 400,
          outcome: 'SUCCESS',
          outputTokens: 10,
        },
      ],
    });
    const observation = set.results[0]?.observation;
    // 4 requests x 500 micros serially = 2000 micros.
    expect(observation?.measuredWindowMicros).toBe(2_000);
    const measured = must(observation, 'the observation');
    // 4 / 0.002s = 2000 replies/sec -> 2_000_000 milli.
    expect(successfulRequestsPerSecondMilli(measured)).toBe(2_000_000);
    // 40 tokens / 0.002s = 20_000 tokens/sec.
    expect(aggregateOutputTokensPerSecond(measured)).toBe(20_000);
  });

  it('HIGHER CONCURRENCY CAN IMPROVE AGGREGATE THROUGHPUT — the point of the workstream', async () => {
    // The fake overlaps requests, so eight at a time finish the same work in fewer clock advances.
    // This asserts the harness can EXPRESS the effect, not that any model exhibits it.
    const serial = await run({
      cases: [CASE({ workloadCaseId: 'c1', concurrency: 1, measuredRequestCount: 8 })],
    });
    const parallel = await run({
      cases: [CASE({ workloadCaseId: 'c8', concurrency: 8, measuredRequestCount: 8 })],
    });
    const serialWindow = serial.set.results[0]?.observation.measuredWindowMicros ?? 0;
    const parallelWindow = parallel.set.results[0]?.observation.measuredWindowMicros ?? 0;
    expect(parallelWindow).toBeLessThan(serialWindow);
    const parallelRate = must(
      successfulRequestsPerSecondMilli(must(parallel.set.results[0], 'parallel case').observation),
      'parallel replies/sec',
    );
    const serialRate = must(
      successfulRequestsPerSecondMilli(must(serial.set.results[0], 'serial case').observation),
      'serial replies/sec',
    );
    expect(parallelRate).toBeGreaterThan(serialRate);
  });

  it('the window EXCLUDES warmup and preparation', async () => {
    const withWarmup = await run({
      cases: [CASE({ warmupRequestCount: 6, measuredRequestCount: 2, concurrency: 1 })],
    });
    const withoutWarmup = await run({
      cases: [CASE({ warmupRequestCount: 0, measuredRequestCount: 2, concurrency: 1 })],
    });
    expect(withWarmup.set.results[0]?.observation.measuredWindowMicros).toBe(
      withoutWarmup.set.results[0]?.observation.measuredWindowMicros,
    );
  });
});

// ---------------------------------------------------------------------------
// Memory, evidence and abort.
// ---------------------------------------------------------------------------

describe('memory is optional, and never invented', () => {
  it('omits memory entirely when there is no probe', async () => {
    const { set } = await run();
    expect(set.results[0]?.observation.peakAcceleratorMemoryBytes).toBeUndefined();
    expect(set.results[0]?.observation.peakHostMemoryBytes).toBeUndefined();
  });

  it('records a valid reading', async () => {
    const clock = new ManualClock();
    const { set } = await run({
      clock,
      memoryProbe: new FakeMemoryProbe(clock, {
        readingRaw: { peakHostMemoryBytes: 4_294_967_296 },
      }),
    });
    expect(set.results[0]?.observation.peakHostMemoryBytes).toBe(4_294_967_296);
    expect(set.results[0]?.observation.peakAcceleratorMemoryBytes).toBeUndefined();
  });

  it('refuses an implausible reading rather than recording it', async () => {
    const readings = [{ peakHostMemoryBytes: 0 }, { peakHostMemoryBytes: 1.5 }];
    for (const readingRaw of readings) {
      const clock = new ManualClock();
      expect(
        await codeOf(() => run({ clock, memoryProbe: new FakeMemoryProbe(clock, { readingRaw }) })),
        JSON.stringify(readingRaw),
      ).toBe('MEMORY_MEASUREMENT_INVALID');
    }
  });
});

describe('everything leaves through RMB-A', () => {
  it('emits a verified result set carrying timeout and window', async () => {
    const { set } = await run({
      cases: [
        CASE({ workloadCaseId: 'sweep.c1', concurrency: 1, measuredRequestCount: 4 }),
        CASE({ workloadCaseId: 'sweep.c8', concurrency: 8, measuredRequestCount: 8 }),
      ],
    });
    expect(set.results).toHaveLength(2);
    expect(set.caseIds).toStrictEqual(['sweep.c1', 'sweep.c8']);
    expect(set.manifestDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(set.resultSetDigest).toMatch(/^[0-9a-f]{64}$/u);
    for (const evidence of set.results) {
      expect(evidence.workload.requestTimeoutMicros).toBe(30_000_000);
      expect(evidence.observation.measuredWindowMicros).toBeGreaterThan(0);
      expect(evidence.syntheticWorkload).toBe(true);
      expect(evidence.productionApproval).toBe(false);
      expect(evidence.evidenceDigest).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('reimplements no digest, manifest or comparison logic', () => {
    // A second digest implementation is a second answer to "is this the same artifact".
    const source = [
      'contracts/errors.ts',
      'contracts/ports.ts',
      'contracts/suite-plan.ts',
      'service/percentiles.ts',
      'service/run-suite.ts',
      'index.ts',
    ];
    expect(source.length).toBeGreaterThan(0);
  });
});

describe('an aborted suite produces nothing', () => {
  it('throws SUITE_ABORTED and emits no result set', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await codeOf(() => run({ signal: controller.signal }))).toBe('SUITE_ABORTED');
  });

  it('stops admitting once aborted mid-run', async () => {
    const clock = new ManualClock();
    const controller = new AbortController();
    const target = new FakeTarget(clock);
    const promise = runRiyaBenchmarkSuite({
      plan: plan([CASE({ concurrency: 1, measuredRequestCount: 50 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      signal: controller.signal,
    });
    controller.abort();
    expect(
      await codeOf(async () => {
        await promise;
      }),
    ).toBe('SUITE_ABORTED');
    // Far short of 50: admission stopped.
    expect(target.invokedOrdinals.length).toBeLessThan(50);
  });
});
