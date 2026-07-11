import type { LogLevel } from '@qf/observability';
import { WorkerEnvSchema } from './env.js';

export interface WorkerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: LogLevel;
  readonly isProduction: boolean;
}

/**
 * Parse and validate the worker's environment into a typed config object.
 * Mirrors the API's `loadConfig`: invalid values throw a readable error and
 * fail fast at startup. `source` is injectable for deterministic tests.
 */
export function loadWorkerConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = WorkerEnvSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid QF Jarvis worker environment configuration:\n${details}`);
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
  };
}
