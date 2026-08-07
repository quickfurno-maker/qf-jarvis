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
 *
 * ### RWC-P2D (ADR-0096) moved exactly ONE of those two boundaries
 *
 * The reasoning above still stands and is not revised: a model DRAFT is not a message anybody is
 * cleared to send. What P2D adds is the case that reasoning did not cover — a proposal QuickFurno
 * Core has already AUTHORIZED under the existing M2/M3 contract. `RiyaWebConversationResultV2` may
 * therefore carry an `authorizedReply`, and only then.
 *
 * The disposition vocabulary is untouched. `PROCESSED` still does not mean replied, sent or
 * delivered, and there is still no `RESPONDED`.
 */
import type { OrchestrationReason } from '@qf-jarvis/agent-runtime';
import type { JarvisCoreAuthorizedReplyV1 } from '@qf-jarvis/jarvis-runtime';
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

/**
 * One final, bounded result. Never a stream, never a chunk, never a partial.
 *
 * **HISTORICAL — frozen at RWC-P2C.** Superseded by {@link RiyaWebConversationResultV2}, which adds
 * the optional Core-authorized reply (RWC-P2D, ADR-0096). V1 is kept exactly as it was rather than
 * grown a content field, because its own documentation above is a promise that there is no reply
 * text in it: a consumer reading a `version: 1` object is entitled to that promise holding. The
 * service now returns V2.
 */
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

/**
 * One final, bounded result, with the Core-authorized reply when there is one (RWC-P2D, ADR-0096).
 *
 * ### Why a new version rather than an added field
 *
 * V1's contract says, in its own text, that there is no reply text. Adding one to it would falsify a
 * documented promise for every consumer already reading `version: 1`. A new version number is how a
 * reader finds out that the boundary moved.
 *
 * ### `authorizedReply` is authorization, not delivery — and not a disposition
 *
 * The dispositions are unchanged: `PROCESSED`, `REFUSED`, `NOT_READY`. There is deliberately no
 * `RESPONDED`, `SENT` or `DELIVERED`, because nothing here responds, sends or delivers. `PROCESSED`
 * may carry an `authorizedReply` or none at all:
 *
 * - Core accepted a `REPLY`/`FOLLOW_UP` that has a body  → `authorizedReply` present;
 * - `MODEL_DRAFTED` with no Core transport wired          → absent (a draft is not authorized);
 * - Core accepted a proposal that carries no client text  → absent.
 *
 * A future ingress adapter must require `authorizedReply !== undefined` before returning any AI text
 * to a browser. `disposition === 'PROCESSED'` is NOT that check.
 */
export interface RiyaWebConversationResultV2 {
  readonly version: 2;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly disposition: RiyaWebConversationDisposition;
  /** The runtime's own closed, content-free refusal reason, present only when it refused. */
  readonly reason: OrchestrationReason | undefined;
  /** The continuity state as it was LOADED or INITIALIZED, unchanged by this turn. */
  readonly continuity: RiyaConversationContinuityStateV1;
  /**
   * The EXACT body QuickFurno Core authorized, or `undefined`.
   *
   * Present only after a final `CORE_ACCEPTED` decision for a text-carrying proposal. Never a draft,
   * never a rewritten body, never a paraphrase, and never evidence that anything was sent.
   */
  readonly authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
}
