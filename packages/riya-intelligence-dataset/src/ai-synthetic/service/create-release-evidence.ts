/**
 * AI-synthetic release evidence (AS1, ADR-0143 §15, §16, §17).
 *
 * ### It records that the AUTOMATED gates passed. It authorizes nothing.
 *
 * `trainingApproval` is a literal `false` here for the same reason it is on the human lane: clearing
 * dataset gates says a corpus is well-formed, leak-free and accepted, not that a training run should
 * start. ADR-0143 §15 goes further and requires base-model selection evidence, a training
 * configuration identity and an owner-approved run before anything trains — none of which this
 * package can see, and none of which a dataset artifact should be able to imply.
 *
 * ### It is a DIFFERENT type from `RiyaDatasetReleaseEvidenceV1`
 *
 * Not a variant, not a flag on the existing one. That contract's documented meaning includes human
 * review; issuing automated acceptance through it would make every stored instance ambiguous after
 * the fact, and nobody reading an old artifact could tell which kind they were holding.
 *
 * The pairing is CONTENT, copied from the human lane's hard-won lesson: `validatedDatasetSha256` is
 * recomputed from the manifest's own records, so two same-sized corpora cannot be swapped.
 */
import type { RiyaDatasetErrorCode } from '../../contracts/errors.js';
import {
  riyaDatasetManifestIntegrityHolds,
  type RiyaIntelligenceDatasetManifestV1,
} from '../../contracts/manifest.js';
import { validatedDatasetSha256FromManifestRecords } from '../../internal/report-integrity.js';
import { sha256OfCanonical } from '../../internal/sha256.js';
import type {
  RiyaAiSyntheticAcceptanceReportV1,
  RiyaAiSyntheticReleaseEvidenceV1,
} from '../contracts/report.js';
import { riyaAiSyntheticReportIntegrityHolds } from '../contracts/report.js';

export interface CreateRiyaAiSyntheticReleaseEvidenceInput {
  readonly report: RiyaAiSyntheticAcceptanceReportV1;
  readonly manifest: RiyaIntelligenceDatasetManifestV1;
  /** Canonical UTC instant. Defaults to the manifest's own — this package reads no clock. */
  readonly createdAt?: string;
}

export type RiyaAiSyntheticReleaseEvidenceResult =
  | { readonly ok: true; readonly evidence: RiyaAiSyntheticReleaseEvidenceV1 }
  | { readonly ok: false; readonly code: RiyaDatasetErrorCode };

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Attempt to create AI-synthetic release evidence. Fails CLOSED with a bounded code.
 *
 * Integrity before verdict: a report whose fields were edited is not evidence of anything, and
 * checking that first is what makes the artifact worth storing at all.
 */
export function createRiyaAiSyntheticReleaseEvidence(
  input: CreateRiyaAiSyntheticReleaseEvidenceInput,
): RiyaAiSyntheticReleaseEvidenceResult {
  if (!riyaAiSyntheticReportIntegrityHolds(input.report)) {
    return { ok: false, code: 'manifest-digest-invalid' };
  }
  if (!riyaDatasetManifestIntegrityHolds(input.manifest)) {
    return { ok: false, code: 'manifest-digest-invalid' };
  }
  if (!input.report.eligible) {
    return { ok: false, code: 'dataset-not-eligible' };
  }

  // THE binding. Recomputed from the manifest, compared to the report.
  if (
    validatedDatasetSha256FromManifestRecords(input.manifest.records) !==
    input.report.validatedDatasetSha256
  ) {
    return { ok: false, code: 'release-binding-invalid' };
  }
  if (input.manifest.records.length !== input.report.totalTrajectories) {
    return { ok: false, code: 'release-binding-invalid' };
  }

  const baseReleasePolicyId = input.report.baseReleasePolicyId;
  const baseReleasePolicyVersion = input.report.baseReleasePolicyVersion;
  const protectedIndexSha256 = input.report.protectedIndexSha256;
  if (
    baseReleasePolicyId === undefined ||
    baseReleasePolicyVersion === undefined ||
    protectedIndexSha256 === undefined
  ) {
    return { ok: false, code: 'release-binding-invalid' };
  }

  const createdAt = input.createdAt ?? input.manifest.createdAt;
  if (!CANONICAL_INSTANT.test(createdAt)) {
    return { ok: false, code: 'invalid-manifest' };
  }

  // Derived, not random: the same accepted corpus always yields the same reference. The `ras.` prefix
  // distinguishes it from the human lane's `rid.` at a glance, in a log line, months later.
  const datasetRef = `ras.${sha256OfCanonical([
    input.manifest.datasetId,
    input.manifest.datasetVersion,
    input.manifest.manifestSha256,
    input.report.validatedDatasetSha256,
    input.report.reportSha256,
    input.report.acceptancePolicyId,
    input.report.acceptancePolicyVersion,
    input.report.acceptancePolicySha256,
    baseReleasePolicyId,
    baseReleasePolicyVersion,
    protectedIndexSha256,
    createdAt,
  ])}`;

  return {
    ok: true,
    evidence: Object.freeze({
      version: 1 as const,
      datasetRef,
      datasetId: input.manifest.datasetId,
      datasetVersion: input.manifest.datasetVersion,
      manifestSha256: input.manifest.manifestSha256,
      validatedDatasetSha256: input.report.validatedDatasetSha256,
      reportSha256: input.report.reportSha256,
      baseReportSha256: input.report.baseReportSha256,
      acceptancePolicyId: input.report.acceptancePolicyId,
      acceptancePolicyVersion: input.report.acceptancePolicyVersion,
      acceptancePolicySha256: input.report.acceptancePolicySha256,
      baseReleasePolicyId,
      baseReleasePolicyVersion,
      protectedIndexSha256,
      createdAt,
      syntheticOnly: true as const,
      reviewMode: 'AUTOMATED_SYNTHETIC' as const,
      trainingApproval: false as const,
    }),
  };
}
