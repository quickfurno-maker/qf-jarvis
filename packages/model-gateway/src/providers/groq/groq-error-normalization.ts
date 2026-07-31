/**
 * Bounded, redacting normalization of Groq HTTP outcomes (QFJ-P04.01B, ADR-0046).
 *
 * Maps an HTTP status to one of the gateway's existing normalized provider-result statuses, with a
 * bounded `retryable` classification — WITHOUT ever surfacing a raw body, header, or key. The gateway
 * owns retry/backoff; the adapter never sleeps or retries. `retryAfterSeconds` is already parsed and
 * bounded by the transport; it is not surfaced further (the gateway does not sleep).
 */
import type { ProviderInvocationResult } from '../../contracts/provider.js';

/**
 * Classify a Groq HTTP status into a normalized failure result:
 *   - 429 → `rate-limited` (QFJ-S2-B: a quota condition, distinct from the provider being down);
 *   - transient 5xx / 498 → `unavailable`, retryable;
 *   - 499 → `cancelled`;
 *   - 401/403 (auth), 400/404/413/422 (client), and unknown → `failed`, non-retryable.
 */
export function normalizeGroqHttpStatus(status: number): ProviderInvocationResult {
  if (status === 429) {
    return { status: 'rate-limited' };
  }
  if (status === 499) {
    return { status: 'cancelled' };
  }
  if (status === 498) {
    return { status: 'unavailable', retryable: true };
  }
  if (status >= 500 && status <= 599) {
    return { status: 'unavailable', retryable: true };
  }
  // 400, 401, 403, 404, 413, 422, and any other 4xx / unexpected status: non-retryable.
  return { status: 'failed', retryable: false };
}

/**
 * The ONE closed Groq error code this adapter recognises (QFJ-S2-E-C-R3).
 *
 * Groq returns HTTP 400 with this code when the generated text does not satisfy the supplied JSON
 * Schema — including when constrained generation was truncated by `max_completion_tokens` before the
 * document closed. That is an OUTPUT problem, not a rejected request: the key, the project, the model
 * permission and the request itself were all accepted, and the model was billed for the tokens it
 * produced.
 *
 * Mapping it to the generic client-rejection bucket told an operator to go and audit a credential that
 * had demonstrably just worked. Live evidence: two independent SHADOW runs where the stable leg returned
 * HTTP 200 and the candidate leg returned HTTP 400 `json_validate_failed`, both after exactly
 * `max_completion_tokens` output tokens, on byte-identical requests.
 */
const GROQ_JSON_VALIDATE_FAILED = 'json_validate_failed';

/**
 * Read the closed error code from a Groq error envelope, and NOTHING else.
 *
 * Returns the code only when it is exactly the one recognised literal above; every other value — and
 * every message, `failed_generation`, request id, header or nested payload — yields `undefined` and is
 * never read, stored, logged or returned. The body is already length-bounded by the transport.
 */
function closedErrorCode(bodyText: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const envelope = parsed as Record<string, unknown>;
  const error: unknown = envelope['error'];
  const code: unknown =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)['code']
      : envelope['code'];
  return code === GROQ_JSON_VALIDATE_FAILED ? GROQ_JSON_VALIDATE_FAILED : undefined;
}

/**
 * Classify a non-2xx Groq response, consulting the body ONLY for the single closed code above.
 *
 * A `json_validate_failed` 400 becomes `malformed` — the existing provider-neutral status for "a
 * response was served but its payload does not satisfy the contract" — which the gateway already maps to
 * `structured-output-invalid` and the SHADOW runner already reports as
 * `provider-output-invalid` / `output-invalid`. No new type, no new status, no new public field.
 *
 * Every other status keeps its existing classification exactly.
 */
export function normalizeGroqHttpFailure(
  status: number,
  bodyText: string,
  latencyMs: number,
): ProviderInvocationResult {
  if (status === 400 && closedErrorCode(bodyText) === GROQ_JSON_VALIDATE_FAILED) {
    return { status: 'malformed', latencyMs };
  }
  return normalizeGroqHttpStatus(status);
}
