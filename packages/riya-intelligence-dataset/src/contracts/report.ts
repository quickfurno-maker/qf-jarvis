/**
 * The dataset release report and release evidence (RID-F1, ADR-0107 §29).
 *
 * ### The report is counts, and only counts
 *
 * Every field is a number or a closed-key tally. No conversation text, no reviewer reference, no
 * matched secret, no protected fixture text. A release report is the artifact people paste into a
 * ticket, so it is the one that must be safe to paste.
 *
 * ### `trainingApproval` is a literal `false`
 *
 * Passing every dataset gate means the corpus is well-formed, leak-free and reviewed. It does not
 * mean a training run should start. That is a human decision with inputs this package cannot see —
 * budget, base-model choice, evaluation readiness, what else is in flight — and a dataset artifact
 * that could say `true` would eventually be wired to something that reads it.
 */
import type {
  RiyaDatasetDifficulty,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetRiskClass,
  RiyaDatasetSourceKind,
  RiyaDatasetSplit,
} from './vocabularies.js';

/** Where a blocking or quarantining finding was. Never what the content said. */
export interface RiyaDatasetFindingLocation {
  readonly trajectoryId: string;
  /** A turn ref, a fact ref, or another opaque location. Absent for whole-trajectory findings. */
  readonly locationRef?: string;
  /** The other artifact involved, for a duplicate or a leakage match. */
  readonly counterpartRef?: string;
}

/** Why a release attestation could not be bound. A closed reason, never content. */
export type RiyaDatasetReleaseBindingFailure =
  | 'RELEASE_POLICY_MISSING'
  | 'PROTECTED_INDEX_MISSING'
  | 'PROTECTED_INDEX_COUNT_MISMATCH'
  | 'PROTECTED_INDEX_DIGEST_MISMATCH';

export interface RiyaDatasetReleaseReportV1 {
  readonly version: 1;
  /**
   * What this report is bound to (owner correction on PR #112).
   *
   * Absent when validation ran without a release policy — which is legal for a dry run and never
   * eligible for release. Present, these say WHICH policy, WHICH coverage bar and WHICH protected
   * exam corpus actually gated this dataset, so evidence can copy them rather than accept a caller's
   * word for it.
   */
  readonly releasePolicyId?: string;
  readonly releasePolicyVersion?: number;
  readonly coveragePolicyId?: string;
  readonly coveragePolicyVersion?: number;
  readonly coveragePolicySha256?: string;
  readonly protectedCorpusRef?: string;
  readonly protectedIndexSha256?: string;
  readonly protectedEntryCount?: number;
  readonly releaseBindingFailures: readonly RiyaDatasetReleaseBindingFailure[];
  /** SHA-256 over the identity of every validated trajectory. The pairing proof. */
  readonly validatedDatasetSha256: string;
  readonly totalTrajectories: number;
  readonly totalAssistantTurns: number;
  readonly countsBySplit: Readonly<Record<RiyaDatasetSplit, number>>;
  readonly countsByLanguage: Readonly<Partial<Record<RiyaDatasetLanguageMode, number>>>;
  readonly countsByPrimaryInteraction: Readonly<
    Partial<Record<RiyaDatasetInteractionKind, number>>
  >;
  readonly countsByPersona: Readonly<Partial<Record<RiyaDatasetPersona, number>>>;
  readonly countsByDifficulty: Readonly<Partial<Record<RiyaDatasetDifficulty, number>>>;
  readonly countsByRiskClass: Readonly<Partial<Record<RiyaDatasetRiskClass, number>>>;
  readonly countsBySourceKind: Readonly<Partial<Record<RiyaDatasetSourceKind, number>>>;
  /** How many trajectories carry the reviews their risk class requires. */
  readonly reviewedTrajectories: number;
  readonly insufficientReview: readonly RiyaDatasetFindingLocation[];
  readonly duplicateTrajectoryIds: readonly RiyaDatasetFindingLocation[];
  readonly lineageSplitViolations: readonly RiyaDatasetFindingLocation[];
  readonly exactCrossSplitDuplicates: readonly RiyaDatasetFindingLocation[];
  readonly nearCrossSplitDuplicates: readonly RiyaDatasetFindingLocation[];
  readonly sameSplitNearDuplicates: readonly RiyaDatasetFindingLocation[];
  readonly protectedExactLeakage: readonly RiyaDatasetFindingLocation[];
  readonly protectedNearLeakage: readonly RiyaDatasetFindingLocation[];
  readonly privacyViolations: readonly (RiyaDatasetFindingLocation & { readonly kind: string })[];
  readonly unsupportedBusinessFacts: readonly RiyaDatasetFindingLocation[];
  readonly coverageShortfalls: readonly {
    readonly dimension: string;
    readonly key: string;
    readonly observed: number;
    readonly required: number;
  }[];
  /** True only when every blocking list is empty AND no quarantine is unresolved. */
  readonly eligible: boolean;
  /** SHA-256 over every field above. Commits to the whole report except itself. */
  readonly reportSha256: string;
}

export interface RiyaDatasetReleaseEvidenceV1 {
  readonly version: 1;
  /** A stable opaque reference derived from the bound digests. Not a training authorization. */
  readonly datasetRef: string;
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly manifestSha256: string;
  /** The content binding. Recomputed from the manifest and compared to the report before issuing. */
  readonly validatedDatasetSha256: string;
  readonly reportSha256: string;
  /** COPIED from the validated report. A caller cannot name a policy validation did not apply. */
  readonly releasePolicyId: string;
  readonly releasePolicyVersion: number;
  readonly protectedIndexSha256: string;
  readonly createdAt: string;
  readonly syntheticOnly: true;
  /** Always `false`. Clearing dataset gates never starts a run. */
  readonly trainingApproval: false;
}
