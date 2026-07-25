/**
 * The provider-neutral reply-plan builder (QFJ-M2, ADR-0055 §E).
 *
 * Assembles a bounded, EXACT-reference plan for the injected model reply port from the context, the
 * assigned actor, the model port's exact release/prompt/capability/evaluation identities, and the
 * exact knowledge citations. It carries no business authority and no transport callback; the minimized
 * normalized inbound text is passed ONLY to the model port.
 */
import type { InboundEnvelope } from '../contracts/inbound-envelope.js';
import type { RuntimeActor } from '../contracts/vocabularies.js';
import type { KnowledgeCitation, OrchestrationContext, ReplyPlan } from './contracts.js';
import type { ModelReplyPort } from './model-reply-port.js';

/** Build a frozen reply plan. Pure and deterministic. */
export function createReplyPlan(args: {
  readonly context: OrchestrationContext;
  readonly envelope: InboundEnvelope;
  readonly assignedActor: RuntimeActor;
  readonly modelPort: ModelReplyPort;
  readonly policyRevision: string;
  readonly taskClass: string;
  readonly citations: readonly KnowledgeCitation[];
}): ReplyPlan {
  const { context, envelope, assignedActor, modelPort } = args;
  return Object.freeze({
    runId: `${context.conversationId}-${envelope.messageId}`,
    conversationId: context.conversationId,
    assignedActor,
    partyType: context.partyType,
    dataClass: context.dataClass,
    taskClass: args.taskClass,
    requiresStructuredOutput: true,
    release: Object.freeze({ ...modelPort.release }),
    promptFamily: modelPort.promptFamily,
    promptVersion: modelPort.promptVersion,
    capabilityProfileRef: modelPort.capabilityProfileRef,
    evaluationRef: modelPort.evaluationRef,
    policyRevision: args.policyRevision,
    citations: Object.freeze(args.citations.map((c) => Object.freeze({ ...c }))),
    normalizedText: envelope.normalizedText,
  });
}
