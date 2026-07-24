/**
 * QFJ-P03.07G — worker telemetry and the startup schema gate.
 *
 * Two invariants are load-bearing here:
 *
 *  - **A blocked projection does not change the worker's exit code.** It is a correct, deliberate,
 *    durable state, not a fault. Exiting non-zero would make an orchestrator restart-loop the worker,
 *    and every restart would re-observe the same block — taking down every other healthy projection.
 *  - **An incomplete projection-failure schema DOES block startup.** Without migration 0006's relations
 *    the retry-exhaustion seam cannot record a failure at all, so processing events would mean running
 *    with a silently broken failure path.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  NOOP_PROJECTION_LOGGER,
  type ProjectionLogger,
} from '../observability/projection-logger.js';
import {
  createProjectionMetricsRegistry,
  type ProjectionMetricsRegistry,
} from '../observability/projection-metrics.js';
import type { DatabaseConfig } from '../persistence/database-config.js';
import type { DatabasePool } from '../persistence/pool.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import type { ProjectionRegistry } from '../projections/projection-registry.js';
import type { ProjectionRunResult } from '../projections/projection-run-result.js';
import {
  runProjectionWorker,
  type ProjectionWorkerDeps,
} from '../projections/projection-worker.js';
import {
  runProjectionWorkerCli,
  SCHEMA_MISMATCH_FAILURE_LINE,
  WORKER_EXIT_FAILURE,
  WORKER_EXIT_SUCCESS,
  type ProjectionWorkerCliDeps,
} from '../projections/projection-worker-cli.js';

const NOW: CanonicalInstant = toCanonicalInstant(new Date('2026-07-24T10:00:00.000Z'));
const NAME = 'event-type-activity';

interface Emitted {
  readonly event: string;
  readonly record: Record<string, unknown>;
}

function recordingLogger(): { logger: ProjectionLogger; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  return {
    emitted,
    logger: {
      projectionEvent: (identity, event) => {
        emitted.push({
          event: (event as { event: string }).event,
          record: { ...(event as unknown as Record<string, unknown>), ...identity },
        });
      },
      workerEvent: (event) => {
        emitted.push({
          event: (event as { event: string }).event,
          record: { ...(event as unknown as Record<string, unknown>) },
        });
      },
    },
  };
}

function singleProjectionRegistry(): ProjectionRegistry {
  const definition = { name: NAME, version: 1, apply: () => Promise.resolve() };
  return {
    get: (name: string) => (name === NAME ? definition : undefined),
    list: () => [definition],
    has: (name: string) => name === NAME,
    size: 1,
  } as unknown as ProjectionRegistry;
}

function workerDeps(
  overrides: Partial<ProjectionWorkerDeps>,
  logger: ProjectionLogger,
  metrics: ProjectionMetricsRegistry,
): ProjectionWorkerDeps {
  return {
    pool: {} as unknown as DatabasePool,
    registry: singleProjectionRegistry(),
    now: () => NOW,
    sleep: () => Promise.resolve(),
    maxCycles: 1,
    logger,
    metrics,
    ...overrides,
  };
}

function counter(metrics: ProjectionMetricsRegistry, name: string): number {
  return metrics
    .snapshot()
    .filter((entry) => entry.name === name)
    .reduce((total, entry) => total + entry.value, 0);
}

describe('worker lifecycle events', () => {
  it('emits started and stopped, carrying the existing summary fields', async () => {
    const { logger, emitted } = recordingLogger();
    const metrics = createProjectionMetricsRegistry();
    const summary = await runProjectionWorker(
      workerDeps(
        {
          maxCycles: 0,
          runOnce: () =>
            Promise.resolve({
              outcome: 'caught-up',
              projectionName: NAME,
              projectionVersion: 1,
              lastPosition: 0n,
            } as unknown as ProjectionRunResult),
        },
        logger,
        metrics,
      ),
    );
    expect(summary.stoppedBy).toBe('max-cycles');
    const names = emitted.map((entry) => entry.event);
    expect(names).toContain('projection.worker.started');
    expect(names).toContain('projection.worker.stopped');

    const stopped = emitted.find((entry) => entry.event === 'projection.worker.stopped');
    expect(stopped?.record['cycles']).toBe(0);
    expect(stopped?.record['stoppedBy']).toBe('max-cycles');
    // Worker-scoped: it spans the whole registry, so it names no single projection.
    expect(stopped?.record).not.toHaveProperty('projectionName');
  });

  it('maintains the worker_up gauge across the run', async () => {
    const metrics = createProjectionMetricsRegistry();
    await runProjectionWorker(workerDeps({ maxCycles: 0 }, NOOP_PROJECTION_LOGGER, metrics));
    // Set to 1 at start and cleared to 0 on the clean return.
    expect(counter(metrics, 'projection_worker_up')).toBe(0);
    expect(metrics.snapshot().some((entry) => entry.name === 'projection_worker_up')).toBe(true);
  });

  it('counts one cycle outcome per projection with a closed outcome label', async () => {
    const { logger, emitted } = recordingLogger();
    const metrics = createProjectionMetricsRegistry();
    await runProjectionWorker(
      workerDeps(
        {
          maxCycles: 1,
          runOnce: () =>
            Promise.resolve({
              outcome: 'blocked-existing',
              projectionName: NAME,
              projectionVersion: 1,
              blockedPosition: 1n,
              failedAttemptCount: 5,
              safeErrorCode: 'projection-handler-failed',
            } as unknown as ProjectionRunResult),
        },
        logger,
        metrics,
      ),
    );
    expect(counter(metrics, 'projection_worker_cycles_total')).toBe(1);
    const cycle = emitted.find((entry) => entry.event === 'projection.worker.cycle');
    expect(cycle?.record['outcome']).toBe('blocked-existing');
    // A cycle event names WHAT happened; the runner already emits the position-bearing events.
    expect(cycle?.record['position']).toBeNull();
  });

  it('a blocked projection does NOT stop the worker or change its summary', async () => {
    const metrics = createProjectionMetricsRegistry();
    const summary = await runProjectionWorker(
      workerDeps(
        {
          maxCycles: 2,
          runOnce: () =>
            Promise.resolve({
              outcome: 'blocked-existing',
              projectionName: NAME,
              projectionVersion: 1,
              blockedPosition: 1n,
              failedAttemptCount: 5,
              safeErrorCode: 'projection-handler-failed',
            } as unknown as ProjectionRunResult),
        },
        NOOP_PROJECTION_LOGGER,
        metrics,
      ),
    );
    expect(summary.cycles).toBe(2);
    expect(summary.stoppedBy).toBe('max-cycles');
  });

  it('a throwing logger cannot abort a completed cycle', async () => {
    const throwing: ProjectionLogger = {
      projectionEvent: () => {
        throw new Error('logger exploded');
      },
      workerEvent: () => {
        throw new Error('logger exploded');
      },
    };
    const summary = await runProjectionWorker(
      workerDeps(
        {
          maxCycles: 1,
          runOnce: () =>
            Promise.resolve({
              outcome: 'caught-up',
              projectionName: NAME,
              projectionVersion: 1,
              lastPosition: 0n,
            } as unknown as ProjectionRunResult),
        },
        throwing,
        createProjectionMetricsRegistry(),
      ),
    );
    expect(summary.cycles).toBe(1);
  });
});

// --- The CLI-level startup gate ------------------------------------------------------------------

const FAKE_CONFIG = {} as DatabaseConfig;
const FAKE_POOL = {} as DatabasePool;

function cliDeps(overrides: Partial<ProjectionWorkerCliDeps> = {}): {
  deps: ProjectionWorkerCliDeps;
  err: string[];
  runWorker: ReturnType<typeof vi.fn>;
} {
  const err: string[] = [];
  const runWorker = vi.fn(() =>
    Promise.resolve({ cycles: 1, succeeded: 0, stoppedBy: 'max-cycles' as const }),
  );
  return {
    err,
    runWorker,
    deps: {
      resolveConfig: () => Promise.resolve(FAKE_CONFIG),
      createPool: () => FAKE_POOL,
      closePool: () => Promise.resolve(),
      buildRegistry: () => singleProjectionRegistry(),
      runWorker,
      now: () => NOW,
      registerShutdownSignals: () => () => undefined,
      writeOut: () => undefined,
      writeErr: (line) => {
        err.push(line);
      },
      probeSchema: () => Promise.resolve(true),
      createLogger: () => NOOP_PROJECTION_LOGGER,
      metrics: createProjectionMetricsRegistry(),
      ...overrides,
    },
  };
}

describe('the startup schema gate', () => {
  it('starts normally when the schema is complete', async () => {
    const { deps, runWorker } = cliDeps();
    await expect(runProjectionWorkerCli(deps)).resolves.toBe(WORKER_EXIT_SUCCESS);
    expect(runWorker).toHaveBeenCalledTimes(1);
  });

  it('REFUSES to start when the projection-failure relations are missing', async () => {
    const { deps, err, runWorker } = cliDeps({ probeSchema: () => Promise.resolve(false) });
    await expect(runProjectionWorkerCli(deps)).resolves.toBe(WORKER_EXIT_FAILURE);
    // No cycle ran: a broken failure path must never process events.
    expect(runWorker).not.toHaveBeenCalled();
    expect(err).toContain(SCHEMA_MISMATCH_FAILURE_LINE);
  });

  it('treats a throwing probe exactly like an incomplete schema', async () => {
    const { deps, err, runWorker } = cliDeps({
      probeSchema: () => Promise.reject(new Error('connection refused')),
    });
    await expect(runProjectionWorkerCli(deps)).resolves.toBe(WORKER_EXIT_FAILURE);
    expect(runWorker).not.toHaveBeenCalled();
    // The caught value is never inspected, so no driver detail can reach the line.
    expect(err.join('\n')).not.toContain('connection refused');
  });

  it('names no relation and no connection detail in the refusal line', () => {
    expect(SCHEMA_MISMATCH_FAILURE_LINE).not.toContain('projection_failure');
    expect(SCHEMA_MISMATCH_FAILURE_LINE).not.toContain('postgres');
    expect(SCHEMA_MISMATCH_FAILURE_LINE).toContain('No worker loop was started');
  });

  it('a logger construction failure is a startup failure, not a silent degradation', async () => {
    const { deps, runWorker } = cliDeps({
      createLogger: () => {
        throw new Error('logger construction exploded');
      },
    });
    await expect(runProjectionWorkerCli(deps)).resolves.toBe(WORKER_EXIT_FAILURE);
    expect(runWorker).not.toHaveBeenCalled();
  });

  it('passes the logger and metrics through to the worker loop', async () => {
    const metrics = createProjectionMetricsRegistry();
    const { deps, runWorker } = cliDeps({ metrics });
    await runProjectionWorkerCli(deps);
    const passed = runWorker.mock.calls[0]?.[0] as ProjectionWorkerDeps | undefined;
    expect(passed?.metrics).toBe(metrics);
    expect(passed?.logger).toBe(NOOP_PROJECTION_LOGGER);
  });
});
