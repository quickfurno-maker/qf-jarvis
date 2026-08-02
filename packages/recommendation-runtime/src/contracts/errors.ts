/**
 * The bounded runtime error contract (QFJ-P05.05, ADR-0079).
 *
 * Four codes, four fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input, the schema, or anything a caller supplied.
 *
 * That matters here for a specific reason. This runtime validates recommendations whose parameters
 * are governed precisely because somebody will eventually put an API key, a phone number or a raw
 * transcript in them — and the governed-parameter scan in `@qf-jarvis/contracts` is careful to
 * report the PATH of an offending value and never the value itself. An error surface that echoed a
 * Zod issue tree would undo that: the validator that refused the secret would then have logged it.
 *
 * So Zod issues are discarded entirely. The code says which of four things went wrong, which is what
 * a caller needs, and nothing further. Rationale, evidence, summaries, subject references,
 * identifiers and crypto errors never reach a message.
 */
const RECOMMENDATION_RUNTIME_ERROR_CODE_VALUES = [
  /** The supplied input is not a valid recommendation input. Nothing was generated. */
  'invalid-input',
  /** The identity port threw, or returned an identifier that is not a contract UUID. */
  'identity-failure',
  /** The assembled recommendation failed `recommendationV1Schema`. Nothing is returned. */
  'recommendation-invalid',
  /** A proposed action could not be canonicalized or digested into a valid fingerprint. */
  'fingerprint-failure',
] as const;

export type RecommendationRuntimeErrorCode =
  (typeof RECOMMENDATION_RUNTIME_ERROR_CODE_VALUES)[number];

export const RECOMMENDATION_RUNTIME_ERROR_CODES: readonly RecommendationRuntimeErrorCode[] =
  Object.freeze([...RECOMMENDATION_RUNTIME_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<RecommendationRuntimeErrorCode, string>> = Object.freeze({
  'invalid-input': 'A recommendation input is invalid.',
  'identity-failure': 'A recommendation or action identity could not be generated.',
  'recommendation-invalid': 'The assembled recommendation is not a valid RecommendationV1.',
  'fingerprint-failure': 'A proposed action could not be fingerprinted.',
});

/** A bounded runtime error. The code is the contract; the message is fixed per code. */
export class RecommendationRuntimeError extends Error {
  readonly code: RecommendationRuntimeErrorCode;

  constructor(code: RecommendationRuntimeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RecommendationRuntimeError';
    this.code = code;
  }
}
