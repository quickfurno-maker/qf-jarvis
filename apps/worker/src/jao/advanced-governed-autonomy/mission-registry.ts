/**
 * The canonical JAO-7 mission registry and planner (ADR-0121).
 *
 * ### PRIVATE governance state
 *
 * Nothing here reaches a barrel except `describeJao7Missions` and `JAO7_MISSION_POLICY_IDS`, both of
 * which hand back detached primitives. The policy records, the registry, the registry type and the
 * parameter schemas are module-private and reachable only by direct module path.
 *
 * ### The plan is DATA, and the digest is what pins it
 *
 * There is no planner that generates steps. A plan is `policy.planSteps` -- a fixed sequence drawn
 * from a closed vocabulary, reviewed as part of the policy -- and `jao7PlanDigest` is a SHA-256 over
 * the mission identity and that sequence. The digest is written onto the run at creation and
 * re-checked on every claim, so a run cannot be resumed against a plan that has changed underneath
 * it, and a caller cannot supply a plan at all because there is no parameter for one.
 *
 * That is what "policy-bounded planning" means structurally: the plan is finite, it cannot recurse,
 * it cannot spawn a child plan, it cannot grow at runtime, and it cannot contain a step type nobody
 * reviewed.
 */
import { createHash } from 'node:crypto';

import type { z } from 'zod';

import { Jao7AutonomyError, type Jao7StepType } from './contracts.js';
import {
  describeJao7Mission,
  freezeJao7Policy,
  jao7CapacityParametersSchema,
  jao7MissionPolicySchema,
  jao7OperatorTaskParametersSchema,
  type Jao7MissionDescriptor,
  type Jao7MissionPolicy,
} from './mission-policy.js';

/**
 * MISSION A -- client sales stall analysis, remediated INTERNALLY.
 *
 * It proves multi-agent planning by including exactly one governed Riya delegation through the
 * certified JAO-2 boundary, and it proves the boundary holds by proposing something that never
 * reaches the client: an internal operator task. Riya analyses client-sales signals, which is the
 * only thing Riya's governed behaviour is scoped to; the remediation is a note for a human.
 *
 * The distinction matters. "Riya said the conversation stalled" is advice. "Send the client a
 * message" would be a communication, and a communication is `client-or-vendor-facing-communication`
 * -- a risk class no active JAO-7 mission may carry.
 *
 * MODULE-PRIVATE.
 */
const CLIENT_SALES_STALL_REMEDIATION: Jao7MissionPolicy = freezeJao7Policy(
  jao7MissionPolicySchema.parse({
    missionPolicyId: 'jao7.client-sales-stall-remediation',
    missionPolicyVersion: 1,
    availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',
    missionClass: 'CLIENT_SALES_STALL_REMEDIATION',

    allowedSubjectTypes: ['client'],

    producer: 'jarvis',
    producerVersion: 'jarvis.jao7.v1',

    maxLifetimeSeconds: 2 * 24 * 60 * 60,
    maxSteps: 10,
    maxResumes: 8,
    maxSpecialistCalls: 1,
    maxToolCalls: 0,
    maxModelCalls: 0,
    maxRehearsalApplies: 1,
    maxRollbackAttempts: 1,

    requiredRisk: 'low-risk-reversible',
    requiredApproval: 'delegated-approver',

    recommendationType: 'client.sales-stall-remediation',
    actionType: 'operator.task.create',
    actionContractVersion: 1,

    planSteps: [
      'VALIDATE_INPUT',
      'DELEGATE_RIYA_ANALYSIS',
      'BUILD_REMEDIATION_PROPOSAL',
      'AWAIT_AUTHORITY',
      'VALIDATE_AUTHORITY_EVIDENCE',
      'REHEARSE_REVERSIBLE_EFFECT',
      'VERIFY_REHEARSAL',
      'COMPLETE',
    ],

    rehearsalClass: 'VIRTUAL_OPERATOR_TASK_LEDGER',

    verificationPolicy: 'EXACT_MATCH_AGAINST_TARGET',
    rollbackPolicy: 'RESTORE_CAPTURED_BEFORE_STATE_ONLY',
    killPolicy: 'TERMINAL_NO_UNKILL_SAFETY_ROLLBACK_SUPERIOR',
    expiryPolicy: 'BLOCKS_FORWARD_WORK_SAFETY_ROLLBACK_SUPERIOR',

    policyReference: { policyId: 'internal-operator-task-approval', policyVersion: 1 },

    rolloutPosture: 'OFFLINE_SHADOW_PROOF',
    businessEffect: false,
    productionMutation: false,

    summary: 'Analyse a stalled client-sales conversation and propose an internal operator task.',
  }),
);

