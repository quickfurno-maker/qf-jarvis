/**
 * The automated acceptance policy (AS1, ADR-0143 §8, §9, §10).
 *
 * ### It WRAPS the release policy, it does not replace it
 *
 * `baseReleasePolicy` is the ordinary `RiyaDatasetReleasePolicyV1`, unmodified, still pinning
 * coverage and still pinning the protected corpus by ref, count and digest. ADR-0143 §6 refused to
 * add a `reviewMode` field to that contract, because accepted V1 evidence would then have been
 * issued under a policy shape that no longer exists — evidence you have to reinterpret is evidence
 * you cannot rely on.
 *
 * So the automated lane composes rather than edits. Everything V1 gated still gates; this adds what
 * replaces the human reviewer, and only for a corpus that is entirely teacher-generated.
 *
 * ### `reviewMode` is a literal
 *
 * `AUTOMATED_SYNTHETIC`, not the union. There is no way to construct an automated acceptance policy
 * that says `HUMAN_REVIEW`, because such a thing would be an ordinary release wearing this
 * contract's name, and the two must not be confusable in stored evidence.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { createRiyaDatasetReleasePolicy } from '../../contracts/release-policy.js';
import type { RiyaDatasetReleasePolicyV1 } from '../../contracts/release-policy.js';
import { RIYA_DATASET_QUALITY_DIMENSIONS } from '../../contracts/vocabularies.js';
import type { RiyaDatasetQualityDimension } from '../../contracts/vocabularies.js';
import { sha256OfCanonical } from '../../internal/sha256.js';
import { createRiyaAiSyntheticDiversityPolicy } from './diversity-policy.js';
import type { RiyaAiSyntheticDiversityPolicyV1 } from './diversity-policy.js';

/**
 * What replaces the human reviewer.
 *
 * The defaults a caller should reach for are two accepted critics and every independence flag on;
 * they are not defaulted IN SOURCE, because a policy field with a silent default is a field nobody
 * sets and nobody notices is wrong.
 */
export interface RiyaAiSyntheticCriticPolicyV1 {
  readonly version: 1;
  /** How many DISTINCT critics must return `ACCEPTED`. ADR-0143 §13 recommends at least two. */
  readonly minAcceptedCritics: number;
  /** Dimensions every accepted trajectory must have satisfied across its critics. */
  readonly requiredQualityDimensions: readonly RiyaDatasetQualityDimension[];
  /** A critic configuration may not be one of the generation roles. */
  readonly requireCriticConfigDistinctFromGeneration: boolean;
  /** Two critics may not share a configuration — otherwise "two critics" is one, twice. */
  readonly requireDistinctCriticConfigs: boolean;
  /** Critics must come from different model families, where families are declared. */
  readonly requireDistinctCriticModelFamilies: boolean;
}

export interface RiyaAiSyntheticAcceptancePolicyV1 {
  readonly version: 1;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly reviewMode: 'AUTOMATED_SYNTHETIC';
  readonly baseReleasePolicy: RiyaDatasetReleasePolicyV1;
  readonly criticPolicy: RiyaAiSyntheticCriticPolicyV1;
  readonly diversityPolicy: RiyaAiSyntheticDiversityPolicyV1;
  /**
   * How far a generated conversation may drift from its scenario's target depth.
   *
   * Zero would refuse a conversation that ended one turn early because the customer said yes, which
   * is the most natural thing that can happen. A large number would make `targetAssistantTurns`
   * decorative.
   */
  readonly assistantTurnTolerance: number;
}

