/**
 * RMB-B boundaries — quiescence, the runtime port firewall, plan re-proof, identity and memory.
 *
 * ### Why the fakes here are slow on purpose
 *
 * A target that resolves in the same tick it was called cannot prove anything about cancellation: the
 * failure, the abort and the drain all happen before the event loop turns, so a harness that leaked
 * work would pass every assertion. Every quiescence spec below therefore HOLDS its requests until the
 * spec itself releases one, which is the only way "the sibling was still in flight when the first one
 * failed" is a fact rather than a hope.
 *
 * ### And why some of them return values TypeScript forbids
 *
 * The port interfaces are erased at run time. A future adapter — written against a real provider, by
 * somebody who has not read this file — can return a raw reply in an unknown key, and the compiler
 * will have been out of the room for hours. So the firewall specs hand the harness exactly that.
 */
import { RIYA_BENCHMARK_MAX_BYTES, RiyaBenchmarkError } from '@qf-jarvis/riya-model-benchmark';
import {
  syntheticDigest,
  syntheticHostedEnvironment,
  syntheticLocalEnvironment,
  syntheticSubject,
} from '@qf-jarvis/riya-model-benchmark/testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RIYA_HARNESS_ERROR_CODES, RiyaHarnessError } from '../contracts/errors.js';
import { createRiyaBenchmarkSuitePlan } from '../contracts/suite-plan.js';
import type {
  RiyaBenchmarkSuiteCaseV1,
  RiyaBenchmarkSuitePlanV1,
} from '../contracts/suite-plan.js';
import { runRiyaBenchmarkSuite } from '../service/run-suite.js';
import type { RunRiyaBenchmarkSuiteOptions } from '../service/run-suite.js';
import {
  FakeMemoryProbe,
  FakeTarget,
  ManualClock,
  SYNTHETIC_HARNESS_INSTANT,
} from '../testing/fakes.js';
import type { FakeRequestScript, FakeTargetOptions } from '../testing/fakes.js';

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

/**
 * A plan that never went through the constructor.
 *
 * This is not a contrived shape: it is what arrives from `JSON.parse`, from a cast, or from a
 * JavaScript caller who never saw the type at all.
 */
const forgedPlan = (value: unknown): RiyaBenchmarkSuitePlanV1 => value as RiyaBenchmarkSuitePlanV1;

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error: unknown) {
    return error instanceof RiyaHarnessError ? error.code : 'not-a-harness-error';
  }
  return 'no-error';
};

const errorOf = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
};

/** Let every pending microtask run, so "still pending" means pending rather than not-yet-scheduled. */
const settleMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
};

interface Harness {
  readonly clock: ManualClock;
  readonly target: FakeTarget;
  readonly run: Promise<unknown>;
}

/** Start a run WITHOUT awaiting it, so a spec can interleave with the requests in flight. */
function start(
  cases: readonly RiyaBenchmarkSuiteCaseV1[],
  targetOptions: FakeTargetOptions,
  extra: Partial<RunRiyaBenchmarkSuiteOptions> = {},
): Harness {
  const clock = new ManualClock();
  const target = new FakeTarget(clock, targetOptions);
  const run = runRiyaBenchmarkSuite({
    plan: PLAN(cases),
    target,
    clock,
    createdAt: SYNTHETIC_HARNESS_INSTANT,
    ...extra,
  });
  // Attached immediately: an unhandled rejection between here and the spec's assertion would be
  // reported as a test-runner failure rather than as the thing under test.
  void run.catch(() => undefined);
  return { clock, target, run };
}

const HOLD: FakeRequestScript = {
  firstOutputAfterMicros: 100,
  completeAfterMicros: 400,
  outcome: 'SUCCESS',
  outputTokens: 8,
  holdUntilReleased: true,
};

/** A held request that, once released, returns a success with no first-output callback. */
const HOLD_THEN_VIOLATE: FakeRequestScript = { ...HOLD, skipFirstOutput: true };

/** A held request that, once cancelled, is SLOW to stop — the only way the drain is observable. */
const HOLD_AND_LINGER: FakeRequestScript = { ...HOLD, holdOnCancel: true };

// ---------------------------------------------------------------------------
// 1-10 — quiescence and cancellation.
// ---------------------------------------------------------------------------

