/**
 * Build a manifest from trajectories (RID-F1, ADR-0107 §28).
 *
 * The digests are computed here rather than accepted from a caller. A manifest whose SHA-256 values
 * were supplied would be an index of what somebody claimed the records were, which is precisely the
 * claim the manifest exists to check.
 */
import {
  createRiyaIntelligenceDatasetManifest,
  type RiyaIntelligenceDatasetManifestV1,
} from '../contracts/manifest.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../internal/trajectory-digest.js';

/** The trajectory contract shape these records were built against. */
export const RIYA_DATASET_SCHEMA_VERSION = 1;

export interface BuildRiyaDatasetManifestInput {
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly policyVersion: number;
  /** A canonical UTC instant. Injected, because this package reads no clock. */
  readonly createdAt: string;
  readonly trajectories: readonly RiyaIntelligenceTrajectoryV1[];
}

/** Compute every digest and seal the manifest. */
export function buildRiyaIntelligenceDatasetManifest(
  input: BuildRiyaDatasetManifestInput,
): RiyaIntelligenceDatasetManifestV1 {
  return createRiyaIntelligenceDatasetManifest({
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    schemaVersion: RIYA_DATASET_SCHEMA_VERSION,
    policyVersion: input.policyVersion,
    createdAt: input.createdAt,
    records: input.trajectories.map((trajectory) => ({
      trajectoryId: trajectory.trajectoryId,
      trajectoryRevision: trajectory.trajectoryRevision,
      lineageRootRef: trajectory.lineageRootRef,
      split: trajectory.split,
      sourceKind: trajectory.source.kind,
      riskClass: trajectory.riskClass,
      sha256: trajectoryArtifactSha256(trajectory),
      normalizedFingerprint: trajectoryConversationFingerprint(trajectory),
    })),
  });
}
