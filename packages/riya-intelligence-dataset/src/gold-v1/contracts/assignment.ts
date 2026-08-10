/**
 * One Human Gold V1 slot (HGV1-A, ADR-0108).
 *
 * ### An assignment is a SLOT, not a conversation
 *
 * It says which wave, which language, which interaction, who the customer is, how hard it should be,
 * how deep it should go, which phase it starts in, which authority classes it will need and which
 * shortcuts are forbidden. It carries no dialogue and no field a sentence could live in.
 *
 * All 360 exist before a single word is written. That is the point: partitioning the corpus first is
 * what makes every wave independently balanced, and it means a defect in the plan is caught while it
 * is still a table rather than after somebody has written three hundred conversations against it.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import {
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_FACT_CLASSES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_RISK_CLASSES,
  RIYA_DATASET_SPLITS,
} from '../../contracts/vocabularies.js';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetFactClass,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
  RiyaDatasetSplit,
} from '../../contracts/vocabularies.js';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import {
  RIYA_GOLD_FORBIDDEN_PATTERNS,
  RIYA_GOLD_MAX_ASSISTANT_TURNS,
  RIYA_GOLD_MIN_ASSISTANT_TURNS,
  RIYA_GOLD_ORDINALS,
  RIYA_GOLD_WAVES,
} from './vocabularies.js';
import type { RiyaGoldForbiddenPattern, RiyaGoldOrdinal, RiyaGoldWave } from './vocabularies.js';

export interface RiyaGoldV1AssignmentV1 {
  readonly version: 1;
  readonly assignmentId: string;
  readonly wave: RiyaGoldWave;
  readonly ordinalWithinPair: RiyaGoldOrdinal;
  readonly split: RiyaDatasetSplit;
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly primaryInteractionKind: RiyaDatasetInteractionKind;
  readonly requiredSecondaryKinds: readonly RiyaDatasetInteractionKind[];
  readonly persona: RiyaDatasetPersona;
  readonly difficulty: RiyaDatasetDifficulty;
  readonly riskClass: RiyaDatasetRiskClass;
  readonly startPhase: RiyaConversationPhase;
  /** The intended depth. A finished trajectory may deviate by one, and the validator reports it. */
  readonly targetAssistantTurns: number;
  readonly authoringBriefRef: string;
  /** Which classes of mutable business fact this scenario will need supplied as context. */
  readonly requiredAuthorityFactClasses: readonly RiyaDatasetFactClass[];
  readonly forbiddenPatterns: readonly RiyaGoldForbiddenPattern[];
}

export type RiyaGoldV1AssignmentInput = RiyaGoldV1AssignmentV1;

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const assignmentSchema = z
  .object({
    version: z.literal(1),
    assignmentId: REF,
    wave: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    ordinalWithinPair: z.union([z.literal(1), z.literal(2)]),
    split: z.enum(RIYA_DATASET_SPLITS),
    languageMode: z.enum(RIYA_DATASET_LANGUAGE_MODES),
    primaryInteractionKind: z.enum(RIYA_DATASET_INTERACTION_KINDS),
    requiredSecondaryKinds: z
      .array(z.enum(RIYA_DATASET_INTERACTION_KINDS))
      .max(RIYA_DATASET_INTERACTION_KINDS.length),
    persona: z.enum(RIYA_DATASET_PERSONAS),
    difficulty: z.enum(RIYA_DATASET_DIFFICULTIES),
    riskClass: z.enum(RIYA_DATASET_RISK_CLASSES),
    startPhase: z.enum(RIYA_CONVERSATION_PHASES),
    targetAssistantTurns: z
      .int()
      .min(RIYA_GOLD_MIN_ASSISTANT_TURNS)
      .max(RIYA_GOLD_MAX_ASSISTANT_TURNS),
    authoringBriefRef: REF,
    requiredAuthorityFactClasses: z
      .array(z.enum(RIYA_DATASET_FACT_CLASSES))
      .max(RIYA_DATASET_FACT_CLASSES.length),
    forbiddenPatterns: z
      .array(z.enum(RIYA_GOLD_FORBIDDEN_PATTERNS))
      .min(1)
      .max(RIYA_GOLD_FORBIDDEN_PATTERNS.length),
  })
  .strict();

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

/** Validate and freeze one Gold assignment. Throws `invalid-gold-assignment`. */
export function createRiyaGoldV1Assignment(
  input: RiyaGoldV1AssignmentInput,
): RiyaGoldV1AssignmentV1 {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-gold-assignment');
  }
  if (
    parsed.data.requiredSecondaryKinds.includes(parsed.data.primaryInteractionKind) ||
    hasDuplicates(parsed.data.requiredSecondaryKinds) ||
    hasDuplicates(parsed.data.requiredAuthorityFactClasses) ||
    hasDuplicates(parsed.data.forbiddenPatterns)
  ) {
    throw new RiyaDatasetError('invalid-gold-assignment');
  }
  // Every wave has one split, and it is not a choice an assignment gets to make.
  if (parsed.data.split !== (parsed.data.wave <= 4 ? 'TRAIN' : 'VALIDATION')) {
    throw new RiyaDatasetError('invalid-gold-assignment');
  }

  return Object.freeze({
    version: 1 as const,
    assignmentId: parsed.data.assignmentId,
    wave: parsed.data.wave,
    ordinalWithinPair: parsed.data.ordinalWithinPair,
    split: parsed.data.split,
    languageMode: parsed.data.languageMode,
    primaryInteractionKind: parsed.data.primaryInteractionKind,
    requiredSecondaryKinds: Object.freeze([...parsed.data.requiredSecondaryKinds].sort()),
    persona: parsed.data.persona,
    difficulty: parsed.data.difficulty,
    riskClass: parsed.data.riskClass,
    startPhase: parsed.data.startPhase,
    targetAssistantTurns: parsed.data.targetAssistantTurns,
    authoringBriefRef: parsed.data.authoringBriefRef,
    requiredAuthorityFactClasses: Object.freeze(
      [...parsed.data.requiredAuthorityFactClasses].sort(),
    ),
    forbiddenPatterns: Object.freeze([...parsed.data.forbiddenPatterns].sort()),
  });
}

/** The wave/language/kind cell an assignment belongs to. Exactly two assignments share one. */
export function goldPairKey(assignment: RiyaGoldV1AssignmentV1): string {
  return `${String(assignment.wave)}|${assignment.languageMode}|${assignment.primaryInteractionKind}`;
}

export { RIYA_GOLD_WAVES, RIYA_GOLD_ORDINALS };
