/**
 * The closed adapter reason vocabulary (QFJ-M3, ADR-0056 §J, §K).
 *
 * Every adapter outcome carries a content-free reason. The reason — together with the closed Core
 * outcome — determines retry classification (information only; the adapter never auto-retries).
 */
export const CORE_ADAPTER_REASONS = [
  'core-accepted',
  'core-rejected',
  'core-human-review',
  'core-retry-later',
  'core-stale-revision',
  'core-unavailable',
  'adapter-state-blocked',
  'adapter-transport-missing',
  'adapter-transport-error',
  'adapter-response-invalid',
  'adapter-identity-mismatch',
] as const;
export type CoreAdapterReason = (typeof CORE_ADAPTER_REASONS)[number];
