/**
 * Activity boundary between durable Temporal control flow and Jarvis intelligence.
 *
 * The planner may call Mastra/agents/model routing and may construct a CoreDecisionRequest, but that
 * content exists only inside the Activity process. The activity submits it through Action Kernel and
 * returns a content-free CycleResult to Temporal, keeping raw model/customer content out of history.
 */
import type { CoreDecisionOutcome, CoreDecisionRequest } from '@qf-jarvis/agent-runtime';
import type { ActionKernel } from '@qf-jarvis/action-kernel';
import {
  durableJourneyCycleInputV1Schema,
  durableJourneyCycleResultV1Schema,
  type DurableJourneyCycleInputV1,
  type DurableJourneyCycleResultV1,
  type DurableCycleDisposition,
} from '@qf-jarvis/durable-orchestration-contracts';

export interface DurableNextDirective {
  readonly disposition: DurableCycleDisposition;
  readonly waitMs: number;
  readonly reasonCode: string;
}

export type DurableCoreDirectiveMap = Readonly<Record<CoreDecisionOutcome, DurableNextDirective>>;

export type DurableJourneyPlan =
  | {
      readonly kind: 'NO_ACTION';
      readonly next: DurableNextDirective;
    }
  | {
      readonly kind: 'SUBMIT_TO_CORE';
      readonly request: CoreDecisionRequest;
      readonly afterCore: DurableCoreDirectiveMap;
    };

/**
 * Implemented by the Jarvis intelligence composition: it can read current derived state, invoke the
 * owning agent through Mastra, and produce an inert proposal. It MUST NOT execute an external effect.
 */
export interface DurableJourneyPlannerPort {
  plan(input: DurableJourneyCycleInputV1): Promise<DurableJourneyPlan>;
}

export interface DurableJourneyActivities {
  runJourneyCycle(input: DurableJourneyCycleInputV1): Promise<DurableJourneyCycleResultV1>;
}

export interface DurableJourneyActivitiesConfig {
  readonly planner: DurableJourneyPlannerPort;
  readonly actionKernel: ActionKernel;
}

const IDENTITY_CONFLICT_RETRY_MS = 5_000;

export function createDurableJourneyActivities(
  config: DurableJourneyActivitiesConfig,
): DurableJourneyActivities {
  return Object.freeze({
    async runJourneyCycle(
      rawInput: DurableJourneyCycleInputV1,
    ): Promise<DurableJourneyCycleResultV1> {
      const input = durableJourneyCycleInputV1Schema.parse(rawInput);
      const plan = await config.planner.plan(input);

      if (plan.kind === 'NO_ACTION') {
        return durableJourneyCycleResultV1Schema.parse({
          ...plan.next,
          coreOutcome: 'NONE',
        });
      }

      const receipt = await config.actionKernel.submit(plan.request);
      if (receipt.status === 'REFUSED') {
        return durableJourneyCycleResultV1Schema.parse({
          disposition: 'RETRY_SOON',
          waitMs: IDENTITY_CONFLICT_RETRY_MS,
          coreOutcome: 'NONE',
          reasonCode: 'action-kernel.identity-conflict',
          requestFingerprint: receipt.requestFingerprint,
        });
      }

      const outcome = receipt.coreOutcome ?? 'CORE_UNAVAILABLE';
      const directive = plan.afterCore[outcome];
      return durableJourneyCycleResultV1Schema.parse({
        ...directive,
        coreOutcome: outcome,
        requestFingerprint: receipt.requestFingerprint,
      });
    },
  });
}