/**
 * MISSION B -- synthetic capacity incident remediation.
 *
 * Capacity optimisation, incident-remediation proposal, and a reversible apply/verify/rollback, over
 * an entirely synthetic pool. The target concurrency is COMPUTED from closed metric bands by a
 * deterministic function; there is no parameter through which a caller or a model could name one.
 *
 * MODULE-PRIVATE.
 */
const SYNTHETIC_CAPACITY_REMEDIATION: Jao7MissionPolicy = freezeJao7Policy(
  jao7MissionPolicySchema.parse({
    missionPolicyId: 'jao7.synthetic-capacity-remediation',
    missionPolicyVersion: 1,
    availability: 'ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY',
    missionClass: 'SYNTHETIC_CAPACITY_REMEDIATION',

    allowedSubjectTypes: ['capacity-pool'],

    producer: 'jarvis',
    producerVersion: 'jarvis.jao7.v1',

    maxLifetimeSeconds: 24 * 60 * 60,
    maxSteps: 12,
    maxResumes: 8,
    maxSpecialistCalls: 0,
    maxToolCalls: 2,
    maxModelCalls: 0,
    maxRehearsalApplies: 1,
    maxRollbackAttempts: 1,

    requiredRisk: 'low-risk-reversible',
    requiredApproval: 'delegated-approver',

    recommendationType: 'capacity.incident-remediation',
    actionType: 'capacity.concurrency-adjustment',
    actionContractVersion: 1,

    planSteps: [
      'VALIDATE_INPUT',
      'GATHER_VIRTUAL_EVIDENCE',
      'ANALYZE_CAPACITY',
      'BUILD_REMEDIATION_PROPOSAL',
      'AWAIT_AUTHORITY',
      'VALIDATE_AUTHORITY_EVIDENCE',
      'REHEARSE_REVERSIBLE_EFFECT',
      'VERIFY_REHEARSAL',
      'COMPLETE',
    ],

    rehearsalClass: 'VIRTUAL_CAPACITY_POOL',

    verificationPolicy: 'EXACT_MATCH_AGAINST_TARGET',
    rollbackPolicy: 'RESTORE_CAPTURED_BEFORE_STATE_ONLY',
    killPolicy: 'TERMINAL_NO_UNKILL_SAFETY_ROLLBACK_SUPERIOR',
    expiryPolicy: 'BLOCKS_FORWARD_WORK_SAFETY_ROLLBACK_SUPERIOR',

    policyReference: { policyId: 'synthetic-capacity-adjustment-approval', policyVersion: 1 },

    rolloutPosture: 'OFFLINE_SHADOW_PROOF',
    businessEffect: false,
    productionMutation: false,

    summary: 'Diagnose a synthetic capacity incident and propose a bounded concurrency adjustment.',
  }),
);

/** Every declared mission. MODULE-PRIVATE. */
const MISSIONS: readonly Jao7MissionPolicy[] = Object.freeze([
  CLIENT_SALES_STALL_REMEDIATION,
  SYNTHETIC_CAPACITY_REMEDIATION,
]);

/**
 * The action parameter schemas, keyed by mission identity. MODULE-PRIVATE.
 *
 * A total map over the declared keys, so a new mission cannot silently inherit another's parameter
 * shape: the map fails to compile until it is given its own entry.
 */
const PARAMETER_SCHEMAS: Readonly<
  Record<
    'jao7.client-sales-stall-remediation@1' | 'jao7.synthetic-capacity-remediation@1',
    z.ZodType
  >
> = Object.freeze({
  'jao7.client-sales-stall-remediation@1': jao7OperatorTaskParametersSchema,
  'jao7.synthetic-capacity-remediation@1': jao7CapacityParametersSchema,
});

function schemaKey(policy: Jao7MissionPolicy): string {
  return `${policy.missionPolicyId}@${String(policy.missionPolicyVersion)}`;
}

/**
 * The parameter schema for one reviewed mission.
 *
 * Refuses rather than falling back: a mission whose parameter shape nobody wrote is a mission nobody
 * reviewed. INTERNAL -- exported from this module and from no barrel.
 */
