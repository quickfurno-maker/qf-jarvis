import type { FastifyInstance } from 'fastify';
import { ServiceInfoSchema, type ServiceInfo } from '@qf/contracts';

export interface RootRoutesOptions {
  /** Service version surfaced in the metadata response. */
  version: string;
}

/**
 * Root metadata route.
 *
 * Returns stable, non-secret service identification only. Deliberately never
 * reflects environment variables or configuration, so it cannot leak secrets.
 */
export async function registerRootRoutes(
  app: FastifyInstance,
  options: RootRoutesOptions,
): Promise<void> {
  const info: ServiceInfo = ServiceInfoSchema.parse({
    service: 'qf-jarvis-api',
    status: 'running',
    version: options.version,
  });

  app.get('/', () => info);
}
