/**
 * Content-free runtime observability (QFJ-M1, ADR-0054 §K).
 *
 * The runtime emits closed-type events carrying only safe ids, the actor/party/state, and a reason. An
 * event NEVER carries message text, a subject reference, PII, a key/token, a provider body, or chain-
 * of-thought. The hook is injected; the default is a no-op.
 */
import type {
  ConversationState,
  RuntimeActor,
  RuntimePartyType,
  RuntimeProposalKind,
  RuntimeReason,
} from './vocabularies.js';

/** The closed set of runtime event types. */
export const RUNTIME_EVENT_TYPES = [
  'runtime-envelope-accepted',
  'runtime-envelope-refused',
  'runtime-agent-assigned',
  'runtime-ai-paused',
  'runtime-human-takeover-entered',
  'runtime-human-takeover-exited',
  'runtime-proposal-created',
  'runtime-proposal-refused',
  'runtime-escalation-required',
] as const;
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

/** One safe, content-free runtime event. */
export interface RuntimeEvent {
  readonly type: RuntimeEventType;
  readonly runtimeId: string;
  readonly conversationId: string;
  readonly actor: RuntimeActor | undefined;
  readonly partyType: RuntimePartyType | undefined;
  readonly state: ConversationState | undefined;
  readonly proposalKind: RuntimeProposalKind | undefined;
  readonly reason: RuntimeReason;
}

/** An injected sink for {@link RuntimeEvent}s. Implementations must not throw. */
export interface RuntimeObservabilityHook {
  onEvent(event: RuntimeEvent): void;
}

/** The default no-op hook: the runtime emits nothing unless a hook is injected. */
export const NOOP_RUNTIME_OBSERVABILITY: RuntimeObservabilityHook = Object.freeze({
  onEvent(_event: RuntimeEvent): void {
    // Intentionally empty.
  },
});
