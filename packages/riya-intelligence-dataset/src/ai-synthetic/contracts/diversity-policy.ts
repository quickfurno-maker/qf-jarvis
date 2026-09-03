/**
 * The anti-formula policy (AS1, ADR-0143 §12).
 *
 * ### Why this is a versioned policy rather than constants
 *
 * Nobody yet knows what the right opener-recurrence ceiling is. It depends on corpus size, on how
 * many lineages there are and on how the teacher actually behaves — none of which exists to measure.
 * Hard-coding a number now would either be wrong or, worse, would become the number everybody tunes
 * the generator to satisfy.
 *
 * So AS1 defines the METRIC, the FIELD and the COMPARISON, and AS3 supplies the values as data with
 * a version attached. A threshold that turns out to be wrong then becomes a policy bump with an
 * audit trail, not an edit to source that silently re-grades every past release.
 *
 * ### Basis points, not floats
 *
 * Every ratio is an integer 0–10000. `0.30000000000000004` deciding whether a corpus ships is not a
 * gate anybody can reason about, and two machines disagreeing about it is not a hypothetical.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { sha256OfCanonical } from '../../internal/sha256.js';
import { RIYA_AI_SYNTHETIC_BASIS_POINTS_MAX } from './vocabularies.js';

export interface RiyaAiSyntheticDiversityPolicyV1 {
  readonly version: 1;
  /** Floor: distinct conversation fingerprints as a share of all trajectories. */
  readonly minFingerprintUniquenessBp: number;
  /** Ceiling: the most common normalized opener, as a share of all trajectories. */
  readonly maxOpenerRecurrenceBp: number;
  readonly maxCloserRecurrenceBp: number;
  /** Ceiling: the most common asked-field sequence, as a share. */
  readonly maxQuestionSequenceRecurrenceBp: number;
  /** Ceiling: the most common phase-transition sequence, as a share. */
  readonly maxPhaseSequenceRecurrenceBp: number;
  /** Ceiling: how many trajectories may share one lineage root. */
  readonly maxVariantsPerLineage: number;
  /** Ceiling: same-lineage near-duplicate pairs, as a share of all trajectories. */
  readonly maxSameLineageNearDuplicateBp: number;
  /** Floor: how many of the depth bands must be populated. */
  readonly minDepthBandsCovered: number;
  /** Floor: distinct assistant decisions the corpus must exercise. */
  readonly minDecisionsCovered: number;
  /** Floor: distinct response objectives the corpus must exercise. */
  readonly minObjectivesCovered: number;
}

export type RiyaAiSyntheticDiversityPolicyInput = Omit<RiyaAiSyntheticDiversityPolicyV1, 'version'>;

const BP = z.int().min(0).max(RIYA_AI_SYNTHETIC_BASIS_POINTS_MAX);
const COUNT = z.int().min(0).max(1_000_000);

const diversitySchema = z
  .object({
    // Optional, so an already-constructed policy can be fed back through without being rejected for
    // carrying the field its own constructor added. Same accommodation the coverage policy makes.
    version: z.literal(1).optional(),
    minFingerprintUniquenessBp: BP,
    maxOpenerRecurrenceBp: BP,
    maxCloserRecurrenceBp: BP,
    maxQuestionSequenceRecurrenceBp: BP,
    maxPhaseSequenceRecurrenceBp: BP,
    maxVariantsPerLineage: z.int().min(1).max(1_000_000),
    maxSameLineageNearDuplicateBp: BP,
    minDepthBandsCovered: COUNT,
    minDecisionsCovered: COUNT,
    minObjectivesCovered: COUNT,
  })
  .strict();

/** Validate and freeze a diversity policy. Throws `invalid-ai-synthetic-policy`. */
export function createRiyaAiSyntheticDiversityPolicy(
  input: RiyaAiSyntheticDiversityPolicyInput,
): RiyaAiSyntheticDiversityPolicyV1 {
  const parsed = diversitySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-policy');
  }
  const { version: _supplied, ...fields } = parsed.data;
  return Object.freeze({ version: 1 as const, ...fields });
}

/** The content digest of a diversity policy. */
export function riyaAiSyntheticDiversityPolicySha256(
  policy: RiyaAiSyntheticDiversityPolicyV1,
): string {
  return sha256OfCanonical(policy);
}
