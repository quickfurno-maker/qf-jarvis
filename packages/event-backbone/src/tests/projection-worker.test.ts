/**
 * Stage 3.4.5A — the projection worker/scheduler, focused unit tests (ADR-0038). No database: a fake
 * `runOnce` returns scripted results (or throws) so traversal, progress, wake-delay, abort/drain,
 * validation, the summary, and — crucially — the deterministic-failure-vs-thrown-failure boundary are
 * all deterministic. Every one of the runner's seven CLOSED results permits later projections to run;
 * any THROWN value aborts the cycle with a fixed {@link ProjectionWorkerError} and is never inspected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { ProjectionInputError } from '../projections/projection-errors.js';
import { type ProjectionName } from '../projections/projection-name.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import {
  blockedExistingResult,
  blockedNowResult,
  busyResult,
  caughtUpResult,
  retryPendingResult,
  retryScheduledResult,
  succeededResult,
  type ProjectionRunResult,
} from '../projections/projection-run-result.js';
import { type ProjectionSafeErrorCode } from '../projections/projection-safe-error.js';
import {
  abortableSleep,
  DEFAULT_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  ProjectionWorkerError,
  runProjectionCycle,
  runProjectionWorker,
  type ProjectionWorkerDeps,
  type RunProjectionOnce,
  type WorkerSleep,
} from '../projections/projection-worker.js';
import type { DatabasePool } from '../persistence/pool.js';

const NOW = toCanonicalInstant('2026-07-19T00:00:00.000Z');
const NEXT = toCanonicalInstant('2026-07-19T00:00:00.500Z');
const SAFE = 'projection-handler-failed' as ProjectionSafeErrorCode;
const FAKE_POOL = {} as DatabasePool;
const WORKER_ERROR_MESSAGE =
  'A projection worker cycle aborted: a runner, registry, clock, or result operation raised a non-result failure.';
const SLEEP_ERROR_MESSAGE =
  'A projection worker sleep failed; the worker could not yield between cycles.';

const noopHandler = async (): Promise<void> => {
  await Promise.resolve();
};

function registryOf(...names: readonly string[]) {
  return createProjectionRegistry(names.map((name) => ({ name, version: 1, apply: noopHandler })));
}

function identity(name: string) {
  return { projectionName: name as ProjectionName, projectionVersion: 1 };
}

/** A fake runOnce that records its calls and returns a scripted result per (name, callIndex). */
function scriptedRunOnce(script: (name: string, callIndexForName: number) => ProjectionRunResult): {
  runOnce: RunProjectionOnce;
  calls: { name: string; now: CanonicalInstant }[];
} {
  const calls: { name: string; now: CanonicalInstant }[] = [];
  const perName = new Map<string, number>();
  const runOnce: RunProjectionOnce = (input) => {
    const index = perName.get(input.name) ?? 0;
    perName.set(input.name, index + 1);
    calls.push({ name: input.name, now: input.now });
    return Promise.resolve(script(input.name, index));
  };
  return { runOnce, calls };
}

/** A fake runOnce that THROWS `thrown` for `a-proj` and succeeds for anything else. */
function throwingRunOnce(thrown: unknown): { runOnce: RunProjectionOnce; calls: string[] } {
  const calls: string[] = [];
  const runOnce: RunProjectionOnce = (input) => {
    calls.push(input.name);
    if (input.name === 'a-proj') {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately a non-Error
      return Promise.reject(thrown);
    }
    return Promise.resolve(succeededResult(identity(input.name), 1n, 1));
  };
  return { runOnce, calls };
}

function recordingSleep(): { sleep: WorkerSleep; calls: { ms: number; aborted: boolean }[] } {
  const calls: { ms: number; aborted: boolean }[] = [];
  const sleep: WorkerSleep = (ms, signal) => {
    calls.push({ ms, aborted: signal?.aborted === true });
    return Promise.resolve();
  };
  return { sleep, calls };
}

