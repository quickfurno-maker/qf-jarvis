/**
 * Authority-first runtime proposals (QFJ-M1, ADR-0054 §G).
 *
 * The runtime produces PROPOSALS ONLY. Every proposal is a frozen data record bound to an exact
 * id/version, an actor/party/conversation, and the authority status `PENDING_CORE_VALIDATION`, and it
 * has NO `execute`/`send`/`authorize`/`callN8n` method. QuickFurno Core is the only authority that may
 * validate and act on a proposal; n8n is transport-only. Actor↔party scope is enforced at creation.
 */
import { z } from 'zod';

import { AgentRuntimeError } from './errors.js';
import { assertActorPartyCompatible } from './scope.js';
import { PROPOSAL_AUTHORITY_STATUS, RUNTIME_PROPOSAL_KINDS } from './vocabularies.js';
import type {
  ProposalAuthorityStatus,
  RuntimeActor,
  RuntimePartyType,
  RuntimeProposalKind,
} from './vocabularies.js';

/** One immutable, authority-pending runtime proposal. It carries no execute/send/authorize method. */
export interface RuntimeProposal {
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly kind: RuntimeProposalKind;
  readonly actor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly conversationId: string;
  readonly authorityStatus: ProposalAuthorityStatus;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const proposalSchema = z
  .object({
    proposalId: IDENTIFIER,
    proposalVersion: z.int().min(1).max(1_000_000),
    kind: z.enum(RUNTIME_PROPOSAL_KINDS),
    conversationId: IDENTIFIER,
  })
  .strict();

/**
 * Build a frozen proposal. Enforces actor↔party scope (Riya client-only / Anisha vendor-only) and
 * stamps `PENDING_CORE_VALIDATION`. Throws `AgentRuntimeError('invalid-proposal' | 'scope-violation')`.
 */
export function createProposal(input: {
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly kind: RuntimeProposalKind;
  readonly actor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly conversationId: string;
}): RuntimeProposal {
  const parsed = proposalSchema.safeParse({
    proposalId: input.proposalId,
    proposalVersion: input.proposalVersion,
    kind: input.kind,
    conversationId: input.conversationId,
  });
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-proposal');
  }
  // Reply/tool-intent are agent ACTIONS and must respect actor↔party scope; assignment/escalation/
  // follow-up are coordination proposals but are held to the same boundary for safety.
  assertActorPartyCompatible(input.actor, input.partyType);
  return Object.freeze({
    proposalId: parsed.data.proposalId,
    proposalVersion: parsed.data.proposalVersion,
    kind: parsed.data.kind,
    actor: input.actor,
    partyType: input.partyType,
    conversationId: parsed.data.conversationId,
    authorityStatus: PROPOSAL_AUTHORITY_STATUS,
  });
}
