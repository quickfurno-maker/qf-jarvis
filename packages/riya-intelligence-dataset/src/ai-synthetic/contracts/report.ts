/**
 * The automated acceptance report and its release evidence (AS1, ADR-0143 §16, §17).
 *
 * ### A SEPARATE identity, on purpose
 *
 * The generic `RiyaDatasetReleaseReportV1` is correct when it says a teacher-only corpus is not
 * eligible: it has no human reviews, and that report's `eligible` means "eligible under human
 * review". Forcing it to say `true` would falsify every existing consumer's reading of that field.
 *
 * So the automated lane produces its OWN report, which cites the base report by digest and reaches
 * its own verdict under its own policy. Two artifacts with two meanings, and no way to mistake one
 * for the other.
 *
 * ### And it is never called P10
 *
 * `RiyaAiSyntheticReleaseEvidenceV1` carries `reviewMode: 'AUTOMATED_SYNTHETIC'` as a literal. It is
 * not `RiyaDatasetReleaseEvidenceV1` and cannot be substituted for one — reusing that type would
 * have attached automated acceptance to a contract whose documented meaning is human review, which
 * is precisely the quiet decay ADR-0143 §17 forbids.
 *
 * `trainingApproval` is a literal `false` here too. Nothing in this lane starts a run either.
 */
import type { RiyaAiSyntheticFindingKind } from './vocabularies.js';
import { sha256OfCanonical } from '../../internal/sha256.js';

/** One reason acceptance failed. A closed kind, refs and integers. Never content. */
export interface RiyaAiSyntheticFindingV1 {
  readonly kind: RiyaAiSyntheticFindingKind;
  readonly trajectoryId?: string;
  /** The other artifact involved — a scenario ref, a config ref, a counterpart trajectory. */
  readonly counterpartRef?: string;
  /** What was measured, and what the policy required. Basis points or plain counts. */
  readonly observed?: number;
  readonly required?: number;
}

/** Content-free corpus shape, reported whether or not the corpus passes. */
export interface RiyaAiSyntheticDiversityMetricsV1 {
  readonly totalTrajectories: number;
  readonly distinctConversationFingerprints: number;
  readonly fingerprintUniquenessBp: number;
  readonly topOpenerRecurrenceBp: number;
  readonly topCloserRecurrenceBp: number;
  readonly topQuestionSequenceRecurrenceBp: number;
  readonly topPhaseSequenceRecurrenceBp: number;
  readonly maxVariantsPerLineage: number;
  readonly sameLineageNearDuplicateBp: number;
  readonly depthBandsCovered: number;
  readonly decisionsCovered: number;
  readonly objectivesCovered: number;
}

export interface RiyaAiSyntheticAcceptanceReportV1 {
  readonly version: 1;
  readonly reviewMode: 'AUTOMATED_SYNTHETIC';
  /** The generic report this verdict was built on top of. Cited by digest, not repeated. */
  readonly baseReportSha256: string;
  readonly validatedDatasetSha256: string;
  readonly acceptancePolicyId: string;
  readonly acceptancePolicyVersion: number;
  readonly acceptancePolicySha256: string;
  readonly baseReleasePolicyId?: string;
  readonly baseReleasePolicyVersion?: number;
  readonly protectedIndexSha256?: string;
  readonly protectedEntryCount?: number;
  readonly totalTrajectories: number;
  readonly acceptedEvidenceCount: number;
  readonly diversityMetrics: RiyaAiSyntheticDiversityMetricsV1;
  readonly findings: readonly RiyaAiSyntheticFindingV1[];
  /** True only when `findings` is empty. There is no partial credit. */
  readonly eligible: boolean;
  readonly reportSha256: string;
}

export interface RiyaAiSyntheticReleaseEvidenceV1 {
  readonly version: 1;
  readonly datasetRef: string;
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly manifestSha256: string;
  readonly validatedDatasetSha256: string;
  /** The AUTOMATED report's digest, not the base report's. */
  readonly reportSha256: string;
  readonly baseReportSha256: string;
  readonly acceptancePolicyId: string;
  readonly acceptancePolicyVersion: number;
  readonly acceptancePolicySha256: string;
  readonly baseReleasePolicyId: string;
  readonly baseReleasePolicyVersion: number;
  readonly protectedIndexSha256: string;
  readonly createdAt: string;
  readonly syntheticOnly: true;
  /** A literal. Automated acceptance is still not a decision to spend a training run. */
  readonly reviewMode: 'AUTOMATED_SYNTHETIC';
  readonly trainingApproval: false;
}

/** SHA-256 over every report field except `reportSha256` itself. */
export function riyaAiSyntheticReportSha256(
  report: Omit<RiyaAiSyntheticAcceptanceReportV1, 'reportSha256'>,
): string {
  return sha256OfCanonical(report);
}

/** Recompute the report digest and compare. `true` only if nothing was edited. */
export function riyaAiSyntheticReportIntegrityHolds(
  report: RiyaAiSyntheticAcceptanceReportV1,
): boolean {
  const { reportSha256: claimed, ...body } = report;
  return riyaAiSyntheticReportSha256(body) === claimed;
}
