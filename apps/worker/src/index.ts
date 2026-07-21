/**
 * QF Jarvis — worker application process entry (Stage 3.4.5B).
 *
 * This module IS the production process entry: `node apps/worker/dist/index.js`. Running it is the
 * point; it is never imported (the testable invocation logic lives in {@link file://./worker-entry.ts}).
 * It starts the projection worker **in this same Node process** — no `pnpm`, shell, or package-manager
 * wrapper is interposed — so a process manager's SIGINT/SIGTERM reaches the `AbortController` and
 * PostgreSQL pool the worker owns, and graceful drain works without depending on signal forwarding
 * through an intermediary process.
 *
 * It sets `process.exitCode` (never `process.exit()`), so Node finishes flushing stdio and any pending
 * async cleanup before exiting. The exit code is bounded: 0 on a clean stop AND a clean pool close, 1
 * on any startup, worker-runtime, signal-registration, or pool-close failure.
 *
 * The permanent architecture boundary applies here: Jarvis recommends, QuickFurno Core authorizes, n8n
 * executes, providers deliver, results return to Core (docs/architecture/system-boundary.md). This
 * slice connects to no external system: no QuickFurno Core, n8n, WhatsApp, Supabase, cloud model, HTTP
 * endpoint, cron, or queue.
 */
import { runWorkerEntry } from './worker-entry.js';

process.exitCode = await runWorkerEntry();
