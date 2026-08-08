/**
 * The Riya-aware inbound capability (RWC-P4B, ADR-0099).
 *
 * ### Why this is a third method, not a wider result
 *
 * `JarvisRuntimeResult` stays exactly the ten content-free keys it has always had, and
 * `processInbound` and `processInboundForCoreAuthorizedReply` keep their exact shapes. A caller that
 * logs an ordinary result whole must not start retaining observations because a different slice
 * needed them — so a caller that wants them names a method that says so, exactly as RWC-P2D did for
 * the authorized reply.
 *
 * ### Why it needs the continuity
 *
 * One inference has to behave as a multi-turn Riya. The current state is what the profile projects
 * into the single user message, and it is what the RWC-P4A reducer checks the model's claimed
 * question plan against. Passing it in — rather than having the runtime load it — keeps the runtime
 * free of persistence: the service that owns the store owns the read.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationObservationBatchV1 } from '@qf-jarvis/riya-conversation-evolution';

import type { JarvisCoreAuthorizedReplyV1 } from './core-authorized-reply.js';
import type { JarvisRuntimeResult } from './runtime-result.js';

/** One Riya-aware run, reported three ways from ONE model call and at most one Core decision. */
export interface JarvisRiyaConversationEvolutionResult {
  /** Byte-for-byte the object ordinary `processInbound` would have returned for the same run. */
  readonly runtimeResult: JarvisRuntimeResult;
  /** Present only under the unchanged RWC-P2D gate: a final `CORE_ACCEPTED` text-carrying proposal. */
  readonly authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
  /**
   * The canonical RWC-P4A batch this turn observed, or `undefined`.
   *
   * Absent whenever no model ran, or the structured answer failed any M4 gate — provenance, strict
   * validation, citation authorization or either state gate. It is deliberately NOT tied to the Core
   * outcome: what a client said is a fact about the conversation, and Core rejecting the reply does
   * not unsay it.
   */
  readonly observationBatch: RiyaConversationObservationBatchV1 | undefined;
}

/** What the Riya-aware method needs: one envelope and the state that turn starts from. */
export interface JarvisRiyaConversationEvolutionInput {
  readonly envelope: InboundEnvelope;
  readonly continuity: RiyaConversationContinuityStateV1;
}
