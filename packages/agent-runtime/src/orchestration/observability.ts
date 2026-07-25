/**
 * Content-free orchestration observability (QFJ-M2, ADR-0055 §L).
 *
 * Closed-type events carrying only safe ids, the actor/party/data class, the proposal kind/status, the
 * Core decision outcome, safe reference ids, and a reason. An event NEVER carries inbound/reply
 * content, a prompt, a subject reference, PII, a key/token, a raw provider/Core error, or chain-of-
 * thought. The hook is injected; the default is a no-op.
 */
import type {
  RuntimeActor,
  RuntimeDataClass,
  RuntimePartyType,
} from '../contracts/vocabularies.js';
import type {
  CoreDecisionOutcome,
  OrchestrationProposalKind,
  OrchestrationReason,
} from './vocabularies.js';

/** The closed set of orchestration event types. */
export const ORCHESTRATION_EVENT_TYPES = [
  'orchestration-started',
  'model-plan-created',
  'model-invocation-skipped',
  'proposal-created',
  'core-decision-requested',
  'core-decision-received',
  'orchestration-refused',
  'orchestration-completed',
] as const;
export type OrchestrationEventType = (typeof ORCHESTRATION_EVENT_TYPES)[number];

/** One safe, content-free orchestration event. */
export interface OrchestrationEvent {
  readonly type: OrchestrationEventType;
  readonly runId: string;
  readonly conversationId: string;
  readonly actor: RuntimeActor | undefined;
  readonly partyType: RuntimePartyType | undefined;
  readonly dataClass: RuntimeDataClass | undefined;
  readonly proposalKind: OrchestrationProposalKind | undefined;
  readonly coreOutcome: CoreDecisionOutcome | undefined;
  readonly reason: OrchestrationReason;
}

/** An injected sink for {@link OrchestrationEvent}s. Implementations must not throw. */
export interface OrchestrationObservabilityHook {
  onEvent(event: OrchestrationEvent): void;
}

/** The default no-op hook: orchestration emits nothing unless a hook is injected. */
export const NOOP_ORCHESTRATION_OBSERVABILITY: OrchestrationObservabilityHook = Object.freeze({
  onEvent(_event: OrchestrationEvent): void {
    // Intentionally empty.
  },
});
