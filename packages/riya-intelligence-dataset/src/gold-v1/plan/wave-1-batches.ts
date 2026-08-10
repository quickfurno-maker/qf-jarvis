/**
 * The Wave-1 authoring schedule: six micro-batches of twelve (HGV1-B).
 *
 * ### Operational only
 *
 * This does not plan anything. `generateRiyaGoldV1Plan` owns the 360 slots and HGV1-A froze them;
 * this file decides only the ORDER humans write Wave 1 in. Every assignment it hands out comes
 * straight from the plan, field for field, and nothing here edits one.
 *
 * ### Why batches at all
 *
 * Writing 72 conversations and then discovering that all of them share one rhythm is the failure the
 * whole Gold design is arranged against — and a wave is small enough to commit it in. So the first
 * twelve are a CALIBRATION ANCHOR: written, reviewed and read end to end before anybody starts the
 * other sixty. If there is a systemic style problem, it costs twelve conversations to find.
 *
 * ### Why each batch is a complete cross-section
 *
 * Every micro-batch carries all twelve interaction kinds and four of each language. An anchor set of
 * twelve easy English discovery cases would teach us nothing about Hindi objections, which is exactly
 * where the problems live — so the anchor is a miniature of the wave, not a corner of it.
 *
 * ### The rotation
 *
 * `language = (kindIndex + batchIndex) mod 3`. For a fixed kind, six batches walk the three languages
 * twice, so each language/kind pair lands in exactly two batches; the earlier one takes ordinal `01`
 * and the later `02`. Across the six, all 72 official assignments appear exactly once. That is proved
 * rather than asserted — see the Wave-1 batch spec.
 *
 * Content-free. No dialogue, no brief prose, no P10 anything.
 */
import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
} from '../../contracts/vocabularies.js';
import type { RiyaDatasetLanguageMode } from '../../contracts/vocabularies.js';
import { RiyaDatasetError } from '../../contracts/errors.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';
import { riyaGoldV1WaveAssignments } from './generate-plan.js';

/** Six batches of twelve. Not a vocabulary — a working shape. */
export const RIYA_GOLD_WAVE_1_BATCHES = [1, 2, 3, 4, 5, 6] as const;
export type RiyaGoldWave1Batch = (typeof RIYA_GOLD_WAVE_1_BATCHES)[number];

export const RIYA_GOLD_WAVE_1_BATCH_SIZE = 12;

/** The batch written, reviewed and read end to end before any other batch begins. */
export const RIYA_GOLD_WAVE_1_ANCHOR_BATCH: RiyaGoldWave1Batch = 1;

/** The language a kind takes in a batch. Indexed access narrowed once. */
function languageFor(kindIndex: number, batchIndex: number): RiyaDatasetLanguageMode {
  const bucket = (kindIndex + batchIndex) % RIYA_DATASET_LANGUAGE_MODES.length;
  const language = RIYA_DATASET_LANGUAGE_MODES[bucket];
  if (language === undefined) {
    throw new RiyaDatasetError('invalid-gold-plan');
  }
  return language;
}

/**
 * The assignments of one micro-batch, in canonical interaction-kind order.
 *
 * Throws `invalid-gold-plan` if the frozen Wave-1 plan does not contain a slot this schedule asks
 * for — which would mean the plan had changed underneath, and is worth stopping for rather than
 * quietly handing an author eleven assignments.
 */
export function riyaGoldWave1BatchAssignments(
  batch: RiyaGoldWave1Batch,
): readonly RiyaGoldV1AssignmentV1[] {
  const wave1 = riyaGoldV1WaveAssignments(1);
  const batchIndex = batch - 1;

  return Object.freeze(
    RIYA_DATASET_INTERACTION_KINDS.map((kind, kindIndex) => {
      const languageMode = languageFor(kindIndex, batchIndex);
      // The pair's two batches are `b` and `b + 3`; whichever comes first takes ordinal 1.
      const ordinal = batchIndex < RIYA_DATASET_LANGUAGE_MODES.length ? 1 : 2;
      const assignment = wave1.find(
        (one) =>
          one.primaryInteractionKind === kind &&
          one.languageMode === languageMode &&
          one.ordinalWithinPair === ordinal,
      );
      if (assignment === undefined) {
        throw new RiyaDatasetError('invalid-gold-plan');
      }
      return assignment;
    }),
  );
}

/** Every micro-batch, in order. The whole of Wave 1, partitioned. */
export function riyaGoldWave1Schedule(): readonly (readonly RiyaGoldV1AssignmentV1[])[] {
  return Object.freeze(
    RIYA_GOLD_WAVE_1_BATCHES.map((batch) => riyaGoldWave1BatchAssignments(batch)),
  );
}

/** Which batch a slot belongs to. For a progress board that wants to report by batch. */
export function riyaGoldWave1BatchOf(assignmentId: string): RiyaGoldWave1Batch | undefined {
  for (const batch of RIYA_GOLD_WAVE_1_BATCHES) {
    if (riyaGoldWave1BatchAssignments(batch).some((one) => one.assignmentId === assignmentId)) {
      return batch;
    }
  }
  return undefined;
}
