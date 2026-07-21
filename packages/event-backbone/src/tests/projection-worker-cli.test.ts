/**
 * Stage 3.4.5B — the projection worker composition root / apps/worker lifecycle (no database, no real
 * process signals, no real timers).
 *
 * This is the "apps/worker unit test" set from the audit matrix. The composition root lives in
 * event-backbone (ADR-0038: "the worker lives inside @qf-jarvis/event-backbone … mirroring
 * migrate-cli.ts"), so its lifecycle is proven here through fully injected seams: config resolution,
 * pool create/close, registry construction, the worker loop, the clock, signal registration, and the
 * output writers. Proven: valid startup and clean stop; invalid/missing config; pool-construction
 * failure; registry failure; poll-interval bounds; exactly one pool / registry / worker (no overlap);
 * SIGINT/SIGTERM-driven drain; the pool closes after success AND after every failure; repeated-signal
 * safety; no listener/timer left after settle; deterministic exit codes; and that a hostile thrown
 * value never leaks into a log line.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseConfig } from '../persistence/database-config.js';
import type { DatabasePool } from '../persistence/pool.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { createProductionProjectionRegistry } from '../projections/production-registry.js';
import type { ProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionWorker } from '../projections/projection-worker.js';
import type {
  ProjectionWorkerDeps,
  ProjectionWorkerSummary,
} from '../projections/projection-worker.js';
import {
  POOL_CLOSE_FAILURE_LINE,
  runProjectionWorkerCli,
  RUNTIME_FAILURE_LINE,
  STARTUP_FAILURE_LINE,
  WORKER_APPLICATION_NAME,
  WORKER_EXIT_FAILURE,
  WORKER_EXIT_SUCCESS,
  type ProjectionWorkerCliDeps,
} from '../projections/projection-worker-cli.js';

const FAKE_CONFIG = {} as unknown as DatabaseConfig;
const FAKE_POOL = { id: 'fake-pool' } as unknown as DatabasePool;
const NOW: CanonicalInstant = toCanonicalInstant('2026-07-20T00:00:00.000Z');

const CLEAN_SUMMARY: ProjectionWorkerSummary = Object.freeze({
  cycles: 1,
  succeeded: 0,
  stoppedBy: 'max-cycles',
});

interface Harness {
  readonly deps: ProjectionWorkerCliDeps;
  readonly resolveConfig: ReturnType<typeof vi.fn>;
  readonly createPool: ReturnType<typeof vi.fn>;
  readonly closePool: ReturnType<typeof vi.fn>;
  readonly buildRegistry: ReturnType<typeof vi.fn>;
  readonly runWorker: ReturnType<typeof vi.fn>;
  readonly registerShutdownSignals: ReturnType<typeof vi.fn>;
  readonly unregister: ReturnType<typeof vi.fn>;
  readonly writeErr: ReturnType<typeof vi.fn>;
  readonly writeOut: ReturnType<typeof vi.fn>;
  /** Resolves once the CLI has registered its shutdown handler (after the async startup phase). */
  readonly whenRegistered: Promise<void>;
  triggerShutdown: () => void;
}

function makeHarness(overrides: Partial<ProjectionWorkerCliDeps> = {}): Harness {
  const resolveConfig = vi.fn((_app: string) => Promise.resolve(FAKE_CONFIG));
  const createPool = vi.fn(() => FAKE_POOL);
  const closePool = vi.fn(() => Promise.resolve());
  const registry: ProjectionRegistry = createProductionProjectionRegistry();
  const buildRegistry = vi.fn(() => registry);
  const runWorker = vi.fn((_deps: ProjectionWorkerDeps) => Promise.resolve(CLEAN_SUMMARY));
  const unregister = vi.fn();
  let captured: (() => void) | undefined;
  let markRegistered: () => void = () => undefined;
  const whenRegistered = new Promise<void>((resolve) => {
    markRegistered = resolve;
  });
  const registerShutdownSignals = vi.fn((onShutdown: () => void) => {
    captured = onShutdown;
    markRegistered();
    return unregister;
  });
  const writeErr = vi.fn();
  const writeOut = vi.fn();
  const now = vi.fn((): CanonicalInstant => NOW);

  const deps: ProjectionWorkerCliDeps = {
    resolveConfig,
    createPool,
    closePool,
    buildRegistry,
    runWorker,
    now,
    registerShutdownSignals,
    writeErr,
    writeOut,
    ...overrides,
  };

  return {
    deps,
    resolveConfig,
    createPool,
    closePool,
    buildRegistry,
    runWorker,
    registerShutdownSignals,
    unregister,
    writeErr,
    writeOut,
    whenRegistered,
    triggerShutdown: () => {
      if (captured === undefined) {
        throw new Error('shutdown handler was never registered');
      }
      captured();
    },
  };
}

