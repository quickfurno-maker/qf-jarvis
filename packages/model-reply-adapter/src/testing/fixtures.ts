/**
 * Deterministic synthetic fixtures for the QFJ-M4 adapter (ADR-0057).
 *
 * Shipped under `./testing`. All synthetic — no real provider, model, message, key, or token. Builds a
 * valid M2 `ReplyPlan` and matching model identity a test can vary, plus a valid structured reply.
 */
import type { KnowledgeCitation, ModelReleaseRef, ReplyPlan } from '@qf-jarvis/agent-runtime';
import { createPromptDefinition } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition } from '@qf-jarvis/prompt-registry';

import type { StructuredReply } from '../contracts/reply-schema.js';

/** A synthetic exact model release identity (HOSTED by default). */
export function syntheticRelease(over: Partial<ModelReleaseRef> = {}): ModelReleaseRef {
  return Object.freeze({
    releaseId: 'rel.reply.1',
    providerId: 'prov.fake',
    modelId: 'model.fake',
    modelVersion: '1',
    configDigest: 'cfg00001',
    executionClass: 'HOSTED',
    ...over,
  });
}

/** A synthetic exact citation. */
export function syntheticCitation(knowledgeId = 'kb.fact', version = 1): KnowledgeCitation {
  return Object.freeze({ knowledgeId, version, source: 'doc://synthetic', digest: 'abcdef01' });
}

/** A valid M2 reply plan bound to the synthetic release; override any field for a specific test. */
export function replyPlan(over: Partial<ReplyPlan> = {}): ReplyPlan {
  return {
    runId: 'run.1',
    conversationId: 'conv.1',
    assignedActor: 'RIYA',
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    taskClass: 'RESPONSE_GENERATION',
    requiresStructuredOutput: true,
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    policyRevision: 'policy.rev.1',
    citations: [syntheticCitation()],
    normalizedText: 'hello, I have a question',
    ...over,
  };
}

/** A valid structured REPLY citing the synthetic knowledge; override any field for a specific test. */
export function structuredReply(over: Partial<StructuredReply> = {}): StructuredReply {
  return {
    kind: 'REPLY',
    replyBody: 'Thank you for reaching out — here is the answer.',
    citations: [{ knowledgeId: 'kb.fact', version: 1 }],
    ...over,
  };
}

/**
 * A synthetic prompt definition matching the default `replyPlan()` identity (QFJ-S3-I-B, ADR-0073).
 *
 * Built through the real `createPromptDefinition`, so its digest is a genuine SHA-256 of the body
 * below. Clearly synthetic: this is not, and must never become, a production instruction.
 */
export function syntheticPromptDefinition(
  over: Partial<Parameters<typeof createPromptDefinition>[0]> = {},
): PromptDefinition {
  return createPromptDefinition({
    // Matches `replyPlan()`'s promptFamily exactly -- a definition that did not would (correctly)
    // refuse to resolve, which is a confusing way for an unrelated spec to fail.
    promptId: 'reply.client',
    promptVersion: 1,
    agentScope: 'CLIENT',
    taskClass: 'RESPONSE_GENERATION',
    resultMode: 'STRUCTURED',
    systemTemplate: 'Synthetic M4 fixture prompt. Not a production instruction.',
    ...over,
  });
}
