/**
 * Deterministic synthetic fixtures for the QFJ-M3 adapter (ADR-0056).
 *
 * Shipped under `./testing`. All synthetic — no real Core, message, key, or token. Builds a valid M2
 * `CoreDecisionRequest` a test can vary. Citations use the M2 `KnowledgeCitation` shape.
 */
import type { CoreDecisionRequest, KnowledgeCitation } from '@qf-jarvis/agent-runtime';

/** A synthetic exact citation. */
export function syntheticCitation(knowledgeId = 'kb.fact', version = 1): KnowledgeCitation {
  return Object.freeze({ knowledgeId, version, source: 'doc://synthetic', digest: 'abcdef01' });
}

/** A valid M2 Core decision request; override any field for a specific test. */
export function coreRequest(over: Partial<CoreDecisionRequest> = {}): CoreDecisionRequest {
  return {
    proposalId: 'conv.1-msg.1-reply',
    proposalVersion: 1,
    conversationId: 'conv.1',
    expectedRevision: 1,
    assignedActor: 'RIYA',
    partyType: 'CLIENT',
    proposalKind: 'REPLY',
    structuredIntent: { taskClass: 'RESPONSE_GENERATION', replyKind: 'REPLY' },
    policyRevision: 'policy.rev.1',
    evaluationRef: 'evref-000000',
    citations: [syntheticCitation()],
    proposedReplyBody: 'synthetic reply body',
    ...over,
  };
}
