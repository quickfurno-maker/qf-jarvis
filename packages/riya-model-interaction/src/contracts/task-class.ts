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
