#!/usr/bin/env node
import { isAbsolute } from 'node:path';

import { loadQuickFurnoWhatsAppProductionWorkerConfig } from '../quickfurno-whatsapp/production-worker-config.js';
import { createQuickFurnoWhatsAppProductionWorker } from '../quickfurno-whatsapp/production-worker.js';

function configPathOf(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--config') {
    throw new Error('invalid-usage');
  }
  const path = argv[1];
  if (path === undefined || !isAbsolute(path)) throw new Error('invalid-usage');
  return path;
}

async function main(): Promise<void> {
  let worker: Awaited<ReturnType<typeof createQuickFurnoWhatsAppProductionWorker>> | undefined;
  try {
    const config = loadQuickFurnoWhatsAppProductionWorkerConfig(
      configPathOf(process.argv.slice(2)),
    );
    worker = await createQuickFurnoWhatsAppProductionWorker(config);

    process.stdout.write(
      `qfj-whatsapp-worker READY revision=${worker.revision} providerMode=${worker.providerMode} approvals=${String(worker.verifiedApprovalCount)} maxConcurrentTurns=${String(worker.maxConcurrentTurns)} riya=${String(worker.maxConcurrentByAgent.RIYA)} anisha=${String(worker.maxConcurrentByAgent.ANISHA)} aarohi=${String(worker.maxConcurrentByAgent.AAROHI)}\n`,
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
  }
}

await main();
