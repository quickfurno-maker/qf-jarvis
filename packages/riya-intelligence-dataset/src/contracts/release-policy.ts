/**
 * The versioned release validation policy (RID-F1 owner correction on PR #112).
 *
 * ### What it closes
 *
 * The protected-exam index and the coverage policy were both OPTIONAL arguments to validation.
 * Omitting the index silently substituted an empty one, which matches nothing, produces no finding
 * and yields `eligible: true` — a release that looks clean precisely because the firewall never ran.
 * Omitting the coverage policy did the same for coverage, and release evidence then accepted a
 * policy id and version that had no connection to the validation that produced the report.
 *
 * A gate you can skip by leaving out an argument is not a gate.
 *
 * ### It PINS the exam corpus
 *
 * `protectedIndexSha256` and `protectedEntryCount` name the exact protected corpus a dataset must
 * have been checked against. Validation refuses to bind if the index it was handed does not match,
 * so "the P10 firewall ran, against the right corpus, in full" becomes a checkable property of the
 * report rather than a claim about how somebody invoked it.
 *
 * ### It hard-codes nothing about P10
 *
 * No `72`, no fixture identifier, no fixture text. The Gold V1 release policy — authored as data by a
 * later slice — pins the real corpus; specs here pin tiny synthetic ones. Naming the real exam in
 * production source is the same mistake the leakage firewall exists to catch.
 */
import { z } from 'zod';

import { createRiyaDatasetCoveragePolicy } from './coverage-policy.js';
import type { RiyaDatasetCoveragePolicyV1 } from './coverage-policy.js';
import { RiyaDatasetError } from './errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../internal/sha256.js';

export interface RiyaDatasetReleasePolicyV1 {
  readonly version: 1;
  readonly policyId: string;
  readonly policyVersion: number;
  /** The exact coverage policy validation must apply. Bound, not supplied alongside. */
  readonly coveragePolicy: RiyaDatasetCoveragePolicyV1;
  /** An opaque name for the protected corpus. Never its content. */
  readonly protectedCorpusRef: string;
  readonly protectedIndexSha256: string;
  readonly protectedEntryCount: number;
}

export interface RiyaDatasetReleasePolicyInput {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly coveragePolicy: RiyaDatasetCoveragePolicyV1;
  readonly protectedCorpusRef: string;
  readonly protectedIndexSha256: string;
  readonly protectedEntryCount: number;
}

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const policySchema = z
  .object({
    policyId: REF,
    policyVersion: z.int().min(1).max(1_000_000),
    // Re-proved through its own constructor below.
    coveragePolicy: z.unknown(),
    protectedCorpusRef: REF,
    protectedIndexSha256: z.string().regex(SHA256_HEX),
    // Zero is refused. A policy expecting no protected corpus is a policy that disables the exam
    // firewall, and that decision must be an ADR rather than a field somebody set to 0.
    protectedEntryCount: z.int().min(1).max(1_000_000),
  })
  .strict();

/** Validate and freeze a release policy. Throws `invalid-release-policy`. */
export function createRiyaDatasetReleasePolicy(
  input: RiyaDatasetReleasePolicyInput,
): RiyaDatasetReleasePolicyV1 {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-release-policy');
  }
  let coveragePolicy: RiyaDatasetCoveragePolicyV1;
  try {
    // The FULL nested value, so the coverage constructor's own strictness applies.
    coveragePolicy = createRiyaDatasetCoveragePolicy(input.coveragePolicy);
  } catch {
    throw new RiyaDatasetError('invalid-release-policy');
  }
  return Object.freeze({
    version: 1 as const,
    policyId: parsed.data.policyId,
    policyVersion: parsed.data.policyVersion,
    coveragePolicy,
    protectedCorpusRef: parsed.data.protectedCorpusRef,
    protectedIndexSha256: parsed.data.protectedIndexSha256,
    protectedEntryCount: parsed.data.protectedEntryCount,
  });
}

/**
 * The content digest of a coverage policy.
 *
 * A report names the coverage policy by id and version AND by digest, so a policy edited in place
 * without a version bump does not silently keep attesting old releases.
 */
export function coveragePolicySha256(policy: RiyaDatasetCoveragePolicyV1): string {
  return sha256OfCanonical(policy);
}
