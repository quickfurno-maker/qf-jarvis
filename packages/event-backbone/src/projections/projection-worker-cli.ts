/**
 * The projection worker composition root — a library edge invoked by the worker application
 * (Stage 3.4.5B, ADR-0038).
 *
 * This is the "worker executable that reads `DATABASE_URL` and owns+closes a pool" ADR-0038 §deferrals
 * assigned to Stage 3.4.5B. Following ADR-0038's direction — "the worker lives inside
 * `@qf-jarvis/event-backbone` as an internal module … mirroring `persistence/migrate-cli.ts`" — the
 * composition/lifecycle live here, but this module is a **pure library edge with no auto-run**: the
 * process entry is `apps/worker`, which imports {@link runProjectionWorkerCli} through the narrowly
 * scoped internal subpath `@qf-jarvis/event-backbone/internal/projection-worker-cli` and invokes it in
 * the SAME Node process (`node apps/worker/dist/index.js`). No package manager is interposed, so a
 * process manager's SIGINT/SIGTERM reaches this process — and the `AbortController` and pool it owns —
 * directly. This module is NOT exported from the package root, so the barrel's 39-symbol runtime
 * surface is unchanged.
 *
 * ### The application owns the process; the library scheduler does not
 *
 * This edge owns everything a process owns and a reusable scheduler must not: it reads the environment,
 * constructs and **owns** the pool (closing it on every exit path), builds the production registry,
 * creates the single `AbortController`, and registers the SIGINT/SIGTERM handlers. The pure scheduler
 * {@link runProjectionWorker} never registers a signal, never reads `process.env`, and never owns the
 * pool — it only *observes* the injected `AbortSignal` (ADR-0038 §5/§6).
 *
 * ### Closed, bounded failure boundary
 *
 * Every boundary fails closed with a **fixed, repository-owned** message and a bounded exit code. A
 * thrown value from config resolution, pool construction, the registry, **signal registration**, the
 * worker loop, or **pool close** is caught by a **bindingless** `catch` and never read, inspected,
 * stringified, spread, enumerated, or retained as `cause`; no SQL, SQLSTATE, credential, or connection
 * string can reach a log line. The exit code is `0` ONLY when the worker completed cleanly AND the pool
 * closed cleanly; any startup, signal-registration, worker-runtime, or **pool-close** failure yields a
 * non-zero code, and a pool-close failure can never convert an existing failure into success. Retry
 * authority stays exclusively with the Stage 3.4.4 runner; this edge fabricates no checkpoint or attempt.
 *
 * ### Testability
 *
 * All process seams — config resolution, pool create/close, registry construction, the worker loop,
 * the clock, signal registration, and the output writers — are injected through
 * {@link ProjectionWorkerCliDeps}, so unit tests drive startup, shutdown-signal drain, pool-close
 * outcomes, signal-registration failure, double-signal safety, and exit codes deterministically with no
 * real process, pool, timer, or clock. Importing this module runs nothing.
 */
import { probeProjectionFailureSchema } from '../observability/projection-health.js';
import {
  createProjectionLogger,
  type ProjectionLogger,
} from '../observability/projection-logger.js';
import {
  createProjectionMetricsRegistry,
  type ProjectionMetricsRegistry,
} from '../observability/projection-metrics.js';
import { resolveCliDatabaseConfig } from '../persistence/cli-config.js';
import type { DatabaseConfig } from '../persistence/database-config.js';
import { closeDatabasePool, createDatabasePool, type DatabasePool } from '../persistence/pool.js';

import { toCanonicalInstant, type CanonicalInstant } from './projection-definition.js';
import { createProductionProjectionRegistry } from './production-registry.js';
import type { ProjectionRegistry } from './projection-registry.js';
import {
  runProjectionWorker,
  type ProjectionWorkerDeps,
  type ProjectionWorkerSummary,
} from './projection-worker.js';

/** The application name reported to PostgreSQL (never a secret). */
export const WORKER_APPLICATION_NAME = 'qf-jarvis-projection-worker';

/** Bounded, deterministic exit codes. 0 only on a clean stop AND a clean pool close; 1 otherwise. */
export const WORKER_EXIT_SUCCESS = 0;
export const WORKER_EXIT_FAILURE = 1;

/**
 * Fixed, repository-owned failure lines. They name the phase, never a value: no URL, password, CA
 * path, hostname, SQL, SQLSTATE, stack, or caught-error text ever appears.
 */
export const STARTUP_FAILURE_LINE =
  'Refusing to start the projection worker: startup failed (environment, TLS/CA, pool, registry, or ' +
  'signal registration). No worker loop was started.';
export const RUNTIME_FAILURE_LINE =
  'The projection worker stopped on a non-result failure. The pool was closed and the process exits non-zero.';
export const POOL_CLOSE_FAILURE_LINE =
  'The projection worker could not close its PostgreSQL pool cleanly; the process exits non-zero.';