describe('worker CLI — valid startup and clean stop', () => {
  it('resolves config, builds one pool + registry, runs exactly one worker, closes the pool, exits 0', async () => {
    const h = makeHarness();
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_SUCCESS);
    expect(h.resolveConfig).toHaveBeenCalledExactlyOnceWith(WORKER_APPLICATION_NAME);
    expect(h.createPool).toHaveBeenCalledTimes(1);
    expect(h.buildRegistry).toHaveBeenCalledTimes(1);
    expect(h.runWorker).toHaveBeenCalledTimes(1);
    expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL);
    expect(h.unregister).toHaveBeenCalledTimes(1);
    expect(h.writeErr).not.toHaveBeenCalled();
  });

  it('drives the worker with the production registry, the injected clock, and the abort signal', async () => {
    let captured: ProjectionWorkerDeps | undefined;
    const runWorker = vi.fn((deps: ProjectionWorkerDeps) => {
      captured = deps;
      return Promise.resolve(CLEAN_SUMMARY);
    });
    const h = makeHarness({ runWorker });
    await runProjectionWorkerCli(h.deps);

    expect(captured?.pool).toBe(FAKE_POOL);
    expect(captured?.registry.list().map((d) => d.name)).toEqual([
      'daily-event-acceptance',
      'event-type-activity',
    ]);
    expect(captured?.now()).toBe(NOW);
    expect(captured?.signal).toBeInstanceOf(AbortSignal);
    expect(captured?.signal?.aborted).toBe(false);
  });

  it('passes a configured bounded poll interval through to the worker', async () => {
    let captured: ProjectionWorkerDeps | undefined;
    const runWorker = vi.fn((deps: ProjectionWorkerDeps) => {
      captured = deps;
      return Promise.resolve(CLEAN_SUMMARY);
    });
    const h = makeHarness({ runWorker, pollIntervalMs: 250 });
    await runProjectionWorkerCli(h.deps);
    expect(captured?.pollIntervalMs).toBe(250);
  });
});

describe('worker CLI — startup failures fail closed and never leak', () => {
  it('missing/invalid environment: exit 1, fixed startup line, no pool created or closed', async () => {
    const resolveConfig = vi.fn((_app: string) =>
      Promise.reject(new Error('DATABASE_URL is not set: postgres://secret:pass@host/db')),
    );
    const h = makeHarness({ resolveConfig });
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_FAILURE);
    expect(h.writeErr).toHaveBeenCalledExactlyOnceWith(STARTUP_FAILURE_LINE);
    expect(h.createPool).not.toHaveBeenCalled();
    expect(h.closePool).not.toHaveBeenCalled();
    // The thrown message (which carried a fake secret) never reaches a log line.
    expect(h.writeErr.mock.calls.flat().join('\n')).not.toContain('secret');
  });

  it('pool construction failure: exit 1, fixed startup line, nothing to close, no worker', async () => {
    const createPool = vi.fn(() => {
      throw new Error('pool boom');
    });
    const h = makeHarness({ createPool });
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_FAILURE);
    expect(h.writeErr).toHaveBeenCalledExactlyOnceWith(STARTUP_FAILURE_LINE);
    expect(h.closePool).not.toHaveBeenCalled();
    expect(h.runWorker).not.toHaveBeenCalled();
  });

  it('registry construction failure: exit 1, fixed startup line, pool closed exactly once, no worker', async () => {
    const buildRegistry = vi.fn((): ProjectionRegistry => {
      throw new Error('registry boom');
    });
    const h = makeHarness({ buildRegistry });
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_FAILURE);
    expect(h.writeErr).toHaveBeenCalledExactlyOnceWith(STARTUP_FAILURE_LINE);
    expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL);
    expect(h.runWorker).not.toHaveBeenCalled();
  });

  it('rejects an out-of-bounds poll interval before any work (via the real worker validation)', async () => {
    // The real scheduler validates deps before touching pool/registry, so an invalid interval throws
    // immediately; the CLI treats it as a bounded runtime failure and still closes the pool.
    const h = makeHarness({
      runWorker: runProjectionWorker,
      pollIntervalMs: 50, // below MIN_POLL_INTERVAL_MS (100)
    });
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_FAILURE);
    expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL);
  });
});

