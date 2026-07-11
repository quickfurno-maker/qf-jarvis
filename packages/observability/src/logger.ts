import {
  pino,
  stdSerializers,
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';

/**
 * Log levels supported by the shared logger. Mirrors Pino's level names so no
 * translation layer sits between callers and Pino semantics.
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface LoggerConfig {
  /** Logical service name, attached to every record (e.g. "qf-jarvis-api"). */
  service: string;
  /** Deployment environment, attached to every record (e.g. "production"). */
  environment: string;
  /** Minimum level to emit. Defaults to "info" when omitted. */
  level?: LogLevel;
}

/**
 * Object paths redacted from every log record. This is a defence-in-depth
 * baseline — secrets should never be passed to the logger in the first place,
 * but if they slip through a common key they are censored rather than emitted.
 * Pino's `*` matches exactly one level, so both top-level and one-deep nested
 * occurrences of each sensitive key are covered.
 */
export const REDACTED_PATHS: readonly string[] = [
  'password',
  'pass',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.authorization',
];

export const REDACTION_CENSOR = '[REDACTED]';

/**
 * A re-export of Pino's `Logger` so consumers can type their own fields and use
 * `.child()` without depending on `pino` directly.
 */
export type { Logger } from 'pino';

/**
 * Build the shared structured logger.
 *
 * Output is line-delimited JSON with ISO-8601 timestamps, a string `level`
 * field, and `service` / `environment` on every record. Errors passed as `err`
 * or `error` are serialized safely (message, type, stack — never a thrown
 * getter). An optional `destination` mirrors Pino's own second argument and is
 * primarily useful for capturing output in tests.
 */
export function createLogger(config: LoggerConfig, destination?: DestinationStream): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    base: {
      service: config.service,
      environment: config.environment,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // Emit the level as its name ("info") rather than its numeric code.
      level(label) {
        return { level: label };
      },
    },
    serializers: {
      err: stdSerializers.err,
      error: stdSerializers.err,
    },
    redact: {
      paths: [...REDACTED_PATHS],
      censor: REDACTION_CENSOR,
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
