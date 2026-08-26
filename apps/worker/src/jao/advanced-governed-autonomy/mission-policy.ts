/**
 * The JAO-7 static mission policy (ADR-0121).
 *
 * ### Why a mission policy is private, versioned and immutable by construction
 *
 * A mission policy decides how far an autonomous run may go before a human is required, how many
 * specialist calls it may spend, how long it may live, what risk class its proposal carries and
 * therefore who must say yes. A policy a caller could supply, extend or edit would be a caller
 * choosing its own oversight -- and no amount of validation downstream would help, because the thing
 * being validated would already be the caller's answer.
 *
 * JAO-6's owner review taught the rest of it the hard way. `Object.freeze` is SHALLOW: a frozen
 * record whose nested array is a live reference is a record a public caller can rewrite, and
 * TypeScript's `readonly` is erased before any of that runs. So policies here are JSON-like by
 * construction -- primitives, arrays of primitives, one nested object of primitives -- and
 * `freezeJao7Policy` rebuilds every nested value as a fresh frozen one before freezing the record.
 *
 * Zod schemas are NOT stored on a policy. A `ZodType` is a framework object with mutable internals;
 * putting one on a governance record makes that record un-freezable in any honest sense, and
 * deep-freezing Zod's internals would break the library. Parameter schemas live in a private lookup
 * keyed by mission identity.
 *
 * ### What availability means
 *
 * `ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY` is the strongest state that exists in this slice. It is not
 * production enablement: JAO-7 is imported by no production entry, reaches no Core, n8n, provider or
 * channel, and its only effect is a local synthetic integer.
 */
import { machineTokenSchema, TEXT_LIMITS, boundedText } from '@qf-jarvis/contracts';
import { z } from 'zod';

import { JAO7_REHEARSAL_CLASSES, JAO7_STEP_TYPES } from './contracts.js';

/** Availability. `PLANNED` is refused before any work. There is no state that means production. */
export const JAO7_MISSION_AVAILABILITIES = Object.freeze([
  'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',
  'PLANNED',
] as const);

export type Jao7MissionAvailability = (typeof JAO7_MISSION_AVAILABILITIES)[number];

/** The two reviewed mission classes. Adding a third is an act of review, not an act of code. */
export const JAO7_MISSION_CLASSES = Object.freeze([
  'CLIENT_SALES_STALL_REMEDIATION',
  'SYNTHETIC_CAPACITY_REMEDIATION',
] as const);

export type Jao7MissionClass = (typeof JAO7_MISSION_CLASSES)[number];

// ---------------------------------------------------------------------------
// Action parameter schemas. Closed structured values only, and no free text.
// ---------------------------------------------------------------------------

/**
 * Mission A's action parameters: an INTERNAL operator task.
 *
 * Nothing here reaches a client. There is no recipient, no channel, no message body and no template
 * -- the proposal says an internal task is warranted, of what class, by when and at what priority.
 * A human decides whether to create it, and Core owns whatever system holds it.
 *
 * Every field is a closed code or a band, so caller prose cannot enter the action bytes and
 * therefore cannot move the canonical fingerprint. That is JAO-6's Finding 3 applied here before
 * anybody had to find it again.
 */
export const jao7OperatorTaskParametersSchema = z.strictObject({
  taskReasonCode: z.enum([
    'client-sales-conversation-stalled',
    'client-requested-human-assistance',
    'client-discovery-incomplete',
    'client-readiness-unclear',
  ]),
  taskClass: z.enum(['sales-followup-review', 'discovery-completion', 'human-handover-review']),
  dueWindowCode: z.enum(['within-4-hours', 'within-1-business-day', 'within-3-business-days']),
  priorityBand: z.enum(['routine', 'elevated']),
});

/** Mission B's action parameters: a bounded concurrency adjustment on a synthetic pool. */
export const jao7CapacityParametersSchema = z.strictObject({
  poolCode: z.enum(['synthetic-pool-alpha', 'synthetic-pool-beta']),
  currentConcurrency: z.number().int().min(1).max(32),
  targetConcurrency: z.number().int().min(1).max(32),
  adjustmentReasonCode: z.enum([
    'saturated-with-low-error-rate',
    'queue-depth-sustained-high',
    'over-provisioned-idle',
  ]),
});

