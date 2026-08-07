/**
 * The ONE materialization rule (RWC-P2D, ADR-0096).
 *
 * Internal to the package: reachable from the composition and from this package's own specs, and
 * deliberately NOT re-exported from the root barrel. It is a decision function, not a capability —
 * exporting it would let a caller materialize a body from a proposal it assembled itself, which is
 * precisely the authorization it exists to require.
 *
 * It is a separate module rather than a closure inside the flow so the gate can be exercised
 * DIRECTLY, including combinations the current pipeline cannot produce. The `ESCALATION`-with-a-body
 * case is the important one: today Riya's escalation decisions carry `modelReplyEligible: false`, so
 * no draft is requested and no body exists to leak. That is a property of one behaviour adapter, not
 * of this contract — a future adapter that escalated *and* drafted would otherwise hand a client text
 * Core never received as a reply body. Defence in depth is only depth if it is tested.
 */
import type { OrchestrationProposal } from '@qf-jarvis/agent-runtime';

import type { JarvisCoreAuthorizedReplyV1 } from '../contracts/core-authorized-reply.js';
import type { JarvisRuntimeOutcome } from '../contracts/reasons.js';

/**
 * Materialize the Core-authorized reply body, or `undefined`.
 *
 * Every condition is checked against the FINAL state of one completed run:
 *
 * 1. the outcome is `CORE_ACCEPTED`. That value exists only when a Core transport was wired AND the
 *    M3 decision came back `ACCEPTED` — and M3 returns `ACCEPTED` only after its own post-response
 *    authoritative-state gate passes. So a raw `ACCEPTED` transport response for a conversation that
 *    drifted, was taken over, paused or cancelled while the call was in flight never reaches here:
 *    M3 has already downgraded it. Reading the final decision, rather than intercepting the
 *    transport, is what makes that gate impossible to bypass;
 * 2. the proposal kind is one Core actually received text for — `REPLY` or `FOLLOW_UP`. M3's
 *    `buildCoreCommand` drops `proposedReplyBody` for every other kind, so text riding along on one
 *    of them was never part of what Core approved;
 * 3. there is a body at all. A proposal without one was produced with no model draft.
 *
 * The body is copied verbatim: no trim, no rewrite, no paraphrase, no template, no second model call.
 */
export function materializeCoreAuthorizedReply(
  outcome: JarvisRuntimeOutcome,
  proposal: OrchestrationProposal,
  boundRevision: number,
): JarvisCoreAuthorizedReplyV1 | undefined {
  if (outcome !== 'CORE_ACCEPTED') {
    return undefined;
  }
  const proposalKind = proposal.kind;
  if (proposalKind !== 'REPLY' && proposalKind !== 'FOLLOW_UP') {
    return undefined;
  }
  const replyBody = proposal.replyBody;
  if (replyBody === undefined || replyBody.length === 0) {
    return undefined;
  }
  return Object.freeze({
    version: 1 as const,
    proposalId: proposal.proposalId,
    boundRevision,
    proposalKind,
    replyBody,
  });
}