function deps(overrides: Partial<ProjectionWorkerDeps> & Pick<ProjectionWorkerDeps, 'registry'>) {
  return {
    pool: FAKE_POOL,
    now: () => NOW,
    sleep: recordingSleep().sleep,
    ...overrides,
  } satisfies ProjectionWorkerDeps;
}

/** The seven CLOSED runner results — each must permit a later projection to run. */
const SEVEN_RESULTS: readonly [string, (name: string) => ProjectionRunResult][] = [
  ['busy', (n) => busyResult(identity(n))],
  ['caught-up', (n) => caughtUpResult(identity(n), 0n)],
  ['succeeded', (n) => succeededResult(identity(n), 1n, 1)],
  ['retry-scheduled', (n) => retryScheduledResult(identity(n), 1n, 1, SAFE, NEXT)],
  ['blocked-now', (n) => blockedNowResult(identity(n), 1n, SAFE)],
  ['blocked-existing', (n) => blockedExistingResult(identity(n), 1n, SAFE)],
  ['retry-pending', (n) => retryPendingResult(identity(n), 1n, 1, NEXT)],
];

describe('runProjectionCycle — every closed result permits later projections (test 1)', () => {
  it.each(SEVEN_RESULTS)('a %s result for A still runs B (test 1)', async (_label, factory) => {
    const { runOnce, calls } = scriptedRunOnce((name) =>
      name === 'a-proj' ? factory('a-proj') : succeededResult(identity(name), 1n, 1),
    );
    const result = await runProjectionCycle(
      deps({ registry: registryOf('a-proj', 'b-proj'), runOnce }),
    );
    expect(calls.map((c) => c.name)).toEqual(['a-proj', 'b-proj']); // B ran after A's closed result
    expect(result.outcomes).toHaveLength(2);
  });
});