/** The exact reviewed key sets, asserted by spec rather than merely documented. */
export const JAO7_OPERATOR_TASK_PARAMETER_KEYS: readonly string[] = Object.freeze([
  'dueWindowCode',
  'priorityBand',
  'taskClass',
  'taskReasonCode',
]);

export const JAO7_CAPACITY_PARAMETER_KEYS: readonly string[] = Object.freeze([
  'adjustmentReasonCode',
  'currentConcurrency',
  'poolCode',
  'targetConcurrency',
]);

// ---------------------------------------------------------------------------
// The policy record.
// ---------------------------------------------------------------------------

/**
 * One reviewed mission.
 *
 * Every governance-bearing value lives here and nowhere else, and there is deliberately no field
 * through which a caller could reach: no callback, no schema, no plan, no evaluator, no effect.
 * `planSteps` is a fixed sequence drawn from the closed step vocabulary, so a plan is data that was
 * reviewed rather than a program that was generated.
 */
export interface Jao7MissionPolicy {
  readonly missionPolicyId: string;
  readonly missionPolicyVersion: number;
  readonly availability: Jao7MissionAvailability;
  readonly missionClass: Jao7MissionClass;

  readonly allowedSubjectTypes: readonly string[];

  /** Provenance. `jarvis`, always: Riya may advise, and Jarvis still concludes. */
  readonly producer: 'jarvis';
  readonly producerVersion: string;

  readonly maxLifetimeSeconds: number;
  readonly maxSteps: number;
  readonly maxResumes: number;
  readonly maxSpecialistCalls: number;
  readonly maxToolCalls: number;
  /** Literal zero. There is no model call anywhere in JAO-7. */
  readonly maxModelCalls: 0;
  readonly maxRehearsalApplies: number;
  readonly maxRollbackAttempts: number;

  /**
   * The approval matrix values for this mission's proposal.
   *
   * `low-risk-reversible` is the ONLY risk an active mission may carry in this proof, and a spec
   * fails closed if that ever stops being true. Communication, voice, money and high-risk classes
   * are not "not used here" -- they are refused.
   */
  readonly requiredRisk: 'low-risk-reversible';
  readonly requiredApproval: 'delegated-approver';

  readonly recommendationType: string;
  readonly actionType: string;
  readonly actionContractVersion: number;

  /** The reviewed plan, as a fixed sequence of closed step types. */
  readonly planSteps: readonly (typeof JAO7_STEP_TYPES)[number][];

  readonly rehearsalClass: (typeof JAO7_REHEARSAL_CLASSES)[number];

  /** How verification decides, and what rollback is permitted to restore. */
  readonly verificationPolicy: 'EXACT_MATCH_AGAINST_TARGET';
  readonly rollbackPolicy: 'RESTORE_CAPTURED_BEFORE_STATE_ONLY';
  readonly killPolicy: 'TERMINAL_NO_UNKILL_SAFETY_ROLLBACK_SUPERIOR';
  readonly expiryPolicy: 'BLOCKS_FORWARD_WORK_SAFETY_ROLLBACK_SUPERIOR';

  /** The citation recorded on the approval request. A reference, never the policy's contents. */
  readonly policyReference: { readonly policyId: string; readonly policyVersion: number };

  readonly rolloutPosture: 'OFFLINE_SHADOW_PROOF';
  readonly businessEffect: false;
  readonly productionMutation: false;

  readonly summary: string;
}

/**
 * The policy schema.
 *
 * Every registry definition is parsed through this at module load, so a definition that violates the
 * shape fails at import rather than at the first run. Note the LITERALS on `requiredRisk`,
 * `requiredApproval`, `maxModelCalls`, `businessEffect` and `productionMutation`: a future mission
 * that tried to declare a money-related risk would not fail a policy check, it would fail to load.
 */
