/**
 * The shared release-attestation preimages (RID-F1 owner correction on PR #112).
 *
 * ### What this closes
 *
 * Release evidence proved a report was eligible and a manifest was intact, and then paired them on
 * `records.length === totalTrajectories`. Two different corpora of the same size therefore paired
 * cleanly: validate a safe dataset A, build a manifest for a different dataset B with the same count,
 * hand over report A and manifest B, and the evidence was issued.
 *
 * The fix is content, not counting. `validatedDatasetSha256` is computed from the CANONICAL validated
 * trajectories and RECOMPUTED from the manifest's records; the two must agree. `reportSha256` covers
 * every other report field, so an edited verdict, a deleted finding or a swapped policy identity is
 * detectable.
 *
 * ONE preimage each, used by the producer and by every consumer. A second copy would drift, and the
 * day it did an artifact would verify against a formula nobody was checking.
 */
import { sha256OfCanonical } from './sha256.js';
import type { RiyaDatasetManifestRecordV1 } from '../contracts/manifest.js';
import type { RiyaDatasetReleaseReportV1 } from '../contracts/report.js';

/** The per-trajectory identity a dataset digest commits to. Identifiers and digests, never text. */
export interface RiyaDatasetIdentityRecord {
  readonly trajectoryId: string;
  readonly trajectoryRevision: number;
  readonly lineageRootRef: string;
  readonly split: string;
  readonly artifactSha256: string;
  readonly normalizedFingerprint: string;
}

/**
 * SHA-256 over the whole validated dataset's identity.
 *
 * Sorted before hashing, so the same corpus assembled in a different order is the same dataset — and
 * a corpus with one changed character, one different lineage or one moved split is not.
 */
export function validatedDatasetSha256(records: readonly RiyaDatasetIdentityRecord[]): string {
  const sorted = [...records]
    .map((record) => [
      record.trajectoryId,
      record.trajectoryRevision,
      record.lineageRootRef,
      record.split,
      record.artifactSha256,
      record.normalizedFingerprint,
    ])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  return sha256OfCanonical(sorted);
}

/** The same digest, recomputed from a manifest's own records. This is the pairing proof. */
export function validatedDatasetSha256FromManifestRecords(
  records: readonly RiyaDatasetManifestRecordV1[],
): string {
  return validatedDatasetSha256(
    records.map((record) => ({
      trajectoryId: record.trajectoryId,
      trajectoryRevision: record.trajectoryRevision,
      lineageRootRef: record.lineageRootRef,
      split: record.split,
      artifactSha256: record.sha256,
      normalizedFingerprint: record.normalizedFingerprint,
    })),
  );
}

/** SHA-256 over every report field except `reportSha256` itself. */
export function reportSha256(report: Omit<RiyaDatasetReleaseReportV1, 'reportSha256'>): string {
  return sha256OfCanonical(report);
}

/** Recompute the report digest and compare. `true` only if nothing was edited. */
export function riyaDatasetReportIntegrityHolds(report: RiyaDatasetReleaseReportV1): boolean {
  const { reportSha256: claimed, ...body } = report;
  return reportSha256(body) === claimed;
}
