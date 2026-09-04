/**
 * The closed error vocabulary of the local benchmark adapter (AS4-PREP-A).
 *
 * ### Three kinds of bad, and only one of them is a measurement
 *
 * A local engine that returns a 500, or that runs past its deadline, is DATA: the adapter returns an
 * ordinary RMB-B `FAILURE`, the suite carries on, and the success rate tells the story. That has no
 * code here.
 *
 * These codes are the other two kinds. Some are CONFIGURATION refusals raised before anything is
 * measured -- a non-loopback endpoint, a model alias, a prompt profile whose bytes cannot be
 * reproduced. The rest are ENGINE protocol violations: a redirect, a served model that is not the
 * configured one, usage the engine reported that cannot be true. Both mean the run would measure
 * something other than what it claims, and the honest output is no output.
 *
 * ### Nothing here carries content
 *
 * `message` is the code and nothing else. No prompt, no completion, no endpoint, no path, no header,
 * no engine error body. An adapter error is safe to log, print in a CI transcript and paste into a
 * review comment -- which is the whole reason a benchmark adapter gets a closed vocabulary rather than
 * being allowed to re-throw whatever the engine said.
 */

export const RIYA_LOCAL_BENCHMARK_ERROR_CODES = [
  // Configuration, all raised before any engine traffic.
  'ENDPOINT_INVALID',
  'ENDPOINT_NOT_LOOPBACK',
  'ADAPTER_CONFIG_INVALID',
  'MODEL_IDENTITY_NOT_EXACT',
  'PROMPT_PROFILE_UNKNOWN',
  'PROMPT_PROFILE_DIGEST_MISMATCH',
  'SAMPLING_CONFIG_MISMATCH',
  'STREAMING_REQUIRED',
  'REQUEST_TIMEOUT_NOT_MILLISECOND_EXACT',
  'CASE_NOT_PREPARED',
  // The engine broke the protocol the adapter measured it under.
  'ENGINE_REDIRECT_REFUSED',
  'ENGINE_PROTOCOL_INVALID',
  'ENGINE_MODEL_MISMATCH',
  'ENGINE_USAGE_INVALID',
  'TOKENIZER_INVALID',
  // The suite was cancelled. Not latency data, and never recorded as a failed request.
  'REQUEST_CANCELLED',
  // Offline artifact handling, owned by the CLI rather than by the target.
  'ARTIFACT_WRITE_REFUSED',
] as const;

export type RiyaLocalBenchmarkErrorCode = (typeof RIYA_LOCAL_BENCHMARK_ERROR_CODES)[number];

/** The one error type this package throws. Carries a closed code and nothing measured. */
export class RiyaLocalBenchmarkError extends Error {
  public readonly code: RiyaLocalBenchmarkErrorCode;

  public constructor(code: RiyaLocalBenchmarkErrorCode) {
    super(code);
    this.name = 'RiyaLocalBenchmarkError';
    this.code = code;
  }
}
