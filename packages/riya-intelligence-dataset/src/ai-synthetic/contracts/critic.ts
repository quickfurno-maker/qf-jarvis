/**
 * The critic verdict: a decision and closed dimensions, and nothing else (AS1, ADR-0143 §10).
 *
 * ### Why there is no rationale field
 *
 * A rationale is model output about model output. Storing it would put unreviewed generated prose
 * into the corpus artifact, where it is one refactor away from being trained on — and it would be
 * the most persuasive prose in the whole dataset, because it was written to justify a conclusion.
 *
 * It would also be the field somebody eventually reads INSTEAD of the gate. A verdict that says
 * `ACCEPTED` plus four satisfied dimensions is checkable. A verdict that says `ACCEPTED` plus two
 * paragraphs about warmth invites agreement rather than verification.
 *
 * ### Why there is no score
 *
 * ADR-0143 §10: no averaged critic score may hide a failed hard gate. The reliable way to guarantee
 * that is to have no number to average. A verdict is `ACCEPTED` or `REJECTED`, the policy counts
 * them, and one explicit rejection is decisive no matter how many acceptances sit beside it.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import {
  RIYA_DATASET_QUALITY_DIMENSIONS,
  RIYA_DATASET_REVIEW_DECISIONS,
} from '../../contracts/vocabularies.js';
import type {
  RiyaDatasetQualityDimension,
  RiyaDatasetReviewDecision,
} from '../../contracts/vocabularies.js';
import { sha256OfCanonical } from '../../internal/sha256.js';

export interface RiyaAiSyntheticCriticVerdictV1 {
  readonly version: 1;
  /** This verdict's own identity. Unique within a trajectory's evidence. */
  readonly criticRef: string;
  /** WHICH critic configuration produced it. Compared against the generation roles. */
  readonly criticConfigRef: string;
  /** Optional opaque family handle, so a policy can require critics from different families. */
  readonly criticModelFamilyRef?: string;
  readonly decision: RiyaDatasetReviewDecision;
  readonly satisfiedQualityDimensions: readonly RiyaDatasetQualityDimension[];
  readonly failedQualityDimensions: readonly RiyaDatasetQualityDimension[];
}

export type RiyaAiSyntheticCriticVerdictInput = Omit<
  RiyaAiSyntheticCriticVerdictV1,
  'version' | 'failedQualityDimensions'
> & {
  readonly version?: 1;
  readonly failedQualityDimensions?: readonly RiyaDatasetQualityDimension[];
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const verdictSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added. Round-tripping is a real path: evidence deep-
    // re-proves verdicts that are themselves already constructed.
    version: z.literal(1).optional(),
    criticRef: REF,
    criticConfigRef: REF,
    criticModelFamilyRef: REF.optional(),
    decision: z.enum(RIYA_DATASET_REVIEW_DECISIONS),
    satisfiedQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length),
    failedQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length)
      .optional(),
  })
  .strict();

/** Validate and freeze a critic verdict. Throws `invalid-ai-synthetic-critic-verdict`. */
export function createRiyaAiSyntheticCriticVerdict(
  input: RiyaAiSyntheticCriticVerdictInput,
): RiyaAiSyntheticCriticVerdictV1 {
  const parsed = verdictSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-critic-verdict');
  }
  const data = parsed.data;
  const satisfied = data.satisfiedQualityDimensions;
  const failed = data.failedQualityDimensions ?? [];

  if (new Set(satisfied).size !== satisfied.length || new Set(failed).size !== failed.length) {
    throw new RiyaDatasetError('invalid-ai-synthetic-critic-verdict');
  }
  // A dimension cannot be both satisfied and failed. A verdict that says so is not a verdict.
  if (satisfied.some((dimension) => failed.includes(dimension))) {
    throw new RiyaDatasetError('invalid-ai-synthetic-critic-verdict');
  }
  // An acceptance that names a failed dimension is the shape of a critic hedging. The gate treats
  // rejection as decisive, so the hedge must not be representable -- otherwise it reads as ACCEPTED.
  if (data.decision === 'ACCEPTED' && failed.length > 0) {
    throw new RiyaDatasetError('invalid-ai-synthetic-critic-verdict');
  }
  // And a rejection has to say what failed, or it carries no information the gate can act on.
  if (data.decision === 'REJECTED' && failed.length === 0) {
    throw new RiyaDatasetError('invalid-ai-synthetic-critic-verdict');
  }

  return Object.freeze({
    version: 1 as const,
    criticRef: data.criticRef,
    criticConfigRef: data.criticConfigRef,
    ...(data.criticModelFamilyRef === undefined
      ? {}
      : { criticModelFamilyRef: data.criticModelFamilyRef }),
    decision: data.decision,
    satisfiedQualityDimensions: Object.freeze([...satisfied].sort()),
    failedQualityDimensions: Object.freeze([...failed].sort()),
  });
}

/** The content digest of a critic verdict. */
export function riyaAiSyntheticCriticVerdictSha256(
  verdict: RiyaAiSyntheticCriticVerdictV1,
): string {
  return sha256OfCanonical(verdict);
}
