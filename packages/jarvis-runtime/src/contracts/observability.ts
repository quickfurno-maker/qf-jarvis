/**
 * Content-free correlated M5 observability (QFJ-M5, ADR-0059 §H).
 *
 * The composition root emits only closed, content-free stage events carrying safe ids, actor/party,
 * revision, stage, outcome, and safe counters/timestamps — NEVER inbound/reply/prompt/knowledge
 * content, subject/PII, secret, raw error, or chain-of-thought. The default hook is a silent no-op.
 */
import type { JarvisRuntimeOutcome } from './reasons.js';
import type { OrchestrationReason, RuntimePartyType, RuntimeActor } from '@qf-jarvis/agent-runtime';

/** Closed M5 stage-event types. */
export const JARVIS_RUNTIME_EVENT_TYPES = [
  'jarvis-inbound-received',
  'jarvis-composition-started',
  'jarvis-completed',
  'jarvis-refused',
] as const;
export type JarvisRuntimeEventType = (typeof JARVIS_RUNTIME_EVENT_TYPES)[number];

/** A single closed, content-free composition stage event. */
export interface JarvisRuntimeEvent {
  readonly type: JarvisRuntimeEventType;
  readonly runId: string;
  readonly conversationId: string;
  readonly partyType: RuntimePartyType;
  readonly assignedActor: RuntimeActor | undefined;
  readonly boundRevision: number | undefined;
  readonly outcome: JarvisRuntimeOutcome | undefined;
  readonly reason: OrchestrationReason | undefined;
  readonly observedAt: string;
}

/** An injected content-free observability hook. It never controls a business outcome. */
export interface JarvisRuntimeObservabilityHook {
  onEvent(event: JarvisRuntimeEvent): void;
}

/** The default silent no-op hook. */
export const NOOP_JARVIS_RUNTIME_OBSERVABILITY: JarvisRuntimeObservabilityHook = Object.freeze({
  onEvent(_event: JarvisRuntimeEvent): void {
    // Intentionally silent.
  },
});
