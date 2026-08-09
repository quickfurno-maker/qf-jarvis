/**
 * The HUMAN review annotation (RWC-P10, ADR-0106 §10).
 *
 * ### Why a human, and why exactly two
 *
 * Subjective sales quality is the one thing in this repository a model must not judge. An
 * LLM-as-judge shares the failure modes of the model it scores — the same verbosity preferences, the
 * same politeness bias, the same blind spot for a confident invented warranty — so it would
 * systematically approve the answers it would itself have given. Worse, using a model to certify a
 * model is a closed loop with no outside reference, and the number it produces looks exactly as
 * authoritative as a real measurement.
 *
 * So two independent people mark each required dimension satisfied or not, and a dimension passes
 * only when BOTH did. One agreeing reviewer is not a measurement; it is one person's taste. A
 * disagreement is a FAIL rather than a tie-break, deliberately: if two trained reviewers reading the
 * same rubric cannot agree that a reply was empathetic, the reply was not clearly empathetic.
 *
 * ### What a review may NOT carry
 *
 * No name, no email, no account id — `reviewRef` is opaque. No comment, no free text, no confidence,
 * no explanation, no chain of thought. The schema is `.strict()`, so each of those is a refusal
 * rather than a field quietly dropped.
 *
 * Comments are excluded for a specific reason rather than tidiness. A reviewer's note about a reply
 * quotes the reply, and a quoted reply is conversation content entering an artifact that is retained,
 * copied into evidence stores and read by people who never saw the privacy contract. The rubric
 * exists so the judgement can be made without needing to write the reason down here; the reason
 * belongs in the review tool, not in the measurement.
 */
import { z } from 'zod';

import { RiyaQualityEvaluationError } from './errors.js';
import { RIYA_QUALITY_DIMENSIONS } from './vocabularies.js';
import type { RiyaQualityDimension } from './vocabularies.js';

/** One human reviewer's binary judgement of one candidate reply. */
export interface RiyaQualityHumanReviewV1 {
  readonly version: 1;
  /**
   * An opaque, exact reviewer identifier.
   *
   * Opaque means the evaluator neither parses nor resolves it: it exists only so two reviews can be
   * proved DISTINCT. A deployment maps it to a person in its own review tool, where that mapping is
   * governed; it must never be a name, an email or an account id, because this value travels into
   * fixtures and specs.
   */
  readonly reviewRef: string;
  /** The dimensions this reviewer judged SATISFIED. Everything absent is not satisfied. */
  readonly satisfiedDimensions: readonly RiyaQualityDimension[];
}

export interface RiyaQualityHumanReviewInput {
  readonly version: 1;
  readonly reviewRef: string;
  readonly satisfiedDimensions: readonly RiyaQualityDimension[];
}

const REVIEW_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const reviewSchema = z
  .object({
    version: z.literal(1),
    reviewRef: REVIEW_REF,
    satisfiedDimensions: z
      .array(z.enum(RIYA_QUALITY_DIMENSIONS))
      .max(RIYA_QUALITY_DIMENSIONS.length),
  })
  .strict();

/** Validate and freeze one human review. Throws `invalid-human-review`. */
export function createRiyaQualityHumanReview(
  input: RiyaQualityHumanReviewInput,
): RiyaQualityHumanReviewV1 {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    // The zod issue is discarded: its message can quote the offending value, and an extra field a
    // caller tried to attach is exactly the free text this contract refuses to carry.
    throw new RiyaQualityEvaluationError('invalid-human-review');
  }
  const dimensions = parsed.data.satisfiedDimensions;
  if (new Set(dimensions).size !== dimensions.length) {
    // A repeated dimension is a malformed annotation, not a stronger opinion.
    throw new RiyaQualityEvaluationError('invalid-human-review');
  }
  return Object.freeze({
    version: 1 as const,
    reviewRef: parsed.data.reviewRef,
    // Sorted, so two reviews that agree are byte-identical and the case digest is stable regardless
    // of the order a review tool happened to emit.
    satisfiedDimensions: Object.freeze([...dimensions].sort()),
  });
}

/** True iff a reviewer marked this dimension satisfied. */
export function reviewSatisfies(
  review: RiyaQualityHumanReviewV1,
  dimension: RiyaQualityDimension,
): boolean {
  return review.satisfiedDimensions.includes(dimension);
}
