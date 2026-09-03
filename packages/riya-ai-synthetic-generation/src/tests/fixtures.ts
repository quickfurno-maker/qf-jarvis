/**
 * Tiny deterministic fixtures for the AS2 specs. TEST-ONLY.
 *
 * Everything is invented and obviously so. `gpt` and `claude` appear here as FAMILY LABELS a caller
 * supplies, never as names production source knows — the whole point of the inventory is that the
 * harness reads family from configuration rather than from anything it was compiled with.
 */
import {
  createRiyaSyntheticConfigInventory,
  createRiyaSyntheticGenerationPolicy,
  createRiyaSyntheticRoleAllocation,
  createRiyaSyntheticRunPlan,
  scheduleRiyaSyntheticScenarios,
} from '../index.js';
import type {
  RiyaSyntheticConfigInventoryV1,
  RiyaSyntheticGenerationPolicyV1,
  RiyaSyntheticModelConfigInput,
  RiyaSyntheticRoleAllocationV1,
} from '../index.js';
import { sha256Hex } from '../internal/digest.js';

const INSTRUCTION_SHA = sha256Hex('synthetic-instruction');

function config(
  configRef: string,
  family: string,
  roles: RiyaSyntheticModelConfigInput['allowedRoles'],
): RiyaSyntheticModelConfigInput {
  return {
    configRef,
    providerFamilyRef: `provider.${family}`,
    modelFamilyRef: family,
    modelRef: `${family}.model.v1`,
    adapterRef: `adapter.${family}`,
    allowedRoles: roles,
    instructionRef: `instruction.${family}.v1`,
    instructionSha256: INSTRUCTION_SHA,
    outputSchemaVersion: 1,
    maxOutputTokens: 2_048,
    samplingPolicyRef: 'sampling.default.v1',
    retryPolicyRef: 'retry.default.v1',
    activeForGeneration: true,
  };
}

/** Two families, each able to teach, simulate, verify and critique. */
export function inventory(): RiyaSyntheticConfigInventoryV1 {
  return createRiyaSyntheticConfigInventory({
    inventoryRef: 'inventory.test.v1',
    configs: [
      config('cfg.planner', 'gpt', ['SCENARIO_PLANNER']),
      config('cfg.sim.gpt', 'gpt', ['CUSTOMER_SIMULATOR']),
      config('cfg.sim.claude', 'claude', ['CUSTOMER_SIMULATOR']),
      config('cfg.teacher.gpt', 'gpt', ['RIYA_TEACHER']),
      config('cfg.teacher.claude', 'claude', ['RIYA_TEACHER']),
      config('cfg.verify.gpt', 'gpt', ['ANNOTATION_VERIFIER']),
      config('cfg.verify.claude', 'claude', ['ANNOTATION_VERIFIER']),
      config('cfg.critic.gpt', 'gpt', ['CRITIC']),
      config('cfg.critic.gpt.two', 'gpt', ['CRITIC']),
      config('cfg.critic.claude', 'claude', ['CRITIC']),
      config('cfg.critic.claude.two', 'claude', ['CRITIC']),
    ],
  });
}

export function policy(
  overrides: Partial<Omit<RiyaSyntheticGenerationPolicyV1, 'version'>> = {},
): RiyaSyntheticGenerationPolicyV1 {
  return createRiyaSyntheticGenerationPolicy({
    policyRef: 'generation.policy.test.v1',
    policyVersion: 1,
    maxStructuralRepairAttempts: 1,
    maxTransientRetries: 2,
    perInvocationTimeoutMs: 5_000,
    candidateTimeoutMs: 60_000,
    maxConcurrentInvocations: 2,
    maxConcurrentCandidates: 1,
    requireCrossFamilyCritique: true,
    minCriticsPerCandidate: 2,
    ...overrides,
  });
}

/** A GPT teacher judged by a Claude critic and a GPT critic — cross-family satisfied. */
export function gptTaughtAllocation(
  overrides: Partial<Omit<RiyaSyntheticRoleAllocationV1, 'version'>> = {},
): RiyaSyntheticRoleAllocationV1 {
  return createRiyaSyntheticRoleAllocation({
    generationRef: 'gen.run.one',
    scenarioPlannerConfigRef: 'cfg.planner',
    customerSimulatorConfigRef: 'cfg.sim.claude',
    riyaTeacherConfigRef: 'cfg.teacher.gpt',
    annotationVerifierConfigRef: 'cfg.verify.claude',
    criticConfigRefs: ['cfg.critic.claude', 'cfg.critic.gpt'],
    ...overrides,
  });
}

/** A Claude teacher judged by a GPT critic and a Claude critic — the mirror arrangement. */
export function claudeTaughtAllocation(
  overrides: Partial<Omit<RiyaSyntheticRoleAllocationV1, 'version'>> = {},
): RiyaSyntheticRoleAllocationV1 {
  return createRiyaSyntheticRoleAllocation({
    generationRef: 'gen.run.two',
    scenarioPlannerConfigRef: 'cfg.planner',
    customerSimulatorConfigRef: 'cfg.sim.gpt',
    riyaTeacherConfigRef: 'cfg.teacher.claude',
    annotationVerifierConfigRef: 'cfg.verify.gpt',
    criticConfigRefs: ['cfg.critic.claude', 'cfg.critic.gpt'],
    ...overrides,
  });
}

/** A tiny plan the scheduler can expand. */
export function runPlan(scenarioCount = 6) {
  return createRiyaSyntheticRunPlan({
    planRef: 'plan.test.v1',
    seed: 3,
    scenarioCount,
    languageModes: ['ENGLISH', 'HINDI', 'HINGLISH'],
    interactionKinds: ['DISCOVERY', 'OBJECTION_PRICE', 'GROUNDING_QA'],
    personas: ['EXPLORING', 'PRICE_SENSITIVE'],
    difficulties: ['BASIC', 'STANDARD', 'HARD'],
    riskClasses: ['STANDARD'],
    startPhases: ['NEED', 'PROJECT_DETAILS'],
    minAssistantTurns: 4,
    maxAssistantTurns: 7,
    validationEveryNth: 5,
  });
}

export function scenarios(scenarioCount = 6) {
  return scheduleRiyaSyntheticScenarios(runPlan(scenarioCount));
}

export const CRITIC_DIMENSIONS = [
  'CLARITY',
  'NATURALNESS',
  'CONTEXT_USE',
  'NON_REPETITION',
] as const;
