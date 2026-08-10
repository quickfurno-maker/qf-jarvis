/**
 * The immutable dataset manifest (RID-F1, ADR-0107 §28).
 *
 * ### What a manifest is for
 *
 * Months after a model is trained, somebody has to answer "which exact corpus produced these
 * weights?". A manifest is that answer: one row per trajectory, each with its artifact SHA-256 and
 * its conversation fingerprint, plus a `manifestSha256` over everything else.
 *
 * ### It carries no text and no reviewer
 *
 * A row names an id, a revision, a lineage, a split, a source kind, a risk class and two digests.
 * Not a sentence, not a persona's words, not a `reviewRef`. A manifest is the thing most likely to be
 * copied into a ticket or a wiki page, so it is the last artifact that should carry conversation
 * content — and a manifest listing which reviewer touched which row would be a performance record of
 * named people, assembled as a side effect of versioning a corpus.
 *
 * ### Records are sorted before hashing
 *
 * Two builders that assembled the same corpus in different orders must produce the same manifest and
 * the same digest, or "the same dataset" would mean nothing.
 */
import { z } from 'zod';

import { RiyaDatasetError } from './errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../internal/sha256.js';
import {
  RIYA_DATASET_RISK_CLASSES,
  RIYA_DATASET_SOURCE_KINDS,
  RIYA_DATASET_SPLITS,
} from './vocabularies.js';
import type {
  RiyaDatasetRiskClass,
  RiyaDatasetSourceKind,
  RiyaDatasetSplit,
} from './vocabularies.js';

export interface RiyaDatasetManifestRecordV1 {
  readonly trajectoryId: string;
  readonly trajectoryRevision: number;
  readonly lineageRootRef: string;
  readonly split: RiyaDatasetSplit;
  readonly sourceKind: RiyaDatasetSourceKind;
  readonly riskClass: RiyaDatasetRiskClass;
  readonly sha256: string;
  readonly normalizedFingerprint: string;
}

export interface RiyaIntelligenceDatasetManifestV1 {
  readonly version: 1;
  readonly datasetId: string;
  readonly datasetVersion: number;
  /** Which trajectory contract shape the records were built against. */
  readonly schemaVersion: number;
  /** Which governance policy the release was gated under. */
  readonly policyVersion: number;
  readonly createdAt: string;
  readonly records: readonly RiyaDatasetManifestRecordV1[];
  readonly counts: Readonly<Record<RiyaDatasetSplit, number>>;
  /** SHA-256 over every field above. Commits to the whole manifest except itself. */
  readonly manifestSha256: string;
}

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const recordSchema = z
  .object({
    trajectoryId: REF,
    trajectoryRevision: z.int().min(1).max(1_000_000),
    lineageRootRef: REF,
    split: z.enum(RIYA_DATASET_SPLITS),
    sourceKind: z.enum(RIYA_DATASET_SOURCE_KINDS),
    riskClass: z.enum(RIYA_DATASET_RISK_CLASSES),
    sha256: z.string().regex(SHA256_HEX),
    normalizedFingerprint: z.string().regex(SHA256_HEX),
  })
  .strict();

const manifestInputSchema = z
  .object({
    datasetId: REF,
    datasetVersion: z.int().min(1).max(1_000_000),
    schemaVersion: z.int().min(1).max(1_000_000),
    policyVersion: z.int().min(1).max(1_000_000),
    createdAt: z.string().regex(CANONICAL_INSTANT),
    records: z.array(recordSchema).min(1).max(1_000_000),
  })
  .strict();

export interface RiyaIntelligenceDatasetManifestInput {
  readonly datasetId: string;
  readonly datasetVersion: number;
  readonly schemaVersion: number;
  readonly policyVersion: number;
  readonly createdAt: string;
  readonly records: readonly RiyaDatasetManifestRecordV1[];
}

/** The canonical digest preimage: everything except `manifestSha256` itself. */
function manifestDigestOf(
  manifest: Omit<RiyaIntelligenceDatasetManifestV1, 'manifestSha256'>,
): string {
  return sha256OfCanonical({
    version: manifest.version,
    datasetId: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    schemaVersion: manifest.schemaVersion,
    policyVersion: manifest.policyVersion,
    createdAt: manifest.createdAt,
    records: manifest.records,
    counts: manifest.counts,
  });
}

/** Validate, sort, count and seal a manifest. Throws `invalid-manifest` or `duplicate-trajectory`. */
export function createRiyaIntelligenceDatasetManifest(
  input: RiyaIntelligenceDatasetManifestInput,
): RiyaIntelligenceDatasetManifestV1 {
  const parsed = manifestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-manifest');
  }
  const ids = parsed.data.records.map((record) => record.trajectoryId);
  if (new Set(ids).size !== ids.length) {
    throw new RiyaDatasetError('duplicate-trajectory');
  }

  const records = [...parsed.data.records]
    .map((record) => Object.freeze({ ...record }))
    .sort((a, b) =>
      a.trajectoryId < b.trajectoryId ? -1 : a.trajectoryId > b.trajectoryId ? 1 : 0,
    );

  const counts: Record<RiyaDatasetSplit, number> = { TRAIN: 0, VALIDATION: 0, HOLDOUT: 0 };
  for (const record of records) {
    counts[record.split] += 1;
  }

  const body = {
    version: 1 as const,
    datasetId: parsed.data.datasetId,
    datasetVersion: parsed.data.datasetVersion,
    schemaVersion: parsed.data.schemaVersion,
    policyVersion: parsed.data.policyVersion,
    createdAt: parsed.data.createdAt,
    records: Object.freeze(records),
    counts: Object.freeze(counts),
  };

  return Object.freeze({ ...body, manifestSha256: manifestDigestOf(body) });
}

/** Recompute the manifest digest and compare. `true` only if nothing was edited. */
export function riyaDatasetManifestIntegrityHolds(
  manifest: RiyaIntelligenceDatasetManifestV1,
): boolean {
  const { manifestSha256, ...body } = manifest;
  return manifestDigestOf(body) === manifestSha256;
}