export interface RiyaAiSyntheticAcceptancePolicyInput {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly baseReleasePolicy: RiyaDatasetReleasePolicyV1;
  readonly criticPolicy: Omit<RiyaAiSyntheticCriticPolicyV1, 'version'>;
  readonly diversityPolicy: Omit<RiyaAiSyntheticDiversityPolicyV1, 'version'>;
  readonly assistantTurnTolerance: number;
}

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const criticPolicySchema = z
  .object({
    // Optional, so an already-constructed critic policy can be re-proved at a service boundary
    // without being rejected for carrying the field its own constructor added.
    version: z.literal(1).optional(),
    // At least one, because zero accepted critics is the automated lane accepting anything. Two is
    // the recommendation; one is representable for a deliberately narrow policy, and is visible.
    minAcceptedCritics: z.int().min(1).max(16),
    requiredQualityDimensions: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .min(1)
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length),
    requireCriticConfigDistinctFromGeneration: z.boolean(),
    requireDistinctCriticConfigs: z.boolean(),
    requireDistinctCriticModelFamilies: z.boolean(),
  })
  .strict();

const policySchema = z
  .object({
    policyId: REF,
    policyVersion: z.int().min(1).max(1_000_000),
    // Re-proved through their own constructors below.
    baseReleasePolicy: z.unknown(),
    criticPolicy: z.unknown(),
    diversityPolicy: z.unknown(),
    assistantTurnTolerance: z.int().min(1).max(4),
  })
  .strict();

/** Validate and freeze an automated acceptance policy. Throws `invalid-ai-synthetic-policy`. */
export function createRiyaAiSyntheticAcceptancePolicy(
  input: RiyaAiSyntheticAcceptancePolicyInput,
): RiyaAiSyntheticAcceptancePolicyV1 {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-policy');
  }
  const critic = criticPolicySchema.safeParse(input.criticPolicy);
  if (!critic.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-policy');
  }
  const dimensions = critic.data.requiredQualityDimensions;
  if (new Set(dimensions).size !== dimensions.length) {
    throw new RiyaDatasetError('invalid-ai-synthetic-policy');
  }
  // Requiring distinct families while allowing shared configs is incoherent: two critics on one
  // config necessarily share a family, so the policy could never be satisfied.
  if (critic.data.requireDistinctCriticModelFamilies && !critic.data.requireDistinctCriticConfigs) {
    throw new RiyaDatasetError('invalid-ai-synthetic-policy');
  }

  let baseReleasePolicy: RiyaDatasetReleasePolicyV1;
  let diversityPolicy: RiyaAiSyntheticDiversityPolicyV1;
  try {
    // The FULL nested values, so each owning constructor's strictness applies.
    //
    // `version` is stripped first: `RiyaDatasetReleasePolicyInput` does not carry one and its schema
    // is `.strict()`, so feeding an ALREADY-CONSTRUCTED policy straight back would be rejected for
    // having the very field its constructor added. Re-proof is still full — every other field goes
    // through the owning constructor unchanged.
    const { version: _baseVersion, ...baseFields } = input.baseReleasePolicy;
    baseReleasePolicy = createRiyaDatasetReleasePolicy(baseFields);
    diversityPolicy = createRiyaAiSyntheticDiversityPolicy(input.diversityPolicy);
  } catch {
    throw new RiyaDatasetError('invalid-ai-synthetic-policy');
  }

  return Object.freeze({
    version: 1 as const,
    policyId: parsed.data.policyId,
    policyVersion: parsed.data.policyVersion,
    reviewMode: 'AUTOMATED_SYNTHETIC' as const,
    baseReleasePolicy,
    criticPolicy: Object.freeze({
      version: 1 as const,
      minAcceptedCritics: critic.data.minAcceptedCritics,
      requiredQualityDimensions: Object.freeze([...dimensions].sort()),
      requireCriticConfigDistinctFromGeneration:
        critic.data.requireCriticConfigDistinctFromGeneration,
      requireDistinctCriticConfigs: critic.data.requireDistinctCriticConfigs,
      requireDistinctCriticModelFamilies: critic.data.requireDistinctCriticModelFamilies,
    }),
    diversityPolicy,
    assistantTurnTolerance: parsed.data.assistantTurnTolerance,
  });
}

/** The content digest of an acceptance policy. Evidence names it by id, version AND digest. */
export function riyaAiSyntheticAcceptancePolicySha256(
  policy: RiyaAiSyntheticAcceptancePolicyV1,
): string {
  return sha256OfCanonical(policy);
}
