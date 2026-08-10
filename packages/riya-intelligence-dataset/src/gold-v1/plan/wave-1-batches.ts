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
 * ```
 * language = (kindIndex + batchIndex) mod 3      // 0 ENGLISH, 1 HINDI, 2 HINGLISH
 * ordinal  = 1 + ((kindIndex + batchIndex) mod 2)
 * ```
 *
 * For a fixed kind, six batches walk the three languages twice, so each language/kind pair lands in
 * exactly two batches — three apart. Adding three flips the parity, so those two occurrences receive
 * opposite ordinals automatically: every pair gets exactly one `01` and one `02`, and all 72 official
 * assignments appear exactly once. Proved rather than asserted, in the Wave-1 batch spec.
 *
 * ### Why the ordinal alternates by KIND rather than by batch
 *
 * The first schedule gave batches 1–3 every `01` and batches 4–6 every `02`. HGV1-A makes difficulty a
 * property of the ordinal — shape `01` is the gentler take of a cell, `02` the harder one — so the
 * calibration anchor contained `BASIC` and `STANDARD` only, and the first `HARD` or `EDGE` slot was
 * not written until batch 4. An anchor exists to surface systemic problems, and it cannot surface a
 * problem in work nobody has done yet.
 *
 * Alternating on `(kind + batch)` parity instead mixes both takes into every batch, so batch 1 carries
 * 3 BASIC, 3 STANDARD, 4 HARD and 2 EDGE. Every property above still holds.
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
      // A pair's two batches are three apart, and adding three flips this parity — so the pair gets
      // one ordinal 01 and one 02 without anything having to track which came first.
      const ordinal = 1 + ((kindIndex + batchIndex) % 2);
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
