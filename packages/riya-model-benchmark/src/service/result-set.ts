/**
 * A benchmark RESULT SET: one configuration, measured across cases (RMB-A).
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
 *
 * ### One configuration, MANY workload cases
 *
 * A set is one subject, one environment, one suite, one harness and one measurement policy — measured
 * across as many differently-shaped cases as the suite defines.
 *
 * Homogeneity on subject and environment is what makes the set a claim about something real: without
 * it, `case.alpha` could be measured on one model and `case.beta` on another, and the aggregate would
 * describe a machine that does not exist. Equality there is by SHA-256 over the canonical form rather
 * than a field list, which stops covering a field the moment somebody adds one.
 *
 * Case SHAPE, though, is meant to vary. An earlier version required full workload parity inside a set,
 * which made `short/c1`, `long/c1`, `short/c8` and `short/c32` illegal together — and the owner goal
 * is maximum useful throughput under RISING concurrency, which cannot be measured by a set that may
 * hold only one concurrency. Prompt size, output cap, concurrency, batch, request counts, streaming
 * and sampling config are therefore free to differ per case.
 *
 * Full workload parity is still required, but INTER-SET and per matched case: A's `short/c8` against
 * B's `short/c8`. That check lives in the comparison layer, where it belongs.
 *
 * ### Verification is deep, never a hash comparison
 *
 * `sha256OfCanonical` is unkeyed, so anyone who can edit an artifact can recompute its digest. A set
 * therefore re-proves every member through `verifyRiyaBenchmarkEvidence` before it will believe any of
 * them, and `verifyRiyaBenchmarkResultSet` does the same for a stored set. A digest that agrees with a
 * body proves the two were written together; it proves nothing about whether the body is a valid
 * measurement.
 */
import { z } from 'zod';

import { RiyaBenchmarkError } from '../contracts/errors.js';
import { verifyRiyaBenchmarkEvidence } from '../contracts/evidence.js';
import type { RiyaBenchmarkEvidenceV1 } from '../contracts/evidence.js';
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
    // Each member is deeply re-proved below; this bounds the collection.
    results: z.array(z.unknown()).max(RIYA_BENCHMARK_MAX_CASES),
    expectedCaseIds: z.array(z.string().min(1).max(128)).min(1).max(RIYA_BENCHMARK_MAX_CASES),
  })
  .strict();

const storedSchema = z
  .object({
    version: z.literal(1),
    results: z.array(z.unknown()).min(1).max(RIYA_BENCHMARK_MAX_CASES),
    caseIds: z.array(z.string().min(1).max(128)).min(1).max(RIYA_BENCHMARK_MAX_CASES),
    manifestDigest: z.string().regex(SHA256_HEX),
    resultSetDigest: z.string().regex(SHA256_HEX),
  })
  .strict();

const manifestDigestOf = (caseIds: readonly string[]): string =>
  sha256OfCanonical({ version: 1, caseIds });

const resultSetDigestOf = (
  manifestDigest: string,
  results: readonly RiyaBenchmarkEvidenceV1[],
): string =>
  sha256OfCanonical({
    version: 1,
    manifestDigest,
    // Digests, not bodies. The set's identity is the identity of what it contains, in order.
    evidenceDigests: results.map((one) => one.evidenceDigest),
  });

/**
 * The checks a group of verified results must pass to be ONE set.
 *
 * Shared by construction and by stored verification, so the two can never disagree about what a valid
 * set is.
 */
