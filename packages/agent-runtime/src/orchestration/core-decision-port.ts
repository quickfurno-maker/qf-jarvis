/**
 * The injected QuickFurno Core decision port (QFJ-M2, ADR-0055 §D).
 *
 * The Core decision is owned by the integration boundary — NOT a fake business authority inside
 * Jarvis. The orchestrator hands Core a content-minimized request and receives a closed outcome; a
 * missing port fails closed to `CORE_UNAVAILABLE`, and agent-runtime cannot fabricate `ACCEPTED`. The
 * request carries no raw provider object; the proposed reply body is included only for Core to
 * validate. The only concrete implementation is the deterministic fake under `./testing`.
 */
import type { KnowledgeCitation } from './contracts.js';
import type { CoreDecisionOutcome, OrchestrationProposalKind } from './vocabularies.js';
import type { RuntimeActor, RuntimePartyType } from '../contracts/vocabularies.js';

/** The content-minimized request handed to QuickFurno Core for a proposal decision. */
export interface CoreDecisionRequest {
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly proposalKind: OrchestrationProposalKind;
  readonly structuredIntent: Readonly<Record<string, string | number | boolean>>;
  readonly policyRevision: string;
  readonly evaluationRef: string | undefined;
  readonly citations: readonly KnowledgeCitation[];
  /** The bounded proposed reply body, present only when Core must validate it. */
  readonly proposedReplyBody: string | undefined;
}

/** The closed response Core returns. The outcome is authoritative and never fabricated by Jarvis. */
export interface CoreDecisionResponse {
  readonly outcome: CoreDecisionOutcome;
}

/**
 * Decides a proposal. Owned by the integration boundary; a missing port fails closed. Awaited (a live
 * Core decision is a network round-trip) (ADR-0058 §1).
 */
export interface CoreDecisionPort {
  decide(request: CoreDecisionRequest): Promise<CoreDecisionResponse>;
}
