import type { LogLevel } from '@qf/observability';
import { EnvSchema } from './env.js';

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly host: string;
  readonly port: number;
  readonly isProduction: boolean;
}

/**
 * Parse and validate the API's environment into a typed, centralized config
 * object. Invalid configuration throws a readable, multi-line error listing
 * every offending variable — so a bad deploy fails fast at startup rather than
 * surfacing as a confusing runtime error later.
 *
 * `source` defaults to `process.env` but is injectable for deterministic tests.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid QF Jarvis API environment configuration:\n${details}`);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    host: env.JARVIS_API_HOST,
    port: env.JARVIS_API_PORT,
    isProduction: env.NODE_ENV === 'production',
  };
}
