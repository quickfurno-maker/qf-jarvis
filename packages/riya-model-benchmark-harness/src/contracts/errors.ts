/**
 * The closed error vocabulary of the benchmark harness (RMB-B).
 *
 * ### Two kinds of bad, and only one of them is a number
 *
 * A target that returns a failure is DATA — it goes in the observation as a failed request, the suite
 * carries on, and the success rate tells the story. That is not an error and has no code here.
 *
 * These codes are the other kind: the harness, the clock or the target broke its own protocol, so the
 * measurement itself is unsound. A run where the clock went backwards or a success arrived without a
 * first-output callback did not measure what it claims to have measured, and the honest output is no
 * output at all.
 *
 * Nothing here carries a measured value, an identifier or any content.
 */

export const RIYA_HARNESS_ERROR_CODES = [
  'PLAN_INVALID',
  'UNSUPPORTED_BATCH_SIZE',
  'TARGET_SUBJECT_INVALID',
  'TARGET_ENVIRONMENT_INVALID',
  'TARGET_CASE_MISMATCH',
  'CLOCK_INVALID',
  'CLOCK_MOVED_BACKWARD',
  'TARGET_PROTOCOL_INVALID',
  'INPUT_TOKEN_MISMATCH',
  'OUTPUT_TOKEN_LIMIT_EXCEEDED',
  'SUITE_ABORTED',
  'MEMORY_MEASUREMENT_INVALID',
] as const;

export type RiyaHarnessErrorCode = (typeof RIYA_HARNESS_ERROR_CODES)[number];

/** The one error type this package throws. Carries a closed code and nothing measured. */
export class RiyaHarnessError extends Error {
  public readonly code: RiyaHarnessErrorCode;

  public constructor(code: RiyaHarnessErrorCode) {
    super(code);
    this.name = 'RiyaHarnessError';
    this.code = code;
  }
}
