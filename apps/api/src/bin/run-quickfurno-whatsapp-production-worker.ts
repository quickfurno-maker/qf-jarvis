#!/usr/bin/env node
import { isAbsolute } from 'node:path';

import { startObservability, type ObservabilityRuntime } from '@qf-jarvis/observability';

import {
  enableCanonicalAosShadow,
  loadQuickFurnoWhatsAppProductionWorkerConfig,
} from '../quickfurno-whatsapp/production-worker-config.js';
import { createQuickFurnoWhatsAppProductionWorker } from '../quickfurno-whatsapp/production-worker.js';

const PHASE14_MIGRATION_HEAD = '0020_scale_phase14_trace_context';

interface CliOptions {
  readonly configPath: string;
  readonly enableAosShadow: boolean;
}

function optionsOf(argv: readonly string[]): CliOptions {
  const enableAosShadow =
    argv.length === 3 && argv[0] === '--config' && argv[2] === '--enable-aos-shadow';
  if (!enableAosShadow && (argv.length !== 2 || argv[0] !== '--config')) {
    throw new Error('invalid-usage');
  }
  const path = argv[1];
  if (path === undefined || !isAbsolute(path)) throw new Error('invalid-usage');
  return Object.freeze({ configPath: path, enableAosShadow });
}

async function main(): Promise<void> {
  let worker: Awaited<ReturnType<typeof createQuickFurnoWhatsAppProductionWorker>> | undefined;
  let observability: ObservabilityRuntime | undefined;
  try {
    const options = optionsOf(process.argv.slice(2));
    const loadedConfig = loadQuickFurnoWhatsAppProductionWorkerConfig(options.configPath);
    const config = options.enableAosShadow ? enableCanonicalAosShadow(loadedConfig) : loadedConfig;
    observability = startObservability({
      serviceName: config.serviceId,
      serviceVersion: config.revision,
      serviceInstanceId: config.runtimeId,
      environment: config.environment,
      imageSha: config.revision,
      migrationHead: PHASE14_MIGRATION_HEAD,
      configSchemaVersion: String(config.schemaVersion),
    });
    worker = await createQuickFurnoWhatsAppProductionWorker(config);

    process.stdout.write(
      `qfj-whatsapp-worker READY revision=${worker.revision} providerMode=${worker.providerMode} aosShadow=${config.aosShadow.mode} approvals=${String(worker.verifiedApprovalCount)} maxConcurrentTurns=${String(worker.maxConcurrentTurns)} riya=${String(worker.maxConcurrentByAgent.RIYA)} anisha=${String(worker.maxConcurrentByAgent.ANISHA)} aarohi=${String(worker.maxConcurrentByAgent.AAROHI)}\n`,
    );

    const controller = new AbortController();
    const stop = (): void => {
      controller.abort();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await worker.run(controller.signal);
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  } catch {
    process.stderr.write('qfj-whatsapp-worker REFUSED\n');
    process.exitCode = 1;
  } finally {
    await worker?.close().catch(() => {
      return undefined;
    });
    await observability?.shutdown().catch(() => undefined);
  }
}

await main();
