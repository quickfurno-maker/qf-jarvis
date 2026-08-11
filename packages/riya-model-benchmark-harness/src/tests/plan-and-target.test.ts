/**
 * RMB-B — the suite plan, the target contract and the clock.
 *
 * The identity specs are the load-bearing ones. "Run against A, stamp it as B" is the forgery a
 * benchmark harness makes easiest, and the defence is that a caller has no way to supply a subject at
 * all — it comes from the target and is re-proved.
 */
import {
  syntheticDigest,
  syntheticHostedEnvironment,
  syntheticSubject,
} from '@qf-jarvis/riya-model-benchmark/testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RiyaHarnessError } from '../contracts/errors.js';
import {
  createRiyaBenchmarkSuitePlan,
  RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_ID,
  RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_VERSION,
  RIYA_BENCHMARK_MEASUREMENT_POLICY_REF,
  riyaBenchmarkWorkloadForCase,
} from '../contracts/suite-plan.js';
import type { RiyaBenchmarkSuiteCaseV1 } from '../contracts/suite-plan.js';
import { runRiyaBenchmarkSuite } from '../service/run-suite.js';
import { FakeTarget, ManualClock, SYNTHETIC_HARNESS_INSTANT } from '../testing/fakes.js';

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error: unknown) {
    return error instanceof RiyaHarnessError ? error.code : 'not-a-harness-error';
  }
  return 'no-error';
};

const CASE = (overrides: Partial<RiyaBenchmarkSuiteCaseV1> = {}): RiyaBenchmarkSuiteCaseV1 => ({
  workloadCaseId: 'short.c1',
  promptProfileDigest: syntheticDigest('face'),
  inputTokenCount: 512,
  maximumOutputTokens: 256,
  requestTimeoutMicros: 30_000_000,
  concurrency: 1,
  batchSize: 1,
  warmupRequestCount: 2,
  measuredRequestCount: 4,
  streaming: true,
  samplingConfigDigest: syntheticDigest('dad'),
  ...overrides,
});

const PLAN = (cases: readonly RiyaBenchmarkSuiteCaseV1[] = [CASE()]) =>
  createRiyaBenchmarkSuitePlan({
    version: 1,
    benchmarkSuiteId: 'suite.alpha',
    benchmarkSuiteVersion: 1,
    cases,
  });

// ---------------------------------------------------------------------------
// Plan.
// ---------------------------------------------------------------------------