describe('runProjectionCycle — a THROWN non-result failure aborts the cycle (tests 2-9)', () => {
  it('a thrown primitive aborts the cycle; B is NOT called (tests 2, 6)', async () => {
    const { runOnce, calls } = throwingRunOnce('boom-secret');
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj', 'b-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
    expect(calls).toEqual(['a-proj']); // later projection not invoked after the throw
  });

  it('a thrown Error aborts the cycle; B is NOT called (tests 3, 6)', async () => {
    const { runOnce, calls } = throwingRunOnce(new Error('secret'));
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj', 'b-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
    expect(calls).toEqual(['a-proj']);
  });

  it('a revoked Proxy aborts the cycle WITHOUT inspection — no raw TypeError escapes (test 4)', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const { runOnce, calls } = throwingRunOnce(proxy);
    let caught: unknown;
    try {
      await runProjectionCycle(deps({ registry: registryOf('a-proj', 'b-proj'), runOnce }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionWorkerError);
    expect(caught).not.toBeInstanceOf(TypeError); // touching a revoked proxy would throw TypeError
    expect(calls).toEqual(['a-proj']);
  });

  it('an object with hostile getters aborts the cycle without invoking a getter (test 5)', async () => {
    let getterInvoked = false;
    const hostile = {};
    for (const key of ['code', 'message', 'name', 'stack', 'cause']) {
      Object.defineProperty(hostile, key, {
        get() {
          getterInvoked = true;
          return 'SECRET';
        },
        enumerable: true,
        configurable: true,
      });
    }
    const { runOnce, calls } = throwingRunOnce(hostile);
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj', 'b-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
    expect(getterInvoked).toBe(false); // no field of the caught value was ever read
    expect(calls).toEqual(['a-proj']);
  });

  it('the caller receives only the fixed code/message; the thrown value is not preserved as cause (tests 8, 9)', async () => {
    const hostile = Object.assign(new Error('SECRET-MARKER'), { code: 'HOSTILE-CODE', cause: 'x' });
    const { runOnce } = throwingRunOnce(hostile);
    let caught: unknown;
    try {
      await runProjectionCycle(deps({ registry: registryOf('a-proj', 'b-proj'), runOnce }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionWorkerError);
    expect((caught as ProjectionWorkerError).code).toBe('projection-worker-cycle-failed');
    expect((caught as Error).message).toBe(WORKER_ERROR_MESSAGE);
    expect((caught as { cause?: unknown }).cause).toBeUndefined(); // not preserved as cause
    const rendered = `${(caught as Error).message} ${(caught as ProjectionWorkerError).code} ${(caught as Error).stack ?? ''}`;
    expect(rendered).not.toContain('SECRET-MARKER');
    expect(rendered).not.toContain('HOSTILE-CODE');
  });

  it('runProjectionWorker returns NO partial summary when a cycle throws (test 7)', async () => {
    const { runOnce } = throwingRunOnce(new Error('boom'));
    await expect(
      runProjectionWorker(
        deps({ registry: registryOf('a-proj', 'b-proj'), runOnce, maxCycles: 5 }),
      ),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
  });
});

describe('runProjectionCycle — deterministic traversal and progress', () => {
  it('visits every projection ONCE in ascending name order', async () => {
    const { runOnce, calls } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const result = await runProjectionCycle(
      deps({ registry: registryOf('b-proj', 'a-proj', 'c-proj'), runOnce }),
    );
    expect(calls.map((c) => c.name)).toEqual(['a-proj', 'b-proj', 'c-proj']);
    expect(result.outcomes.map((o) => o.projectionName)).toEqual(['a-proj', 'b-proj', 'c-proj']);
  });

  it('passes the injected now() into each invocation', async () => {
    const { runOnce, calls } = scriptedRunOnce((name) => busyResult(identity(name)));
    await runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce, now: () => NOW }));
    expect(calls[0]?.now).toBe(NOW);
  });

  it('reports progressed=true iff some projection succeeded', async () => {
    const progressing = scriptedRunOnce((name) =>
      name === 'a-proj'
        ? succeededResult(identity(name), 1n, 1)
        : caughtUpResult(identity(name), 0n),
    );
    const r1 = await runProjectionCycle(
      deps({ registry: registryOf('a-proj', 'b-proj'), runOnce: progressing.runOnce }),
    );
    expect(r1.progressed).toBe(true);

    const idle = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const r2 = await runProjectionCycle(
      deps({ registry: registryOf('a-proj', 'b-proj'), runOnce: idle.runOnce }),
    );
    expect(r2.progressed).toBe(false);
  });

  it('tracks the earliest scheduled retry across the cycle', async () => {
    const soon = toCanonicalInstant('2026-07-19T00:00:00.500Z');
    const later = toCanonicalInstant('2026-07-19T00:00:05.000Z');
    const { runOnce } = scriptedRunOnce((name) =>
      name === 'a-proj'
        ? retryPendingResult(identity(name), 1n, 1, later)
        : retryPendingResult(identity(name), 1n, 1, soon),
    );
    const result = await runProjectionCycle(
      deps({ registry: registryOf('a-proj', 'b-proj'), runOnce }),
    );
    expect(result.earliestNextAttemptAt).toBe(soon);
  });
});

describe('runProjectionWorker — no busy-spin and wake scheduling', () => {
  it('sleeps once per no-progress cycle with the poll interval when nothing is scheduled', async () => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const { sleep, calls } = recordingSleep();
    const summary = await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, sleep, maxCycles: 3 }),
    );
    expect(summary.cycles).toBe(3);
    expect(summary.stoppedBy).toBe('max-cycles');
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.ms === DEFAULT_POLL_INTERVAL_MS)).toBe(true);
  });

  it('sleeps until the earliest scheduled retry (clamped to the poll interval)', async () => {
    const soon = toCanonicalInstant('2026-07-19T00:00:00.400Z');
    const { runOnce } = scriptedRunOnce((name) => retryPendingResult(identity(name), 1n, 1, soon));
    const { sleep, calls } = recordingSleep();
    await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, sleep, now: () => NOW, maxCycles: 1 }),
    );
    expect(calls[0]?.ms).toBe(400);
  });

  it('does NOT sleep after a cycle that advanced a position, then sleeps once it idles', async () => {
    const { runOnce } = scriptedRunOnce((_name, callIndex) =>
      callIndex === 0
        ? succeededResult(identity('a-proj'), 1n, 1)
        : caughtUpResult(identity('a-proj'), 1n),
    );
    const { sleep, calls } = recordingSleep();
    await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, sleep, maxCycles: 2 }),
    );
    expect(calls).toHaveLength(1);
  });
});

