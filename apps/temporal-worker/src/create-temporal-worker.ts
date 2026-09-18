/** Native Temporal worker composition. Configuration and credentials are injected at process edge. */
import { fileURLToPath } from 'node:url';
import { Worker, type NativeConnection } from '@temporalio/worker';
import { JARVIS_DURABLE_TASK_QUEUE } from '@qf-jarvis/durable-orchestration-contracts';
import type { DurableJourneyActivities } from './activities/create-durable-journey-activities.js';

export interface JarvisTemporalWorkerConfig {
  readonly connection: NativeConnection;
  readonly namespace: string;
  readonly activities: DurableJourneyActivities;
  readonly taskQueue?: string;
  readonly maxConcurrentActivityTaskExecutions?: number;
  readonly maxConcurrentWorkflowTaskExecutions?: number;
}

export async function createJarvisTemporalWorker(
  config: JarvisTemporalWorkerConfig,
): Promise<Worker> {
  return Worker.create({
    connection: config.connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue ?? JARVIS_DURABLE_TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL('./workflows/index.js', import.meta.url)),
    activities: config.activities,
    maxConcurrentActivityTaskExecutions: config.maxConcurrentActivityTaskExecutions ?? 100,
    maxConcurrentWorkflowTaskExecutions: config.maxConcurrentWorkflowTaskExecutions ?? 100,
  });
}