describe('worker CLI — runtime failure fails closed and never leaks a hostile value', () => {
  it('a thrown worker value: exit 1, fixed runtime line only, pool closed once, signals unregistered', async () => {
    const hostile = Object.assign(new Error('SQLSTATE 08006 host=db.internal password=hunter2'), {
      code: '08006',
      cause: { credential: 'hunter2' },
    });
    const runWorker = vi.fn((_deps: ProjectionWorkerDeps) => Promise.reject(hostile));
    const h = makeHarness({ runWorker });
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_FAILURE);
    expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL);
    expect(h.unregister).toHaveBeenCalledTimes(1);
    const logged = h.writeErr.mock.calls.flat().join('\n');
    expect(logged).toBe(RUNTIME_FAILURE_LINE);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('08006');
    expect(logged).not.toContain('db.internal');
  });

  it('a hostile pool-close value is never inspected or logged (only the fixed line)', async () => {
    const hostileClose = Object.assign(new Error('close SQLSTATE 57P01 password=hunter2'), {
      code: '57P01',
    });
    const closePool = vi.fn(() => Promise.reject(hostileClose));
    const h = makeHarness({ closePool });
    const code = await runProjectionWorkerCli(h.deps);

    expect(code).toBe(WORKER_EXIT_FAILURE); // F3: a pool-close failure is itself a failure
    const logged = h.writeErr.mock.calls.flat().join('\n');
    expect(logged).toBe(POOL_CLOSE_FAILURE_LINE);
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('57P01');
  });
});

describe('worker CLI — pool-close outcome is part of the exit code (F3)', () => {
  it('worker success + pool close success => 0', async () => {
    const h = makeHarness();
    expect(await runProjectionWorkerCli(h.deps)).toBe(WORKER_EXIT_SUCCESS);
    expect(h.writeErr).not.toHaveBeenCalled();
  });

  it('worker success + pool close rejection => 1, with the fixed pool-close line', async () => {
    const closePool = vi.fn(() => Promise.reject(new Error('close boom')));
    const h = makeHarness({ closePool });
    expect(await runProjectionWorkerCli(h.deps)).toBe(WORKER_EXIT_FAILURE);
    expect(closePool).toHaveBeenCalledTimes(1);
    expect(h.writeErr).toHaveBeenCalledExactlyOnceWith(POOL_CLOSE_FAILURE_LINE);
  });

  it('worker failure + pool close success => 1', async () => {
    const runWorker = vi.fn((_deps: ProjectionWorkerDeps) =>
      Promise.reject(new Error('worker boom')),
    );
    const h = makeHarness({ runWorker });
    expect(await runProjectionWorkerCli(h.deps)).toBe(WORKER_EXIT_FAILURE);
    expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL);
    expect(h.writeErr.mock.calls.flat()).toContain(RUNTIME_FAILURE_LINE);
  });

  it('worker failure + pool close rejection => 1 (close failure never masks the existing failure)', async () => {
    const runWorker = vi.fn((_deps: ProjectionWorkerDeps) =>
      Promise.reject(new Error('worker boom')),
    );
    const closePool = vi.fn(() => Promise.reject(new Error('close boom')));
    const h = makeHarness({ runWorker, closePool });
    expect(await runProjectionWorkerCli(h.deps)).toBe(WORKER_EXIT_FAILURE);
    expect(closePool).toHaveBeenCalledTimes(1);
    const logged = h.writeErr.mock.calls.flat();
    expect(logged).toContain(RUNTIME_FAILURE_LINE);
    expect(logged).toContain(POOL_CLOSE_FAILURE_LINE);
  });

  it('signal shutdown (clean drain) + pool close rejection => 1', async () => {
    const closePool = vi.fn(() => Promise.reject(new Error('close boom')));
    const runWorker = vi.fn(
      (wdeps: ProjectionWorkerDeps) =>
        new Promise<ProjectionWorkerSummary>((resolve) => {
          wdeps.signal?.addEventListener('abort', () => {
            resolve(Object.freeze({ cycles: 1, succeeded: 0, stoppedBy: 'aborted' }));
          });
        }),
    );
    const h = makeHarness({ runWorker, closePool });
    const runPromise = runProjectionWorkerCli(h.deps);
    await h.whenRegistered;
    h.triggerShutdown();
    expect(await runPromise).toBe(WORKER_EXIT_FAILURE);
    expect(closePool).toHaveBeenCalledTimes(1);
  });
});