describe('runProjectionWorker — abort, drain, summary and validation', () => {
  it('starts no cycle when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { runOnce, calls } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const summary = await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, signal: controller.signal, maxCycles: 5 }),
    );
    expect(summary.cycles).toBe(0);
    expect(summary.stoppedBy).toBe('aborted');
    expect(calls).toHaveLength(0);
  });

  it('drains: an abort mid-run stops before the next cycle; the in-flight invocation completes', async () => {
    const controller = new AbortController();
    let seen = 0;
    const runOnce: RunProjectionOnce = (input) => {
      seen += 1;
      if (seen === 2) {
        controller.abort();
      }
      return Promise.resolve(succeededResult(identity(input.name), BigInt(seen), 1));
    };
    const { sleep } = recordingSleep();
    const summary = await runProjectionWorker(
      deps({
        registry: registryOf('a-proj'),
        runOnce,
        sleep,
        signal: controller.signal,
        maxCycles: 10,
      }),
    );
    expect(seen).toBe(2);
    expect(summary.cycles).toBe(2);
    expect(summary.stoppedBy).toBe('aborted');
  });

  it('reports cycles and total succeeded in the summary', async () => {
    const { runOnce } = scriptedRunOnce((_name, callIndex) =>
      callIndex < 2
        ? succeededResult(identity('a-proj'), BigInt(callIndex + 1), 1)
        : caughtUpResult(identity('a-proj'), 2n),
    );
    const { sleep } = recordingSleep();
    const summary = await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, sleep, maxCycles: 3 }),
    );
    expect(summary.succeeded).toBe(2);
    expect(summary.cycles).toBe(3);
  });

  it('passes the signal into sleep so the wait is abortable', async () => {
    const controller = new AbortController();
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const sleep = vi.fn<WorkerSleep>(() => Promise.resolve());
    await runProjectionWorker(
      deps({
        registry: registryOf('a-proj'),
        runOnce,
        sleep,
        signal: controller.signal,
        maxCycles: 1,
      }),
    );
    expect(sleep).toHaveBeenCalledWith(DEFAULT_POLL_INTERVAL_MS, controller.signal);
  });

  it('maxCycles = 0 runs no cycle and stops by the bound', async () => {
    const { runOnce, calls } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const summary = await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, maxCycles: 0 }),
    );
    expect(summary.cycles).toBe(0);
    expect(summary.stoppedBy).toBe('max-cycles');
    expect(calls).toHaveLength(0);
  });
});

// --- Item 1: bounded polling --------------------------------------------------------------------

