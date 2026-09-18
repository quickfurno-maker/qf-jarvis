/**
 * One generic durable journey for Riya, Anisha, Aarohi and Jarvis.
 *
 * This workflow persists CONTROL STATE ONLY. Every model call, knowledge read, Core request and
 * Action Kernel submission happens inside `runJourneyCycle`, a Temporal Activity. That keeps raw
 * customer/vendor text and model output out of Workflow history while still giving us durable timers,
 * retries, signals, crash recovery and Continue-As-New history bounding.
 */
import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import {
  DURABLE_ORCHESTRATION_PROTOCOL,
  JARVIS_DURABLE_CANCEL_SIGNAL,
  JARVIS_DURABLE_STATUS_QUERY,
  JARVIS_DURABLE_WAKE_SIGNAL,
  type DurableCycleTrigger,
  type DurableJourneyCancelV1,
  type DurableJourneyCycleResultV1,
  type DurableJourneyPhase,
  type DurableJourneyStartV1,
  type DurableJourneyStatusV1,
  type DurableJourneyWakeV1,
} from '@qf-jarvis/durable-orchestration-contracts';
import type { DurableJourneyActivities } from '../activities/create-durable-journey-activities.js';

const activities = proxyActivities<DurableJourneyActivities>({
  startToCloseTimeout: '2 minutes',
  scheduleToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
    maximumInterval: '1 minute',
    maximumAttempts: 5,
  },
});

export const durableWakeSignal = defineSignal<[DurableJourneyWakeV1]>(JARVIS_DURABLE_WAKE_SIGNAL);
export const durableCancelSignal = defineSignal<[DurableJourneyCancelV1]>(
  JARVIS_DURABLE_CANCEL_SIGNAL,
);
export const durableStatusQuery = defineQuery<DurableJourneyStatusV1>(JARVIS_DURABLE_STATUS_QUERY);

/** Bound replay history for journeys that can stay alive for months. */
export const CONTINUE_AS_NEW_AFTER_CYCLES = 100;

function phaseFor(
  disposition: 'WAIT' | 'RETRY_SOON' | 'HUMAN_REVIEW' | 'COMPLETE',
): DurableJourneyPhase {
  if (disposition === 'COMPLETE') return 'COMPLETE';
  if (disposition === 'HUMAN_REVIEW') return 'HUMAN_REVIEW';
  return 'WAITING';
}

export async function jarvisDurableJourneyWorkflow(
  input: DurableJourneyStartV1,
): Promise<DurableJourneyStatusV1> {
  // Minimal deterministic guard at the workflow boundary. Full schema validation also happens at the
  // API/client boundary and again at the Activity boundary.
  if (input.journeyId.length === 0) {
    throw new TypeError('invalid-durable-journey-input');
  }

  let cancelled = false;
  let cancelReason = 'workflow.cancelled';
  let latestEventRef: string | undefined;
  let wakeVersion = 0;
  let wakeSignalsSeen = 0;
  let completedCycles = input.cycleBase;
  let generationCycles = 0;
  let lastCoreOutcome: DurableJourneyStatusV1['lastCoreOutcome'] = 'NONE';
  let lastReasonCode = input.generation === 0 ? 'workflow.started' : 'workflow.continued-as-new';
  let phase: DurableJourneyPhase = 'ACTIVE';
  const isCancelled = (): boolean => cancelled;

  const status = (): DurableJourneyStatusV1 => ({
    protocol: DURABLE_ORCHESTRATION_PROTOCOL,
    journeyId: input.journeyId,
    phase: cancelled ? 'CANCELLED' : phase,
    generation: input.generation,
    completedCycles,
    wakeSignalsSeen,
    lastCoreOutcome,
    lastReasonCode: cancelled ? cancelReason : lastReasonCode,
    executionAuthority: 'NONE',
    canExecute: false,
  });

  setHandler(durableWakeSignal, (wake) => {
    latestEventRef = wake.eventRef;
    wakeVersion += 1;
    wakeSignalsSeen += 1;
    lastReasonCode = wake.reasonCode;
  });
  setHandler(durableCancelSignal, (cancel) => {
    cancelled = true;
    cancelReason = cancel.reasonCode;
    phase = 'CANCELLED';
  });
  setHandler(durableStatusQuery, status);

  let trigger: DurableCycleTrigger = input.generation === 0 ? 'START' : 'CONTINUE_AS_NEW';

  while (!isCancelled()) {
    const cycleWakeVersion = wakeVersion;
    const triggerEventRef = latestEventRef;
    latestEventRef = undefined;
    phase = 'ACTIVE';

    const result: DurableJourneyCycleResultV1 = await activities.runJourneyCycle({
      journey: input,
      cycle: completedCycles,
      trigger,
      ...(triggerEventRef === undefined ? {} : { triggerEventRef }),
    });

    completedCycles += 1;
    generationCycles += 1;
    lastCoreOutcome = result.coreOutcome;
    lastReasonCode = result.reasonCode;
    phase = phaseFor(result.disposition);

    if (result.disposition === 'COMPLETE') return status();
    if (isCancelled()) return status();

    // A signal that arrived while the Activity was running must be processed before Continue-As-New;
    // otherwise a pending Core event could be lost at the history boundary.
    const pendingWake = wakeVersion !== cycleWakeVersion;
    if (generationCycles >= CONTINUE_AS_NEW_AFTER_CYCLES && !pendingWake) {
      await continueAsNew<typeof jarvisDurableJourneyWorkflow>({
        ...input,
        generation: input.generation + 1,
        cycleBase: completedCycles,
      });
    }

    if (pendingWake) {
      trigger = 'CORE_EVENT';
      continue;
    }

    // Temporal's durable condition+timer survives process/server restarts. A Core event signal wakes
    // the journey early; otherwise the timer advances it. No in-memory setTimeout is involved.
    const woke: boolean = await condition(
      () => isCancelled() || wakeVersion !== cycleWakeVersion,
      result.waitMs,
    );
    if (isCancelled()) return status();
    trigger = woke ? 'CORE_EVENT' : 'TIMER';
  }

  return status();
}