describe('worker CLI — signal-registration failure is inside the closed boundary (F4)', () => {
  const hostiles: readonly (readonly [string, () => unknown])[] = [
    ['thrown primitive', () => 'boom-marker'],
    [
      'Error carrying a secret',
      () => Object.assign(new Error('reg SQLSTATE password=hunter2'), { code: 'XX000' }),
    ],
    [
      'revoked Proxy',
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ],
    [
      'getter-bearing hostile object',
      () => ({
        get message(): string {
          throw new Error('getter-marker');
        },
        code: 'leak-marker',
      }),
    ],
  ];

  it.each(hostiles)(
    '%s: no worker starts, pool closed once, exit 1, fixed line, value never observed',
    async (_label, make) => {
      const thrown = make();
      const registerShutdownSignals = vi.fn((_onShutdown: () => void): (() => void) => {
        throw thrown;
      });
      const h = makeHarness({ registerShutdownSignals });
      const code = await runProjectionWorkerCli(h.deps);

      expect(code).toBe(WORKER_EXIT_FAILURE);
      expect(h.runWorker).not.toHaveBeenCalled(); // the worker never starts
      expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL); // the pool is still closed once
      const logged = h.writeErr.mock.calls.flat().join('\n');
      expect(logged).toBe(STARTUP_FAILURE_LINE); // fixed line only
      for (const marker of ['hunter2', 'boom-marker', 'leak-marker', 'getter-marker', 'XX000']) {
        expect(logged).not.toContain(marker);
      }
    },
  );
});

describe('worker CLI — signal-driven shutdown drains and stays leak-free', () => {
  it('SIGINT/SIGTERM aborts the active cycle, waits for it to drain, closes the pool once, exits 0', async () => {
    vi.useFakeTimers();
    try {
      let sawAbortAtSettle: boolean | undefined;
      const runWorker = vi.fn(
        (wdeps: ProjectionWorkerDeps) =>
          new Promise<ProjectionWorkerSummary>((resolve) => {
            // Model an active cycle: settle ONLY after the abort signal fires (drain), recording that
            // the signal was already aborted at settle time.
            wdeps.signal?.addEventListener('abort', () => {
              sawAbortAtSettle = wdeps.signal?.aborted === true;
              resolve(Object.freeze({ cycles: 1, succeeded: 0, stoppedBy: 'aborted' }));
            });
          }),
      );
      const h = makeHarness({ runWorker });

      const runPromise = runProjectionWorkerCli(h.deps);
      await h.whenRegistered; // startup is async; wait until the signal handler is registered
      // The worker is mid-cycle; deliver the shutdown signal (twice — repeated signals must be safe).
      h.triggerShutdown();
      h.triggerShutdown();
      const code = await runPromise;

      expect(code).toBe(WORKER_EXIT_SUCCESS);
      expect(sawAbortAtSettle).toBe(true);
      expect(runWorker).toHaveBeenCalledTimes(1); // no overlap / no second worker
      expect(h.closePool).toHaveBeenCalledExactlyOnceWith(FAKE_POOL); // closed exactly once
      expect(h.unregister).toHaveBeenCalledTimes(1); // listeners removed
      expect(vi.getTimerCount()).toBe(0); // no timer left after cancellation
    } finally {
      vi.useRealTimers();
    }
  });

  it('the injected signal aborts exactly once even under repeated shutdown signals', async () => {
    let abortCount = 0;
    const runWorker = vi.fn(
      (wdeps: ProjectionWorkerDeps) =>
        new Promise<ProjectionWorkerSummary>((resolve) => {
          wdeps.signal?.addEventListener('abort', () => {
            abortCount += 1;
            resolve(CLEAN_SUMMARY);
          });
        }),
    );
    const h = makeHarness({ runWorker });
    const runPromise = runProjectionWorkerCli(h.deps);
    await h.whenRegistered; // wait until the signal handler is registered before signalling
    h.triggerShutdown();
    h.triggerShutdown();
    h.triggerShutdown();
    await runPromise;
    expect(abortCount).toBe(1);
  });
});
