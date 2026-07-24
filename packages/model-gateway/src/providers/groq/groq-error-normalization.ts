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
 *   - 429 and transient 5xx / 498 → `unavailable`, retryable;
 *   - 499 → `cancelled`;
 *   - 401/403 (auth), 400/404/413/422 (client), and unknown → `failed`, non-retryable.
 */
export function normalizeGroqHttpStatus(status: number): ProviderInvocationResult {
  if (status === 429) {
    return { status: 'unavailable', retryable: true };
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
