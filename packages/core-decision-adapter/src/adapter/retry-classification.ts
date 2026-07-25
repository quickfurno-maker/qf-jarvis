/**
 * Retry classification (QFJ-M3, ADR-0056 §J).
 *
 * Information only — the adapter performs the transport at most once and NEVER auto-retries. Retryable:
 * `CORE_UNAVAILABLE`, `RETRY_LATER`, a bounded transport timeout/error, a missing transport.
 * Non-retryable: `REJECTED`, `HUMAN_REVIEW_REQUIRED`, `STALE_REVISION`, and any protocol/identity
 * mismatch or invalid response.
 */
import type { CoreAdapterReason } from '../contracts/reasons.js';

const RETRYABLE_REASONS: ReadonlySet<CoreAdapterReason> = new Set([
  'core-unavailable',
  'core-retry-later',
  'adapter-transport-missing',
  'adapter-transport-error',
]);

/** True iff a caller may retry this outcome later (the adapter itself never retries). */
export function isRetryable(reason: CoreAdapterReason): boolean {
  return RETRYABLE_REASONS.has(reason);
}
