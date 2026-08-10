/**
 * Formula-degeneration metrics (HGV1-A, ADR-0108 §34).
 *
 * ### The failure this measures
 *
 * A corpus written to a rubric drifts toward one voice. Every reply opens the same way, every turn
 * closes with the same call to action, and the numbers all look fine — 360 trajectories, balanced
 * matrix, every gate green. What the model learns is the formula, and it produces it in situations
 * the formula does not fit.
 *
 * Nothing else in the pipeline notices, because every individual example is good.
 *
 * ### Report first, block later
 *
 * These are REPORTED, not gated. Setting a threshold now would mean guessing what a healthy Gold
 * corpus looks like before one exists, and a guessed number is either so loose it never fires or so
 * tight it blocks the first honest wave. Wave-1 calibration sets the V1 threshold against real
 * content, and that decision is written down rather than invented here.
 *
 * The one exception is an EXACT repeated assistant reply, which is a copy-paste rather than a style —
 * and even that is only counted, with the blocking left to the calibration gate.
 *
 * Short acknowledgements are excluded from the prefix counts. "Sure." and "Understood." recurring is
 * normal human writing, and a metric that flagged them would be ignored within a week.
 */
import { normalizeForComparison, tokenize } from '../../internal/normalization.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../../contracts/trajectory.js';

/** Below this many tokens a reply is an acknowledgement, not a formula. */
export const RIYA_GOLD_MIN_TOKENS_FOR_PREFIX_METRIC = 6;

/** How many tokens make an opener or a closer, for the prefix and suffix counts. */
export const RIYA_GOLD_PREFIX_TOKENS = 5;

export interface RiyaGoldRepeatedPhrase {
  /** A normalized token run. Content, but only of the corpus's OWN most repeated phrasing. */
  readonly phrase: string;
  readonly count: number;
}

export interface RiyaGoldRepetitionMetrics {
  readonly totalAssistantReplies: number;
  readonly uniqueNormalizedReplies: number;
  /** Replies appearing verbatim more than once, counted as the surplus copies. */
  readonly exactRepeatedReplyCount: number;
  readonly repeatedOpeningPrefixCount: number;
  readonly repeatedClosingSuffixCount: number;
  readonly topOpeningPrefixes: readonly RiyaGoldRepeatedPhrase[];
  readonly topClosingSuffixes: readonly RiyaGoldRepeatedPhrase[];
}

const topPhrases = (
  counts: ReadonlyMap<string, number>,
  limit: number,
): readonly RiyaGoldRepeatedPhrase[] =>
  Object.freeze(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([phrase, count]) => Object.freeze({ phrase, count }))
      .sort((a, b) => (b.count - a.count !== 0 ? b.count - a.count : a.phrase < b.phrase ? -1 : 1))
      .slice(0, limit),
  );

/** How many assistant turns a trajectory has. Used by the depth-deviation check too. */
export function assistantTurnCountOf(trajectory: RiyaIntelligenceTrajectoryV1): number {
  return trajectory.turns.filter((turn) => turn.type === 'ASSISTANT').length;
}

/** Compute the degeneration metrics for a corpus. Pure, deterministic, and never blocking. */
export function riyaGoldRepetitionMetrics(
  trajectories: readonly RiyaIntelligenceTrajectoryV1[],
  options: { readonly topLimit?: number } = {},
): RiyaGoldRepetitionMetrics {
  const replies: string[] = [];
  for (const trajectory of trajectories) {
    for (const turn of trajectory.turns) {
      if (turn.type === 'ASSISTANT') {
        replies.push(normalizeForComparison(turn.text));
      }
    }
  }

  const replyCounts = new Map<string, number>();
  for (const reply of replies) {
    replyCounts.set(reply, (replyCounts.get(reply) ?? 0) + 1);
  }
  let exactRepeated = 0;
  for (const count of replyCounts.values()) {
    if (count > 1) {
      exactRepeated += count - 1;
    }
  }

  const prefixCounts = new Map<string, number>();
  const suffixCounts = new Map<string, number>();
  for (const reply of replies) {
    const tokens = tokenize(reply);
    if (tokens.length < RIYA_GOLD_MIN_TOKENS_FOR_PREFIX_METRIC) {
      continue;
    }
    const prefix = tokens.slice(0, RIYA_GOLD_PREFIX_TOKENS).join(' ');
    const suffix = tokens.slice(-RIYA_GOLD_PREFIX_TOKENS).join(' ');
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
  }

  const surplus = (counts: ReadonlyMap<string, number>): number => {
    let total = 0;
    for (const count of counts.values()) {
      if (count > 1) {
        total += count - 1;
      }
    }
    return total;
  };

  return Object.freeze({
    totalAssistantReplies: replies.length,
    uniqueNormalizedReplies: replyCounts.size,
    exactRepeatedReplyCount: exactRepeated,
    repeatedOpeningPrefixCount: surplus(prefixCounts),
    repeatedClosingSuffixCount: surplus(suffixCounts),
    topOpeningPrefixes: topPhrases(prefixCounts, options.topLimit ?? 10),
    topClosingSuffixes: topPhrases(suffixCounts, options.topLimit ?? 10),
  });
}
