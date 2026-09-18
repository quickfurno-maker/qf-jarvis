/**
 * apps/api -> Temporal client seam.
 *
 * This client starts/wakes content-minimized durable journeys. It does NOT submit business actions to
 * Core and does not expose an execution method. Temporal workers perform agent cycles in Activities,
 * then submit any resulting proposal through Action Kernel -> QuickFurno Core.
 */
import type { Client } from '@temporalio/client';
import {
  JARVIS_DURABLE_CANCEL_SIGNAL,
  JARVIS_DURABLE_JOURNEY_WORKFLOW,
  JARVIS_DURABLE_STATUS_QUERY,
  JARVIS_DURABLE_TASK_QUEUE,
  JARVIS_DURABLE_WAKE_SIGNAL,
  durableJourneyCancelV1Schema,
  durableJourneyStartV1Schema,
  durableJourneyStatusV1Schema,
  durableJourneyWakeV1Schema,
  durableJourneyWorkflowId,
  type DurableJourneyCancelV1,
  type DurableJourneyStartV1,
  type DurableJourneyStatusV1,
  type DurableJourneyWakeV1,
} from '@qf-jarvis/durable-orchestration-contracts';

export interface DurableOrchestrationClient {
  startOrWake(
    input: DurableJourneyStartV1,
    wake: DurableJourneyWakeV1,
  ): Promise<{ workflowId: string }>;
  wake(
    input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>,
    wake: DurableJourneyWakeV1,
  ): Promise<void>;
  cancel(
    input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>,
    cancel: DurableJourneyCancelV1,
  ): Promise<void>;
  status(input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>): Promise<DurableJourneyStatusV1>;
  capabilities(): {
    readonly durableCoordination: true;
    readonly businessAuthority: 'NONE';
    readonly canExecuteBusinessEffects: false;
  };
}

export interface DurableOrchestrationClientConfig {
  readonly client: Client;
  readonly taskQueue?: string;
}

export function createDurableOrchestrationClient(
  config: DurableOrchestrationClientConfig,
): DurableOrchestrationClient {
  const taskQueue = config.taskQueue ?? JARVIS_DURABLE_TASK_QUEUE;

  const key = (input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>): string =>
    durableJourneyWorkflowId(input);

  return Object.freeze({
    async startOrWake(rawInput: DurableJourneyStartV1, rawWake: DurableJourneyWakeV1) {
      const input = durableJourneyStartV1Schema.parse(rawInput);
      const wake = durableJourneyWakeV1Schema.parse(rawWake);
      const workflowId = key(input);

      // signalWithStart is race-safe for "create journey if absent, otherwise wake the existing one".
      // Temporal defaults this API to USE_EXISTING on workflow-id conflict.
      await config.client.workflow.signalWithStart(JARVIS_DURABLE_JOURNEY_WORKFLOW, {
        workflowId,
        taskQueue,
        args: [input],
        signal: JARVIS_DURABLE_WAKE_SIGNAL,
        signalArgs: [wake],
      });
      return { workflowId };
    },

    async wake(
      input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>,
      rawWake: DurableJourneyWakeV1,
    ) {
      const wake = durableJourneyWakeV1Schema.parse(rawWake);
      await config.client.workflow.getHandle(key(input)).signal(JARVIS_DURABLE_WAKE_SIGNAL, wake);
    },

    async cancel(
      input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>,
      rawCancel: DurableJourneyCancelV1,
    ) {
      const cancel = durableJourneyCancelV1Schema.parse(rawCancel);
      await config.client.workflow
        .getHandle(key(input))
        .signal(JARVIS_DURABLE_CANCEL_SIGNAL, cancel);
    },

    async status(input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>) {
      const raw = await config.client.workflow
        .getHandle(key(input))
        .query(JARVIS_DURABLE_STATUS_QUERY);
      return durableJourneyStatusV1Schema.parse(raw);
    },

    capabilities: () =>
      Object.freeze({
        durableCoordination: true as const,
        businessAuthority: 'NONE' as const,
        canExecuteBusinessEffects: false as const,
      }),
  });
}
