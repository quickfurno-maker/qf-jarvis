/**
 * Deterministic anti-formula metrics (AS1, ADR-0143 §12).
 *
 * ### Deterministic, and that is a constraint not a preference
 *
 * No embedding, no model, no probabilistic similarity. A corpus that passes on Tuesday and fails on
 * Thursday is not gated, and an embedding would also make this package invoke a model — the one
 * thing RID-F1 has never done and the containment suite actively proves it does not.
 *
 * Everything below is token overlap, exact normalized equality and counting. It reuses the same
 * normalization and near-match primitives the cross-split duplicate firewall already uses, rather
 * than growing a second notion of "nearly the same".
 *
 * ### Why this lane caps what the human lane only reported
 *
 * ADR-0108 §16 measured formula degeneration and left the blocking to human calibration. There is no
 * human here, and volume is cheap: one prompt shapes every row, so the failure this measures is not
 * a risk on the AI lane, it is the default outcome. Hence caps.
 *
 * Short acknowledgements are excluded from the opener and closer counts, matching the human lane's
 * convention. "Sure." recurring is normal writing, and a metric that flagged it would be ignored
 * within a week.
 */
import {
  jaccard,
  ngrams,
  normalizeForComparison,
  normalizedTokens,
  tokenize,
} from '../../internal/normalization.js';
import {
  CROSS_SPLIT_NEAR_MIN_COMMON_RUN_TOKENS,
  CROSS_SPLIT_NEAR_MIN_JACCARD,
} from '../../service/validate-dataset.js';
import { longestCommonRun } from '../../internal/normalization.js';
import { trajectoryConversationFingerprint } from '../../internal/trajectory-digest.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../../contracts/trajectory.js';
import type { RiyaAiSyntheticDiversityMetricsV1 } from '../contracts/report.js';
import { RIYA_AI_SYNTHETIC_BASIS_POINTS_MAX } from '../contracts/vocabularies.js';

/** Below this many tokens a reply is an acknowledgement, not a formula. */
export const RIYA_AI_SYNTHETIC_MIN_TOKENS_FOR_EDGE_METRIC = 6;
/** How many tokens make an opener or a closer. */
export const RIYA_AI_SYNTHETIC_EDGE_TOKENS = 5;
/** N-gram size for the same-lineage near-duplicate comparison. Matches the cross-split firewall. */
const NEAR_NGRAM_SIZE = 5;

/**
 * Depth bands over the lane's 4–12 range.
 *
 * Bands rather than exact counts because "the corpus contains a 7-turn conversation" is not the
 * property worth gating — "the corpus is not all 6-turn conversations" is.
 */
export const RIYA_AI_SYNTHETIC_DEPTH_BANDS: readonly (readonly [number, number])[] = Object.freeze([
  [4, 5],
  [6, 7],
  [8, 9],
  [10, 12],
]);

const assistantTurnsOf = (trajectory: RiyaIntelligenceTrajectoryV1) =>
  trajectory.turns.filter((turn) => turn.type === 'ASSISTANT');

/** Basis points, rounded down. An empty corpus scores zero rather than dividing by zero. */
const basisPoints = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.floor((part * RIYA_AI_SYNTHETIC_BASIS_POINTS_MAX) / whole);

/** The most common value's count, or 0 when nothing qualified. */
const topCount = (values: readonly string[]): number => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let top = 0;
  for (const count of counts.values()) if (count > top) top = count;
  return top;
};

/** The opener of a trajectory: the first assistant reply long enough to have a style. */
function openerOf(trajectory: RiyaIntelligenceTrajectoryV1): string | undefined {
  for (const turn of assistantTurnsOf(trajectory)) {
    const tokens = tokenize(normalizeForComparison(turn.text));
    if (tokens.length >= RIYA_AI_SYNTHETIC_MIN_TOKENS_FOR_EDGE_METRIC) {
      return tokens.slice(0, RIYA_AI_SYNTHETIC_EDGE_TOKENS).join(' ');
    }
  }
  return undefined;
}

/** The closer: the LAST assistant reply long enough to have a style, by its final tokens. */
function closerOf(trajectory: RiyaIntelligenceTrajectoryV1): string | undefined {
  const replies = [...assistantTurnsOf(trajectory)].reverse();
  for (const turn of replies) {
    const tokens = tokenize(normalizeForComparison(turn.text));
    if (tokens.length >= RIYA_AI_SYNTHETIC_MIN_TOKENS_FOR_EDGE_METRIC) {
      return tokens.slice(-RIYA_AI_SYNTHETIC_EDGE_TOKENS).join(' ');
    }
  }
  return undefined;
}

/**
 * The question sequence: which discovery fields were asked, in order.
 *
 * Structural, from `askedDiscoveryFields` — never inferred from the prose. Two corpora asking the
 * same four things in the same order are running one script, whatever words they use.
 */
