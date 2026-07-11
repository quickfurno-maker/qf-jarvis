import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import type { Logger } from '@qf/observability';
import { registerHealthRoutes } from './health/routes.js';
import { registerRootRoutes } from './plugins/root.js';

export interface BuildAppOptions {
  /** Shared structured logger; Fastify logs requests through it. */
  logger: Logger;
  /** Service version surfaced by the root metadata route. */
  version: string;
}

/**
 * Build the Fastify application. This is pure construction — it wires routes,
 * logging, request IDs, and error handling, then returns the instance WITHOUT
 * listening. Keeping construction separate from process startup (see
 * `server.ts`) is what makes the app testable via `inject()` and keeps the
 * lifecycle logic in one place.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  // Our Pino `Logger` is a superset of Fastify's `FastifyBaseLogger`. Narrowing
  // it to that type here keeps Fastify's logger generic at its default, so the
  // returned instance is a plain `FastifyInstance` — no casts, no generic
  // widening leaking into every route handler's inferred types.
  const loggerInstance: FastifyBaseLogger = options.logger;

  const app = Fastify({
    loggerInstance,
    // Correlate every request with an ID: honour an inbound X-Request-Id or mint
    // one. Fastify already labels it `reqId` on each log line by default.
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  // Never leak internal error detail or stack traces in HTTP responses. The full
  // error is logged server-side with the request context; the client receives a
  // sanitized body, and a generic message for any 5xx.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'request handler failed');
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? 'Internal Server Error' : error.message;
    return reply.status(statusCode).send({ statusCode, error: message });
  });

  await app.register(registerRootRoutes, { version: options.version });
  await app.register(registerHealthRoutes);

  return app;
}
