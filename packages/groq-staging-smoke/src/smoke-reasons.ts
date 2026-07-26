/**
 * The closed, sanitized smoke-harness outcome vocabulary (QFJ-S1A, ADR-0061 §H, and §E of the
 * implementation contract).
 *
 * Every path out of the harness resolves to exactly one of these codes. A code carries NO cause, NO
 * message, NO raw body/header/error, NO key or credential reference value, NO prompt text, and NO model
 * output. That is the whole point: an operator reading a failed staging run learns WHICH gate refused,
 * never WHAT was in flight. There is no `unknown`/passthrough member — an unmapped condition becomes
 * `smoke-invariant`, which is a bug in this harness rather than a place for a raw string to escape.
 */

/** The single success code. */
export const SMOKE_SUCCESS_REASON = 'smoke-completed';

/** The closed set of sanitized failure codes. */
export const SMOKE_FAILURE_REASONS = [
  /** The configuration file is missing, unreadable, not JSON, or fails the strict closed schema. */
  'smoke-config-invalid',
  /** The configuration carried a forbidden field class: secret/key/token/password, prompt or output
   *  text, or a URL/endpoint/header/arbitrary provider option. Rejected without echoing the value. */
  'smoke-config-secret-field-forbidden',
  /** stdin/stdout is not an interactive terminal. Refused BEFORE any credential read is attempted. */
  'smoke-tty-required',
  /** The typed credential failed the bounded length/charset check, or a second read was attempted. */
  'smoke-credential-invalid',
  /** `bindGroqStagingProvider` refused. The sanitized gateway bind reason is reported alongside. */
  'smoke-bind-refused',
  /** The harness-owned timer fired and aborted the single in-flight request. */
  'smoke-timeout',
  /** The single request was cancelled without the harness timer having fired. */
  'smoke-cancelled',
  /** The provider returned a normalized non-retryable failure. */
  'smoke-provider-failed',
  /** The provider returned a normalized retryable unavailability (including a 429 or a 5xx). */
  'smoke-provider-unavailable',
  /** The provider returned a response that failed strict structural validation. */
  'smoke-provider-malformed',
  /** A harness invariant was violated (for example an attempted second invocation). A harness bug. */
  'smoke-invariant',
] as const;

export type SmokeFailureReason = (typeof SMOKE_FAILURE_REASONS)[number];
export type SmokeReason = typeof SMOKE_SUCCESS_REASON | SmokeFailureReason;

/** True iff `value` is one of the closed sanitized codes. Used to prove nothing else can escape. */
export function isSmokeReason(value: unknown): value is SmokeReason {
  return (
    value === SMOKE_SUCCESS_REASON ||
    (SMOKE_FAILURE_REASONS as readonly string[]).includes(value as string)
  );
}
