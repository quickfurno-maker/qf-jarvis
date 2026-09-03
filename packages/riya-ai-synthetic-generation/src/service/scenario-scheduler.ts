/**
 * The deterministic scenario scheduler (AS2, ADR-0143 §6).
 *
 * ### Deterministic, because this is bookkeeping rather than language
 *
 * Choosing which enum combination comes next is not a job a model does better than arithmetic, and
 * asking one to do it costs tokens, introduces variance and makes coverage unauditable. Models are
 * for writing sentences. The schedule is a function of the plan.
 *
 * Same plan, same seed, same schedule — so a run can be re-derived, and a coverage claim can be
 * checked without re-reading a corpus.
 *
 * ### Lineage and split are fixed HERE, before generation
 *
 * ADR-0143 §6 in mechanical form. Each scenario gets its own lineage root and a split decided by
 * arithmetic, so a candidate's split is settled before a single word exists. Generating first and
 * splitting afterwards is how a paraphrase reaches `VALIDATION` while its parent sits in `TRAIN`, the
 * validation score rises, and nobody can see why.
 *
 * ### Balance by co-prime strides, not by randomness
 *
 * Each axis advances on its own stride. Using the same stride everywhere would lock the axes
 * together — every Hindi scenario also an objection, every EXPLORING persona also depth 4 — which
 * looks balanced per axis and is a single repeated conversation shape in practice.
 */
import {
  RIYA_AI_SYNTHETIC_BEHAVIOR_CODES,
  RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS,
  RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS,
  RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS,
  RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS,
  createRiyaAiSyntheticScenario,
} from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import type { RiyaAiSyntheticScenarioV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import { RIYA_DATASET_DISCOVERY_FIELDS } from '@qf-jarvis/riya-intelligence-dataset';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
} from '@qf-jarvis/riya-intelligence-dataset';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import { z } from 'zod';

import { RiyaSyntheticGenerationError } from '../contracts/errors.js';
import { sha256OfCanonical } from '../internal/digest.js';

export interface RiyaSyntheticRunPlanV1 {
  readonly version: 1;
  readonly planRef: string;
  readonly seed: number;
  readonly scenarioCount: number;
  readonly languageModes: readonly RiyaDatasetLanguageMode[];
  readonly interactionKinds: readonly RiyaDatasetInteractionKind[];
  readonly personas: readonly RiyaDatasetPersona[];
  readonly difficulties: readonly RiyaDatasetDifficulty[];
  readonly riskClasses: readonly RiyaDatasetRiskClass[];
  readonly startPhases: readonly RiyaConversationPhase[];
  readonly minAssistantTurns: number;
  readonly maxAssistantTurns: number;
  /** One scenario in every N goes to VALIDATION. Arithmetic, so coverage is checkable. */
  readonly validationEveryNth: number;
}

export type RiyaSyntheticRunPlanInput = Omit<RiyaSyntheticRunPlanV1, 'version'> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const planSchema = z
  .object({
    version: z.literal(1).optional(),
    planRef: REF,
    seed: z.int().min(0).max(2_147_483_647),
    // Bounded. AS2 builds the mechanism; AS3 decides how many candidates to actually spend.
    scenarioCount: z.int().min(1).max(10_000),
    languageModes: z.array(z.string()).min(1),
    interactionKinds: z.array(z.string()).min(1),
    personas: z.array(z.string()).min(1),
    difficulties: z.array(z.string()).min(1),
    riskClasses: z.array(z.string()).min(1),
    startPhases: z.array(z.string()).min(1),
    minAssistantTurns: z
      .int()
      .min(RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS)
      .max(RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS),
    maxAssistantTurns: z
      .int()
      .min(RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS)
      .max(RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS),
    validationEveryNth: z.int().min(2).max(1_000),
  })
  .strict();

/** Validate and freeze a run plan. Throws `invalid-run-plan`. */
export function createRiyaSyntheticRunPlan(
  input: RiyaSyntheticRunPlanInput,
): RiyaSyntheticRunPlanV1 {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('invalid-run-plan');
  }
  if (parsed.data.minAssistantTurns > parsed.data.maxAssistantTurns) {
    throw new RiyaSyntheticGenerationError('invalid-run-plan');
  }
  const { version: _supplied, ...fields } = parsed.data;
  return Object.freeze({ version: 1 as const, ...fields }) as RiyaSyntheticRunPlanV1;
}

/** The content digest of a plan. A run manifest binds to this. */
export function riyaSyntheticRunPlanSha256(plan: RiyaSyntheticRunPlanV1): string {
  return sha256OfCanonical(plan);
}

/**
 * Per-axis walk parameters.
 *
 * The first attempt multiplied each axis by a fixed stride and took a modulo. That is wrong whenever
 * the stride shares a factor with the axis length: a stride of 3 against three interaction kinds
 * yields index 0 forever, so every scenario got the same kind while the schedule still looked
 * deliberate. A spec caught it, which is the only reason it is not in the corpus.
 *
 * Two fixes, together. The stride is forced CO-PRIME with the axis length at runtime, so the walk
 * visits every value; and a `floor(step / length)` term is added, so two axes of the same length do
 * not move in lockstep. Balanced per axis and still one repeated conversation shape is the failure
 * that looks most like success.
 */
