/**
 * The RWC-P7 post-summary grounded reply capability (ADR-0103 §16).
 *
 * ### Why a sixth method, and not a wider fifth
 *
 * `processInboundForRiyaConversationEvolution` owns `INTRO..SUMMARY` and returns an observation
 * batch. RWC-P4B deliberately made it REFUSE `CONTACT`, `CONSENT` and `COMPLETE`, because a model
 * call about one of those would have been that slice reasoning past its ceiling. That refusal is
 * frozen, and widening it now would hand the P4B method authority over P6's phases.
 *
 * So the post-summary text turn gets its own method, and its result shape says what it is: a reply,
 * or nothing. There is no `observationBatch` field, because there is nothing that could put a value
 * in it — the profile's schema has no `evolution` key at all.
 *
 * ### What a post-summary text turn may and may not do
 *
 * A client who has confirmed their summary may still ask "how long does installation usually take?",
 * and refusing to answer would be a worse product for no safety gain. So the turn may reach one model
 * call, grounded in governed knowledge, and produce one Core-authorized reply.
 *
 * It may not change anything. No observations, no phase move, no `summaryConfirmed`, no consent, no
 * completion evidence, no compare-and-set. In particular a client typing "yes" cannot become a
 * structured RWC-P6 action: those make zero model calls, and this method has nothing to write with.
 */
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import type { JarvisCoreAuthorizedReplyV1 } from './core-authorized-reply.js';
import type { JarvisRuntimeResult } from './runtime-result.js';

/** What the grounded reply method needs. The same three inputs the P4B method takes. */
export interface JarvisRiyaGroundedReplyInput {
  readonly envelope: InboundEnvelope;
  /**
   * The state this turn starts from, and the state it will still be in afterwards.
   *
   * Supplied for the same reason as everywhere else in this runtime: the service that owns the store
   * owns the read. It is re-proved through the canonical constructor at this boundary.
   */
  readonly continuity: RiyaConversationContinuityStateV1;
  /**
   * The CURRENT Core-owned availability, captured once for this turn (RWC-P5).
   *
   * Still required past `SUMMARY`. A client asking "do you work in Beta?" must be answered from live
   * Core authority, which outranks any governed document for the question of what is sold where.
   */
  readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
}

/** One grounded post-summary run. A reply, or nothing — and never a state change. */
export interface JarvisRiyaGroundedReplyResult {
  /** Byte-for-byte the object ordinary `processInbound` would have returned for the same run. */
  readonly runtimeResult: JarvisRuntimeResult;
  /** Present only under the unchanged RWC-P2D gate: a final `CORE_ACCEPTED` text-carrying proposal. */
  readonly authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
}