describe('a failure stops the suite, and the suite does not return until everything has stopped', () => {
  it('one worker can fail while seven siblings are genuinely in flight', async () => {
    const { target, run } = start([CASE({ concurrency: 8, measuredRequestCount: 8 })], {
      script: [HOLD_THEN_VIOLATE, HOLD],
    });
    await target.whenInFlight(8);
    expect(target.maxInFlight).toBe(8);

    target.release(0);
    expect(await codeOf(() => run)).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('the FIRST failure aborts the internal controller — with no caller signal in sight', async () => {
    // Every sibling is held on a gate nobody opens. The only thing that can settle them is the
    // internal abort, so their settlement IS the proof that the controller fired.
    const { target, run } = start([CASE({ concurrency: 4, measuredRequestCount: 4 })], {
      script: [HOLD_THEN_VIOLATE, { ...HOLD, onCancel: 'FAILURE' }],
    });
    await target.whenInFlight(4);
    target.release(0);
    await codeOf(() => run);
    expect(target.settledOrdinals.sort()).toStrictEqual([0, 1, 2, 3]);
  });

  it('ADMITS NO FURTHER ORDINAL ONCE THE CONTROLLER HAS ABORTED', async () => {
    // The sibling returns an ordinary FAILURE when cancelled — a perfectly valid outcome, so its
    // worker survives and goes round the loop again. Only the pre-admission check on the INTERNAL
    // signal stops it pulling ordinal 2 into a suite that has already failed.
    const { target, run } = start([CASE({ concurrency: 2, measuredRequestCount: 8 })], {
      script: [HOLD_THEN_VIOLATE, { ...HOLD, onCancel: 'FAILURE' }],
    });
    await target.whenInFlight(2);
    target.release(0);
    expect(await codeOf(() => run)).toBe('TARGET_PROTOCOL_INVALID');
    expect(target.invokedOrdinals).toStrictEqual([0, 1]);
  });

  it('admits no further ordinal after an EXTERNAL abort either', async () => {
    const controller = new AbortController();
    const { target, run } = start(
      [CASE({ concurrency: 1, measuredRequestCount: 4 })],
      { script: [{ ...HOLD, onCancel: 'FAILURE' }] },
      { signal: controller.signal },
    );
    await target.whenInFlight(1);
    controller.abort();
    expect(await codeOf(() => run)).toBe('SUITE_ABORTED');
    // One admitted, three never offered — even though the cancelled one terminated cleanly.
    expect(target.invokedOrdinals).toStrictEqual([0]);
  });

  it('DOES NOT RETURN WHILE A SIBLING IS STILL STOPPING', async () => {
    // The seven siblings are cancelled and then deliberately linger. A fail-fast join would hand the
    // rejection back here with seven requests still running against the target — the caller would
    // believe the suite was over while load continued.
    const { target, run } = start([CASE({ concurrency: 8, measuredRequestCount: 8 })], {
      script: [HOLD_THEN_VIOLATE, HOLD_AND_LINGER],
    });
    const settled = run.then(
      () => 'RESOLVED',
      () => 'REJECTED',
    );
    await target.whenInFlight(8);
    target.release(0);
    await target.whenCancelPending(7);
    await settleMicrotasks();

    expect(target.inFlight).toBe(7);
    expect(await Promise.race([settled, Promise.resolve('PENDING')])).toBe('PENDING');

    target.releaseCancels();
    expect(await codeOf(() => run)).toBe('TARGET_PROTOCOL_INVALID');
    expect(target.settledOrdinals).toHaveLength(8);
  });

  it('has ZERO requests in flight at the exact moment it rejects', async () => {
    const { target, run } = start([CASE({ concurrency: 8, measuredRequestCount: 8 })], {
      script: [HOLD_THEN_VIOLATE, HOLD_AND_LINGER],
    });
    // Read inside the rejection handler, not after awaiting it: "in flight when it settled" and "in
    // flight a few microtasks later" are different claims, and only the first one is the promise.
    const inFlightAtRejection = run.then(
      () => -1,
      () => target.inFlight,
    );
    await target.whenInFlight(8);
    target.release(0);
    await target.whenCancelPending(7);
    target.releaseCancels();
    expect(await inFlightAtRejection).toBe(0);
  });

  it('starts nothing new after the returned promise has settled', async () => {
    const { target, run } = start([CASE({ concurrency: 2, measuredRequestCount: 8 })], {
      script: [HOLD_THEN_VIOLATE, HOLD],
    });
    await target.whenInFlight(2);
    target.release(0);
    await codeOf(() => run);
    const admitted = target.invokedOrdinals.length;
    // Releasing every remaining gate must move nothing: there is no worker left to admit them.
    for (let ordinal = 0; ordinal < 8; ordinal += 1) {
      target.release(ordinal);
    }
    await settleMicrotasks();
    expect(target.invokedOrdinals.length).toBe(admitted);
    expect(target.inFlight).toBe(0);
  });

  it('surfaces the ORIGINAL failure, not the cancellations it caused', async () => {
    // Ordinal 0 reports a token count the plan never asked for; the other seven are cancelled and
    // would each raise SUITE_ABORTED. The token mismatch is the one that explains the run.
    const { target, run } = start([CASE({ concurrency: 8, measuredRequestCount: 8 })], {
      script: [{ ...HOLD, wrongInputTokens: 1_024 }, HOLD],
    });
    await target.whenInFlight(8);
    target.release(0);
    expect(await codeOf(() => run)).toBe('INPUT_TOKEN_MISMATCH');
  });

  it('an EXTERNAL abort is SUITE_ABORTED, and produces no result set', async () => {
    const controller = new AbortController();
    const { run } = start(
      [CASE({ concurrency: 4, measuredRequestCount: 4 })],
      { script: [HOLD] },
      { signal: controller.signal },
    );
    controller.abort();
    expect(await codeOf(() => run)).toBe('SUITE_ABORTED');
  });

  it('an external abort DRAINS cooperative in-flight calls', async () => {
    const controller = new AbortController();
    const { target, run } = start(
      [CASE({ concurrency: 4, measuredRequestCount: 4 })],
      { script: [{ ...HOLD_AND_LINGER, onCancel: 'FAILURE' }] },
      { signal: controller.signal },
    );
    const inFlightAtRejection = run.then(
      () => -1,
      () => target.inFlight,
    );
    await target.whenInFlight(4);
    controller.abort();
    await target.whenCancelPending(4);
    await settleMicrotasks();
    expect(target.inFlight).toBe(4);

    target.releaseCancels();
    expect(await inFlightAtRejection).toBe(0);
    expect(await codeOf(() => run)).toBe('SUITE_ABORTED');
    expect(target.settledOrdinals).toHaveLength(4);
  });

  it('a throw FROM an aborted signal is cancellation, not a broken adapter', async () => {
    // The adapter did exactly what the port asks — it stopped. Calling that TARGET_PROTOCOL_INVALID
    // would blame the target for the caller's decision, and the log would send somebody debugging it.
    const controller = new AbortController();
    const { target, run } = start(
      [CASE({ concurrency: 2, measuredRequestCount: 2 })],
      { script: [{ ...HOLD, onCancel: 'THROW' }] },
      { signal: controller.signal },
    );
    await target.whenInFlight(2);
    controller.abort();
    expect(await codeOf(() => run)).toBe('SUITE_ABORTED');
  });
});

// ---------------------------------------------------------------------------
// 11-22 — the runtime port firewall.
// ---------------------------------------------------------------------------

describe('a TypeScript interface is not a firewall, so every port value is re-parsed', () => {
  const runWith = (options: FakeTargetOptions): (() => Promise<unknown>) => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock, options);
    return () =>
      runRiyaBenchmarkSuite({
        plan: PLAN(),
        target,
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
      });
  };

  it('a descriptor that THROWS is normalized', async () => {
    expect(await codeOf(runWith({ descriptorThrows: true }))).toBe('TARGET_PROTOCOL_INVALID');
  });

  it.each([
    ['null', null],
    ['a string', 'model.alpha'],
    ['an empty object', {}],
    ['a missing environment', { subject: syntheticSubject() }],
  ])('a descriptor that is %s is refused', async (_name, descriptorRaw) => {
    expect(await codeOf(runWith({ descriptorRaw }))).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('a descriptor with an UNKNOWN top-level key is refused, not ignored', async () => {
    expect(
      await codeOf(
        runWith({
          descriptorRaw: {
            subject: syntheticSubject(),
            environment: syntheticLocalEnvironment(),
            transcript: 'customer: do you deliver to Pune?',
          },
        }),
      ),
    ).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('a nested subject carrying raw content is refused by RMB-A', async () => {
    expect(
      await codeOf(
        runWith({
          descriptorRaw: {
            subject: { ...syntheticSubject(), promptText: 'you are Riya, a sales assistant' },
            environment: syntheticLocalEnvironment(),
          },
        }),
      ),
    ).toBe('TARGET_SUBJECT_INVALID');
  });

  it('a nested environment carrying a machine detail is refused by RMB-A', async () => {
    expect(
      await codeOf(
        runWith({
          descriptorRaw: {
            subject: syntheticSubject(),
            environment: { ...syntheticLocalEnvironment(), machineName: 'build-box-07' },
          },
        }),
      ),
    ).toBe('TARGET_ENVIRONMENT_INVALID');
  });

  it.each([
    ['a prompt', 'prompt'],
    ['a message list', 'messages'],
    ['a transcript', 'transcript'],
  ])('a prepared case carrying %s is refused', async (_name, key) => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    const workloadShaped = {
      workloadCaseId: 'case.alpha',
      promptProfileDigest: syntheticDigest('face'),
      inputTokenCount: 512,
      maximumOutputTokens: 256,
      samplingConfigDigest: syntheticDigest('dad'),
      streaming: true,
      [key]: 'namaste! looking for a 3-seater sofa',
    };
    expect(
      await codeOf(() =>
        runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock, { preparedRaw: workloadShaped }),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
        }),
      ),
    ).toBe('TARGET_PROTOCOL_INVALID');
    expect(target.invokedOrdinals).toStrictEqual([]);
  });

  it('a prepareCase that THROWS is normalized', async () => {
    expect(await codeOf(runWith({ prepareThrows: true }))).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('A SUCCESS CARRYING THE MODEL REPLY IS REFUSED — the content does not merely go unused', async () => {
    expect(
      await codeOf(
        runWith({
          script: [
            {
              ...HOLD,
              holdUntilReleased: false,
              rawResult: {
                outcome: 'SUCCESS',
                inputTokens: 512,
                outputTokens: 20,
                text: 'Yes, we deliver across Pune within 5 working days.',
              },
            },
          ],
        }),
      ),
    ).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('a FAILURE carrying partial output is refused', async () => {
    expect(
      await codeOf(
        runWith({
          script: [
            {
              ...HOLD,
              holdUntilReleased: false,
              outcome: 'FAILURE',
              rawResult: { outcome: 'FAILURE', partialText: 'Yes, we deliv' },
            },
          ],
        }),
      ),
    ).toBe('TARGET_PROTOCOL_INVALID');
  });

  it.each([
    ['null', null],
    ['an unknown outcome', { outcome: 'PARTIAL', inputTokens: 512, outputTokens: 4 }],
    ['no outcome at all', { inputTokens: 512, outputTokens: 4 }],
    ['a usage blob', { outcome: 'SUCCESS', inputTokens: 512, outputTokens: 4, usageBlob: {} }],
  ])('a terminal result that is %s is refused', async (_name, rawResult) => {
    expect(
      await codeOf(runWith({ script: [{ ...HOLD, holdUntilReleased: false, rawResult }] })),
    ).toBe('TARGET_PROTOCOL_INVALID');
  });

  it('a memory reading carrying a device detail is refused', async () => {
    const clock = new ManualClock();
    expect(
      await codeOf(() =>
        runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
          memoryProbe: new FakeMemoryProbe(clock, {
            readingRaw: {
              peakHostMemoryBytes: 4_294_967_296,
              devicePath: '/dev/accelerator0',
              serialNumber: 'SN-0000-1111',
            },
          }),
        }),
      ),
    ).toBe('MEMORY_MEASUREMENT_INVALID');
  });

  it('NO foreign exception message reaches the caller', async () => {
    // A real adapter's message is where the prompt, the endpoint and the credential live.
    const cases: (() => Promise<unknown>)[] = [
      runWith({ descriptorThrows: true }),
      runWith({ prepareThrows: true }),
      runWith({ script: [{ ...HOLD, holdUntilReleased: false, throwInstead: true }] }),
    ];
    for (const run of cases) {
      const error = await errorOf(run);
      expect(error).toBeInstanceOf(RiyaHarnessError);
      const harnessError = error instanceof RiyaHarnessError ? error : undefined;
      expect(harnessError?.message).toBe('TARGET_PROTOCOL_INVALID');
      expect(harnessError?.cause).toBeUndefined();
      expect(JSON.stringify(harnessError?.stack ?? '')).not.toContain('exploded');
    }
  });
});

// ---------------------------------------------------------------------------
// 23-28 — the plan is re-proved at the runner boundary.
// ---------------------------------------------------------------------------

describe('the runner re-proves the plan before it touches the target', () => {
  const attempt = async (plan: RiyaBenchmarkSuitePlanV1): Promise<[string, FakeTarget]> => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    const code = await codeOf(() =>
      runRiyaBenchmarkSuite({ plan, target, clock, createdAt: SYNTHETIC_HARNESS_INSTANT }),
    );
    return [code, target];
  };

  const RAW_CASE = {
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
  };

  it('a well-formed plan survives re-proof unchanged', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ workloadCaseId: 'zeta.c1' }), CASE({ workloadCaseId: 'alpha.c1' })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    // Sorted, exactly as the constructor promises, and the runner used ITS ordering.
    expect(set.caseIds).toStrictEqual(['alpha.c1', 'zeta.c1']);
  });

  it('a forged plan with an unknown OUTER key is refused before the target is read', async () => {
    const [code, target] = await attempt(
      forgedPlan({
        version: 1,
        benchmarkSuiteId: 'suite.alpha',
        benchmarkSuiteVersion: 1,
        cases: [RAW_CASE],
        systemPrompt: 'you are Riya',
      }),
    );
    expect(code).toBe('PLAN_INVALID');
    expect(target.descriptorCalls).toBe(0);
    expect(target.prepareCalls).toBe(0);
  });

  it('a forged CASE carrying raw text is refused before the target is read', async () => {
    const [code, target] = await attempt(
      forgedPlan({
        version: 1,
        benchmarkSuiteId: 'suite.alpha',
        benchmarkSuiteVersion: 1,
        cases: [{ ...RAW_CASE, promptText: 'namaste! do you have modular kitchens?' }],
      }),
    );
    expect(code).toBe('PLAN_INVALID');
    expect(target.descriptorCalls).toBe(0);
  });

  it.each([
    ['a zero measured count', { measuredRequestCount: 0 }],
    ['a fractional concurrency', { concurrency: 1.5 }],
    ['a negative warmup', { warmupRequestCount: -1 }],
    ['a missing timeout', { requestTimeoutMicros: undefined }],
  ])('a forged case with %s is refused before the target is read', async (_name, override) => {
    const [code, target] = await attempt(
      forgedPlan({
        version: 1,
        benchmarkSuiteId: 'suite.alpha',
        benchmarkSuiteVersion: 1,
        cases: [{ ...RAW_CASE, ...override }],
      }),
    );
    expect(code).toBe('PLAN_INVALID');
    expect(target.descriptorCalls).toBe(0);
  });

  it('an empty plan is refused before the target is read', async () => {
    const [code, target] = await attempt(
      forgedPlan({
        version: 1,
        benchmarkSuiteId: 'suite.alpha',
        benchmarkSuiteVersion: 1,
        cases: [],
      }),
    );
    expect(code).toBe('PLAN_INVALID');
    expect(target.descriptorCalls).toBe(0);
  });

  it('AN UNSUPPORTED BATCH IS REFUSED BEFORE THE DESCRIPTOR IS EVEN READ', async () => {
    // "Before any target work" has to include asking the target what it is.
    const [code, target] = await attempt(PLAN([CASE({ batchSize: 4 })]));
    expect(code).toBe('UNSUPPORTED_BATCH_SIZE');
    expect(target.descriptorCalls).toBe(0);
    expect(target.prepareCalls).toBe(0);
    expect(target.invokedOrdinals).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 29-33 — identity stability across the suite.
// ---------------------------------------------------------------------------

describe('the target may not change what it is halfway through', () => {
  const twoCases = [CASE({ workloadCaseId: 'case.alpha' }), CASE({ workloadCaseId: 'case.beta' })];

  const attempt = async (options: FakeTargetOptions): Promise<string> => {
    const clock = new ManualClock();
    return codeOf(() =>
      runRiyaBenchmarkSuite({
        plan: PLAN(twoCases),
        target: new FakeTarget(clock, options),
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
      }),
    );
  };

  it('a stable descriptor is read repeatedly and accepted', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN(twoCases),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    expect(set.results).toHaveLength(2);
    // Locked once, then re-proved before and after each of the two cases.
    expect(target.descriptorCalls).toBe(5);
    expect(set.results[0]?.subject.release.modelId).toBe('model.alpha');
  });

  it('A SUBJECT THAT DRIFTS BETWEEN CASES FAILS THE WHOLE SUITE', async () => {
    expect(
      await attempt({
        driftAfterDescriptorCalls: 3,
        driftSubject: syntheticSubject({ modelId: 'model.beta' }),
      }),
    ).toBe('TARGET_IDENTITY_CHANGED');
  });

  it('an ENVIRONMENT that drifts between cases fails the whole suite', async () => {
    expect(
      await attempt({
        driftAfterDescriptorCalls: 3,
        driftEnvironment: syntheticHostedEnvironment(),
      }),
    ).toBe('TARGET_IDENTITY_CHANGED');
  });

  it('a drift visible only AFTER the measured phase is still caught', async () => {
    // Reads: lock (1), pre-case (2), post-case (3). Drifting after the second means the case ran
    // against something the harness had already proved, and changed underneath it.
    const clock = new ManualClock();
    const target = new FakeTarget(clock, {
      driftAfterDescriptorCalls: 2,
      driftSubject: syntheticSubject({ modelId: 'model.beta' }),
    });
    const code = await codeOf(() =>
      runRiyaBenchmarkSuite({
        plan: PLAN(),
        target,
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
      }),
    );
    expect(code).toBe('TARGET_IDENTITY_CHANGED');
    // It measured, and then refused to keep the numbers.
    expect(target.invokedOrdinals).toStrictEqual([0]);
  });

  it('produces NO evidence and no result set after a drift', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock, {
      driftAfterDescriptorCalls: 3,
      driftSubject: syntheticSubject({ modelId: 'model.beta' }),
    });
    const outcome = await runRiyaBenchmarkSuite({
      plan: PLAN(twoCases),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    }).then(
      (set) => set,
      () => undefined,
    );
    expect(outcome).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 34-45 — the measured-phase memory lifecycle.
// ---------------------------------------------------------------------------

describe('peak memory belongs to the measured phase, and to nothing else', () => {
  it('opens AFTER warmup, closes AFTER the window, and costs the window nothing', async () => {
    const clock = new ManualClock();
    let invocationsAtBegin = -1;
    const target = new FakeTarget(clock);
    const probe = new FakeMemoryProbe(clock, {
      beginAdvanceMicros: 5_000,
      finishAdvanceMicros: 7_000,
      onBegin: () => {
        invocationsAtBegin = target.invokedOrdinals.length;
      },
    });
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ warmupRequestCount: 1, measuredRequestCount: 2 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
    });

    // The one warmup request had already run when the window opened.
    expect(invocationsAtBegin).toBe(1);
    expect(probe.beganCaseIds).toStrictEqual(['case.alpha']);
    expect(probe.finishedCaseIds).toStrictEqual(['case.alpha']);
    expect(probe.abortedCaseIds).toStrictEqual([]);
    // Two measured requests at 500 micros each. Neither the 5,000 of probe setup nor the 7,000 of
    // probe teardown is inside it — if either were, throughput would be understated by 6x.
    expect(set.results[0]?.observation.measuredWindowMicros).toBe(1_000);
  });

  it('RECORDS THE MEASURED PEAK AND EXCLUDES THE WARMUP PEAK', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    const target = new FakeTarget(clock, {
      memoryObserver: probe,
      // Warmup burns 9 GB; the measured phase never goes above 3.5.
      memoryBytesByInvocation: [9_000_000_000, 3_000_000_000, 3_500_000_000],
    });
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ warmupRequestCount: 1, measuredRequestCount: 2 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
    });
    expect(set.results[0]?.observation.peakHostMemoryBytes).toBe(3_500_000_000);
  });

  it('does not let one case contaminate the next', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    const target = new FakeTarget(clock, {
      memoryObserver: probe,
      memoryBytesByInvocation: [8_000_000_000, 2_000_000_000],
    });
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ workloadCaseId: 'case.alpha' }), CASE({ workloadCaseId: 'case.beta' })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
    });
    expect(probe.beganCaseIds).toStrictEqual(['case.alpha', 'case.beta']);
    expect(set.results[0]?.observation.peakHostMemoryBytes).toBe(8_000_000_000);
    expect(set.results[1]?.observation.peakHostMemoryBytes).toBe(2_000_000_000);
  });

  it('aborts the open case when the measured phase fails a protocol check', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    const code = await codeOf(() =>
      runRiyaBenchmarkSuite({
        plan: PLAN(),
        target: new FakeTarget(clock, {
          script: [{ ...HOLD, holdUntilReleased: false, skipFirstOutput: true }],
        }),
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
        memoryProbe: probe,
      }),
    );
    expect(code).toBe('TARGET_PROTOCOL_INVALID');
    expect(probe.abortedCaseIds).toStrictEqual(['case.alpha']);
    expect(probe.finishedCaseIds).toStrictEqual([]);
    expect(probe.openCases).toBe(0);
  });

  it('aborts the open case when the caller cancels', async () => {
    const controller = new AbortController();
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    const target = new FakeTarget(clock, { script: [HOLD] });
    const run = runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ concurrency: 2, measuredRequestCount: 2 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
      signal: controller.signal,
    });
    void run.catch(() => undefined);
    await target.whenInFlight(2);
    controller.abort();
    expect(await codeOf(() => run)).toBe('SUITE_ABORTED');
    expect(probe.abortedCaseIds).toStrictEqual(['case.alpha']);
    expect(probe.openCases).toBe(0);
  });

  it('AWAITS THE CLEANUP — a probe still releasing a handle holds the suite open', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, { holdAbort: true });
    const run = runRiyaBenchmarkSuite({
      plan: PLAN(),
      target: new FakeTarget(clock, {
        script: [{ ...HOLD, holdUntilReleased: false, skipFirstOutput: true }],
      }),
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
      memoryProbe: probe,
    });
    const settled = run.then(
      () => 'RESOLVED',
      () => 'REJECTED',
    );

    await probe.whenAbortStarted();
    await settleMicrotasks();
    expect(probe.abortCompleted).toBe(false);
    expect(await Promise.race([settled, Promise.resolve('PENDING')])).toBe('PENDING');

    probe.releaseAbort();
    expect(await codeOf(() => run)).toBe('TARGET_PROTOCOL_INVALID');
    expect(probe.abortCompleted).toBe(true);
  });

  it('a cleanup failure does not replace the failure that caused it', async () => {
    const clock = new ManualClock();
    const probe = new FakeMemoryProbe(clock, {});
    // `abort` on this probe rejects; the token mismatch is still what surfaces.
    const failing = {
      beginMeasuredCase: () =>
        Promise.resolve({
          finish: () => Promise.resolve({}),
          abort: () => Promise.reject(new Error('probe teardown exploded')),
        }),
    };
    const code = await codeOf(() =>
      runRiyaBenchmarkSuite({
        plan: PLAN(),
        target: new FakeTarget(clock, {
          script: [{ ...HOLD, holdUntilReleased: false, wrongInputTokens: 1_024 }],
        }),
        clock,
        createdAt: SYNTHETIC_HARNESS_INSTANT,
        memoryProbe: failing,
      }),
    );
    expect(code).toBe('INPUT_TOKEN_MISMATCH');
    expect(probe.abortedCaseIds).toStrictEqual([]);
  });

  it('omits memory entirely when there is no probe', async () => {
    const clock = new ManualClock();
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN(),
      target: new FakeTarget(clock),
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    expect(set.results[0]?.observation.peakHostMemoryBytes).toBeUndefined();
    expect(set.results[0]?.observation.peakAcceleratorMemoryBytes).toBeUndefined();
  });

  it.each([
    ['a malformed reading', { peakHostMemoryBytes: 'four gigabytes' }],
    ['a zero reading', { peakHostMemoryBytes: 0 }],
    ['an above-bound reading', { peakHostMemoryBytes: RIYA_BENCHMARK_MAX_BYTES + 1 }],
  ])('refuses %s rather than recording it', async (_name, readingRaw) => {
    const clock = new ManualClock();
    expect(
      await codeOf(() =>
        runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
          memoryProbe: new FakeMemoryProbe(clock, { readingRaw }),
        }),
      ),
    ).toBe('MEMORY_MEASUREMENT_INVALID');
  });

  it('a probe that fails to open or to read is normalized, never ignored', async () => {
    for (const options of [{ throwOnBegin: true }, { throwOnFinish: true }]) {
      const clock = new ManualClock();
      expect(
        await codeOf(() =>
          runRiyaBenchmarkSuite({
            plan: PLAN(),
            target: new FakeTarget(clock),
            clock,
            createdAt: SYNTHETIC_HARNESS_INSTANT,
            memoryProbe: new FakeMemoryProbe(clock, options),
          }),
        ),
        JSON.stringify(options),
      ).toBe('MEMORY_MEASUREMENT_INVALID');
    }
  });
});

