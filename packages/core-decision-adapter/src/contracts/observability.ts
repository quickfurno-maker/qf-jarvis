/**
 * Content-free Core-adapter observability (QFJ-M3, ADR-0056 §K).
 *
 * Closed-type events carrying only safe ids, revisions, the outcome/reason, protocol references, and
 * timestamps. An event NEVER carries inbound/reply content, a prompt, a subject reference, PII, a
 * secret, a raw error, or chain-of-thought. The hook is injected; the default is a no-op.
 */
import type { CoreDecisionOutcome } from '@qf-jarvis/agent-runtime';
import type { CoreAdapterReason } from './reasons.js';

/** The closed set of adapter event types. */
export const CORE_ADAPTER_EVENT_TYPES = [
  'command-created',
  'transport-requested',
  'response-received',
  'response-refused',
  'completed',
] as const;
export type CoreAdapterEventType = (typeof CORE_ADAPTER_EVENT_TYPES)[number];

/** One safe, content-free adapter event. */
export interface CoreAdapterEvent {
  readonly type: CoreAdapterEventType;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly conversationId: string;
  readonly proposalId: string;
  readonly expectedRevision: number;
  readonly protocolName: string;
  readonly protocolVersion: number;
  readonly outcome: CoreDecisionOutcome | undefined;
  readonly reason: CoreAdapterReason;
}

/** An injected sink for {@link CoreAdapterEvent}s. Implementations must not throw. */
export interface CoreAdapterObservabilityHook {
  onEvent(event: CoreAdapterEvent): void;
}

/** The default no-op hook: the adapter emits nothing unless a hook is injected. */
export const NOOP_CORE_ADAPTER_OBSERVABILITY: CoreAdapterObservabilityHook = Object.freeze({
  onEvent(_event: CoreAdapterEvent): void {
    // Intentionally empty.
  },
});
