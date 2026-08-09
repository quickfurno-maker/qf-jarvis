/**
 * Versioned per-dimension quality thresholds (RWC-P10, ADR-0106 §15).
 *
 * ### There is no single score, and that is the point
 *
 * Every threshold is per DIMENSION. There is no average, no weighted total, no star rating and no
 * "overall quality" number anywhere in this package.
 *
 * A single score is the standard way this kind of system fails. A candidate that becomes noticeably
 * pushier but slightly clearer improves its average, and the average is what a rollout decision
 * reads — so the regression ships, and the thing that actually reaches a client is a Riya that
 * pressures them. Per-dimension gates make that impossible to express: `TRUST_BUILDING` falling
 * below its floor blocks the suite no matter how far `CLARITY` rose.
 *
 * ### Basis points, integers, floor division
 *
 * Rates are integer basis points, 0..10000, and are computed with `Math.floor`. No float ever enters
 * a gate: `0.95` is not exactly representable, and a comparison that is right on 999 machines and
 * wrong on the thousandth is not a gate at all.
 *
 * ### Absent means UNGATED, on purpose
 *
 * A dimension with no entry is not measured against a floor and needs no coverage. That exists so a
 * focused suite can gate the three dimensions it is about instead of being forced to carry all ten.
 * The canonical V1 set below lists every dimension explicitly, so the production corpus gates
 * everything, and a spec locks those numbers.
 */
import { z } from 'zod';

import { RiyaQualityEvaluationError } from './errors.js';
import { RIYA_QUALITY_DIMENSIONS } from './vocabularies.js';
import type { RiyaQualityDimension } from './vocabularies.js';

/** The number of independent human reviews V1 requires. Exactly two — see `human-review.ts`. */
export const RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS = 2;

export interface RiyaQualityThresholdsV1 {
  readonly thresholdsId: string;
  readonly thresholdsVersion: number;
  /** Exactly 2 in V1. Present as a field so evidence names the rule it was gated under. */
  readonly requiredHumanReviews: number;
  /** Dimension -> minimum pass rate in basis points. An absent dimension is deliberately ungated. */
  readonly minimumPassRateBpsByDimension: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly maximumObjectiveFailures: number;
  readonly maximumInconclusiveCases: number;
}

export interface RiyaQualityThresholdsInput {
  readonly thresholdsId: string;
  readonly thresholdsVersion: number;
  readonly requiredHumanReviews: number;
  readonly minimumPassRateBpsByDimension: Partial<Record<RiyaQualityDimension, number>>;
  readonly maximumObjectiveFailures: number;
  readonly maximumInconclusiveCases: number;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const BPS = z.int().min(0).max(10_000);

const thresholdsSchema = z
  .object({
    thresholdsId: IDENTIFIER,
    thresholdsVersion: z.int().min(1).max(1_000_000),
    // Literal 2, not "at least 2". A V1 that silently accepted three reviews would make "both
    // reviewers agreed" mean something different from case to case.
    requiredHumanReviews: z.literal(RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS),
    // Deliberately loose here and checked key-by-key below. A zod enum record is EXHAUSTIVE, which
    // would force every threshold set to list all ten dimensions and make a focused suite
    // impossible; an unknown key still has to be a refusal, so the loop does both.
    minimumPassRateBpsByDimension: z.record(z.string(), z.unknown()),
    maximumObjectiveFailures: z.int().min(0).max(100_000),
    maximumInconclusiveCases: z.int().min(0).max(100_000),
  })
  .strict();

/** Validate and freeze a threshold set. Throws `invalid-thresholds`. */
export function createRiyaQualityThresholds(
  input: RiyaQualityThresholdsInput,
): RiyaQualityThresholdsV1 {
  const parsed = thresholdsSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaQualityEvaluationError('invalid-thresholds');
  }
  const supplied = parsed.data.minimumPassRateBpsByDimension;
  const known = new Set<string>(RIYA_QUALITY_DIMENSIONS);
  for (const key of Object.keys(supplied)) {
    // An unknown dimension is a typo, and a typo here is a gate somebody believes exists and does
    // not. It must be a refusal, never a silently ignored key.
    if (!known.has(key)) {
      throw new RiyaQualityEvaluationError('invalid-thresholds');
    }
  }
  const table: Partial<Record<RiyaQualityDimension, number>> = {};
  for (const dimension of RIYA_QUALITY_DIMENSIONS) {
    const value = supplied[dimension];
    if (value === undefined) {
      continue;
    }
    if (!BPS.safeParse(value).success) {
      throw new RiyaQualityEvaluationError('invalid-thresholds');
    }
    table[dimension] = value as number;
  }
  return Object.freeze({
    thresholdsId: parsed.data.thresholdsId,
    thresholdsVersion: parsed.data.thresholdsVersion,
    requiredHumanReviews: RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
    minimumPassRateBpsByDimension: Object.freeze(table),
    maximumObjectiveFailures: parsed.data.maximumObjectiveFailures,
    maximumInconclusiveCases: parsed.data.maximumInconclusiveCases,
  });
}

/**
 * The canonical V1 thresholds (ADR-0106 §15).
 *
 * The two 10000s are not perfectionism. `CONTEXT_USE` at anything below 100% means a Riya that
 * sometimes ignores what the client already told it, which is the single most damaging thing a sales
 * conversation can do — the client repeats themselves and concludes nobody is listening.
 * `NON_REPETITION` is the same failure seen from the other side.
 *
 * `EMPATHY` sits lowest at 8500 because it is the most reviewer-sensitive of the ten, not because it
 * matters least. Two trained people reading the same rubric disagree about warmth more often than
 * they disagree about whether a question was asked twice, and a floor set above the measurement's
 * own agreement rate would block every candidate forever.
 *
 * Objective failures and inconclusive cases are both capped at ZERO. An objective failure is a
 * contract violation, not a matter of degree; an inconclusive case means the suite did not measure
 * something it claimed to, and tolerating those would let coverage quietly rot.
 */
export const RIYA_QUALITY_CANONICAL_THRESHOLDS_V1: RiyaQualityThresholdsV1 =
  createRiyaQualityThresholds({
    thresholdsId: 'riya-quality-thresholds-v1',
    thresholdsVersion: 1,
    requiredHumanReviews: RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
    minimumPassRateBpsByDimension: {
      CLARITY: 9500,
      CONCISION: 9000,
      NATURALNESS: 9000,
      CONTEXT_USE: 10_000,
      EMPATHY: 8500,
      OBJECTION_HANDLING: 9000,
      TRUST_BUILDING: 9000,
      SALES_MOMENTUM: 9000,
      CTA_QUALITY: 9000,
      NON_REPETITION: 10_000,
    },
    maximumObjectiveFailures: 0,
    maximumInconclusiveCases: 0,
  });

/**
 * A pass rate in basis points, by integer floor division.
 *
 * Floor, never round: rounding 8999.5 up to 9000 would let a candidate through a gate it did not
 * actually clear, and "the rate was almost the floor" is not a thing a gate should be able to say.
 * A dimension nothing applied to is 0 rather than a full score — no coverage is not perfection, and
 * the coverage check in the evaluator refuses that case separately.
 */
export function passRateBps(passCount: number, applicableCount: number): number {
  if (applicableCount <= 0) {
    return 0;
  }
  return Math.floor((passCount * 10_000) / applicableCount);
}
