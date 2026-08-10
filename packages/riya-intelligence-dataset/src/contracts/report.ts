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

export interface RiyaDatasetReleaseReportV1 {
  readonly version: 1;
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
}

export interface RiyaDatasetReleaseEvidenceV1 {
  readonly version: 1;
  /** A stable opaque reference derived from the manifest digest. Not a training authorization. */
  readonly datasetRef: string;
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly manifestSha256: string;
  readonly releasePolicyId: string;
  readonly releasePolicyVersion: number;
  readonly createdAt: string;
  readonly syntheticOnly: true;
  /** Always `false`. Clearing dataset gates never starts a run. */
  readonly trainingApproval: false;
}
