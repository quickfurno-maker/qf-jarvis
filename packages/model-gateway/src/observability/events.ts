/**
 * Gateway observability hooks (QFJ-P04.01A, ADR-0045).
 *
 * The gateway emits bounded, content-free events through an INJECTED hook — no external backend, no
 * logging library. Every event carries only a closed type, stable identifiers, a safe error code, an
 * enum, and numeric counters. It NEVER carries a prompt, a message, user/client/vendor content, a
 * subject reference, a provider header, or a secret.
 */
import type { GatewayMode, ModelDataClass } from '../contracts/enums.js';
import type { ModelGatewayErrorCode } from '../errors/gateway-error.js';
import type { CircuitState } from '../reliability/circuit-breaker.js';
import type { FallbackDecisionReason, RoutingProfile } from '../routing/routing-reasons.js';

/** The closed set of gateway event types. */
export const GATEWAY_EVENT_TYPES = [
  'invocation-started',
  'provider-selected',
  'invocation-completed',
  'invocation-failed',
  'fallback-used',
  'budget-refused',
  'timeout',
  'cancelled',
  'circuit-state-change',
  'queue-refused',
  'concurrency-refused',
  'structured-output-failed',
  'kill-switch',
  'routing-decided',
] as const;
export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];

/** One bounded, content-free observability event. */
export interface GatewayEvent {
  readonly type: GatewayEventType;
  readonly runId: string;
  readonly providerId?: string;
  readonly code?: ModelGatewayErrorCode;
  readonly mode?: GatewayMode;
  readonly attempts?: number;
  readonly latencyMs?: number;
  readonly circuitState?: CircuitState;
  /** Hybrid-routing evidence (QFJ-P04.01D) — all bounded, content-free enums/ids. */
  readonly profile?: RoutingProfile;
  readonly dataClass?: ModelDataClass;
  readonly fallbackReason?: FallbackDecisionReason;
}

/** The injected sink for gateway events. */
export interface GatewayObservabilityHook {
  record(event: GatewayEvent): void;
}

/** A hook that records nothing — the safe default. */
export const NOOP_OBSERVABILITY: GatewayObservabilityHook = Object.freeze({
  record(): void {
    // Intentionally does nothing.
  },
});
