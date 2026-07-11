import { fileURLToPath } from 'node:url';
import { createLogger, type Logger } from '@qf/observability';
import { loadWorkerConfig, type WorkerConfig } from './config/index.js';
import { healthForState, type WorkerLifecycleState } from './health/health.js';

const SERVICE_NAME = 'qf-jarvis-worker';

/** Idle heartbeat interval (ms). Keeps the event loop alive without spinning. */
const KEEP_ALIVE_MS = 60_000;

export interface StartWorkerOptions {
  config: WorkerConfig;
  logger: Logger;
}

export interface WorkerHandle {
  /** Current lifecycle state. */
  readonly state: () => WorkerLifecycleState;
  /** Begin a graceful shutdown. Safe to call more than once. */
  readonly shutdown: (reason: string) => Promise<void>;
  /** Resolves once the worker has fully stopped. */
  readonly done: Promise<void>;
}

/**
 * Start the worker runtime.
 *
 * Phase 0A intentionally does no work: it establishes the process lifecycle —
 * a structured startup log, an idle keep-alive so the process stays up without
 * busy-looping, and a clean, idempotent shutdown — so later phases can attach
 * event processing (subscriptions, handlers, draining) without rewriting any of
 * this lifecycle code.
 */
export function startWorker(options: StartWorkerOptions): WorkerHandle {
  const { config, logger } = options;
  let state: WorkerLifecycleState = 'starting';

  // Idle heartbeat: an empty long-interval timer that keeps the event loop
  // alive. Deliberately NOT unref'd, so an otherwise-idle worker stays running.
  // Later phases replace this with real event subscriptions.
  const keepAlive = setInterval(() => {
    // No-op in Phase 0A. Placeholder slot for future liveness/heartbeat work.
  }, KEEP_ALIVE_MS);

  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  state = 'running';
  logger.info(
    { health: healthForState(state), nodeEnv: config.nodeEnv },
    'qf-jarvis-worker started',
  );

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      await done;
      return;
    }
    shuttingDown = true;
    state = 'stopping';
    logger.info({ reason }, 'qf-jarvis-worker shutting down');

    clearInterval(keepAlive);
    // Nothing to drain in Phase 0A. In-flight work is awaited here later.

    state = 'stopped';
    logger.info('qf-jarvis-worker stopped cleanly');
    resolveDone();
    await done;
  };

  return {
    state: () => state,
    shutdown,
    done,
  };
}

/**
 * Process entrypoint: load config, create the logger, start the worker, and
 * bind signal handlers for graceful shutdown. Separated from `startWorker` so
 * the runtime can be unit-tested without spawning a process or handling
 * signals.
 */
function bootstrap(): void {
  const config = loadWorkerConfig();
  const logger = createLogger({
    service: SERVICE_NAME,
    environment: config.nodeEnv,
    level: config.logLevel,
  });

  const worker = startWorker({ config, logger });

  const onSignal = (signal: NodeJS.Signals): void => {
    // `shutdown` clears the keep-alive timer; with no remaining handles the
    // process exits 0 naturally, letting the logger flush rather than being
    // truncated by a forced exit.
    worker.shutdown(`signal:${signal}`).catch((error: unknown) => {
      logger.error({ err: error }, 'error during worker shutdown');
      process.exit(1);
    });
  };

  process.on('SIGTERM', () => {
    onSignal('SIGTERM');
  });
  process.on('SIGINT', () => {
    onSignal('SIGINT');
  });
}

// Run the process only when executed directly (`node dist/index.js`), never when
// imported by tests.
const isEntrypoint =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  try {
    bootstrap();
  } catch (error: unknown) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`fatal: ${SERVICE_NAME} failed to start\n${message}\n`);
    process.exit(1);
  }
}
