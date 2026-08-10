/**
 * The canonical training record: a MULTI-TURN TRAJECTORY (RID-F1, ADR-0107 §8, §19).
 *
 * ### Why a trajectory rather than a reply
 *
 * The obvious record is `customer message → good reply`, and it is the wrong one. It teaches the
 * model what a good sentence looks like in isolation, which is exactly the skill that fails on the
 * fourth turn — when the right answer depends on what the customer already said, what the business
 * already supplied, and where the conversation is trying to get to.
 *
 * A trajectory carries all of that, so the training signal is a STRATEGY over a conversation rather
 * than a lookup. Model-specific rows are derived from it later; the trajectory stays the source, and
 * regenerating rows for a different model never means re-authoring the data.
 *
 * ### Lineage, which is the anti-leakage rule that actually matters
 *
 * `lineageRootRef` groups an original example with every synthetic variant of it. Splits are
 * partitioned by lineage, not by row, so a teacher-generated paraphrase can never land in VALIDATION
 * while its parent sits in TRAIN. Without it a corpus can look perfectly split and be measuring
 * memorisation — the validation score rises, nobody can see why, and the model is worse.
 */
import { z } from 'zod';

import { RiyaDatasetError } from './errors.js';
import { createRiyaTrainingReview } from './review.js';
import type { RiyaTrainingReviewV1 } from './review.js';
import type { RiyaTrainingStateV1 } from './training-state.js';
import type { RiyaDatasetTurnV1 } from './turns.js';
import {
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_RISK_CLASSES,
  RIYA_DATASET_SOURCE_KINDS,
  RIYA_DATASET_SPLITS,
} from './vocabularies.js';
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
  RiyaDatasetSourceKind,
  RiyaDatasetSplit,
} from './vocabularies.js';

/** A conversation is at most this long. Beyond it, an example is a transcript, not a lesson. */
export const RIYA_DATASET_MAX_TURNS = 64;
export const RIYA_DATASET_MAX_ASSISTANT_TURNS = 32;

/** Where an example came from. `synthetic` is a literal `true`: nothing else is representable. */
export interface RiyaDatasetSourceV1 {
  readonly kind: RiyaDatasetSourceKind;
  /** Who or what produced it. Opaque — an author handle, never a name or an email. */
  readonly sourceRef: string;
  readonly synthetic: true;
  /** Which teacher configuration generated a variant. Absent for human-authored examples. */
  readonly teacherRef?: string;
}

export interface RiyaIntelligenceTrajectoryV1 {
  readonly version: 1;
  readonly trajectoryId: string;
  readonly trajectoryRevision: number;
  /** The family this example and all its variants belong to. Splits partition on THIS. */
  readonly lineageRootRef: string;
  readonly parentTrajectoryRef?: string;
  readonly split: RiyaDatasetSplit;
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly primaryInteractionKind: RiyaDatasetInteractionKind;
  readonly secondaryInteractionKinds: readonly RiyaDatasetInteractionKind[];
  readonly persona: RiyaDatasetPersona;
  readonly difficulty: RiyaDatasetDifficulty;
  readonly riskClass: RiyaDatasetRiskClass;
  readonly source: RiyaDatasetSourceV1;
  readonly initialState: RiyaTrainingStateV1;
  readonly turns: readonly RiyaDatasetTurnV1[];
  readonly review: readonly RiyaTrainingReviewV1[];
}

export type RiyaIntelligenceTrajectoryInput = RiyaIntelligenceTrajectoryV1;

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const trajectorySchema = z
  .object({
    version: z.literal(1),
    trajectoryId: REF,
    trajectoryRevision: z.int().min(1).max(1_000_000),
    lineageRootRef: REF,
    parentTrajectoryRef: REF.optional(),
    split: z.enum(RIYA_DATASET_SPLITS),
    languageMode: z.enum(RIYA_DATASET_LANGUAGE_MODES),
    primaryInteractionKind: z.enum(RIYA_DATASET_INTERACTION_KINDS),
    secondaryInteractionKinds: z
      .array(z.enum(RIYA_DATASET_INTERACTION_KINDS))
      .max(RIYA_DATASET_INTERACTION_KINDS.length),
    persona: z.enum(RIYA_DATASET_PERSONAS),
    difficulty: z.enum(RIYA_DATASET_DIFFICULTIES),
    riskClass: z.enum(RIYA_DATASET_RISK_CLASSES),
    source: z
      .object({
        kind: z.enum(RIYA_DATASET_SOURCE_KINDS),
        sourceRef: REF,
        // A LITERAL. There is no way to declare a non-synthetic source, which is what makes
        // "synthetic only" a property of the contract rather than a rule somebody must remember.
        synthetic: z.literal(true),
        teacherRef: REF.optional(),
      })
      .strict(),
    // Both re-proved by their own constructors below; a second schema here would drift from them.
    initialState: z.unknown(),
    turns: z.array(z.unknown()).min(1).max(RIYA_DATASET_MAX_TURNS),
    review: z.array(z.unknown()).max(8),
  })
  .strict();

const isTurn = (value: unknown): value is RiyaDatasetTurnV1 =>
  value !== null && typeof value === 'object' && 'type' in value;

