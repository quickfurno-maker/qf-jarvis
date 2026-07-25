/**
 * The closed, content-free adapter reason vocabulary (QFJ-M4, ADR-0057 §K).
 *
 * Every adapter outcome carries one of these safe reasons. A raw provider/gateway error is NEVER
 * exposed; the reason is a bounded code only. The adapter performs no automatic retry beyond whatever
 * the gateway itself owns.
 */
export const MODEL_REPLY_ADAPTER_REASONS = [
  'model-adapter-completed',
  'model-adapter-unavailable',
  'model-plan-invalid',
  'model-state-blocked',
  'model-cancelled',
  'model-gateway-refused',
  'model-gateway-transient',
  'model-result-invalid',
  'model-structured-output-invalid',
  'model-provenance-mismatch',
  'model-citation-mismatch',
  'model-invariant',
] as const;
export type ModelReplyAdapterReason = (typeof MODEL_REPLY_ADAPTER_REASONS)[number];