const PREFERRED_STRIDES = Object.freeze({
  language: 1,
  kind: 2,
  persona: 3,
  difficulty: 4,
  risk: 5,
  phase: 6,
  depth: 7,
  behavior: 8,
  discovery: 9,
});

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A deterministic, decorrelated, full-coverage index into an axis. */
function axisIndex(step: number, length: number, preferred: number): number {
  let stride = preferred % length;
  if (stride === 0) stride = 1;
  while (gcd(stride, length) !== 1) {
    stride += 1;
  }
  return (step * stride + Math.floor(step / length)) % length;
}

const pick = <T>(items: readonly T[], index: number): T => {
  const item = items[((index % items.length) + items.length) % items.length];
  /* c8 ignore next 3 -- the modulo above cannot produce an out-of-range index for a non-empty array */
  if (item === undefined) {
    throw new RiyaSyntheticGenerationError('invalid-run-plan');
  }
  return item;
};

/**
 * Expand a plan into scenarios. Pure, deterministic, and free of any model call.
 *
 * Every scenario is fully constructed through the AS1 constructor, so a schedule that could not
 * produce a legal scenario fails here rather than after generation.
 */
export function scheduleRiyaSyntheticScenarios(
  plan: RiyaSyntheticRunPlanV1,
): readonly RiyaAiSyntheticScenarioV1[] {
  const depthSpan = plan.maxAssistantTurns - plan.minAssistantTurns + 1;
  const scenarios: RiyaAiSyntheticScenarioV1[] = [];

  for (let index = 0; index < plan.scenarioCount; index += 1) {
    // The seed shifts the whole schedule without changing its shape, so two runs of the same plan
    // under different seeds explore different combinations rather than repeating one.
    const step = index + plan.seed;
    const ordinal = String(index).padStart(5, '0');

    const behaviorStart = axisIndex(
      step,
      RIYA_AI_SYNTHETIC_BEHAVIOR_CODES.length,
      PREFERRED_STRIDES.behavior,
    );
    const behaviors = [
      pick(RIYA_AI_SYNTHETIC_BEHAVIOR_CODES, behaviorStart),
      pick(RIYA_AI_SYNTHETIC_BEHAVIOR_CODES, behaviorStart + 1),
    ];
    const discoveryStart = axisIndex(
      step,
      RIYA_DATASET_DISCOVERY_FIELDS.length,
      PREFERRED_STRIDES.discovery,
    );
    const discovery = [
      pick(RIYA_DATASET_DISCOVERY_FIELDS, discoveryStart),
      pick(RIYA_DATASET_DISCOVERY_FIELDS, discoveryStart + 1),
    ];

    const events = [
      pick(RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS, step),
      'ASK_ONE_DISCOVERY_QUESTION' as const,
    ].filter((one, at, all) => all.indexOf(one) === at);

    // A scenario that requires the assistant to USE an authoritative fact must also plan a class for
    // that fact to belong to. AS1 refuses the pair apart, and it is right to: requiring the use of
    // authority while naming none is a plan whose only satisfying output is an invented price.
    const authorityClasses = events.includes('USE_AUTHORITATIVE_FACT')
      ? (['PROCESS'] as const)
      : ([] as const);

    scenarios.push(
      createRiyaAiSyntheticScenario({
        scenarioRef: `${plan.planRef}.scn.${ordinal}`,
        // One scenario, one lineage root. A family cannot straddle a split because no two scenarios
        // share a root; AS3 variants inherit the root and therefore the split.
        lineageRootRef: `${plan.planRef}.lin.${ordinal}`,
        split: index % plan.validationEveryNth === 0 ? 'VALIDATION' : 'TRAIN',
        languageMode: pick(
          plan.languageModes,
          axisIndex(step, plan.languageModes.length, PREFERRED_STRIDES.language),
        ),
        primaryInteractionKind: pick(
          plan.interactionKinds,
          axisIndex(step, plan.interactionKinds.length, PREFERRED_STRIDES.kind),
        ),
        secondaryInteractionKinds: [],
        persona: pick(
          plan.personas,
          axisIndex(step, plan.personas.length, PREFERRED_STRIDES.persona),
        ),
        difficulty: pick(
          plan.difficulties,
          axisIndex(step, plan.difficulties.length, PREFERRED_STRIDES.difficulty),
        ),
        riskClass: pick(
          plan.riskClasses,
          axisIndex(step, plan.riskClasses.length, PREFERRED_STRIDES.risk),
        ),
        startPhase: pick(
          plan.startPhases,
          axisIndex(step, plan.startPhases.length, PREFERRED_STRIDES.phase),
        ),
        targetAssistantTurns:
          plan.minAssistantTurns + axisIndex(step, depthSpan, PREFERRED_STRIDES.depth),
        plannedDiscoveryFields: [...new Set(discovery)],
        // Obviously synthetic values. A realistic-looking city or budget would be indistinguishable
        // from a real one in six months, and the privacy scanner cannot tell the difference either.
        plannedCustomerFacts: [
          { field: 'location', value: `city.alpha.${String(step % 7)}` },
          { field: 'scope', value: `scope.synthetic.${String(step % 5)}` },
        ],
        requiredAuthorityFactClasses: [...authorityClasses],
        requiredAssistantDecisions: ['ASK_DISCOVERY'],
        requiredResponseObjectives: ['DISCOVER'],
        customerBehaviorCodes: [...new Set(behaviors)],
        requiredConversationEvents: events,
        forbiddenBehaviors: [...RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS],
      }),
    );
  }

  return Object.freeze(scenarios);
}