/**
 * Validate and freeze a trajectory. Throws `invalid-trajectory`.
 *
 * The ordering rules below are not tidiness. **Context must precede its use**, because a training
 * example where the assistant cites a fact supplied later teaches the model that facts are available
 * whenever convenient — which in production means asserting a price nobody gave it. **No two
 * assistant turns in a row**, because a conversation the customer never got to answer is not a
 * conversation. And a trajectory must contain at least one of each speaking role, or there is
 * nothing to learn from.
 */
export function createRiyaIntelligenceTrajectory(
  input: RiyaIntelligenceTrajectoryInput,
): RiyaIntelligenceTrajectoryV1 {
  const parsed = trajectorySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  if (parsed.data.secondaryInteractionKinds.includes(parsed.data.primaryInteractionKind)) {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  const secondary = parsed.data.secondaryInteractionKinds;
  if (new Set(secondary).size !== secondary.length) {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  // A human-authored example has no teacher, and a teacher-generated one must name the configuration
  // that produced it -- otherwise a bad generator cannot be traced to the rows it made.
  if (
    (parsed.data.source.kind === 'TEACHER_GENERATED_SYNTHETIC') !==
    (parsed.data.source.teacherRef !== undefined)
  ) {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  if (parsed.data.parentTrajectoryRef === parsed.data.trajectoryId) {
    throw new RiyaDatasetError('invalid-trajectory');
  }

  const turns = input.turns;
  if (!turns.every(isTurn)) {
    throw new RiyaDatasetError('invalid-trajectory');
  }

  const turnRefs = turns.map((turn) => turn.turnRef);
  if (new Set(turnRefs).size !== turnRefs.length) {
    throw new RiyaDatasetError('invalid-trajectory');
  }

  const speaking = turns.filter((turn) => turn.type !== 'AUTHORITATIVE_CONTEXT');
  const firstSpeaking = speaking[0];
  // Pre-existing context may open a trajectory -- "the business already told Riya X" is a real
  // starting condition -- but the first thing SAID must be the customer. An assistant opening
  // unprompted is a broadcast, not a conversation.
  if (firstSpeaking?.type !== 'USER') {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  const assistantTurns = turns.filter((turn) => turn.type === 'ASSISTANT');
  if (assistantTurns.length === 0 || assistantTurns.length > RIYA_DATASET_MAX_ASSISTANT_TURNS) {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  for (let index = 1; index < speaking.length; index += 1) {
    if (speaking[index]?.type === 'ASSISTANT' && speaking[index - 1]?.type === 'ASSISTANT') {
      throw new RiyaDatasetError('invalid-trajectory');
    }
  }

  // Context precedes use. Walking forward and collecting facts as they appear means a citation can
  // only ever resolve to something already supplied.
  const availableFacts = new Set<string>();
  for (const turn of turns) {
    if (turn.type === 'AUTHORITATIVE_CONTEXT') {
      for (const fact of turn.facts) {
        if (availableFacts.has(fact.factRef)) {
          throw new RiyaDatasetError('invalid-trajectory');
        }
        availableFacts.add(fact.factRef);
      }
      continue;
    }
    if (turn.type === 'ASSISTANT') {
      for (const ref of turn.annotation.supportedFactRefs) {
        if (!availableFacts.has(ref)) {
          // A fact cited before it exists, or one that never exists at all.
          throw new RiyaDatasetError('unsupported-business-fact');
        }
      }
    }
  }

  const reviews = input.review.map((review) => createRiyaTrainingReview(review));
  const reviewRefs = reviews.map((review) => review.reviewRef);
  if (new Set(reviewRefs).size !== reviewRefs.length) {
    throw new RiyaDatasetError('invalid-review');
  }

  return Object.freeze({
    version: 1 as const,
    trajectoryId: parsed.data.trajectoryId,
    trajectoryRevision: parsed.data.trajectoryRevision,
    lineageRootRef: parsed.data.lineageRootRef,
    ...(parsed.data.parentTrajectoryRef === undefined
      ? {}
      : { parentTrajectoryRef: parsed.data.parentTrajectoryRef }),
    split: parsed.data.split,
    languageMode: parsed.data.languageMode,
    primaryInteractionKind: parsed.data.primaryInteractionKind,
    secondaryInteractionKinds: Object.freeze([...secondary].sort()),
    persona: parsed.data.persona,
    difficulty: parsed.data.difficulty,
    riskClass: parsed.data.riskClass,
    source: Object.freeze({
      kind: parsed.data.source.kind,
      sourceRef: parsed.data.source.sourceRef,
      synthetic: true as const,
      ...(parsed.data.source.teacherRef === undefined
        ? {}
        : { teacherRef: parsed.data.source.teacherRef }),
    }),
    initialState: input.initialState,
    turns: Object.freeze([...turns]),
    // Sorted by ref, so a trajectory's bytes do not depend on which reviewer submitted first.
    review: Object.freeze(
      [...reviews].sort((a, b) =>
        a.reviewRef < b.reviewRef ? -1 : a.reviewRef > b.reviewRef ? 1 : 0,
      ),
    ),
  });
}

/** Every assistant turn, in order. */
export function assistantTurnsOf(trajectory: RiyaIntelligenceTrajectoryV1) {
  return trajectory.turns.filter((turn) => turn.type === 'ASSISTANT');
}
