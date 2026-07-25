/**
 * Content-free reply-adapter observability (QFJ-M4, ADR-0057 §L).
 *
 * Closed-type events carrying only safe ids, references, the result kind/reason, and counters/
 * timestamps. An event NEVER carries inbound/reply content, prompt text, knowledge content, a subject
 * ref, PII, a key/token, a raw provider error/body/header, or chain-of-thought. The hook is injected;
 * the default is a no-op.
 */
import type { RuntimeActor, RuntimeDataClass, RuntimePartyType } from '@qf-jarvis/agent-runtime';

import type { ModelReplyAdapterReason } from './reasons.js';
import type { StructuredReplyKind } from './reply-schema.js';

/** The closed set of reply-adapter event types. */
export const MODEL_REPLY_ADAPTER_EVENT_TYPES = [
  'model-adapter-plan-validated',
  'model-gateway-requested',
  'model-gateway-result-received',
  'model-result-refused',
  'model-adapter-completed',
] as const;
export type ModelReplyAdapterEventType = (typeof MODEL_REPLY_ADAPTER_EVENT_TYPES)[number];

/** One safe, content-free reply-adapter event. */
export interface ModelReplyAdapterEvent {
  readonly type: ModelReplyAdapterEventType;
  readonly runId: string;
  readonly conversationId: string;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly dataClass: RuntimeDataClass;
  readonly taskClass: string;
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly capabilityProfileRef: string;
  readonly evaluationRef: string | undefined;
  readonly resultKind: StructuredReplyKind | undefined;
  readonly reason: ModelReplyAdapterReason;
  /** Already-normalized, non-identifying counters (only present after a received result). */
  readonly outputTokens: number | undefined;
  readonly latencyMs: number | undefined;
}

/** An injected sink for {@link ModelReplyAdapterEvent}s. Implementations must not throw. */
export interface ModelReplyAdapterObservabilityHook {
  onEvent(event: ModelReplyAdapterEvent): void;
}

/** The default no-op hook: the adapter emits nothing unless a hook is injected. */
export const NOOP_MODEL_REPLY_ADAPTER_OBSERVABILITY: ModelReplyAdapterObservabilityHook =
  Object.freeze({
    onEvent(_event: ModelReplyAdapterEvent): void {
      // Intentionally empty.
    },
  });