// ---------------------------------------------------------------------------
// 46-49 — the request deadline belongs to the adapter.
// ---------------------------------------------------------------------------

describe('the adapter owns the deadline, and the harness owns no timer', () => {
  it('EVERY invocation receives the workload timeout exactly, warmup included', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    await runRiyaBenchmarkSuite({
      plan: PLAN([
        CASE({
          workloadCaseId: 'case.alpha',
          requestTimeoutMicros: 1_500_000,
          warmupRequestCount: 2,
          measuredRequestCount: 3,
        }),
        CASE({
          workloadCaseId: 'case.beta',
          requestTimeoutMicros: 9_000_000,
          measuredRequestCount: 2,
        }),
      ]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    expect(target.invokedTimeouts).toStrictEqual([
      1_500_000, 1_500_000, 1_500_000, 1_500_000, 1_500_000, 9_000_000, 9_000_000,
    ]);
  });

  it('an expired deadline is an ORDINARY FAILURE, and the suite carries on', async () => {
    // The adapter enforced its deadline and returned a failure. That is data: it lands in the success
    // rate, contributes no latency sample, and does not invalidate the measurement.
    const clock = new ManualClock();
    const target = new FakeTarget(clock, {
      script: [
        { ...HOLD, holdUntilReleased: false, outcome: 'FAILURE' },
        { ...HOLD, holdUntilReleased: false },
      ],
    });
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([CASE({ measuredRequestCount: 4 })]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    const observation = set.results[0]?.observation;
    expect(observation?.failedRequests).toBe(1);
    expect(observation?.successfulRequests).toBe(3);
    expect(observation?.attemptedRequests).toBe(4);
    // Exactly four invocations: the expired one was never asked again.
    expect(target.invokedOrdinals).toStrictEqual([0, 1, 2, 3]);
  });

  it('the new boundary modules name no timer and no ambient clock', () => {
    for (const relative of [
      '../service/run-suite.ts',
      '../internal/port-firewall.ts',
      '../internal/identity-lock.ts',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
      for (const forbidden of ['setTimeout', 'setInterval', 'Date.now', 'performance.now']) {
        expect(source, `${relative} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 50-53 — one closed error type at the public boundary.
// ---------------------------------------------------------------------------

describe('the public boundary throws exactly one type of error', () => {
  const failures: (readonly [string, () => Promise<unknown>])[] = [
    [
      'an invalid createdAt',
      () => {
        const clock = new ManualClock();
        return runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock),
          clock,
          createdAt: 'yesterday afternoon',
        });
      },
    ],
    [
      'a forged plan',
      () => {
        const clock = new ManualClock();
        return runRiyaBenchmarkSuite({
          plan: forgedPlan({ version: 1, cases: 'all of them' }),
          target: new FakeTarget(clock),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
        });
      },
    ],
    [
      'a malformed target result',
      () => {
        const clock = new ManualClock();
        return runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock, {
            script: [{ ...HOLD, holdUntilReleased: false, rawResult: { outcome: 'MAYBE' } }],
          }),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
        });
      },
    ],
    [
      'an above-bound memory reading',
      () => {
        const clock = new ManualClock();
        return runRiyaBenchmarkSuite({
          plan: PLAN(),
          target: new FakeTarget(clock),
          clock,
          createdAt: SYNTHETIC_HARNESS_INSTANT,
          memoryProbe: new FakeMemoryProbe(clock, {
            readingRaw: { peakAcceleratorMemoryBytes: RIYA_BENCHMARK_MAX_BYTES + 1 },
          }),
        });
      },
    ],
  ];

  it('an invalid createdAt is refused by RMB-A and surfaces as a harness code', async () => {
    const code = await codeOf(must(failures[0])[1]);
    expect(code).toBe('EVIDENCE_CONSTRUCTION_INVALID');
  });

  it.each(failures)('%s leaks no RMB-A error, no ZodError and no TypeError', async (_name, run) => {
    const error = await errorOf(run);
    expect(error).toBeInstanceOf(RiyaHarnessError);
    expect(error).not.toBeInstanceOf(RiyaBenchmarkError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error?.constructor.name).toBe('RiyaHarnessError');
    const code = error instanceof RiyaHarnessError ? error.code : 'not-a-harness-error';
    expect(RIYA_HARNESS_ERROR_CODES).toContain(code);
  });

  it('the closed code surface is exactly these fourteen', () => {
    expect([...RIYA_HARNESS_ERROR_CODES]).toStrictEqual([
      'PLAN_INVALID',
      'UNSUPPORTED_BATCH_SIZE',
      'TARGET_SUBJECT_INVALID',
      'TARGET_ENVIRONMENT_INVALID',
      'TARGET_CASE_MISMATCH',
      'TARGET_IDENTITY_CHANGED',
      'CLOCK_INVALID',
      'CLOCK_MOVED_BACKWARD',
      'TARGET_PROTOCOL_INVALID',
      'INPUT_TOKEN_MISMATCH',
      'OUTPUT_TOKEN_LIMIT_EXCEEDED',
      'SUITE_ABORTED',
      'MEMORY_MEASUREMENT_INVALID',
      'EVIDENCE_CONSTRUCTION_INVALID',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 54 — the sweep still runs, end to end, after all of the above.
// ---------------------------------------------------------------------------

describe('the concurrency sweep still works', () => {
  it('runs 1, 8 and 32 in one suite and reaches each ceiling', async () => {
    const clock = new ManualClock();
    const target = new FakeTarget(clock);
    const set = await runRiyaBenchmarkSuite({
      plan: PLAN([
        CASE({ workloadCaseId: 'sweep.c01', concurrency: 1, measuredRequestCount: 4 }),
        CASE({ workloadCaseId: 'sweep.c08', concurrency: 8, measuredRequestCount: 16 }),
        CASE({ workloadCaseId: 'sweep.c32', concurrency: 32, measuredRequestCount: 64 }),
      ]),
      target,
      clock,
      createdAt: SYNTHETIC_HARNESS_INSTANT,
    });
    expect(set.caseIds).toStrictEqual(['sweep.c01', 'sweep.c08', 'sweep.c32']);
    expect(target.maxInFlight).toBe(32);
    for (const evidence of set.results) {
      expect(evidence.observation.successfulRequests).toBe(evidence.workload.measuredRequestCount);
      expect(evidence.observation.measuredWindowMicros).toBeGreaterThan(0);
    }
  });
});

/** Narrow one optional value: the lint bans both `!` and a widening `as`. */
function must<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('missing value');
  }
  return value;
}
