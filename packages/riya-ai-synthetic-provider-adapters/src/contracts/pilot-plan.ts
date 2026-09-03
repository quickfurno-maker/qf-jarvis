/**
 * The content-free pilot plan (AS3A, ADR-0143 §14).
 *
 * ### A plan says what to spend, never what to say
 *
 * There is no prompt here, no conversation, no customer text and no credential. A plan carries an
 * AS2 run-plan spec, a config inventory, a generation policy, an execution budget, the critic rubric
 * and a list of role allocations. Scenarios are not IN the file: they are DERIVED from the run-plan
 * spec by AS2's deterministic scheduler, so the same plan produces the same schedule on any machine
 * and a reviewer can read the whole thing in one screen.
 *
 * That is also what keeps the file safe to hand around. A plan that embedded scenarios would embed
 * planned customer facts and behaviour codes, and would be one careless `cat` away from a log.
 *
 * ### Allocations cycle, so a pilot matrix is a data change
 *
 * `allocations` is a non-empty list applied round-robin across the scheduled scenarios. Two entries —
 * one GPT-taught, one Claude-taught — give the AS3B handshake and the language matrix without a code
 * change, and the derived `generationRef` per item keeps AS1 provenance identities unique.
 *
 * ### Deep re-proof, here, before anything costs money
 *
 * Every nested contract goes back through its own canonical constructor. A plan is JSON somebody
 * typed, so it is exactly the kind of input that type annotations say nothing true about.
 */
import {
  createRiyaSyntheticConfigInventory,
  createRiyaSyntheticGenerationPolicy,
  createRiyaSyntheticRoleAllocation,
  createRiyaSyntheticRunPlan,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticConfigInventoryV1,
  RiyaSyntheticGenerationPolicyV1,
  RiyaSyntheticRoleAllocationV1,
  RiyaSyntheticRunPlanV1,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import { RIYA_DATASET_QUALITY_DIMENSIONS } from '@qf-jarvis/riya-intelligence-dataset';
import { createRiyaAiSyntheticAcceptancePolicy } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type { RiyaAiSyntheticAcceptancePolicyV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type { RiyaDatasetQualityDimension } from '@qf-jarvis/riya-intelligence-dataset';
import { z } from 'zod';

import { createRiyaSyntheticExecutionBudget } from './execution-budget.js';
import type { RiyaSyntheticExecutionBudgetV1 } from './execution-budget.js';
import { RiyaSyntheticPilotError } from './pilot-errors.js';

export interface RiyaSyntheticPilotPlanV1 {
  readonly version: 1;
  readonly planRef: string;
  readonly runPlan: RiyaSyntheticRunPlanV1;
  readonly inventory: RiyaSyntheticConfigInventoryV1;
  readonly policy: RiyaSyntheticGenerationPolicyV1;
  readonly budget: RiyaSyntheticExecutionBudgetV1;
  /**
   * AS1's acceptance policy, reused rather than reimplemented.
   *
   * It is in the plan because the pilot ends in `validateRiyaAiSyntheticCorpus`, and a run whose
   * acceptance policy was decided after the candidates existed would be a run that chose its own bar.
   */
  readonly acceptancePolicy: RiyaAiSyntheticAcceptancePolicyV1;
  /** Applied round-robin across the scheduled scenarios. Never empty. */
  readonly allocations: readonly RiyaSyntheticRoleAllocationV1[];
  readonly criticQualityDimensions: readonly RiyaDatasetQualityDimension[];
}

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * The OUTER shape only.
 *
 * Nested objects are `unknown` on purpose: their own constructors are the authority on their shape,
 * and re-describing them here would create a second definition that drifts. This schema's whole job
 * is to prove the file is an object with the right top-level keys and nothing else.
 */
const planSchema = z
  .object({
    version: z.literal(1).optional(),
    planRef: REF,
    runPlan: z.unknown(),
    inventory: z.unknown(),
    policy: z.unknown(),
    budget: z.unknown(),
    acceptancePolicy: z.unknown(),
    allocations: z.array(z.unknown()).min(1).max(64),
    criticQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .min(1)
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length),
  })
  .strict();

/** Strip a supplied `version` before handing fields to a constructor that adds its own. */
function withoutVersion(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RiyaSyntheticPilotError('invalid-pilot-plan');
  }
  const { version: _supplied, ...fields } = value as Record<string, unknown>;
  return fields;
}

/**
 * Validate and freeze a pilot plan. Throws `invalid-pilot-plan`.
 *
 * Every nested contract is re-proved through the constructor that owns it. A constructor rejection is
 * re-thrown as `invalid-pilot-plan` rather than propagated: a plan file is one artifact to a reader,
 * and "your plan is invalid" is the honest thing to say about it. The specific nested reason is
 * available by running that constructor directly, and is deliberately not smuggled into a message
 * that could carry a value from the file.
 */
export function createRiyaSyntheticPilotPlan(input: unknown): RiyaSyntheticPilotPlanV1 {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticPilotError('invalid-pilot-plan');
  }
  const data = parsed.data;

  let runPlan: RiyaSyntheticRunPlanV1;
  let inventory: RiyaSyntheticConfigInventoryV1;
  let policy: RiyaSyntheticGenerationPolicyV1;
  let budget: RiyaSyntheticExecutionBudgetV1;
  let acceptancePolicy: RiyaAiSyntheticAcceptancePolicyV1;
  let allocations: readonly RiyaSyntheticRoleAllocationV1[];
  try {
    runPlan = createRiyaSyntheticRunPlan(
      withoutVersion(data.runPlan) as Parameters<typeof createRiyaSyntheticRunPlan>[0],
    );
    inventory = createRiyaSyntheticConfigInventory(
      withoutVersion(data.inventory) as unknown as Parameters<
        typeof createRiyaSyntheticConfigInventory
      >[0],
    );
    policy = createRiyaSyntheticGenerationPolicy(
      withoutVersion(data.policy) as Parameters<typeof createRiyaSyntheticGenerationPolicy>[0],
    );
    budget = createRiyaSyntheticExecutionBudget(
      withoutVersion(data.budget) as Parameters<typeof createRiyaSyntheticExecutionBudget>[0],
    );
    acceptancePolicy = createRiyaAiSyntheticAcceptancePolicy(
      withoutVersion(data.acceptancePolicy) as unknown as Parameters<
        typeof createRiyaAiSyntheticAcceptancePolicy
      >[0],
    );
    allocations = data.allocations.map((one) =>
      createRiyaSyntheticRoleAllocation(
        withoutVersion(one) as Parameters<typeof createRiyaSyntheticRoleAllocation>[0],
      ),
    );
  } catch {
    throw new RiyaSyntheticPilotError('invalid-pilot-plan');
  }

  // Two allocations sharing a generation identity would give two candidates one provenance record,
  // and AS1 evidence that cannot say which trajectory it describes.
  const generationRefs = allocations.map((one) => one.generationRef);
  if (new Set(generationRefs).size !== generationRefs.length) {
    throw new RiyaSyntheticPilotError('invalid-pilot-plan');
  }
  // The critic rubric is a set, not a bag. A repeated dimension would double-count one opinion.
  const dimensions = data.criticQualityDimensions;
  if (new Set(dimensions).size !== dimensions.length) {
    throw new RiyaSyntheticPilotError('invalid-pilot-plan');
  }

  return Object.freeze({
    version: 1 as const,
    planRef: data.planRef,
    runPlan,
    inventory,
    policy,
    budget,
    acceptancePolicy,
    allocations: Object.freeze([...allocations]),
    criticQualityDimensions: Object.freeze([...dimensions]),
  });
}
