/**
 * The generic behaviour-decision seam (QFJ-S3-C-B, ADR-0068).
 *
 * The orchestrator knows the ORDER of a turn — gates, knowledge, model, double gate, proposal, Core.
 * It does not know what any particular conversation is ABOUT, and it must not: the moment this package
 * could name a sales intent or a vendor issue it would stop being generic infrastructure and would
 * have to depend on the behaviour packages it exists to serve. So the seam is an injected port, and
 * everything domain-shaped stays on the far side of it.
 *
 * A decision answers exactly two questions the pipeline cannot answer for itself — may a model be
 * invoked for this turn, and what kind of thing is being proposed to Core — plus a bounded intent
 * record. It carries no reply body, no actor, no party type, no authority state, no Core outcome and
 * no executable instruction, because each of those is already owned elsewhere and a second source
 * would be a second authority.
 *
 * The port is OPTIONAL. When it is absent the orchestrator uses the legacy default (eligible, `REPLY`)
 * and behaves exactly as it did before this contract existed.
 */
import type { RuntimeActor, RuntimePartyType } from '../contracts/vocabularies.js';
import type { OrchestrationProposalKind } from './vocabularies.js';

/**
 * What the orchestrator tells a behaviour port about the turn.
 *
 * Content-free and revision-bound. Deliberately NOT the envelope: a behaviour decision has no business
 * with the provider message reference or the normalized text, and passing them would invite exactly
 * the natural-language classification this seam exists to keep out of the runtime.
 */
export interface BehaviourDecisionRequest {
  readonly conversationId: string;
  readonly partyType: RuntimePartyType;
  /** The actor the merged router already assigned. Informational — a port cannot change it. */
  readonly assignedActor: RuntimeActor;
  readonly revision: number;
}

/**
 * One behaviour decision.
 *
 * `modelReplyEligible` is an eligibility answer, not a budget: the orchestrator still owns the
 * at-most-one-invocation guarantee, and `false` simply means the model stage is skipped entirely.
 */
export interface BehaviourDecision {
  readonly modelReplyEligible: boolean;
  readonly proposalKind: OrchestrationProposalKind;
  readonly structuredIntent: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Supplies a behaviour decision for one turn, or `undefined` to accept the legacy default.
 *
 * Awaited, because a real implementation reads state across a boundary (ADR-0058 §1). It is called at
 * most once per turn, and only after the complete first gate has passed — a paused, cancelled,
 * privacy-blocked or out-of-scope conversation must not reach a behaviour port at all.
 */
export interface BehaviourDecisionPort {
  decide(request: BehaviourDecisionRequest): Promise<BehaviourDecision | undefined>;
}
