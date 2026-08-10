/**
 * Dataset release evidence (RID-F1, ADR-0107 §29).
 *
 * ### It records that gates passed. It authorizes nothing.
 *
 * `syntheticOnly` is a literal `true` and `trainingApproval` a literal `false` — neither is a field a
 * caller can set. Clearing every dataset gate means the corpus is well-formed, leak-free and
 * reviewed. Whether to spend a training run on it is a human decision with inputs this package
 * cannot see, and an artifact that could say `true` would eventually be wired to something that
 * reads it.
 *
 * There is deliberately no bridge to a training job, a queue, a scheduler or a rollout ladder.
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
import { sha256OfCanonical } from '../internal/sha256.js';

export interface CreateRiyaDatasetReleaseEvidenceInput {
  readonly report: RiyaDatasetReleaseReportV1;
  readonly manifest: RiyaIntelligenceDatasetManifestV1;
  readonly releasePolicyId: string;
  readonly releasePolicyVersion: number;
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
 * Integrity before eligibility: a manifest whose records were edited after sealing is not evidence of
 * anything, and checking that first is what makes the artifact worth storing. Then the report must be
 * eligible — evidence for a corpus that failed a gate would be a record of a failure wearing the
 * shape of an approval.
 */
export function createRiyaDatasetReleaseEvidence(
  input: CreateRiyaDatasetReleaseEvidenceInput,
): RiyaDatasetReleaseEvidenceResult {
  if (!riyaDatasetManifestIntegrityHolds(input.manifest)) {
    return { ok: false, code: 'manifest-digest-invalid' };
  }
  if (!input.report.eligible) {
    return { ok: false, code: 'dataset-not-eligible' };
  }
  // The manifest and the report must describe the same corpus. Pairing an eligible report with a
  // manifest of a different size is the easiest way to launder a failing dataset.
  if (input.manifest.records.length !== input.report.totalTrajectories) {
    return { ok: false, code: 'dataset-not-eligible' };
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
    input.releasePolicyId,
    input.releasePolicyVersion,
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
      releasePolicyId: input.releasePolicyId,
      releasePolicyVersion: input.releasePolicyVersion,
      createdAt,
      syntheticOnly: true as const,
      trainingApproval: false as const,
    }),
  };
}