/**
 * QFJ-P03.07G. The ONE health condition that blocks startup: if the projection-failure relations are
 * absent, the retry-exhaustion seam cannot record a failure at all, and processing events anyway would
 * mean running with a silently broken failure path. Names no relation and no connection detail.
 */
export const SCHEMA_MISMATCH_FAILURE_LINE =
  'Refusing to start the projection worker: the projection-failure schema is incomplete (migrations ' +
  'are behind the repository). No worker loop was started.';

/**
 * The injected process seams. Every one defaults to a real implementation via
 * {@link defaultProjectionWorkerCliDeps}; unit tests override them to drive the lifecycle without a
 * real environment, pool, timer, clock, or process signal.
 */
export interface ProjectionWorkerCliDeps {
  /** Resolve the validated DB config from the environment. */
  readonly resolveConfig: (applicationName: string) => Promise<DatabaseConfig>;
  /** Construct the owned pool. */
  readonly createPool: (config: DatabaseConfig) => DatabasePool;
  /** Close the owned pool (tolerating an already-closed pool). */
  readonly closePool: (pool: DatabasePool) => Promise<void>;
  /** Build the production projection registry. */
  readonly buildRegistry: () => ProjectionRegistry;
  /** Drive the worker loop (defaults to {@link runProjectionWorker}). */
  readonly runWorker: (deps: ProjectionWorkerDeps) => Promise<ProjectionWorkerSummary>;
  /** The injected clock — the ONLY wall clock in the system, read at this edge and passed to the worker. */
  readonly now: () => CanonicalInstant;
  /**
   * Register process shutdown signals and return an unregister function. Defaults to SIGINT/SIGTERM.
   * The application owns signals; the library scheduler never does.
   */
  readonly registerShutdownSignals: (onShutdown: () => void) => () => void;
  /** Write one line to standard output. */
  readonly writeOut: (line: string) => void;
  /** Write one line to standard error. */
  readonly writeErr: (line: string) => void;
  /**
   * Verify the projection-failure relations exist before any cycle runs (QFJ-P03.07G). Returns `true`
   * when the schema is complete. Injected so tests drive both outcomes without a database.
   */
  readonly probeSchema: (pool: DatabasePool) => Promise<boolean>;
  /**
   * Build the structured logger for this run (QFJ-P03.07G). The default writes JSON Lines through
   * `writeOut`, so the worker still owns its only two output streams.
   */
  readonly createLogger: (deps: ProjectionWorkerCliDeps) => ProjectionLogger;
  /** The process-local metrics registry for this run (QFJ-P03.07G). */
  readonly metrics: ProjectionMetricsRegistry;
  /** Optional bounded poll interval (ms). Validated by {@link runProjectionWorker}; undefined => default. */
  readonly pollIntervalMs?: number;
}

/**
 * Register signals, run exactly one worker loop, and always unregister. NEVER throws — a failure at any
 * seam is caught by a bindingless `catch`, a fixed line is written, and the phase reports `'failed'`.
 * Signal registration is inside this closed boundary (F4): if it throws, the worker never starts.
 */
async function runWorkerPhase(
  deps: ProjectionWorkerCliDeps,
  pool: DatabasePool,
): Promise<'ok' | 'failed'> {
  let registry: ProjectionRegistry;
  try {
    registry = deps.buildRegistry();
  } catch {
    deps.writeErr(STARTUP_FAILURE_LINE);
    return 'failed';
  }

  // QFJ-P03.07G startup gate. A probe that throws is treated exactly like a probe reporting an
  // incomplete schema: fail closed and start nothing. The thrown value is never inspected.
  let schemaComplete: boolean;
  try {
    schemaComplete = await deps.probeSchema(pool);
  } catch {
    deps.writeErr(SCHEMA_MISMATCH_FAILURE_LINE);
    return 'failed';
  }
  if (!schemaComplete) {
    deps.writeErr(SCHEMA_MISMATCH_FAILURE_LINE);
    return 'failed';
  }

  // Built once per run; a construction failure is a startup failure like any other.
  let logger: ProjectionLogger;
  try {
    logger = deps.createLogger(deps);
  } catch {
    deps.writeErr(STARTUP_FAILURE_LINE);
    return 'failed';
  }

  // One AbortController, one one-shot shutdown. Repeated signals never re-abort: `shuttingDown` latches.
  const controller = new AbortController();
  let shuttingDown = false;
  const onShutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    controller.abort();
  };

  // Signal registration is a trust boundary: a throw is discarded (never inspected) and no worker
  // starts. The real seam cleans up any partial listener install before rethrowing (see below).
  let unregisterSignals: () => void;
  try {
    unregisterSignals = deps.registerShutdownSignals(onShutdown);
  } catch {
    deps.writeErr(STARTUP_FAILURE_LINE);
    return 'failed';
  }

  try {
    await deps.runWorker({
      pool,
      registry,
      now: deps.now,
      signal: controller.signal,
      logger,
      metrics: deps.metrics,
      // Only pass an override when configured — exactOptionalPropertyTypes forbids an explicit
      // `undefined`, and the scheduler already applies its bounded default.
      ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}),
    });
    return 'ok';
  } catch {
    // A ProjectionWorkerError (or any escaping value) — never inspected, stringified, or logged.
    deps.writeErr(RUNTIME_FAILURE_LINE);
    return 'failed';
  } finally {
    // Remove the process listeners so no handler survives the run (no listener leak).
    unregisterSignals();
  }
}