function proveSetInvariants(
  results: readonly RiyaBenchmarkEvidenceV1[],
  expectedCaseIds: readonly string[],
): void {
  const expected = [...expectedCaseIds].sort();
  if (new Set(expected).size !== expected.length) {
    throw new RiyaBenchmarkError('MANIFEST_DUPLICATE_CASE');
  }

  const seen = new Set<string>();
  for (const evidence of results) {
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

  // One configuration. Canonical-digest equality rather than field-by-field, so a field added to the
  // subject or the environment later is covered without anybody remembering to extend this.
  if (new Set(results.map((one) => sha256OfCanonical(one.subject))).size > 1) {
    throw new RiyaBenchmarkError('RESULT_SET_SUBJECT_MISMATCH');
  }
  if (new Set(results.map((one) => sha256OfCanonical(one.environment))).size > 1) {
    throw new RiyaBenchmarkError('RESULT_SET_ENVIRONMENT_MISMATCH');
  }

  // One harness, one set of measurement rules -- and that is ALL that must be uniform about the
  // workloads. Requiring full workload parity here was wrong: it made `short/c1`, `long/c1`,
  // `short/c8` and `short/c32` illegal in one set, which is exactly the sweep the owner goal needs.
  // Throughput under RISING concurrency is unmeasurable if a set may hold only one concurrency.
  //
  // Each axis is checked separately so a mixed-suite set and a mixed-policy set are different
  // answers to whoever has to fix one.
  const suites = new Set(
    results.map(
      (one) => `${one.workload.benchmarkSuiteId}|${String(one.workload.benchmarkSuiteVersion)}`,
    ),
  );
  if (suites.size > 1) {
    throw new RiyaBenchmarkError('RESULT_SET_SUITE_MISMATCH');
  }
  const implementations = new Set(
    results.map(
      (one) =>
        `${one.workload.benchmarkImplementationId}|${String(one.workload.benchmarkImplementationVersion)}`,
    ),
  );
  if (implementations.size > 1) {
    throw new RiyaBenchmarkError('RESULT_SET_IMPLEMENTATION_MISMATCH');
  }
  if (new Set(results.map((one) => one.workload.measurementPolicyRef)).size > 1) {
    // Two harnesses can agree on every number and still disagree about what a p95 IS.
    throw new RiyaBenchmarkError('RESULT_SET_MEASUREMENT_POLICY_MISMATCH');
  }
}

const byCaseId = (
  results: readonly RiyaBenchmarkEvidenceV1[],
): readonly RiyaBenchmarkEvidenceV1[] =>
  Object.freeze(
    [...results].sort((a, b) => (a.workload.workloadCaseId < b.workload.workloadCaseId ? -1 : 1)),
  );

/**
 * Build a result set from evidence, refusing anything that is not one whole configuration.
 *
 * Every member is deeply re-proved on the way in. Throws `MANIFEST_DUPLICATE_CASE`,
 * `MANIFEST_CASE_MISSING`, `MANIFEST_CASE_UNEXPECTED`, `RESULT_SET_SUBJECT_MISMATCH`,
 * `RESULT_SET_ENVIRONMENT_MISMATCH`, `COMPARISON_NOT_PARITY` or a nested contract's own code.
 */
export function createRiyaBenchmarkResultSet(
  input: RiyaBenchmarkResultSetInput,
): RiyaBenchmarkResultSetV1 {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('RESULT_SET_INVALID');
  }

  // DEEP, not a digest comparison. A set is only as trustworthy as its weakest member, and "it was
  // valid when we wrote it" is not a property of a file.
  const results = byCaseId(parsed.data.results.map((one) => verifyRiyaBenchmarkEvidence(one)));
  proveSetInvariants(results, input.expectedCaseIds);

  const caseIds = Object.freeze([...input.expectedCaseIds].sort());
  const manifestDigest = manifestDigestOf(caseIds);
  const resultSetDigest = resultSetDigestOf(manifestDigest, results);

  return Object.freeze({ version: 1 as const, results, caseIds, manifestDigest, resultSetDigest });
}

/**
 * Verify a STORED or otherwise untrusted result set, and return the canonical reconstruction.
 *
 * Full canonical surface required, unknown keys refused, every member deeply re-proved, ordering
 * re-derived, `caseIds` required to equal the cases actually present, homogeneity and parity proved,
 * and both digests recomputed from the reconstruction and compared.
 *
 * It never restamps. A stored set whose digests do not match what its contents imply is refused, not
 * quietly re-signed — silently correcting an artifact is how a forged one becomes a trusted one.
 */
export function verifyRiyaBenchmarkResultSet(candidate: unknown): RiyaBenchmarkResultSetV1 {
  const parsed = storedSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RiyaBenchmarkError('RESULT_SET_INVALID');
  }

  const results = byCaseId(parsed.data.results.map((one) => verifyRiyaBenchmarkEvidence(one)));

  // The manifest must describe what is actually here — not a superset it once described.
  const actual = [...results.map((one) => one.workload.workloadCaseId)].sort();
  const claimed = [...parsed.data.caseIds].sort();
  if (actual.length !== claimed.length || actual.some((id, index) => id !== claimed[index])) {
    throw new RiyaBenchmarkError('MANIFEST_CASE_MISSING');
  }
  proveSetInvariants(results, claimed);

  const caseIds = Object.freeze(claimed);
  const manifestDigest = manifestDigestOf(caseIds);
  if (manifestDigest !== parsed.data.manifestDigest) {
    throw new RiyaBenchmarkError('DIGEST_INVALID');
  }
  const resultSetDigest = resultSetDigestOf(manifestDigest, results);
  if (resultSetDigest !== parsed.data.resultSetDigest) {
    throw new RiyaBenchmarkError('DIGEST_INVALID');
  }

  return Object.freeze({ version: 1 as const, results, caseIds, manifestDigest, resultSetDigest });
}

/**
 * True iff `candidate` is a fully valid canonical result set.
 *
 * TOTAL: accepts anything, catches everything, returns a boolean. This is the deep check — the same
 * one `verifyRiyaBenchmarkResultSet` performs — not a digest comparison.
 */
export function riyaBenchmarkResultSetIntegrityHolds(candidate: unknown): boolean {
  try {
    verifyRiyaBenchmarkResultSet(candidate);
    return true;
  } catch {
    return false;
  }
}
