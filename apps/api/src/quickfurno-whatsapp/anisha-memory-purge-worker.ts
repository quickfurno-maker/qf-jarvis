import { setTimeout as sleep } from 'node:timers/promises';
import type { AnishaMemoryPurgeCore, AnishaMemoryPurgeTask } from './quickfurno-http.js';

/**
 * AN-A2c: no reply path and no AI model. Failed DB delete NEVER gets an ACK.
 * A lost ACK is safe: the Core lease expires, duplicate delete -> zero rows,
 * and the fenced transaction remains until Core receives a valid ACK.
 */
export interface AnishaMemoryPurgeWorker {
  runCycle(): Promise<
    Readonly<{ claimed: number; deleted: number; acknowledged: number; failed: number }>
  >;
  run(signal: AbortSignal): Promise<void>;
}
export function createAnishaMemoryPurgeWorker(input: {
  readonly core: AnishaMemoryPurgeCore;
  readonly erase: (task: AnishaMemoryPurgeTask) => Promise<{ readonly deletedCount: number }>;
  readonly cadenceMs?: number;
}): AnishaMemoryPurgeWorker {
  const cadence = input.cadenceMs ?? 30_000;
  if (!Number.isInteger(cadence) || cadence < 5_000 || cadence > 300_000) {
    throw new TypeError('anisha-memory-purge-cadence-invalid');
  }
  let running = false;
  return Object.freeze({
    async runCycle() {
      if (running) throw new TypeError('anisha-memory-purge-cycle-overlap');
      running = true;
      try {
        const tasks = await input.core.claim(5);
        let deleted = 0;
        let acknowledged = 0;
        let failed = 0;
        for (const task of tasks) {
          try {
            const result = await input.erase(task);
            if (!Number.isSafeInteger(result.deletedCount) || result.deletedCount < 0) {
              throw new TypeError('anisha-memory-purge-invalid-receipt');
            }
            deleted += result.deletedCount;
            await input.core.acknowledge(task);
            acknowledged++;
          } catch {
            // The task remains pending. Core lease-expiry supplies retry.
            // Suppress raw DB/provider errors and vendor identifiers.
            failed++;
          }
        }
        return Object.freeze({ claimed: tasks.length, deleted, acknowledged, failed });
      } finally {
        running = false;
      }
    },
    async run(signal: AbortSignal): Promise<void> {
      while (!signal.aborted) {
        try {
          await this.runCycle();
        } catch {
          /* Core unavailable: retry next cycle */
        }
        if (signal.aborted) break;
        try {
          await sleep(cadence, undefined, { signal });
        } catch {
          break;
        }
      }
    },
  });
}
