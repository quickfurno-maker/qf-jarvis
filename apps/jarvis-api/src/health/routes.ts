import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@qf/contracts';

/**
 * Health probe routes.
 *
 * The responses are validated against the shared contract before being sent,
 * so the probe surface can never drift from the published `HealthResponse`
 * shape.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: the process is up and the event loop is responsive. It must not
  // depend on downstream systems, or a dependency blip would cause pointless
  // restarts.
  app.get('/health/live', () => HealthResponseSchema.parse({ status: 'ok' }));

  // Readiness: safe to receive traffic. Phase 0A has no external dependencies,
  // so the service is ready as soon as it can serve. Later phases add real
  // checks here (event intake, downstream reachability) and may return a
  // non-ready status.
  app.get('/health/ready', () => HealthResponseSchema.parse({ status: 'ready' }));
}
