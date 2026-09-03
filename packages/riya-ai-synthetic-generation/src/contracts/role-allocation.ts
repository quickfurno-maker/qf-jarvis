/**
 * Which configuration plays which role, and the cross-family lock (AS2, ADR-0143 §9).
 *
 * ### This is where "no model approves its own work" becomes checkable
 *
 * AS1 named the roles so the rule could be expressed. AS2 has to make it true of a real run, and the
 * only way to do that is to resolve every role against the config INVENTORY and compare families
 * there — never against anything a model said about itself.
 *
 * ### The cross-family rule, stated exactly
 *
 * With `requireCrossFamilyCritique` on, at least one critic must come from a family the teacher does
 * not belong to. A GPT teacher reviewed only by GPT critics is refused; so is a Claude teacher
 * reviewed only by Claude critics. The rule is symmetric and neither family is named in this file —
 * families are inventory data, so the lock outlives whichever two families are current.
 *
 * A critic that shares the teacher's weights shares its blind spots and will systematically approve
 * the answers it would itself have produced. Two such critics are not two opinions.
 */
import { z } from 'zod';

import { RiyaSyntheticGenerationError } from './errors.js';
import { configFor, configServesRole } from './model-config.js';
import type { RiyaSyntheticConfigInventoryV1 } from './model-config.js';
import type { RiyaSyntheticGenerationPolicyV1 } from './policy.js';

export interface RiyaSyntheticRoleAllocationV1 {
  readonly version: 1;
  /** The run/bundle identity. Never a config ref — AS1 provenance refuses that collapse. */
  readonly generationRef: string;
  readonly scenarioPlannerConfigRef: string;
  readonly customerSimulatorConfigRef: string;
  readonly riyaTeacherConfigRef: string;
  readonly annotationVerifierConfigRef: string;
  readonly criticConfigRefs: readonly string[];
}

export type RiyaSyntheticRoleAllocationInput = Omit<RiyaSyntheticRoleAllocationV1, 'version'> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const allocationSchema = z
  .object({
    version: z.literal(1).optional(),
    generationRef: REF,
    scenarioPlannerConfigRef: REF,
    customerSimulatorConfigRef: REF,
    riyaTeacherConfigRef: REF,
    annotationVerifierConfigRef: REF,
    criticConfigRefs: z.array(REF).min(1).max(8),
  })
  .strict();

/** Validate and freeze a role allocation's SHAPE. Throws `role-config-conflict`. */
export function createRiyaSyntheticRoleAllocation(
  input: RiyaSyntheticRoleAllocationInput,
): RiyaSyntheticRoleAllocationV1 {
  const parsed = allocationSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }
  const data = parsed.data;

  // The bundle identity is not one of its own roles. AS1's provenance constructor refuses that too;
  // catching it here means the run fails before spending a single token.
  const roleRefs = [
    data.scenarioPlannerConfigRef,
    data.customerSimulatorConfigRef,
    data.riyaTeacherConfigRef,
    data.annotationVerifierConfigRef,
    ...data.criticConfigRefs,
  ];
  if (roleRefs.includes(data.generationRef)) {
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }

  // The verifier checks the teacher's own structured claims. Sharing a config means the teacher
  // confirms its own annotations -- the self-approval failure one layer below the critic.
  if (data.annotationVerifierConfigRef === data.riyaTeacherConfigRef) {
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }

  const critics = data.criticConfigRefs;
  if (new Set(critics).size !== critics.length) {
    // Two critics on one config is one critic, twice.
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }
  if (critics.includes(data.riyaTeacherConfigRef)) {
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }
  if (critics.includes(data.annotationVerifierConfigRef)) {
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }

  return Object.freeze({
    version: 1 as const,
    generationRef: data.generationRef,
    scenarioPlannerConfigRef: data.scenarioPlannerConfigRef,
    customerSimulatorConfigRef: data.customerSimulatorConfigRef,
    riyaTeacherConfigRef: data.riyaTeacherConfigRef,
    annotationVerifierConfigRef: data.annotationVerifierConfigRef,
    criticConfigRefs: Object.freeze([...critics].sort()),
  });
}

/**
 * Resolve an allocation against the inventory and the policy. Fails closed.
 *
 * Throws `invalid-model-config` when a ref is unknown or is not permitted to serve its role,
 * `critic-policy-failed` when the critic set does not satisfy the policy.
 *
 * Runs BEFORE any invocation. Discovering a same-family critic set after generating ten turns wastes
 * the tokens and, worse, creates a candidate somebody may be tempted to keep.
 */
export function resolveRiyaSyntheticRoleAllocation(
  allocation: RiyaSyntheticRoleAllocationV1,
  inventory: RiyaSyntheticConfigInventoryV1,
  policy: RiyaSyntheticGenerationPolicyV1,
): {
  readonly teacherModelFamilyRef: string;
  readonly customerSimulatorModelFamilyRef: string;
  readonly criticModelFamilyRefs: readonly string[];
} {
  const planner = configFor(inventory, allocation.scenarioPlannerConfigRef);
  const simulator = configFor(inventory, allocation.customerSimulatorConfigRef);
  const teacher = configFor(inventory, allocation.riyaTeacherConfigRef);
  const verifier = configFor(inventory, allocation.annotationVerifierConfigRef);
  const critics = allocation.criticConfigRefs.map((ref) => configFor(inventory, ref));

  const serves: readonly [typeof planner, Parameters<typeof configServesRole>[1]][] = [
    [planner, 'SCENARIO_PLANNER'],
    [simulator, 'CUSTOMER_SIMULATOR'],
    [teacher, 'RIYA_TEACHER'],
    [verifier, 'ANNOTATION_VERIFIER'],
  ];
  for (const [config, role] of serves) {
    if (!configServesRole(config, role)) {
      throw new RiyaSyntheticGenerationError('invalid-model-config');
    }
  }
  for (const critic of critics) {
    if (!configServesRole(critic, 'CRITIC')) {
      throw new RiyaSyntheticGenerationError('invalid-model-config');
    }
  }

  if (critics.length < policy.minCriticsPerCandidate) {
    throw new RiyaSyntheticGenerationError('critic-policy-failed');
  }

  // THE cross-family lock. Family identity comes from the inventory, never from the model.
  if (policy.requireCrossFamilyCritique) {
    const different = critics.some((critic) => critic.modelFamilyRef !== teacher.modelFamilyRef);
    if (!different) {
      throw new RiyaSyntheticGenerationError('critic-policy-failed');
    }
  }

  return {
    teacherModelFamilyRef: teacher.modelFamilyRef,
    customerSimulatorModelFamilyRef: simulator.modelFamilyRef,
    criticModelFamilyRefs: Object.freeze(critics.map((critic) => critic.modelFamilyRef)),
  };
}
