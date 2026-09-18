/**
 * Run a configured native Temporal worker until shutdown.
 *
 * The caller owns connection/config acquisition at the executable process boundary. This function
 * starts no connection on import and reads no environment. Worker shutdown/drain semantics remain
 * Temporal SDK semantics; no package-manager or shell process is interposed.
 */
import type { Worker } from '@temporalio/worker';
import {
  createJarvisTemporalWorker,
  type JarvisTemporalWorkerConfig,
} from './create-temporal-worker.js';

export async function runJarvisTemporalWorker(config: JarvisTemporalWorkerConfig): Promise<void> {
  const worker: Worker = await createJarvisTemporalWorker(config);
  await worker.run();
}
