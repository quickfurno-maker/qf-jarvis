/**
 * Case, suite and evidence result shapes (RWC-P10, ADR-0106 §14, §17, §18).
 *
 * All three are CONTENT-FREE. A case result names the scenario, the outcome, the closed objective
 * failure codes and which required dimensions failed. It carries no reply, no user text, no observed
 * value, no citation content and — deliberately — no `reviewRef`.
 *
 * Excluding the reviewer reference is the least obvious of those and the one worth stating. A result
 * that recorded which reviewer failed which case would, across a full corpus, be a performance
 * record of named people, assembled as a side effect of measuring a model. Nobody would have decided
 * to build that, and it would be retained wherever evidence is retained. The two-reviewer rule needs
 * the refs during evaluation and nowhere after it.
 */
import type { RiyaQualityCandidateBindingV1 } from './binding.js';
import type {
  RiyaQualityCaseOutcome,
  RiyaQualityComparisonOutcome,
  RiyaQualityDimension,
  RiyaQualityObjectiveFailureCode,
} from './vocabularies.js';

/** One evaluated scenario. */
export interface RiyaQualityCaseResultV1 {
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly outcome: RiyaQualityCaseOutcome;
  /** Closed codes only. Sorted, so the case digest does not depend on check order. */
  readonly objectiveFailures: readonly RiyaQualityObjectiveFailureCode[];
  /** Required dimensions at least one reviewer did not mark satisfied. Sorted. */
  readonly failedQualityDimensions: readonly RiyaQualityDimension[];
}

/** Which threshold refused, and what it refused. */
export interface RiyaQualityThresholdBreach {
  readonly kind:
    'OBJECTIVE_FAILURES' | 'INCONCLUSIVE_CASES' | 'DIMENSION_PASS_RATE' | 'DIMENSION_NOT_COVERED';
  /** Present only for the two dimension kinds. */
  readonly dimension?: RiyaQualityDimension;
  /** The observed value: a count, or a pass rate in basis points. */
  readonly observed: number;
  /** The configured limit: a maximum count, or a minimum rate in basis points. */
  readonly limit: number;
}

export interface RiyaQualitySuiteResultV1 {
  readonly version: 1;
  readonly binding: RiyaQualityCandidateBindingV1;
  readonly caseResults: readonly RiyaQualityCaseResultV1[];
  readonly countsByOutcome: Readonly<Record<RiyaQualityCaseOutcome, number>>;
  readonly objectiveFailureCount: number;
  /** Dimension -> how many cases it was required by AND determinately judged in. */
  readonly dimensionApplicableCounts: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly dimensionPassCounts: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly dimensionPassRateBps: Readonly<Partial<Record<RiyaQualityDimension, number>>>;
  readonly thresholdBreaches: readonly RiyaQualityThresholdBreach[];
  readonly qualityEligible: boolean;
  readonly caseSetDigest: string;
  readonly resultDigest: string;
}

/**
 * Immutable Riya quality evidence.
 *
 * `synthetic` is `true` and `productionApproval` is `false`, always. This package scores synthetic
 * fixtures against human annotations; it is not, and must never become, a production approval. It
 * has no rollout bridge and no promotion path, and adding one would be a new ADR.
 */
export interface RiyaQualityEvidenceV1 {
  readonly version: 1;
  /** A stable opaque reference. Not a rollout token. */
  readonly qualityRef: string;
  readonly candidateBinding: RiyaQualityCandidateBindingV1;
  readonly resultDigest: string;
  readonly caseSetDigest: string;
  readonly createdAt: string;
  readonly synthetic: true;
  readonly productionApproval: false;
}

/** Per-dimension movement between two comparable results, in basis points. */
export interface RiyaQualityDimensionDelta {
  readonly dimension: RiyaQualityDimension;
  readonly baselineBps: number;
  readonly candidateBps: number;
  /** `candidateBps - baselineBps`. Negative is a regression, at any magnitude. */
  readonly deltaBps: number;
}

export interface RiyaQualityComparisonResultV1 {
  readonly version: 1;
  readonly outcome: RiyaQualityComparisonOutcome;
  readonly policyId: string;
  readonly policyVersion: number;
  /** Sorted by dimension. Empty when the two results were not comparable. */
  readonly dimensionDeltas: readonly RiyaQualityDimensionDelta[];
  /** Dimensions where the candidate is strictly worse, at any magnitude. */
  readonly regressedDimensions: readonly RiyaQualityDimension[];
  /** Dimensions where the candidate improved by at least the policy's minimum. */
  readonly materiallyImprovedDimensions: readonly RiyaQualityDimension[];
  readonly baselineEligible: boolean;
  readonly candidateEligible: boolean;
}
