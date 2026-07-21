/**
 * QF Jarvis — the worker application's invocation logic (Stage 3.4.5B).
 *
 * `apps/worker` is the deployment home of the projection worker, and it activates it **in-process, by
 * import** — not by delegating to a package manager. This module imports the composition root through
 * the narrowly scoped internal subpath `@qf-jarvis/event-backbone/internal/projection-worker-cli`
 * (the barrel's 39-symbol root surface is unchanged) and invokes it in the SAME Node process that
 * `node ./dist/index.js` starts. Because no `pnpm`/shell wrapper is interposed, an OS/process-manager
 * SIGINT/SIGTERM reaches the very process that owns the `AbortController` and the PostgreSQL pool, so
 * graceful drain does not depend on package-manager signal forwarding.
 *
 * This module has **no side effect on import**: the process entry ({@link file://./index.ts}) calls
 * {@link runWorkerEntry}. Tests import this function and inject deterministic lifecycle seams, so they
 * never start a real, unbounded worker.
 */
import {
  defaultProjectionWorkerCliDeps,
  runProjectionWorkerCli,
  type ProjectionWorkerCliDeps,
} from '@qf-jarvis/event-backbone/internal/projection-worker-cli';

/**
 * Run the projection worker in THIS Node process and return its bounded exit code (0 clean / 1 on any
 * startup, worker-runtime, signal-registration, or pool-close failure). Defaults to the real process
 * seams; tests pass injected seams. Importing this module runs nothing.
 */
export async function runWorkerEntry(
  deps: ProjectionWorkerCliDeps = defaultProjectionWorkerCliDeps(),
): Promise<number> {
  return runProjectionWorkerCli(deps);
}
