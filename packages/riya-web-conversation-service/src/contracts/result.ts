/**
 * The service result: one bounded, non-streaming answer (RWC-P2C, ADR-0094).
 *
 * ### There is no reply text, and that is a finding rather than an omission
 *
 * `JarvisRuntimeResult` deliberately carries **no client-facing text**. It reports an outcome, a
 * run id, whether a model drafted, whether Core was consulted, a closed refusal reason and a
 * content-free provenance record. The draft's `replyBody` is read once inside the composition — only
 * to compute the boolean `modelDrafted` — and never leaves.
 *
 * That is correct, and it is the permanent boundary showing through: Jarvis recommends, QuickFurno
 * Core authorizes. What a turn produces today is a PROPOSAL stamped `PENDING_CORE_VALIDATION`, not
 * a message anybody is cleared to send. So this contract carries no `replyText` field at all.
 *
 * An optional `replyText?: string` that could never be populated would be worse than its absence: a
 * consumer would write the branch that reads it, the branch would never run, and nobody would
 * notice until somebody made it run.
 *
 * ### Why the served disposition is not called `RESPONDED`
 *
 * Because nothing responded. A turn was processed and a proposal exists; no text was produced for a
 * client and nothing was sent. This repository has made the same call before — QFJ-P09.02's bridge
 * counts `handoffs`, never `sent` or `delivered`, and the eighteen-state model refuses to collapse
 * `provider-accepted` into `delivered`. A field name is the first thing someone reads when deciding
 * what a system did.
 */
import type { OrchestrationReason } from '@qf-jarvis/agent-runtime';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

/**
 * The closed dispositions.
 *
 * - `PROCESSED`  — the authoritative runtime completed a turn and produced a draft or an accepted
 *   proposal. It does NOT mean a reply exists, was rendered, or was sent.
 * - `REFUSED`    — the runtime refused, or Core rejected. A decision was made and it was "no".
 * - `NOT_READY`  — the turn could not be served right now: a human holds the conversation, Core was
 *   unavailable, the revision drifted, or there was nothing to do. It may become servable later.
 */
export const RIYA_WEB_CONVERSATION_DISPOSITIONS = ['PROCESSED', 'REFUSED', 'NOT_READY'] as const;

export type RiyaWebConversationDisposition = (typeof RIYA_WEB_CONVERSATION_DISPOSITIONS)[number];

/** One final, bounded result. Never a stream, never a chunk, never a partial. */
export interface RiyaWebConversationResultV1 {
  readonly version: 1;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly disposition: RiyaWebConversationDisposition;
  /**
   * The runtime's own closed, content-free refusal reason, present only when it refused.
   *
   * A token from a fixed vocabulary — never a message, a model output, a provider name, an
   * exception, a stack, SQL or anything a client said.
   */
  readonly reason: OrchestrationReason | undefined;
  /**
   * The continuity state as it was LOADED or INITIALIZED, unchanged by this turn.
   *
   * RWC-P4 owns evolution. Returning the state the turn started from is what makes "P2C does not
   * evolve continuity" checkable by a caller rather than only by a spec.
   */
  readonly continuity: RiyaConversationContinuityStateV1;
}
