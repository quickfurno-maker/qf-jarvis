/**
 * The pre/post-gateway state gate (QFJ-M4, ADR-0057 §J).
 *
 * The same content-free check runs IMMEDIATELY BEFORE gateway invocation and IMMEDIATELY AFTER the
 * gateway result: a cancellation, a human takeover, an AI pause, a non-clear subject status, or a
 * party/assignment/data-class mismatch against the plan blocks drafting; a revision change between the
 * two reads blocks drafting after the result. Any block prevents a reply draft from returning.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';

import type { ReplyState } from '../contracts/state.js';
import type { ModelReplyAdapterReason } from '../contracts/reasons.js';

/** A blocking reason for the current state against the plan, or `null` when clear. */
export function stateBlockReason(
  state: ReplyState,
  plan: ReplyPlan,
): ModelReplyAdapterReason | null {
  if (state.cancelled) {
    return 'model-cancelled';
  }
  if (state.humanTakeover || state.aiPaused) {
    return 'model-state-blocked';
  }
  if (state.subjectStatus !== 'clear') {
    return 'model-state-blocked';
  }
  if (
    state.partyType !== plan.partyType ||
    state.assignedActor !== plan.assignedActor ||
    state.dataClass !== plan.dataClass
  ) {
    return 'model-state-blocked';
  }
  return null;
}

/** A blocking reason if the post-gateway state now blocks or drifted from the pre-gateway baseline. */
export function postGatewayBlockReason(
  before: ReplyState,
  after: ReplyState,
  plan: ReplyPlan,
): ModelReplyAdapterReason | null {
  const block = stateBlockReason(after, plan);
  if (block !== null) {
    return block;
  }
  if (after.revision !== before.revision) {
    return 'model-state-blocked';
  }
  return null;
}
