import { HealthResponseSchema, type HealthResponse } from '@qf/contracts';

/** The worker's lifecycle states, in order. */
export type WorkerLifecycleState = 'starting' | 'running' | 'stopping' | 'stopped';

/**
 * Map a lifecycle state onto the shared health contract.
 *
 * Phase 0A exposes no HTTP probe, but centralizing this mapping now means a
 * future readiness endpoint (or supervisor) reports worker status consistently
 * with the API, using the same `HealthResponse` shape.
 */
export function healthForState(state: WorkerLifecycleState): HealthResponse {
  const status = state === 'running' ? 'ok' : state === 'stopped' ? 'error' : 'degraded';
  return HealthResponseSchema.parse({ status });
}
