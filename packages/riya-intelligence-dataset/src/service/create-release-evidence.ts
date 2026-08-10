/**
 * Dataset release evidence (RID-F1, ADR-0107 §29; owner correction on PR #112).
 *
 * ### It records that gates passed. It authorizes nothing.
 *
 * `syntheticOnly` is a literal `true` and `trainingApproval` a literal `false` — neither is a field a
 * caller can set. Clearing every dataset gate means the corpus is well-formed, leak-free and
 * reviewed. Whether to spend a training run on it is a human decision with inputs this package
 * cannot see. There is deliberately no bridge to a job, a queue, a scheduler or a rollout ladder.
 *
 * ### The pairing is CONTENT, not counting
 *
 * The first version paired a report and a manifest on `records.length === totalTrajectories`. Two
 * different corpora of the same size therefore paired cleanly: validate a safe dataset A, build a
 * manifest for a different dataset B with the same count, hand over report A and manifest B, and the
 * evidence was issued — attesting a corpus that had never been validated.
 *
 * Now `validatedDatasetSha256` is RECOMPUTED from the manifest's own records and compared to the
 * report's. Identifiers, revisions, lineages, splits and both per-trajectory digests all have to
 * agree. Counting remains as a cheap extra check, never as the binding.
 *
 * ### The policy identity is COPIED, never supplied
 *
 * A caller can no longer name a release policy. The report says which policy actually gated the
 * dataset; evidence takes it from there. Accepting a free-floating id was how an unbound validation
 * could be attested under a policy it had never applied.
 */
import type { RiyaDatasetErrorCode } from '../contracts/errors.js';
import {
  riyaDatasetManifestIntegrityHolds,
  type RiyaIntelligenceDatasetManifestV1,
} from '../contracts/manifest.js';
import type {
  RiyaDatasetReleaseEvidenceV1,
  RiyaDatasetReleaseReportV1,
} from '../contracts/report.js';
import {
  riyaDatasetReportIntegrityHolds,
  validatedDatasetSha256FromManifestRecords,
} from '../internal/report-integrity.js';
import { sha256OfCanonical } from '../internal/sha256.js';

export interface CreateRiyaDatasetReleaseEvidenceInput {
  readonly report: RiyaDatasetReleaseReportV1;
  readonly manifest: RiyaIntelligenceDatasetManifestV1;
  /** Canonical UTC instant. Defaults to the manifest's own. */
  readonly createdAt?: string;
}

export type RiyaDatasetReleaseEvidenceResult =
  | { readonly ok: true; readonly evidence: RiyaDatasetReleaseEvidenceV1 }
  | { readonly ok: false; readonly code: RiyaDatasetErrorCode };

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Attempt to create release evidence. Fails CLOSED with a bounded code.
 *
 * In order: the report must recompute, the manifest must recompute, the report must be eligible, the
 * two must be provably the same corpus, and the report must carry a real release binding. Integrity
 * before verdict, because a result whose fields were edited is not evidence of anything and checking
 * that first is what makes the artifact worth storing.
 */
export function createRiyaDatasetReleaseEvidence(
  input: CreateRiyaDatasetReleaseEvidenceInput,
): RiyaDatasetReleaseEvidenceResult {
  if (!riyaDatasetReportIntegrityHolds(input.report)) {
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
  // A cheap extra check. Never the binding -- it is exactly what a same-size swap defeats.
  if (input.manifest.records.length !== input.report.totalTrajectories) {
    return { ok: false, code: 'release-binding-invalid' };
  }

  // An eligible report always carries its binding, but reading it defensively keeps the failure a
  // bounded code rather than an undefined field reaching an artifact.
  const releasePolicyId = input.report.releasePolicyId;
  const releasePolicyVersion = input.report.releasePolicyVersion;
  const protectedIndexSha256 = input.report.protectedIndexSha256;
  if (
    input.report.releaseBindingFailures.length > 0 ||
    releasePolicyId === undefined ||
    releasePolicyVersion === undefined ||
    protectedIndexSha256 === undefined
  ) {
    return { ok: false, code: 'release-binding-invalid' };
  }

  const createdAt = input.createdAt ?? input.manifest.createdAt;
  if (!CANONICAL_INSTANT.test(createdAt)) {
    return { ok: false, code: 'invalid-manifest' };
  }

  // Derived, not random: the same eligible corpus always yields the same reference, so two runs of
  // the same release cannot look like two different attestations.
  const datasetRef = `rid.${sha256OfCanonical([
    input.manifest.datasetId,
    input.manifest.datasetVersion,
    input.manifest.manifestSha256,
    input.report.validatedDatasetSha256,
    input.report.reportSha256,
    releasePolicyId,
    releasePolicyVersion,
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
      releasePolicyId,
      releasePolicyVersion,
      protectedIndexSha256,
      createdAt,
      syntheticOnly: true as const,
      trainingApproval: false as const,
    }),
  };
}
