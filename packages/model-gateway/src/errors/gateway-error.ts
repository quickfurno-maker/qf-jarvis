/**
 * The closed, safe error vocabulary of the model gateway (QFJ-P04.01A, ADR-0045).
 *
 * A gateway failure is a bounded CODE and a FIXED message — never a prompt, user/client/vendor content,
 * a subject reference, a provider header, an API key, a raw provider error body, or a stack trace. The
 * constructor accepts only a code, normalised at runtime against the closed table, so neither `message`
 * nor `code` can carry caller/provider text; a wrapped provider error is deliberately NOT retained as
 * `cause`. Callers branch on the stable {@link ModelGatewayErrorCode}, never by parsing a message.
 */

const MODEL_GATEWAY_ERROR_MESSAGES = {
  'gateway-off': 'The model gateway is not serving model calls in its current mode.',
  'human-only': 'The request is HUMAN_ONLY and reaches no model provider.',
  'no-eligible-provider': 'No registered provider is eligible for the request.',
  'local-provider-required':
    'A LOCAL_ONLY request has no eligible local provider and cannot use a hosted one.',
  'capability-mismatch': 'No eligible provider declares the capabilities the request requires.',
  'queue-full': 'The gateway request queue is at capacity.',
  'concurrency-limit': 'The gateway concurrency limit is reached.',
  'token-budget-exceeded': 'The request would exceed its token budget.',
  'cost-budget-exceeded': 'The request would exceed its cost budget.',
  timeout: 'The provider invocation timed out.',
  cancelled: 'The request was cancelled.',
  'retry-budget-exhausted': 'The retry budget was exhausted without a valid result.',
  'circuit-open': 'The provider circuit is open and the request cannot be served.',
  'kill-switch-active': 'The emergency kill switch is active; no model invocation is permitted.',
  'provider-unavailable': 'The selected provider reported itself unavailable.',
  'provider-failed': 'The provider invocation failed.',
  'malformed-provider-output': 'The provider returned output that could not be parsed.',
  'structured-output-invalid':
    'The provider output did not satisfy the requested structured-output schema.',
  'request-invalid': 'The model request is not a valid, minimized, provider-neutral request.',
  'internal-invariant': 'A gateway internal invariant was violated.',
} as const;

/** The closed set of gateway error codes. */
export const MODEL_GATEWAY_ERROR_CODES = Object.freeze(
  Object.keys(MODEL_GATEWAY_ERROR_MESSAGES) as ModelGatewayErrorCode[],
);

/** One gateway error code. */
export type ModelGatewayErrorCode = keyof typeof MODEL_GATEWAY_ERROR_MESSAGES;

/** The safe, generic classification applied when a supplied code is not one of the closed codes. */
const GATEWAY_FALLBACK_CODE: ModelGatewayErrorCode = 'internal-invariant';

function normalizeGatewayCode(code: unknown): ModelGatewayErrorCode {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(MODEL_GATEWAY_ERROR_MESSAGES, code)
    ? (code as ModelGatewayErrorCode)
    : GATEWAY_FALLBACK_CODE;
}

/**
 * A gateway failure. The constructor accepts ONLY a closed code (normalised at runtime), so neither
 * `message` nor `code` can carry caller/provider text, and no `cause` is retained.
 */
export class ModelGatewayError extends Error {
  public readonly code: ModelGatewayErrorCode;

  public constructor(code: ModelGatewayErrorCode) {
    const safeCode = normalizeGatewayCode(code);
    super(MODEL_GATEWAY_ERROR_MESSAGES[safeCode]);
    this.name = 'ModelGatewayError';
    this.code = safeCode;
  }
}

/** True iff `value` is a {@link ModelGatewayError} carrying a closed code. */
export function isModelGatewayError(value: unknown): value is ModelGatewayError {
  return (
    value instanceof ModelGatewayError &&
    typeof value.code === 'string' &&
    (MODEL_GATEWAY_ERROR_CODES as readonly string[]).includes(value.code)
  );
}