function questionSequenceOf(trajectory: RiyaIntelligenceTrajectoryV1): string {
  return assistantTurnsOf(trajectory)
    .map((turn) => turn.annotation.askedDiscoveryFields.join('+'))
    .join('>');
}

/** The phase-transition sequence, from `expectedPhaseAfter`. */
function phaseSequenceOf(trajectory: RiyaIntelligenceTrajectoryV1): string {
  return assistantTurnsOf(trajectory)
    .map((turn) => turn.annotation.expectedPhaseAfter ?? '-')
    .join('>');
}

/** The spoken conversation as one normalized token list, for near-duplicate comparison. */
function spokenTokensOf(trajectory: RiyaIntelligenceTrajectoryV1): readonly string[] {
  const spoken = trajectory.turns
    .filter((turn) => turn.type === 'USER' || turn.type === 'ASSISTANT')
    .map((turn) => turn.text)
    .join(' ');
  return normalizedTokens(spoken);
}

/** Are two conversations near-duplicates, by the same rule the cross-split firewall applies? */
function nearDuplicate(left: readonly string[], right: readonly string[]): boolean {
  if (longestCommonRun(left, right) >= CROSS_SPLIT_NEAR_MIN_COMMON_RUN_TOKENS) {
    return true;
  }
  const leftGrams = new Set(ngrams(left, NEAR_NGRAM_SIZE));
  const rightGrams = new Set(ngrams(right, NEAR_NGRAM_SIZE));
  return jaccard(leftGrams, rightGrams) >= CROSS_SPLIT_NEAR_MIN_JACCARD;
}

/**
 * Compute the corpus's diversity metrics. Pure, deterministic, content-free.
 *
 * Every field is a count or a basis-point ratio. Nothing here returns a phrase — the human lane's
 * equivalent reports its top repeated phrasings, which is useful when a person is reading them and
 * would be generated text sitting in a release artifact here.
 */
export function riyaAiSyntheticDiversityMetrics(
  trajectories: readonly RiyaIntelligenceTrajectoryV1[],
): RiyaAiSyntheticDiversityMetricsV1 {
  const total = trajectories.length;

  const fingerprints = trajectories.map((one) => trajectoryConversationFingerprint(one));
  const distinctFingerprints = new Set(fingerprints).size;

  const openers = trajectories
    .map((one) => openerOf(one))
    .filter((one): one is string => one !== undefined);
  const closers = trajectories
    .map((one) => closerOf(one))
    .filter((one): one is string => one !== undefined);

  const lineages = new Map<string, RiyaIntelligenceTrajectoryV1[]>();
  for (const trajectory of trajectories) {
    const bucket = lineages.get(trajectory.lineageRootRef) ?? [];
    bucket.push(trajectory);
    lineages.set(trajectory.lineageRootRef, bucket);
  }
  let maxVariants = 0;
  for (const bucket of lineages.values()) {
    if (bucket.length > maxVariants) maxVariants = bucket.length;
  }

  // Same-lineage near duplicates. Counted as trajectories involved in at least one such pair, not as
  // pairs -- a lineage of five identical rows should read as five, not as ten.
  const redundant = new Set<string>();
  for (const bucket of lineages.values()) {
    if (bucket.length < 2) continue;
    const tokens = bucket.map((one) => spokenTokensOf(one));
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (nearDuplicate(tokens[i] ?? [], tokens[j] ?? [])) {
          redundant.add(bucket[i]?.trajectoryId ?? '');
          redundant.add(bucket[j]?.trajectoryId ?? '');
        }
      }
    }
  }

  const depths = trajectories.map((one) => assistantTurnsOf(one).length);
  const depthBandsCovered = RIYA_AI_SYNTHETIC_DEPTH_BANDS.filter(([low, high]) =>
    depths.some((depth) => depth >= low && depth <= high),
  ).length;

  const decisions = new Set<string>();
  const objectives = new Set<string>();
  for (const trajectory of trajectories) {
    for (const turn of assistantTurnsOf(trajectory)) {
      decisions.add(turn.annotation.decision);
      objectives.add(turn.annotation.responseObjective);
    }
  }

  return Object.freeze({
    totalTrajectories: total,
    distinctConversationFingerprints: distinctFingerprints,
    fingerprintUniquenessBp: basisPoints(distinctFingerprints, total),
    topOpenerRecurrenceBp: basisPoints(topCount(openers), total),
    topCloserRecurrenceBp: basisPoints(topCount(closers), total),
    topQuestionSequenceRecurrenceBp: basisPoints(
      topCount(trajectories.map((one) => questionSequenceOf(one))),
      total,
    ),
    topPhaseSequenceRecurrenceBp: basisPoints(
      topCount(trajectories.map((one) => phaseSequenceOf(one))),
      total,
    ),
    maxVariantsPerLineage: maxVariants,
    sameLineageNearDuplicateBp: basisPoints(redundant.size, total),
    depthBandsCovered,
    decisionsCovered: decisions.size,
    objectivesCovered: objectives.size,
  });
}
