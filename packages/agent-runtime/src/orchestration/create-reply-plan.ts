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
import type { ModelPromptIdentity, ModelReplyPort } from './model-reply-port.js';

/** Build a frozen reply plan. Pure and deterministic. */
export function createReplyPlan(args: {
  readonly context: OrchestrationContext;
  readonly envelope: InboundEnvelope;
  readonly assignedActor: RuntimeActor;
  readonly modelPort: ModelReplyPort;
  /**
   * The prompt identity M2 already selected for this actor (ADR-0073). Passed explicitly so the
   * selector runs exactly once per turn, and so this builder cannot quietly choose a different one.
   */
  readonly promptIdentity: ModelPromptIdentity;
  readonly policyRevision: string;
  readonly taskClass: string;
  readonly citations: readonly KnowledgeCitation[];
}): ReplyPlan {
  const { context, envelope, assignedActor, modelPort } = args;
  return Object.freeze({
    // The canonical run identifier (ADR-0069). Concatenating the conversation and message ids could
    // reach 257 characters, which the gateway's own 128-character `runId` bound then rejected — so a
    // valid envelope produced an invalid request. `runtimeId` is already caller-supplied, validated,
    // bounded and immutable; it is the identity this field was always meant to carry.
    runId: envelope.runtimeId,
    conversationId: context.conversationId,
    assignedActor,
    partyType: context.partyType,
    dataClass: context.dataClass,
    taskClass: args.taskClass,
    requiresStructuredOutput: true,
    release: Object.freeze({ ...modelPort.release }),
    promptFamily: args.promptIdentity.promptFamily,
    promptVersion: args.promptIdentity.promptVersion,
    capabilityProfileRef: modelPort.capabilityProfileRef,
    evaluationRef: args.promptIdentity.evaluationRef,
    policyRevision: args.policyRevision,
    citations: Object.freeze(args.citations.map((c) => Object.freeze({ ...c }))),
    normalizedText: envelope.normalizedText,
  });
}
