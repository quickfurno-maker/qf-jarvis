/**
 * Bounded, redacting normalization of Nara HTTP outcomes (JF-2A, ADR-0146).
 *
 * Maps an HTTP status to one of the gateway's EXISTING normalized provider-result statuses, with a
 * bounded `retryable` classification — WITHOUT ever surfacing a raw body, header, or key. The whole
 * input to this function is a status number. The gateway owns retry/backoff; the adapter never sleeps
 * and never retries, and it never decides cross-provider policy — `decideFallover` does that.
 *
 * ### Why "model unavailable / not entitled" is non-retryable
 *
 * A 403 or 404 naming a model is a CONFIGURATION fact, not a transient one: the account is not entitled
 * to that model, or the model id is wrong. Retrying cannot grant an entitlement, and classifying it as
 * transient would let a misconfigured primary quietly fail over on every request — which looks like a
 * working system and is a permanently broken one. It stays in the non-retryable bucket, exactly where
 * the Groq adapter puts the same statuses, so an operator sees the misconfiguration instead of a
 * fallback rate.
 */
import type { ProviderInvocationResult } from '../../contracts/provider.js';

/**
 * Classify a Nara HTTP status into a normalized failure result:
 *   - 429 → `rate-limited` (a quota condition, distinct from the provider being down);
 *   - transient 5xx / 498 → `unavailable`, retryable;
 *   - 499 → `cancelled`;
 *   - 401/403 (auth or entitlement), 400/404/413/422 (client, including unknown model), and any
 *     unexpected status → `failed`, non-retryable.
 */
export function normalizeNaraHttpStatus(status: number): ProviderInvocationResult {
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