export function jao7ParameterSchemaFor(policy: Jao7MissionPolicy): z.ZodType {
  const found = (PARAMETER_SCHEMAS as Readonly<Record<string, z.ZodType | undefined>>)[
    schemaKey(policy)
  ];
  if (found === undefined) {
    throw new Jao7AutonomyError('MISSION_UNKNOWN');
  }
  return found;
}

// ---------------------------------------------------------------------------
// Digests.
// ---------------------------------------------------------------------------

/** Length-prefixed so no concatenation of two parts can collide with a different pair. */
export function jao7Digest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(`${String(part.length)}:${part};`);
  }
  return hash.digest('hex');
}

/**
 * The digest of a mission policy, over its governance-bearing fields in a fixed order.
 *
 * A run stores this at creation. If the reviewed policy is later edited, an in-flight run stops
 * rather than silently continuing under bounds nobody enrolled it against.
 */
export function jao7MissionDigest(policy: Jao7MissionPolicy): string {
  return jao7Digest([
    'JAO7_MISSION',
    policy.missionPolicyId,
    String(policy.missionPolicyVersion),
    policy.availability,
    policy.missionClass,
    policy.allowedSubjectTypes.join(','),
    policy.producer,
    policy.producerVersion,
    String(policy.maxLifetimeSeconds),
    String(policy.maxSteps),
    String(policy.maxResumes),
    String(policy.maxSpecialistCalls),
    String(policy.maxToolCalls),
    String(policy.maxModelCalls),
    String(policy.maxRehearsalApplies),
    String(policy.maxRollbackAttempts),
    policy.requiredRisk,
    policy.requiredApproval,
    policy.recommendationType,
    policy.actionType,
    String(policy.actionContractVersion),
    policy.planSteps.join('>'),
    policy.rehearsalClass,
    policy.verificationPolicy,
    policy.rollbackPolicy,
    policy.killPolicy,
    policy.expiryPolicy,
    policy.policyReference.policyId,
    String(policy.policyReference.policyVersion),
  ]);
}

/** The digest of the reviewed plan itself: mission identity plus the exact step sequence. */
export function jao7PlanDigest(policy: Jao7MissionPolicy): string {
  return jao7Digest([
    'JAO7_PLAN',
    policy.missionPolicyId,
    String(policy.missionPolicyVersion),
    ...policy.planSteps,
  ]);
}

/** The reviewed plan, as a frozen copy. A caller reading it cannot reach the policy's own array. */
export function jao7PlanFor(policy: Jao7MissionPolicy): readonly Jao7StepType[] {
  return Object.freeze([...policy.planSteps]);
}

// ---------------------------------------------------------------------------
// The registry.
// ---------------------------------------------------------------------------

/** What a lookup found. There is no nearest match and no default. */
export type Jao7RegistryLookup =
  | { readonly found: 'MISSION'; readonly policy: Jao7MissionPolicy }
  | { readonly found: 'VERSION_MISMATCH' }
  | { readonly found: 'UNKNOWN' };

/** INTERNAL. Exported from this module and from no barrel. */
export interface Jao7MissionRegistry {
  lookup(missionPolicyId: string, missionPolicyVersion: number): Jao7RegistryLookup;
}

/** Build the canonical registry. Reads the module-private definitions and nothing else. */
export function createJao7MissionRegistry(): Jao7MissionRegistry {
  return Object.freeze({
    lookup(missionPolicyId: string, missionPolicyVersion: number): Jao7RegistryLookup {
      const byId = MISSIONS.filter((policy) => policy.missionPolicyId === missionPolicyId);
      if (byId.length === 0) {
        return { found: 'UNKNOWN' };
      }
      const exact = byId.find((policy) => policy.missionPolicyVersion === missionPolicyVersion);
      if (exact === undefined) {
        return { found: 'VERSION_MISMATCH' };
      }
      return { found: 'MISSION', policy: exact };
    },
  });
}

/** The declared mission ids, as detached primitives. Safe to export: strings copy by value. */
export const JAO7_MISSION_POLICY_IDS: readonly string[] = Object.freeze(
  MISSIONS.map((policy) => policy.missionPolicyId),
);

/** A DETACHED, primitive-only listing. A fresh array of fresh descriptors on every call. */
export function describeJao7Missions(): readonly Jao7MissionDescriptor[] {
  return Object.freeze(MISSIONS.map(describeJao7Mission));
}
