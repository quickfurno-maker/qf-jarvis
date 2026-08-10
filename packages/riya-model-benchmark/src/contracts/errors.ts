/**
 * The closed error vocabulary of operational benchmark evidence (RMB-A).
 *
 * Closed codes, never free text. A caller branching on a message string is a caller that breaks when
 * somebody improves the wording, and an error you cannot branch on is a log line rather than a
 * contract.
 *
 * Nothing here carries a measured value, an identifier or any content. A benchmark failure says WHAT
 * was wrong and WHERE, never what the number was — the same discipline the dataset and evaluation
 * packages already keep, for the same reason: an error path is the easiest place for content to leak
 * out of a system that was careful everywhere else.
 */

export const RIYA_BENCHMARK_ERROR_CODES = [
  'SUBJECT_INVALID',
  'ENVIRONMENT_INVALID',
  'WORKLOAD_INVALID',
  'OBSERVATION_INVALID',
  'REQUEST_COUNT_MISMATCH',
  'PERCENTILE_ORDER_INVALID',
  'TOKEN_MEASUREMENT_INVALID',
  'MANIFEST_DUPLICATE_CASE',
  'MANIFEST_CASE_MISSING',
  'MANIFEST_CASE_UNEXPECTED',
  // A result set is one configuration measured across cases. Two cases measured on different
  // releases, or on different hardware, is a stitched artifact rather than a benchmark — and it is
  // its own mistake, distinct from a workload-parity break, so it gets its own code.
  'RESULT_SET_SUBJECT_MISMATCH',
  'RESULT_SET_ENVIRONMENT_MISMATCH',
  // A suite may vary its workload cases -- that is what a suite IS -- but not the harness that ran
  // them or the rules it measured by. Three axes, three codes, because a set that mixed suites and a
  // set that mixed measurement policies are different problems for whoever has to fix one.
  'RESULT_SET_SUITE_MISMATCH',
  'RESULT_SET_IMPLEMENTATION_MISMATCH',
  'RESULT_SET_MEASUREMENT_POLICY_MISMATCH',
  'RESULT_SET_INVALID',
  'DIGEST_INVALID',
  'EVIDENCE_TAMPERED',
  'COMPARISON_NOT_PARITY',
] as const;

export type RiyaBenchmarkErrorCode = (typeof RIYA_BENCHMARK_ERROR_CODES)[number];

/** The one error type this package throws. Carries a closed code and nothing measured. */
export class RiyaBenchmarkError extends Error {
  public readonly code: RiyaBenchmarkErrorCode;

  public constructor(code: RiyaBenchmarkErrorCode) {
    super(code);
    this.name = 'RiyaBenchmarkError';
    this.code = code;
  }
}
