import { z } from 'zod';

/** Log levels accepted by the worker; kept in step with `@qf/observability`. */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * Environment variables the worker reads. The worker has no HTTP surface, so it
 * needs only runtime mode and log verbosity in Phase 0A. Declared once, here,
 * so configuration stays centralized and validated.
 */
export const WorkerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;
