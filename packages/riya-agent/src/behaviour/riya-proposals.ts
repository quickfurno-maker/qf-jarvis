/**
 * Riya sales proposal semantics (QFJ-S3-C, ADR-0067).
 *
 * This module adds MEANING, not machinery. Every proposal is built by the merged
 * `createProposal` from `@qf-jarvis/agent-runtime`, which stamps `PENDING_CORE_VALIDATION` and
 * enforces actor↔party scope. No new proposal kind, no new authority state, no second proposal model.
 *
 * The two sales proposals Riya can request map onto existing generic kinds:
 *
 *   sales follow-up          -> FOLLOW_UP
 *   human sales contact      -> ESCALATION
 *
 * No new kind was needed, so none was added. `AGENT_ASSIGNMENT`, `REPLY` and `TOOL_INTENT` remain
 * outside Riya's vocabulary: assignment is Jarvis's, `REPLY` is produced by the orchestration layer,
 * and `TOOL_INTENT` would imply an action Riya may never take.
 *
 * The returned record carries an identity and a kind and nothing else — no executor, webhook, URL,
 * workflow id, command, SQL, handle or send instruction. There is no field one could be put in.
 */
import { createProposal } from '@qf-jarvis/agent-runtime';
import type { RuntimeProposal, RuntimeProposalKind } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

import { RiyaBehaviourError } from '../contracts/errors.js';
import { RIYA_ACTOR, RIYA_SUPPORTED_PARTY } from './decide-riya-turn.js';

/** The sales proposals Riya may request. A closed map onto existing generic kinds. */
export const RIYA_PROPOSAL_INTENTS = ['SALES_FOLLOW_UP', 'HUMAN_SALES_CONTACT'] as const;
export type RiyaProposalIntent = (typeof RIYA_PROPOSAL_INTENTS)[number];

export const RIYA_PROPOSAL_INTENTS_FROZEN: readonly RiyaProposalIntent[] = Object.freeze([
  ...RIYA_PROPOSAL_INTENTS,
]);

/** Riya sales meaning -> merged generic kind. Total, and the only mapping that exists. */
const KIND_BY_INTENT: Readonly<Record<RiyaProposalIntent, RuntimeProposalKind>> = Object.freeze({
  SALES_FOLLOW_UP: 'FOLLOW_UP',
  HUMAN_SALES_CONTACT: 'ESCALATION',
});

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const requestSchema = z
  .object({
    proposalIntent: z.enum(RIYA_PROPOSAL_INTENTS),
    proposalId: IDENTIFIER,
    proposalVersion: z.int().min(1).max(1_000_000),
    conversationId: IDENTIFIER,
  })
  .strict();

export interface RiyaProposalRequest {
  readonly proposalIntent: RiyaProposalIntent;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
}

/**
 * Build one Riya sales proposal through the merged boundary.
 *
 * The actor and party type are NOT accepted from the caller — they are fixed to RIYA and CLIENT, so
 * this function cannot be used to propose on a vendor conversation. `createProposal` independently
 * re-checks that pairing and would throw `AgentRuntimeError('scope-violation')` if it were ever
 * wrong, which means the boundary holds even if this module is refactored badly.
 *
 * Throws `RiyaBehaviourError('invalid-proposal-request')` on structurally invalid input, and lets the
 * merged `AgentRuntimeError` propagate unchanged for scope and proposal failures — the caller sees one
 * normalized vocabulary per boundary, not a re-wrapped one.
 */
export function createRiyaProposal(request: RiyaProposalRequest): RuntimeProposal {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    throw new RiyaBehaviourError('invalid-proposal-request');
  }
  return createProposal({
    proposalId: parsed.data.proposalId,
    proposalVersion: parsed.data.proposalVersion,
    kind: KIND_BY_INTENT[parsed.data.proposalIntent],
    actor: RIYA_ACTOR,
    partyType: RIYA_SUPPORTED_PARTY,
    conversationId: parsed.data.conversationId,
  });
}

/** The merged generic kind a Riya sales meaning maps to. Exposed so S3-D can mirror the pattern. */
export function proposalKindFor(intent: RiyaProposalIntent): RuntimeProposalKind {
  return KIND_BY_INTENT[intent];
}
