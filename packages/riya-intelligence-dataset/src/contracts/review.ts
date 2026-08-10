/**
 * The training review annotation (RID-F1, ADR-0107 §21).
 *
 * ### Risk-based, because reviewer attention is the scarce resource
 *
 * A `STANDARD` trajectory needs one independent accepted review. A `HIGH_RISK` one — price,
 * discount, payment, warranty, policy, consent, handoff, complaint, business action, current
 * availability, identity, privacy — needs two DISTINCT accepted reviews.
 *
 * Demanding two on everything sounds safer and is not: it halves throughput, so either the corpus
 * stops growing or reviews become rubber stamps, and a rubber stamp on a price example is worse than
 * an honest single review on a greeting. Spending the second reviewer where a wrong answer becomes a
 * commitment somebody has to honour is where it actually buys something.
 *
 * **The author is not a reviewer.** A review whose ref matches the trajectory's `sourceRef` does not
 * count, because a person checking their own work is the failure mode this contract exists to
 * prevent, not an instance of it.
 *
 * ### No free text, for the same reason as everywhere else
 *
 * An opaque `reviewRef`, a decision, and which quality dimensions were satisfied. No name, email,
 * comment, rationale, confidence or chain-of-thought. A reviewer's note about a training example
 * quotes the example, and a quoted example is conversation content entering an artifact that gets
 * copied between machines and read by people who never saw the privacy contract.
 */
import { z } from 'zod';

import { RiyaDatasetError } from './errors.js';
import { RIYA_DATASET_QUALITY_DIMENSIONS, RIYA_DATASET_REVIEW_DECISIONS } from './vocabularies.js';
import type { RiyaDatasetQualityDimension, RiyaDatasetReviewDecision } from './vocabularies.js';

export interface RiyaTrainingReviewV1 {
  readonly reviewRef: string;
  readonly decision: RiyaDatasetReviewDecision;
  readonly satisfiedQualityDimensions: readonly RiyaDatasetQualityDimension[];
}

export type RiyaTrainingReviewInput = RiyaTrainingReviewV1;

const reviewSchema = z
  .object({
    reviewRef: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    decision: z.enum(RIYA_DATASET_REVIEW_DECISIONS),
    satisfiedQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length),
  })
  .strict();

/** Validate and freeze one training review. Throws `invalid-review`. */
export function createRiyaTrainingReview(input: RiyaTrainingReviewInput): RiyaTrainingReviewV1 {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    // The zod issue is discarded: an extra key a caller tried to attach is exactly the free text
    // this contract refuses to carry, and its message would quote the value.
    throw new RiyaDatasetError('invalid-review');
  }
  const dimensions = parsed.data.satisfiedQualityDimensions;
  if (new Set(dimensions).size !== dimensions.length) {
    throw new RiyaDatasetError('invalid-review');
  }
  return Object.freeze({
    reviewRef: parsed.data.reviewRef,
    decision: parsed.data.decision,
    // Sorted, so two reviewers who agree produce byte-identical annotations.
    satisfiedQualityDimensions: Object.freeze([...dimensions].sort()),
  });
}