/**
 * Close the owned pool EXACTLY once. Never throws; returns `true` on a clean close and `false`
 * otherwise. The thrown value is discarded without inspection — the caller emits a fixed line.
 */
async function closePoolOnce(deps: ProjectionWorkerCliDeps, pool: DatabasePool): Promise<boolean> {
  try {
    await deps.closePool(pool);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the projection worker to completion and return a bounded exit code.
 *
 * Lifecycle: resolve config (env) → construct+own the pool → run the worker phase (build registry,
 * register SIGINT/SIGTERM, drive exactly one {@link runProjectionWorker} loop, drain on the first
 * signal, unregister) → close the pool **exactly once**. The exit code is {@link WORKER_EXIT_SUCCESS}
 * ONLY when the worker phase succeeded AND the pool closed cleanly; otherwise {@link WORKER_EXIT_FAILURE}
 * (F3 — a pool-close failure is itself a failure and never masks an earlier one).
 */
export async function runProjectionWorkerCli(deps: ProjectionWorkerCliDeps): Promise<number> {
  let config: DatabaseConfig;
  try {
    config = await deps.resolveConfig(WORKER_APPLICATION_NAME);
  } catch {
    deps.writeErr(STARTUP_FAILURE_LINE);
    return WORKER_EXIT_FAILURE;
  }

  let pool: DatabasePool;
  try {
    pool = deps.createPool(config);
  } catch {
    // No pool was constructed, so there is nothing to close.
    deps.writeErr(STARTUP_FAILURE_LINE);
    return WORKER_EXIT_FAILURE;
  }

  // The pool now exists and MUST be closed exactly once; its close outcome is part of the exit code.
  const workerOutcome = await runWorkerPhase(deps, pool);
  const poolClosedCleanly = await closePoolOnce(deps, pool);
  if (!poolClosedCleanly) {
    deps.writeErr(POOL_CLOSE_FAILURE_LINE);
  }
  return workerOutcome === 'ok' && poolClosedCleanly ? WORKER_EXIT_SUCCESS : WORKER_EXIT_FAILURE;
}

/**
 * Register real SIGINT/SIGTERM handlers; the returned function removes exactly those handlers. If
 * installing a later signal throws, any already-installed listener is removed before the error
 * propagates, so a partial install never leaks (F4).
 */
function registerRealShutdownSignals(onShutdown: () => void): () => void {
  const handler = (): void => {
    onShutdown();
  };
  const signals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  const installed: NodeJS.Signals[] = [];
  try {
    for (const signal of signals) {
      process.on(signal, handler);
      installed.push(signal);
    }
  } catch (error: unknown) {
    for (const signal of installed) {
      process.off(signal, handler);
    }
    throw error;
  }
  return () => {
    for (const signal of signals) {
      process.off(signal, handler);
    }
  };
}

/**
 * The real process seams. `resolveCliDatabaseConfig` is the single place that reads `process.env`
 * (shared with the migrate/preflight CLIs, so the worker trusts the same connection rules — a
 * transaction-mode pooler and an `sslmode`/`sslrootcert`-carrying URL are refused, and a non-loopback
 * host requires a pinned CA). The clock is read here, once, and injected into the worker.
 */
export function defaultProjectionWorkerCliDeps(): ProjectionWorkerCliDeps {
  return {
    resolveConfig: resolveCliDatabaseConfig,
    createPool: createDatabasePool,
    closePool: closeDatabasePool,
    buildRegistry: createProductionProjectionRegistry,
    runWorker: runProjectionWorker,
    now: () => toCanonicalInstant(new Date()),
    registerShutdownSignals: registerRealShutdownSignals,
    writeOut: (line) => process.stdout.write(`${line}\n`),
    writeErr: (line) => process.stderr.write(`${line}\n`),
    probeSchema: async (pool) => {
      const client = await pool.connect();
      try {
        const probe = await probeProjectionFailureSchema(client);
        return probe.present;
      } finally {
        client.release();
      }
    },
    createLogger: (cliDeps) =>
      createProjectionLogger({
        // Writes through the SAME injected seam the worker already owns, so this module still holds no
        // direct reference to a process stream.
        sink: {
          write: (line) => {
            cliDeps.writeOut(line);
          },
        },
        now: cliDeps.now,
      }),
    metrics: createProjectionMetricsRegistry(),
  };
}
