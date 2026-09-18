import { z } from 'zod';

/** Stable protocol/version strings used on both the Temporal client and worker side. */
export const DURABLE_ORCHESTRATION_PROTOCOL = 'qfj.temporal.orchestration.v1' as const;
export const JARVIS_DURABLE_TASK_QUEUE = 'qfj-durable-orchestration-v1' as const;
export const JARVIS_DURABLE_JOURNEY_WORKFLOW = 'jarvisDurableJourneyWorkflow' as const;
export const JARVIS_DURABLE_WAKE_SIGNAL = 'jarvis.durable.wake.v1' as const;
export const JARVIS_DURABLE_CANCEL_SIGNAL = 'jarvis.durable.cancel.v1' as const;
export const JARVIS_DURABLE_STATUS_QUERY = 'jarvis.durable.status.v1' as const;

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);
const reasonCode = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const DURABLE_JOURNEY_KINDS = [
  'CLIENT_SUCCESS',
  'VENDOR_SUCCESS',
  'PROSPECT_GROWTH',
  'FOUNDER_TASK',
] as const;
export const durableJourneyKindSchema = z.enum(DURABLE_JOURNEY_KINDS);
export type DurableJourneyKind = z.infer<typeof durableJourneyKindSchema>;

export const DURABLE_JOURNEY_ACTORS = ['RIYA', 'ANISHA', 'AAROHI', 'JARVIS'] as const;
export const durableJourneyActorSchema = z.enum(DURABLE_JOURNEY_ACTORS);
export type DurableJourneyActor = z.infer<typeof durableJourneyActorSchema>;

/**
 * Workflow input is deliberately content-minimized because Temporal persists workflow arguments.
 * It contains opaque references and control state only. There is no conversation text, model output,
 * phone number, email, address, consent flag, credential, provider payload or business record body.
 */
export const durableJourneyStartV1Schema = z
  .strictObject({
    protocol: z.literal(DURABLE_ORCHESTRATION_PROTOCOL),
    journeyId: identifier,
    kind: durableJourneyKindSchema,
    actor: durableJourneyActorSchema,
    subjectRef: identifier,
    conversationRef: identifier.optional(),
    startedFromEventRef: identifier,
    policyRevision: identifier,
    generation: z.number().int().min(0).max(100_000).default(0),
    cycleBase: z.number().int().min(0).max(10_000_000).default(0),
  })
  .superRefine((value, ctx) => {
    const expectedActor: Readonly<Record<DurableJourneyKind, DurableJourneyActor>> = {
      CLIENT_SUCCESS: 'RIYA',
      VENDOR_SUCCESS: 'ANISHA',
      PROSPECT_GROWTH: 'AAROHI',
      FOUNDER_TASK: 'JARVIS',
    };
    if (value.actor !== expectedActor[value.kind]) {
      ctx.addIssue({
        code: 'custom',
        path: ['actor'],
        message: 'actor must match the durable journey kind owner',
      });
    }
  });
export type DurableJourneyStartV1 = z.infer<typeof durableJourneyStartV1Schema>;

export const durableJourneyWakeV1Schema = z.strictObject({
  eventRef: identifier,
  reasonCode,
});
export type DurableJourneyWakeV1 = z.infer<typeof durableJourneyWakeV1Schema>;

export const durableJourneyCancelV1Schema = z.strictObject({
  reasonCode,
});
export type DurableJourneyCancelV1 = z.infer<typeof durableJourneyCancelV1Schema>;

export const DURABLE_CYCLE_TRIGGERS = ['START', 'TIMER', 'CORE_EVENT', 'CONTINUE_AS_NEW'] as const;
export const durableCycleTriggerSchema = z.enum(DURABLE_CYCLE_TRIGGERS);
export type DurableCycleTrigger = z.infer<typeof durableCycleTriggerSchema>;

export const durableJourneyCycleInputV1Schema = z.strictObject({
  journey: durableJourneyStartV1Schema,
  cycle: z.number().int().min(0).max(10_000_000),
  trigger: durableCycleTriggerSchema,
  triggerEventRef: identifier.optional(),
});
export type DurableJourneyCycleInputV1 = z.infer<typeof durableJourneyCycleInputV1Schema>;

export const DURABLE_CYCLE_DISPOSITIONS = [
  'WAIT',
  'RETRY_SOON',
  'HUMAN_REVIEW',
  'COMPLETE',
] as const;
export const durableCycleDispositionSchema = z.enum(DURABLE_CYCLE_DISPOSITIONS);
export type DurableCycleDisposition = z.infer<typeof durableCycleDispositionSchema>;

export const DURABLE_CORE_OUTCOMES = [
  'NONE',
  'ACCEPTED',
  'REJECTED',
  'HUMAN_REVIEW_REQUIRED',
  'RETRY_LATER',
  'STALE_REVISION',
  'CORE_UNAVAILABLE',
] as const;
export const durableCoreOutcomeSchema = z.enum(DURABLE_CORE_OUTCOMES);
export type DurableCoreOutcome = z.infer<typeof durableCoreOutcomeSchema>;

/**
 * Activity result persisted in Temporal history. It is content-free by construction.
 * Raw model output and the CoreDecisionRequest are created and consumed INSIDE the activity only.
 */
export const durableJourneyCycleResultV1Schema = z.strictObject({
  disposition: durableCycleDispositionSchema,
  waitMs: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 60 * 60 * 1000),
  coreOutcome: durableCoreOutcomeSchema,
  reasonCode,
  requestFingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
});
export type DurableJourneyCycleResultV1 = z.infer<typeof durableJourneyCycleResultV1Schema>;

export const DURABLE_JOURNEY_PHASES = [
  'ACTIVE',
  'WAITING',
  'HUMAN_REVIEW',
  'COMPLETE',
  'CANCELLED',
] as const;
export const durableJourneyPhaseSchema = z.enum(DURABLE_JOURNEY_PHASES);
export type DurableJourneyPhase = z.infer<typeof durableJourneyPhaseSchema>;

export const durableJourneyStatusV1Schema = z.strictObject({
  protocol: z.literal(DURABLE_ORCHESTRATION_PROTOCOL),
  journeyId: identifier,
  phase: durableJourneyPhaseSchema,
  generation: z.number().int().min(0),
  completedCycles: z.number().int().min(0),
  wakeSignalsSeen: z.number().int().min(0),
  lastCoreOutcome: durableCoreOutcomeSchema,
  lastReasonCode: reasonCode,
  executionAuthority: z.literal('NONE'),
  canExecute: z.literal(false),
});
export type DurableJourneyStatusV1 = z.infer<typeof durableJourneyStatusV1Schema>;

export function durableJourneyWorkflowId(
  input: Pick<DurableJourneyStartV1, 'kind' | 'journeyId'>,
): string {
  return `qfj:${input.kind.toLowerCase()}:${input.journeyId}`;
}
