/**
 * The channel-neutral turn result (RWC-P8, ADR-0104).
 *
 * ### What it carries
 *
 * The identity the caller already knows, a closed disposition, the runtime's own content-free refusal
 * reason, the authoritative continuity, and — under the unchanged RWC-P2D gate — the exact body
 * QuickFurno Core authorized.
 *
 * ### What it deliberately does not
 *
 * No channel echo, no source reference, no ledger row, no claim state, no digest, no `requestId`, no
 * model, provider or prompt identity, no history and no citation list. A caller that needs to know
 * which channel it called on already knows; everything else is either internal machinery or an
 * identifier that would let a result become a correlation handle.
 *
 * `authorizedReply` remains the ONLY client-facing text capability, on every channel. RWC-P8 sends
 * nothing, delivers nothing and records no provider delivery state — a future trusted WhatsApp adapter
 * decides what to do with an authorized body, exactly as a future web ingress does.
 */
import type { OrchestrationReason } from '@qf-jarvis/agent-runtime';
import type { JarvisCoreAuthorizedReplyV1 } from '@qf-jarvis/jarvis-runtime';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import type { RiyaWebConversationDisposition } from './result.js';

/** One bounded, non-streaming result for one inbound turn on any channel. */
export interface RiyaConversationResultV1 {
  readonly version: 1;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly disposition: RiyaWebConversationDisposition;
  /** The runtime's own closed, content-free refusal reason, present only when it refused. */
  readonly reason: OrchestrationReason | undefined;
  /** The AUTHORITATIVE continuity after this turn — evolved and persisted, or loaded unchanged. */
  readonly continuity: RiyaConversationContinuityStateV1;
  /**
   * The EXACT body QuickFurno Core authorized, or `undefined`.
   *
   * Released only after the turn's durable claim has been finalized. A body handed back before the
   * ledger recorded the turn as complete could be delivered to a client while the same message stayed
   * eligible for a second Riya turn.
   */
  readonly authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
}