describe('runProjectionWorker — bounded poll interval [MIN, MAX] (item 1)', () => {
  it('locks the constants at 100 / 1_000 / 60_000', () => {
    expect(MIN_POLL_INTERVAL_MS).toBe(100);
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(1_000);
    expect(MAX_POLL_INTERVAL_MS).toBe(60_000);
  });

  it.each([
    ['MIN accepted', MIN_POLL_INTERVAL_MS],
    ['MAX accepted', MAX_POLL_INTERVAL_MS],
  ])('%s', async (_label, pollIntervalMs) => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const summary = await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, pollIntervalMs, maxCycles: 0 }),
    );
    expect(summary.stoppedBy).toBe('max-cycles'); // accepted (validation did not throw)
  });

  it.each([
    ['MIN-1 rejected', MIN_POLL_INTERVAL_MS - 1],
    ['MAX+1 rejected', MAX_POLL_INTERVAL_MS + 1],
    ['zero rejected', 0],
    ['negative rejected', -1],
    ['decimal rejected', 100.5],
    ['NaN rejected', Number.NaN],
    ['+Infinity rejected', Number.POSITIVE_INFINITY],
    ['-Infinity rejected', Number.NEGATIVE_INFINITY],
  ])('%s BEFORE any work', async (_label, pollIntervalMs) => {
    const { runOnce, calls } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    await expect(
      runProjectionWorker(deps({ registry: registryOf('a-proj'), runOnce, pollIntervalMs })),
    ).rejects.toBeInstanceOf(ProjectionInputError);
    expect(calls).toHaveLength(0); // rejected before any runOnce invocation
  });

  it('rejects invalid maxCycles BEFORE any work', async () => {
    const registry = registryOf('a-proj');
    for (const maxCycles of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(runProjectionWorker(deps({ registry, maxCycles }))).rejects.toBeInstanceOf(
        ProjectionInputError,
      );
    }
  });
});

// --- Item 2: every started cycle completes ------------------------------------------------------

describe('runProjectionCycle — a started cycle completes the whole snapshot (item 2)', () => {
  it('A aborting the signal during its invocation does NOT cut the cycle short: A, B, C all run once', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const runOnce: RunProjectionOnce = (input) => {
      seen.push(input.name);
      if (input.name === 'a-proj') {
        controller.abort(); // abort mid-cycle — the cycle must still drain B and C
      }
      return Promise.resolve(caughtUpResult(identity(input.name), 0n));
    };
    const result = await runProjectionCycle(
      deps({
        registry: registryOf('a-proj', 'b-proj', 'c-proj'),
        runOnce,
        signal: controller.signal,
      }),
    );
    expect(seen).toEqual(['a-proj', 'b-proj', 'c-proj']); // each invoked exactly once
    expect(result.outcomes.map((o) => o.projectionName)).toEqual(['a-proj', 'b-proj', 'c-proj']);
  });

  it('runProjectionWorker: abort during cycle 1 finishes the cycle, starts no cycle 2, does not sleep', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const runOnce: RunProjectionOnce = (input) => {
      seen.push(input.name);
      if (input.name === 'a-proj') {
        controller.abort();
      }
      return Promise.resolve(caughtUpResult(identity(input.name), 0n));
    };
    const { sleep, calls } = recordingSleep();
    const summary = await runProjectionWorker(
      deps({
        registry: registryOf('a-proj', 'b-proj', 'c-proj'),
        runOnce,
        sleep,
        signal: controller.signal,
        maxCycles: 10,
      }),
    );
    expect(seen).toEqual(['a-proj', 'b-proj', 'c-proj']); // cycle 1 drained fully
    expect(summary.cycles).toBe(1); // no second cycle began
    expect(summary.stoppedBy).toBe('aborted');
    expect(calls).toHaveLength(0); // did not sleep after abort
  });
});

// --- Item 3: closed error boundary over every injected seam -------------------------------------

