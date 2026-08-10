/**
 * A benchmark RESULT SET: the whole suite for one subject, and its manifest (RMB-A).
 *
 * ### The manifest is what makes a comparison honest
 *
 * A single case is a number. A result set is a claim about a configuration — and the way that claim
 * goes wrong is selection. Run twelve cases, keep the eight that looked good, and every downstream
 * comparison is between one model's best cases and another's full spread, with nothing in either
 * artifact revealing it.
 *
 * So a set names the cases it was supposed to contain, and refuses anything else. Missing, duplicated
 * and unexpected are three separate codes because they are three different mistakes: a case that
 * failed to run, a case counted twice, and a case that came from somewhere else.
 */
import { z } from 'zod';

import { RiyaBenchmarkError } from '../contracts/errors.js';
import { riyaBenchmarkEvidenceIntegrityHolds } from '../contracts/evidence.js';
import type { RiyaBenchmarkEvidenceV1 } from '../contracts/evidence.js';
import { workloadParityKey } from '../contracts/workload.js';
import { RIYA_BENCHMARK_MAX_CASES } from '../contracts/vocabularies.js';
import { SHA256_HEX, sha256OfCanonical } from '../internal/digest.js';

export interface RiyaBenchmarkResultSetV1 {
  readonly version: 1;
  /** Sorted by `workloadCaseId`, always. Two harnesses ordering differently is not two results. */
  readonly results: readonly RiyaBenchmarkEvidenceV1[];
  /** The case ids, sorted. The manifest's whole content. */
  readonly caseIds: readonly string[];
  readonly manifestDigest: string;
  readonly resultSetDigest: string;
}

export interface RiyaBenchmarkResultSetInput {
  readonly version: 1;
  readonly results: readonly RiyaBenchmarkEvidenceV1[];
  /** Exactly the cases this set must contain. Not a filter — a contract. */
  readonly expectedCaseIds: readonly string[];
}

const inputSchema = z
  .object({
    version: z.literal(1),
    // Each artifact is re-verified below by its own integrity check; this bounds the collection.
    results: z.array(z.unknown()).max(RIYA_BENCHMARK_MAX_CASES),
    expectedCaseIds: z.array(z.string().min(1).max(128)).min(1).max(RIYA_BENCHMARK_MAX_CASES),
  })
  .strict();

/**
 * Build a result set, refusing any set that does not match its expected cases exactly.
 *
 * Throws `MANIFEST_DUPLICATE_CASE`, `MANIFEST_CASE_MISSING`, `MANIFEST_CASE_UNEXPECTED`,
 * `EVIDENCE_TAMPERED` or `COMPARISON_NOT_PARITY`.
 */
export function createRiyaBenchmarkResultSet(
  input: RiyaBenchmarkResultSetInput,
): RiyaBenchmarkResultSetV1 {
  // Shape first, through zod like every other contract here — `Array.isArray` on an already-typed
  // field widens it to `any[]` and quietly disables the type checking further down.
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('OBSERVATION_INVALID');
  }

  const expected = [...input.expectedCaseIds].sort();
  if (new Set(expected).size !== expected.length) {
    throw new RiyaBenchmarkError('MANIFEST_DUPLICATE_CASE');
  }

  const seen = new Set<string>();
  for (const evidence of input.results) {
    // Every artifact re-checked. A set built from stored evidence is only as trustworthy as the
    // weakest artifact in it, and "it was valid when we wrote it" is not a property of a file.
    if (!riyaBenchmarkEvidenceIntegrityHolds(evidence)) {
      throw new RiyaBenchmarkError('EVIDENCE_TAMPERED');
    }
    const caseId = evidence.workload.workloadCaseId;
    if (seen.has(caseId)) {
      throw new RiyaBenchmarkError('MANIFEST_DUPLICATE_CASE');
    }
    seen.add(caseId);
    if (!expected.includes(caseId)) {
      throw new RiyaBenchmarkError('MANIFEST_CASE_UNEXPECTED');
    }
  }
  for (const caseId of expected) {
    if (!seen.has(caseId)) {
      throw new RiyaBenchmarkError('MANIFEST_CASE_MISSING');
    }
  }

  // Every case in a set must have been measured the same way. A set mixing concurrencies is not one
  // measurement of a configuration, and its aggregate would be meaningless.
  const parityKeys = new Set(input.results.map((one) => workloadParityKey(one.workload)));
  if (parityKeys.size > 1) {
    throw new RiyaBenchmarkError('COMPARISON_NOT_PARITY');
  }

  const results = Object.freeze(
    [...input.results].sort((a, b) =>
      a.workload.workloadCaseId < b.workload.workloadCaseId ? -1 : 1,
    ),
  );
  const caseIds = Object.freeze(expected);
  const manifestDigest = sha256OfCanonical({ version: 1, caseIds });
  const resultSetDigest = sha256OfCanonical({
    version: 1,
    manifestDigest,
    // Digests, not bodies. The set's identity is the identity of what it contains.
    evidenceDigests: results.map((one) => one.evidenceDigest),
  });

  return Object.freeze({ version: 1 as const, results, caseIds, manifestDigest, resultSetDigest });
}

/** True iff a result set still hashes to the digests it carries. Total, never throws. */
export function riyaBenchmarkResultSetIntegrityHolds(set: RiyaBenchmarkResultSetV1): boolean {
  if (!SHA256_HEX.test(set.manifestDigest) || !SHA256_HEX.test(set.resultSetDigest)) {
    return false;
  }
  const manifestDigest = sha256OfCanonical({ version: 1, caseIds: set.caseIds });
  if (manifestDigest !== set.manifestDigest) {
    return false;
  }
  const resultSetDigest = sha256OfCanonical({
    version: 1,
    manifestDigest,
    evidenceDigests: set.results.map((one) => one.evidenceDigest),
  });
  return (
    resultSetDigest === set.resultSetDigest &&
    set.results.every((one) => riyaBenchmarkEvidenceIntegrityHolds(one))
  );
}