describe('a suite plan is content-free and says what to measure', () => {
  it('accepts a well-formed plan and freezes it', () => {
    const plan = PLAN();
    expect(plan.cases).toHaveLength(1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.cases)).toBe(true);
  });

  it('has NO FIELD a prompt, message or transcript fits in', () => {
    for (const leak of [
      { prompt: 'what does a kitchen cost' },
      { systemPrompt: 'You are Riya.' },
      { messages: [{ role: 'user' }] },
      { sampleText: 'hello' },
    ]) {
      expect(
        await0(() => PLAN([{ ...CASE(), ...leak }])),
        JSON.stringify(leak).slice(0, 24),
      ).toBe('PLAN_INVALID');
    }
  });

  it('refuses a duplicate case id', () => {
    expect(await0(() => PLAN([CASE(), CASE()]))).toBe('PLAN_INVALID');
  });

  it('sorts deterministically regardless of input order', () => {
    const plan = PLAN([
      CASE({ workloadCaseId: 'short.c32', concurrency: 32 }),
      CASE({ workloadCaseId: 'long.c1', inputTokenCount: 4_096 }),
      CASE({ workloadCaseId: 'short.c8', concurrency: 8 }),
    ]);
    expect(plan.cases.map((one) => one.workloadCaseId)).toStrictEqual([
      'long.c1',
      'short.c32',
      'short.c8',
    ]);
    // Same plan, same order, twice.
    expect(PLAN([...plan.cases].reverse())).toStrictEqual(plan);
  });

  it('CARRIES A REAL CONCURRENCY SWEEP: 1, 8 and 32 in one suite', () => {
    // The whole objective is throughput under RISING concurrency, so a plan that could hold only one
    // concurrency would make the workstream unmeasurable. Invented case names — this asserts the
    // shape is expressible, not that these are production numbers.
    const plan = PLAN([
      CASE({ workloadCaseId: 'sweep.c1', concurrency: 1 }),
      CASE({ workloadCaseId: 'sweep.c8', concurrency: 8, measuredRequestCount: 16 }),
      CASE({ workloadCaseId: 'sweep.c32', concurrency: 32, measuredRequestCount: 64 }),
    ]);
    expect(plan.cases.map((one) => one.concurrency)).toStrictEqual([1, 32, 8]);
    // And each yields a valid RMB-A workload.
    for (const one of plan.cases) {
      expect(riyaBenchmarkWorkloadForCase(plan, one).concurrency).toBe(one.concurrency);
    }
  });

  it('ships NO default case list and no production-distribution constant', () => {
    // We do not have production distributions, and a constant asserting "512 tokens is typical Riya"
    // or "32 is production concurrency" would be quoted as though we did. A caller must state the
    // matrix; the real one is a later owner-reviewed artifact.
    const source = readFileSync(
      fileURLToPath(new URL('../contracts/suite-plan.ts', import.meta.url)),
      'utf8',
    );
    for (const claim of [
      'DEFAULT_CASES',
      'TYPICAL_',
      'PRODUCTION_CONCURRENCY',
      'PRODUCTION_CASES',
      'RIYA_TYPICAL',
    ]) {
      expect(source, claim).not.toContain(claim);
    }
    expect(RIYA_BENCHMARK_MEASUREMENT_POLICY_REF).toBe('riya-benchmark-measurement.v1');
  });

  it('the HARNESS stamps who measured and by what rules — a caller cannot', () => {
    const plan = PLAN();
    const workload = riyaBenchmarkWorkloadForCase(plan, CASE());
    expect(workload.benchmarkImplementationId).toBe(RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_ID);
    expect(workload.benchmarkImplementationVersion).toBe(
      RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_VERSION,
    );
    expect(workload.measurementPolicyRef).toBe(RIYA_BENCHMARK_MEASUREMENT_POLICY_REF);
    // There is no case field for any of the three.
    expect(Object.keys(CASE())).not.toContain('benchmarkImplementationId');
    expect(Object.keys(CASE())).not.toContain('measurementPolicyRef');
  });

  it('requires a timeout on every case, though RMB-A leaves it optional', () => {
    const { requestTimeoutMicros: _dropped, ...withoutTimeout } = CASE();
    expect(await0(() => PLAN([withoutTimeout as RiyaBenchmarkSuiteCaseV1]))).toBe('PLAN_INVALID');
    expect(riyaBenchmarkWorkloadForCase(PLAN(), CASE()).requestTimeoutMicros).toBe(30_000_000);
  });

  it('accepts batchSize 1 in a plan and lets the runner refuse larger', () => {
    expect(PLAN([CASE({ batchSize: 1 })]).cases[0]?.batchSize).toBe(1);
    // A larger batch is a valid RMB-A workload — RMB-A supports it. This HARNESS version does not,
    // and refuses at run time rather than pretending a batch of four is four separate requests.
    expect(PLAN([CASE({ batchSize: 4 })]).cases[0]?.batchSize).toBe(4);
  });
});

/** Synchronous variant of `codeOf`, for constructors that do not return a promise. */
function await0(run: () => unknown): string {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaHarnessError ? error.code : 'not-a-harness-error';
  }
  return 'no-error';
}

// ---------------------------------------------------------------------------
// Target identity and preparation.
// ---------------------------------------------------------------------------

