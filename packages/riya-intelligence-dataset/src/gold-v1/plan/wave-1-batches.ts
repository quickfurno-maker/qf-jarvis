/**
 * The Wave-1 micro-batch schedule — operational ORDER, not a second planning authority (HGV1-B).
 *
 * ### What this is, and what it deliberately is not
 *
 * Seventy-two assignments handed to a team as one list is not a plan, it is a pile. This module
 * partitions Wave 1 into **six batches of twelve** so authoring can start, be reviewed, and be
 * calibrated before the remaining five batches are written.
 *
 * It changes **nothing** about the assignments. Every entry is the official record from
 * {@link riyaGoldV1WaveAssignments}, frozen and field-for-field identical — no clone with an adjusted
 * field, no schedule-only property bolted on. (The plan builds fresh objects per call, so identity
 * across two calls is structural rather than referential; what matters is that nothing here edits
 * one.) If the scheduler could edit an assignment it would become a second, quieter planning
 * authority, and the plan the reviewers checked would stop being the plan the authors write against.
 *
 * ### The rotation, and why it is a formula rather than a list
 *
 * For batch index `b` (0-based) and interaction-kind index `k`:
 *
 * ```
 * language = LANGUAGES[(k + b) % 3]
 * ordinal  = 1 + ((k + b) % 2)
 * ```
 *
 * A hand-maintained list of 72 ids would drift the first time the plan changed, and nobody would
 * notice until an author opened a batch that no longer matched. The formula cannot drift: it is
 * re-derived from the current plan every call.
 *
 * It also partitions Wave 1 **exactly**, which is not a coincidence. As `b` runs 0…5, `(k + b)`
 * covers all six residues mod 6, and mod 6 splits uniquely into (mod 3, mod 2) — so each kind visits
 * all 3 × 2 = 6 language/ordinal combinations exactly once. Twelve kinds × six batches = 72, with no
 * slot repeated and none missed.
 *
 * Two useful properties fall out of the same arithmetic. Within a batch, `(k + b) % 3` cycles every
 * three kinds, so each of the twelve batches carries **four assignments per language**. And the two
 * ordinals of any one language/kind pair land **exactly three batches apart** — `b` and `b + 3` are
 * the only batches where `(k + b) % 3` hits that language, and because 3 is odd their ordinals differ.
 * A pair is therefore never written back-to-back by the same person on the same afternoon.
 *
 * ### Batch 1 is the calibration anchor
 *
 * The ordinal alternates with `k + b` rather than being blocked by ordinal, so Batch 1 is not twelve
 * easy first-ordinals. It draws six ordinal-1 and six ordinal-2 slots, which is what makes it worth
 * calibrating against: the reviewers see the hard cases immediately rather than in Batch 4.
 *
 * **Batch 1 must be authored, independently reviewed and read end to end before batches 2–6 begin.**
 * That sequencing is a governance rule, not something this module can enforce — it holds no state and
 * tracks no progress.
 *
 * ### Containment
 *
 * Not exported from the package root or from the `gold-v1` barrel. This is an internal authoring
 * operation, not a public contract, and it carries no dialogue: it moves assignment objects around
 * and never touches a brief, a scenario, a goal or a turn.
 */
import { RiyaDatasetError } from '../../contracts/errors.js';
import {
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
} from '../../contracts/vocabularies.js';
import type { RiyaGoldOrdinal } from '../contracts/vocabularies.js';
import type { RiyaGoldV1AssignmentV1 } from '../contracts/assignment.js';

import { goldAssignmentId, riyaGoldV1WaveAssignments } from './generate-plan.js';

/** The six micro-batches, in authoring order. */
export const RIYA_GOLD_WAVE_1_BATCHES = [1, 2, 3, 4, 5, 6] as const;
export type RiyaGoldWave1Batch = (typeof RIYA_GOLD_WAVE_1_BATCHES)[number];

/** Twelve assignments per batch — one per interaction kind, by construction. */
export const RIYA_GOLD_WAVE_1_BATCH_SIZE = 12;

/**
 * The batch everything else waits on.
 *
 * Not merely "the first". Batch 1 exists to calibrate reviewers against real authored work, so the
 * remaining batches are deliberately blocked until it has been read end to end.
 */
export const RIYA_GOLD_WAVE_1_ANCHOR_BATCH: RiyaGoldWave1Batch = 1;

/**
 * The assignments of one micro-batch, in kind order.
 *
 * Returns the OFFICIAL assignment objects. A caller that mutates one is mutating the plan, which is
 * why the plan freezes them.
 */
export function riyaGoldWave1BatchAssignments(
  batch: RiyaGoldWave1Batch,
): readonly RiyaGoldV1AssignmentV1[] {
  const wave1 = riyaGoldV1WaveAssignments(1);
  const byId = new Map(wave1.map((assignment) => [assignment.assignmentId, assignment]));
  const batchIndex = batch - 1;

  const scheduled = RIYA_DATASET_INTERACTION_KINDS.map((kind, kindIndex) => {
    const rotation = kindIndex + batchIndex;
    const languageMode = RIYA_DATASET_LANGUAGE_MODES[rotation % RIYA_DATASET_LANGUAGE_MODES.length];
    const ordinal = (1 + (rotation % 2)) as RiyaGoldOrdinal;

    if (languageMode === undefined) {
      // Unreachable while the language vocabulary is non-empty, and cheaper to state than to debug.
      throw new RiyaDatasetError('invalid-gold-plan');
    }

    const assignmentId = goldAssignmentId(1, languageMode, kind, ordinal);
    const assignment = byId.get(assignmentId);
    if (assignment === undefined) {
      // The schedule asked for a slot the plan does not contain. That means the rotation and the plan
      // have diverged, and inventing an assignment here would hide it behind a batch that looks full.
      throw new RiyaDatasetError('invalid-gold-plan');
    }

    return assignment;
  });

  return Object.freeze(scheduled);
}

/** All six batches, in order. Deterministic: same plan, same schedule, every time. */
export function riyaGoldWave1Schedule(): readonly (readonly RiyaGoldV1AssignmentV1[])[] {
  return Object.freeze(
    RIYA_GOLD_WAVE_1_BATCHES.map((batch) => riyaGoldWave1BatchAssignments(batch)),
  );
}

/**
 * Which batch an assignment belongs to, or `undefined`.
 *
 * `undefined` rather than a throw: asking "is this scheduled?" about a wave-3 slot is a fair question
 * with a fair answer, and only Wave 1 is scheduled.
 */
export function riyaGoldWave1BatchOf(assignmentId: string): RiyaGoldWave1Batch | undefined {
  for (const batch of RIYA_GOLD_WAVE_1_BATCHES) {
    const found = riyaGoldWave1BatchAssignments(batch).some(
      (assignment) => assignment.assignmentId === assignmentId,
    );
    if (found) return batch;
  }
  return undefined;
}