describe('runProjectionCycle/Worker — closed error boundary over every seam (item 3)', () => {
  const hostileRegistry = (throwOnList: unknown) =>
    ({
      list(): readonly never[] {
        throw throwOnList;
      },
      get: () => undefined,
      has: () => false,
    }) as unknown as ProjectionWorkerDeps['registry'];

  it('registry.list throwing a primitive fails closed with the fixed cycle code', async () => {
    await expect(
      runProjectionCycle(deps({ registry: hostileRegistry('SECRET') })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
  });

  it('registry.list returning a hostile proxy (throwing length) fails closed', async () => {
    const hostileList = new Proxy([], {
      get(_target, prop) {
        if (prop === 'length') {
          throw new Error('SECRET-LENGTH');
        }
        return undefined;
      },
    });
    const registry = {
      list: () => hostileList as readonly never[],
      get: () => undefined,
      has: () => false,
    } as unknown as ProjectionWorkerDeps['registry'];
    let caught: unknown;
    try {
      await runProjectionCycle(deps({ registry }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionWorkerError);
    expect((caught as Error).stack ?? '').not.toContain('SECRET-LENGTH');
  });

  it('now() throwing fails the cycle closed', async () => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    await expect(
      runProjectionCycle(
        deps({
          registry: registryOf('a-proj'),
          runOnce,
          now: () => {
            throw new Error('SECRET-CLOCK');
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
  });

  it('sleep rejecting a primitive becomes a sleep-failure, NOT a successful aborted stop', async () => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const sleep: WorkerSleep = () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate non-Error
      Promise.reject('SECRET-SLEEP');
    let caught: unknown;
    try {
      await runProjectionWorker(
        deps({ registry: registryOf('a-proj'), runOnce, sleep, maxCycles: 3 }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionWorkerError);
    expect((caught as ProjectionWorkerError).code).toBe('projection-worker-sleep-failed');
    expect((caught as Error).message).toBe(SLEEP_ERROR_MESSAGE);
  });

  it('sleep rejecting an Error becomes a sleep-failure without preserving the value', async () => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const sleep: WorkerSleep = () => Promise.reject(new Error('SECRET-SLEEP-ERR'));
    let caught: unknown;
    try {
      await runProjectionWorker(
        deps({ registry: registryOf('a-proj'), runOnce, sleep, maxCycles: 3 }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionWorkerError);
    expect((caught as ProjectionWorkerError).code).toBe('projection-worker-sleep-failed');
    expect((caught as { cause?: unknown }).cause).toBeUndefined();
    expect((caught as Error).stack ?? '').not.toContain('SECRET-SLEEP-ERR');
  });

  it('runOnce returning a hostile proxy (throwing outcome getter) fails closed without invoking it twice', async () => {
    const hostile = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'outcome') {
            throw new Error('SECRET-OUTCOME');
          }
          return undefined;
        },
      },
    ) as unknown as ProjectionRunResult;
    const runOnce: RunProjectionOnce = () => Promise.resolve(hostile);
    let caught: unknown;
    try {
      await runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectionWorkerError);
    expect((caught as ProjectionWorkerError).code).toBe('projection-worker-cycle-failed');
    expect((caught as Error).stack ?? '').not.toContain('SECRET-OUTCOME');
  });

  it('runOnce returning an unknown outcome fails closed', async () => {
    const runOnce: RunProjectionOnce = (input) =>
      Promise.resolve({
        ...identity(input.name),
        outcome: 'not-a-real-outcome',
      } as unknown as ProjectionRunResult);
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
  });

  it('runOnce returning a mismatched identity fails closed', async () => {
    const runOnce: RunProjectionOnce = () =>
      Promise.resolve(succeededResult(identity('WRONG-NAME'), 1n, 1));
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
  });

  it('runOnce returning a retry outcome with a non-canonical nextAttemptAt fails closed', async () => {
    const runOnce: RunProjectionOnce = (input) =>
      Promise.resolve({
        ...identity(input.name),
        outcome: 'retry-scheduled',
        position: 1n,
        attemptNumber: 1,
        safeErrorCode: SAFE,
        nextAttemptAt: 'not-an-instant',
      } as unknown as ProjectionRunResult);
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
  });

  it('after a cycle-boundary failure, later projections are NOT invoked', async () => {
    const seen: string[] = [];
    const runOnce: RunProjectionOnce = (input) => {
      seen.push(input.name);
      if (input.name === 'a-proj') {
        return Promise.resolve({
          ...identity(input.name),
          outcome: 'bogus',
        } as unknown as ProjectionRunResult);
      }
      return Promise.resolve(succeededResult(identity(input.name), 1n, 1));
    };
    await expect(
      runProjectionCycle(deps({ registry: registryOf('a-proj', 'b-proj'), runOnce })),
    ).rejects.toBeInstanceOf(ProjectionWorkerError);
    expect(seen).toEqual(['a-proj']); // b-proj never invoked
  });
});

// --- Item 4: repository-owned abortable sleep ---------------------------------------------------

describe('abortableSleep — timer/listener/promise cleanup (item 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves on the timer and leaves no pending timer (normal completion)', async () => {
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const promise = abortableSleep(1_000);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    await expect(promise).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0); // timer fired, none left
    expect(clearSpy).not.toHaveBeenCalled(); // normal completion does not clear
  });

  it('resolves immediately WITHOUT creating a timer when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    await expect(abortableSleep(1_000, controller.signal)).resolves.toBeUndefined();
    expect(setSpy).not.toHaveBeenCalled(); // no timer created
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves EARLY on abort and clears the timer + removes the listener', async () => {
    const controller = new AbortController();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = abortableSleep(60_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await expect(promise).resolves.toBeUndefined();
    expect(clearSpy).toHaveBeenCalledTimes(1); // timer cleared on abort
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function)); // listener removed
    expect(vi.getTimerCount()).toBe(0); // no timer left after early resolution
  });

  it('removes its abort listener after NORMAL completion so a later abort is inert', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const promise = abortableSleep(1_000, controller.signal);
    vi.advanceTimersByTime(1_000);
    await promise;
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort(); // must not throw or resurrect anything
    expect(vi.getTimerCount()).toBe(0);
  });
});