export const jao7MissionPolicySchema = z.strictObject({
  missionPolicyId: machineTokenSchema,
  missionPolicyVersion: z.number().int().min(1).max(1_000),
  availability: z.enum(JAO7_MISSION_AVAILABILITIES),
  missionClass: z.enum(JAO7_MISSION_CLASSES),

  allowedSubjectTypes: z.array(machineTokenSchema).min(1).max(8),

  producer: z.literal('jarvis'),
  producerVersion: machineTokenSchema,

  maxLifetimeSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 60 * 60),
  maxSteps: z.number().int().min(1).max(64),
  maxResumes: z.number().int().min(0).max(64),
  maxSpecialistCalls: z.number().int().min(0).max(4),
  maxToolCalls: z.number().int().min(0).max(8),
  maxModelCalls: z.literal(0),
  maxRehearsalApplies: z.number().int().min(1).max(1),
  maxRollbackAttempts: z.number().int().min(1).max(1),

  requiredRisk: z.literal('low-risk-reversible'),
  requiredApproval: z.literal('delegated-approver'),

  recommendationType: machineTokenSchema,
  actionType: machineTokenSchema,
  actionContractVersion: z.number().int().min(1).max(1_000),

  planSteps: z.array(z.enum(JAO7_STEP_TYPES)).min(1).max(64),

  rehearsalClass: z.enum(JAO7_REHEARSAL_CLASSES),

  verificationPolicy: z.literal('EXACT_MATCH_AGAINST_TARGET'),
  rollbackPolicy: z.literal('RESTORE_CAPTURED_BEFORE_STATE_ONLY'),
  killPolicy: z.literal('TERMINAL_NO_UNKILL_SAFETY_ROLLBACK_SUPERIOR'),
  expiryPolicy: z.literal('BLOCKS_FORWARD_WORK_SAFETY_ROLLBACK_SUPERIOR'),

  policyReference: z.strictObject({
    policyId: machineTokenSchema,
    policyVersion: z.number().int().min(1).max(1_000),
  }),

  rolloutPosture: z.literal('OFFLINE_SHADOW_PROOF'),
  businessEffect: z.literal(false),
  productionMutation: z.literal(false),

  summary: boundedText(TEXT_LIMITS.summary),
});

/**
 * Freeze a parsed policy DEEPLY, by rebuilding every nested value.
 *
 * The types are all JSON-like, so this terminates and needs no cycle guard: there is no framework
 * object, no function and no self-reference to walk into.
 */
export function freezeJao7Policy(policy: Jao7MissionPolicy): Jao7MissionPolicy {
  return Object.freeze({
    ...policy,
    allowedSubjectTypes: Object.freeze([...policy.allowedSubjectTypes]),
    planSteps: Object.freeze([...policy.planSteps]),
    policyReference: Object.freeze({ ...policy.policyReference }),
  });
}

/**
 * A DETACHED, primitive-only view of a reviewed mission.
 *
 * What an operator surface may see. Every call returns a fresh copy sharing no reference with
 * canonical execution, so mutating one changes nothing anywhere -- a stronger promise than asking a
 * caller not to, and the only kind worth making across a barrel.
 */
export interface Jao7MissionDescriptor {
  readonly missionPolicyId: string;
  readonly missionPolicyVersion: number;
  readonly availability: Jao7MissionAvailability;
  readonly missionClass: Jao7MissionClass;
  readonly requiredRisk: string;
  readonly requiredApproval: string;
  readonly recommendationType: string;
  readonly actionType: string;
  readonly actionContractVersion: number;
  readonly maxLifetimeSeconds: number;
  readonly maxSteps: number;
  readonly maxSpecialistCalls: number;
  readonly maxToolCalls: number;
  readonly maxModelCalls: number;
  readonly maxRehearsalApplies: number;
  readonly rehearsalClass: string;
  readonly rolloutPosture: string;
  readonly summary: string;
}

/** Build the detached view. Primitives only: no array, no nested object, nothing shared. */
export function describeJao7Mission(policy: Jao7MissionPolicy): Jao7MissionDescriptor {
  return Object.freeze({
    missionPolicyId: policy.missionPolicyId,
    missionPolicyVersion: policy.missionPolicyVersion,
    availability: policy.availability,
    missionClass: policy.missionClass,
    requiredRisk: policy.requiredRisk,
    requiredApproval: policy.requiredApproval,
    recommendationType: policy.recommendationType,
    actionType: policy.actionType,
    actionContractVersion: policy.actionContractVersion,
    maxLifetimeSeconds: policy.maxLifetimeSeconds,
    maxSteps: policy.maxSteps,
    maxSpecialistCalls: policy.maxSpecialistCalls,
    maxToolCalls: policy.maxToolCalls,
    maxModelCalls: policy.maxModelCalls,
    maxRehearsalApplies: policy.maxRehearsalApplies,
    rehearsalClass: policy.rehearsalClass,
    rolloutPosture: policy.rolloutPosture,
    summary: policy.summary,
  });
}
