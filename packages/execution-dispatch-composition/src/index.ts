/**
 * `@qf-jarvis/execution-dispatch-composition` — QFJ-P09.04, durable execution dispatch composition.
 *
 * QFJ-P09.02 owns the execution-dispatch verification boundary and made its replay guard required
 * and defaultless. QFJ-P09.03 owns the durable PostgreSQL guard and left it composed by nobody.
 * This package is the one narrow composition that binds them, so the repository has a
 * restart-durable dispatch validation path that cannot be assembled with a process-lifetime guard
 * by mistake.
 *
 * It adopts NO transport and sends NOTHING: no URL, webhook, endpoint, n8n client, workflow id,
 * credential, provider, message or recipient. It creates no migration — 0010 belongs to P09.03 and
 * is reused unchanged — and grants no new authority to Jarvis, to n8n or to itself.
 *
 * The result is the P09.02 result verbatim. A verified first-seen dispatch is a bounded validation
 * observation, never execution truth.
 */

export { createDurableExecutionDispatchBoundary } from './create-durable-dispatch-boundary.js';
export type {
  DurableDispatchBoundaryConfig,
  DurableDispatchInput,
  DurableExecutionDispatchBoundary,
} from './create-durable-dispatch-boundary.js';