// --- Item 5: result-boundary immutability -------------------------------------------------------

describe('result boundary — frozen, primitive-only, mutation-proof (item 5)', () => {
  it('an empty registry cannot be constructed, so the smallest cycle is a single idle projection', () => {
    expect(() => registryOf()).toThrow(); // registry rejects an empty list (guards the empty case)
  });

  it('the cycle result, its outcomes array, and every nested outcome record are frozen', async () => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const result = await runProjectionCycle(
      deps({ registry: registryOf('a-proj', 'b-proj'), runOnce }),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.outcomes)).toBe(true);
    for (const outcome of result.outcomes) {
      expect(Object.isFrozen(outcome)).toBe(true);
    }
  });

  it('every recorded outcome carries only controlled primitives', async () => {
    const { runOnce } = scriptedRunOnce((name) => succeededResult(identity(name), 1n, 1));
    const result = await runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce }));
    const outcome = result.outcomes[0];
    expect(Object.keys(outcome ?? {}).sort()).toEqual([
      'outcome',
      'projectionName',
      'projectionVersion',
    ]);
    expect(typeof outcome?.projectionName).toBe('string');
    expect(typeof outcome?.projectionVersion).toBe('number');
    expect(typeof outcome?.outcome).toBe('string');
  });

  it('the worker summary is frozen', async () => {
    const { runOnce } = scriptedRunOnce((name) => caughtUpResult(identity(name), 0n));
    const summary = await runProjectionWorker(
      deps({ registry: registryOf('a-proj'), runOnce, maxCycles: 1 }),
    );
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it('mutating the caller-owned runner-result object after completion cannot mutate the cycle result', async () => {
    const mutable = { ...succeededResult(identity('a-proj'), 1n, 1) } as ProjectionRunResult;
    const runOnce: RunProjectionOnce = () => Promise.resolve(mutable);
    const result = await runProjectionCycle(deps({ registry: registryOf('a-proj'), runOnce }));
    const before = result.outcomes[0]?.outcome;
    (mutable as { outcome: string }).outcome = 'tampered';
    expect(result.outcomes[0]?.outcome).toBe(before); // recorded copy is independent
    expect(() => {
      (result.outcomes[0] as { outcome: string }).outcome = 'tampered';
    }).toThrow(); // frozen record rejects mutation (strict mode)
  });
});
