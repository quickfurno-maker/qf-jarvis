/**
 * The customer-orchestration contracts (JF-4, ADR-0149).
 *
 * Deliberately small. The canonical turn and result schemas belong to
 * `@qf-jarvis/riya-web-conversation-service`, and restating either here would create a second
 * definition of what a Riya turn is — the first thing a second definition gets wrong is a bound.
 *
 * What IS defined here is only what orchestration itself needs: a closed refusal vocabulary for the
 * case where the workflow could not run at all, and a content-free observability event.
 */
import type { RiyaConversationChannel } from '@qf-jarvis/riya-web-conversation-service';

/**
 * Why the orchestration shell itself could not complete.
 *
 * Not why RIYA refused — that stays in the service result, where it always was. These are the only
 * things that can go wrong in a shell whose entire job is to call one function once.
 */
export const RIYA_CUSTOMER_ORCHESTRATION_REFUSALS = [
  /** The workflow was cancelled before or during the step. */
  'CANCELLED',
  /** The workflow framework failed. The thrown value is never read, so this is all a caller learns. */
  'WORKFLOW_FAILED',
  /** The conversation service threw. The service owns its own refusals; this is an exception. */
  'SERVICE_FAILED',
] as const;
export type RiyaCustomerOrchestrationRefusal =
  (typeof RIYA_CUSTOMER_ORCHESTRATION_REFUSALS)[number];

/**
 * One content-free orchestration event.
 *
 * Enough to prove the composition holds, and nothing more. No message, no reply body, no knowledge
 * content, no subject reference, no prompt, no provider identity — a turn's content never reaches
 * observability, and the fields below are the complete list of what does.
 */
export interface RiyaCustomerOrchestrationEvent {
  readonly type: 'riya-customer-turn';
  /** Opaque per-run reference. Not a conversation id and not derived from one. */
  readonly runRef: string;
  readonly channel: RiyaConversationChannel;
  /** `1` when the conversation service was invoked, `0` when the shell refused before reaching it. */
  readonly serviceInvocations: 0 | 1;
  /** Whether the turn produced an authorized reply. Never the reply itself. */
  readonly authorizedReplyPresent: boolean;
  /** Present only when the SHELL refused. A Riya refusal is in the result, not here. */
  readonly refusal: RiyaCustomerOrchestrationRefusal | undefined;
}

/** An injected sink for orchestration events. Implementations must not throw. */
export interface RiyaCustomerOrchestrationObservability {
  onEvent(event: RiyaCustomerOrchestrationEvent): void;
}
