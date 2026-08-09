/**
 * The dedicated Riya conversation-evolution task class (RWC-P4B, ADR-0099 §8).
 *
 * The RWC-P4B structured result has different semantics from the old reply-only result, so it must
 * not silently reuse a prompt that was written, evaluated and approved to produce a reply alone.
 * A distinct task class is what makes the prompt registry refuse the mismatch instead of resolving
 * a definition that happens to be bound to the same scope.
 */
export const RIYA_CONVERSATION_EVOLUTION_TASK_CLASS = 'RIYA_CONVERSATION_EVOLUTION' as const;

export type RiyaConversationEvolutionTaskClass = typeof RIYA_CONVERSATION_EVOLUTION_TASK_CLASS;

/**
 * The two GROUNDED task classes (RWC-P7, ADR-0103 §10).
 *
 * Same argument, one step further. A grounded turn puts governed knowledge records into the user
 * message, and a prompt that was written, evaluated and approved BEFORE grounded content existed has
 * never been assessed against the question that matters most here: what should Riya do when a record
 * in its own input contains an instruction? Reusing it would be answering that question by omission.
 *
 * So a grounded turn resolves its own prompt definition and its own evaluation, and there is no
 * fallback to the ungrounded evolution prompt or to the ordinary CLIENT reply prompt.
 *
 * These are PROMPT/orchestration identities. `PromptRegistry.taskClass` is deliberately an open exact
 * identifier, whereas `model-gateway`'s `MODEL_TASK_CLASSES` is a separate closed TECHNICAL capability
 * vocabulary about what a model must be able to do. Neither of these is a `ModelTaskClass`, and the
 * gateway's vocabulary is not touched.
 */
export const RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS =
  'RIYA_GROUNDED_CONVERSATION_EVOLUTION' as const;

export type RiyaGroundedConversationEvolutionTaskClass =
  typeof RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS;

/** The post-summary grounded REPLY-ONLY identity. No evolution, no observations, no phase move. */
export const RIYA_GROUNDED_REPLY_TASK_CLASS = 'RIYA_GROUNDED_REPLY' as const;

export type RiyaGroundedReplyTaskClass = typeof RIYA_GROUNDED_REPLY_TASK_CLASS;