describe('identity comes from the target, and is re-proved', () => {
  const run = (target: FakeTarget, clock: ManualClock) =>
    runRiyaBenchmarkSuite({
      plan: PLAN(),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });

  it('stamps the target subject and environment onto the evidence', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock, { subject: syntheticSubject({ modelId: 'model.beta' }) });
    const set = await run(target, clock);
    expect(set.results[0]?.subject.release.modelId).toBe('model.beta');
    expect(set.results[0]?.environment.kind).toBe('LOCAL_EXPLICIT');
  });

  it('a hosted target is stamped as hosted, with no invented hardware', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock, { environment: syntheticHostedEnvironment() });
    const set = await run(target, clock);
    expect(set.results[0]?.environment.kind).toBe('HOSTED_OPAQUE');
    expect(set.results[0]?.environment.acceleratorCount).toBeUndefined();
  });

  it('THE CALLER CANNOT SUPPLY AN IDENTITY — there is no option for one', async () => {
    // "Run against A and stamp it as B" is the forgery this shape prevents.
    const clock = new ManualClock();
    const set = await run(new FakeTarget(clock), clock);
    expect(set.results[0]?.subject.release.modelId).toBe('model.alpha');
    // The options object has no subject/environment key at all.
    const options = {
      plan: PLAN(),
      target: new FakeTarget(new ManualClock()),
      clock: new ManualClock(),
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    };
    expect(Object.keys(options).sort()).toStrictEqual(['clock', 'createdAt', 'plan', 'target']);
  });

  it('an invalid target subject or environment aborts before any request', async () => {
    const clock = new ManualClock();
    const badSubject = new FakeTarget(clock, {
      subject: { ...syntheticSubject(), promptVersion: 0 },
    });
    expect(await codeOf(() => run(badSubject, clock))).toBe('TARGET_SUBJECT_INVALID');
    expect(badSubject.prepareCalls).toBe(0);

    const badEnvironment = new FakeTarget(clock, {
      environment: { ...syntheticHostedEnvironment(), acceleratorCount: 4 },
    });
    expect(await codeOf(() => run(badEnvironment, clock))).toBe('TARGET_ENVIRONMENT_INVALID');
    expect(badEnvironment.prepareCalls).toBe(0);
  });

  it.each([
    ['prompt digest', { promptProfileDigest: syntheticDigest('bbbb') }],
    ['input token count', { inputTokenCount: 1_024 }],
    ['output cap', { maximumOutputTokens: 64 }],
    ['sampling config', { samplingConfigDigest: syntheticDigest('cccc') }],
    ['streaming mode', { streaming: false }],
    ['case id', { workloadCaseId: 'something.else' }],
  ])('a prepared %s that disagrees with the plan aborts BEFORE warmup', async (_name, override) => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock, { preparedOverride: override });
    expect(await codeOf(() => run(target, clock))).toBe('TARGET_CASE_MISMATCH');
    // Prepared, then refused — no request was ever issued.
    expect(target.prepareCalls).toBe(1);
    expect(target.invokedOrdinals).toStrictEqual([]);
  });

  it('refuses a batch larger than one before touching the target', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    expect(
      await codeOf(() =>
        runRiyaBenchmarkSuite({
          plan: PLAN([CASE({ batchSize: 4 })]),
          target,
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
        }),
      ),
    ).toBe('UNSUPPORTED_BATCH_SIZE');
    expect(target.prepareCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Clock.
// ---------------------------------------------------------------------------

describe('the clock is monotonic, injected, and never the wall clock', () => {
  it('a backwards clock aborts rather than producing a negative latency', async () => {
    // A rewind would make an end-to-end latency negative, which reads as an impossibly fast request
    // rather than as a broken clock. Driven from the clock itself, because that is whose property it
    // is: the second reading is earlier than the first.
    let readings = 0;
    const rewinding = {
      nowMicros: (): number => {
        readings += 1;
        return readings === 1 ? 10_000 : 9_000;
      },
    };
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    expect(
      await codeOf(() =>
        runRiyaBenchmarkSuite({
          plan: PLAN([CASE({ warmupRequestCount: 0, measuredRequestCount: 1 })]),
          target,
          clock: rewinding,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
        }),
      ),
    ).toBe('CLOCK_MOVED_BACKWARD');
  });

  it('a fractional or negative reading is refused', async () => {
    const clock = new ManualClock();
    clock.setRaw(1.5);
    expect(
      await codeOf(() =>
        runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
        }),
      ),
    ).toBe('CLOCK_INVALID');
  });

  it('createdAt is injected and is NOT derived from the monotonic clock', async () => {
    const clock = new ManualClock(999_999);
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN(),
      target: new FakeTarget(clock),
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    expect(set.results[0]?.createdAt).toBe(SYNTHETIC_HARNESS_INSTANT);
  });
});
