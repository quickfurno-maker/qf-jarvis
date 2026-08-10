/**
 * The pure per-dimension rate comparison (RWC-P10 owner correction on PR #111).
 *
 * ### Why this is a separate, internal function
 *
 * The rule is "any negative delta blocks preference", and the sharpest case for it is a ONE basis
 * point regression bought with a large improvement elsewhere. That case cannot be produced by a real
 * suite: pass rates are `floor(pass * 10000 / applicable)`, so the smallest step a corpus can express
 * is `10000 / N`, and `N` is capped at 1000 cases. Reaching 1 bp would need ten thousand cases judged
 * by two people each.
 *
 * Previously the public comparator was fed hand-built result objects to prove it, which is exactly
 * the hole the integrity gate now closes. So the arithmetic lives here, where it can be tested on
 * plain rate maps with no artifact to forge, and the public comparator is tested only on results the
 * evaluator genuinely produced.
 */
import { RIYA_QUALITY_DIMENSIONS } from '../contracts/vocabularies.js';
import type { RiyaQualityDimension } from '../contracts/vocabularies.js';
import type { RiyaQualityDimensionDelta } from '../contracts/results.js';

export type RiyaQualityRateMap = Readonly<Partial<Record<RiyaQualityDimension, number>>>;

export interface RiyaQualityRateComparison {
  /** Sorted by the canonical dimension order. Only dimensions BOTH sides measured. */
  readonly deltas: readonly RiyaQualityDimensionDelta[];
  /** Dimensions where the candidate is strictly worse, at ANY magnitude. */
  readonly candidateRegressed: readonly RiyaQualityDimension[];
  /** Dimensions where the candidate improved by at least the policy minimum. */
  readonly candidateImproved: readonly RiyaQualityDimension[];
  readonly baselineRegressed: readonly RiyaQualityDimension[];
  readonly baselineImproved: readonly RiyaQualityDimension[];
}

/**
 * Compare two rate maps under a minimum-improvement threshold.
 *
 * A dimension only ONE side measured is skipped rather than treated as zero. Treating an absent rate
 * as zero would manufacture a catastrophic regression out of a coverage difference, and the verdict
 * would then be about the corpus rather than about the candidate.
 */
export function compareRiyaQualityRates(
  baseline: RiyaQualityRateMap,
  candidate: RiyaQualityRateMap,
  minimumImprovementBps: number,
): RiyaQualityRateComparison {
  const deltas: RiyaQualityDimensionDelta[] = [];
  const candidateRegressed: RiyaQualityDimension[] = [];
  const candidateImproved: RiyaQualityDimension[] = [];
  const baselineRegressed: RiyaQualityDimension[] = [];
  const baselineImproved: RiyaQualityDimension[] = [];

  for (const dimension of RIYA_QUALITY_DIMENSIONS) {
    const baselineBps = baseline[dimension];
    const candidateBps = candidate[dimension];
    if (baselineBps === undefined || candidateBps === undefined) {
      continue;
    }
    const deltaBps = candidateBps - baselineBps;
    deltas.push(Object.freeze({ dimension, baselineBps, candidateBps, deltaBps }));

    // ANY negative delta. Not "a material one" -- the alternative is a tolerance, and a tolerance is
    // where "slightly pushier, much clearer" gets approved.
    if (deltaBps < 0) {
      candidateRegressed.push(dimension);
    }
    if (deltaBps > 0) {
      baselineRegressed.push(dimension);
    }
    if (deltaBps >= minimumImprovementBps) {
      candidateImproved.push(dimension);
    }
    if (-deltaBps >= minimumImprovementBps) {
      baselineImproved.push(dimension);
    }
  }

  return Object.freeze({
    deltas: Object.freeze(deltas),
    candidateRegressed: Object.freeze([...candidateRegressed].sort()),
    candidateImproved: Object.freeze([...candidateImproved].sort()),
    baselineRegressed: Object.freeze([...baselineRegressed].sort()),
    baselineImproved: Object.freeze([...baselineImproved].sort()),
  });
}
