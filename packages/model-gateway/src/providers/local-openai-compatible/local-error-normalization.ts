/**
 * Bounded, redacting normalization of local HTTP outcomes (QFJ-P04.01C, ADR-0047).
 *
 * Maps an HTTP status to one of the gateway's existing normalized provider-result statuses, with a
 * bounded `retryable` classification — WITHOUT ever surfacing a raw body, header, or token. The gateway
 * owns retry/backoff; the adapter never sleeps or retries. Retryability is conservative: transient
 * capacity/server failures may be retried; authentication/config/request/schema errors never are.
 */
import type { ProviderInvocationResult } from '../../contracts/provider.js';

/**
 * Classify a local-server HTTP status into a normalized failure result:
 *   - 429 and transient 5xx (500/502/503/504 and any other 5xx) → `unavailable`, retryable;
 *   - 499 → `cancelled`;
 *   - 400/401/403/404/413/422 and any other 4xx / unexpected status → `failed`, non-retryable.
 */
export function normalizeLocalHttpStatus(status: number): ProviderInvocationResult {
  if (status === 429) {
    return { status: 'unavailable', retryable: true };
  }
  if (status === 499) {
    return { status: 'cancelled' };
  }
  if (status >= 500 && status <= 599) {
    return { status: 'unavailable', retryable: true };
  }
  // 400, 401, 403, 404, 413, 422, and any other 4xx / unexpected status: non-retryable.
  return { status: 'failed', retryable: false };
}
