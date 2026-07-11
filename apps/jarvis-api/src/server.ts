import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLogger, type Logger } from '@qf/observability';
import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';

const SERVICE_NAME = 'qf-jarvis-api';

/**
 * Read the service version from this app's package.json at runtime. Kept out of
 * the TypeScript program (read via fs, not imported) so it works regardless of
 * bundling and never pulls a file outside `rootDir`.
 */
function resolveVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const logger: Logger = createLogger({
    service: SERVICE_NAME,
    environment: config.nodeEnv,
    level: config.logLevel,
  });

  const version = resolveVersion();
  const app = await buildApp({ logger, version });

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutdown signal received; closing server');
    app
      .close()
      .then(() => {
        // Deliberately no `process.exit(0)`: once Fastify is closed there are no
        // open handles, so the event loop drains and the process exits 0 on its
        // own. Forcing an exit here can truncate the logger's buffered output.
        logger.info('server closed cleanly');
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'error during graceful shutdown');
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  try {
    const address = await app.listen({ host: config.host, port: config.port });
    logger.info({ address, version, nodeEnv: config.nodeEnv }, 'qf-jarvis-api listening');
  } catch (error) {
    logger.error({ err: error }, 'failed to start qf-jarvis-api');
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  // Reached only if configuration or logger construction throws before the app
  // (and its logger) exist, so write to stderr directly and exit non-zero.
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`fatal: ${SERVICE_NAME} failed to start\n${message}\n`);
  process.exit(1);
});
