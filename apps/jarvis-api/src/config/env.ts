import { z } from 'zod';

/**
 * Log levels accepted by the API. Kept in step with `@qf/observability`'s
 * `LogLevel`; validated here so an invalid value fails fast at startup.
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * The complete set of environment variables the API reads. Every variable is
 * declared here and nowhere else, so configuration has a single validated
 * source rather than scattered `process.env` reads.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  JARVIS_API_HOST: z.string().min(1).default('127.0.0.1'),
  JARVIS_API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export type Env = z.infer<typeof EnvSchema>;
