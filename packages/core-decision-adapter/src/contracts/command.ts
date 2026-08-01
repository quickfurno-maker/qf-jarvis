/**
 * The immutable, versioned Core command (QFJ-M3, ADR-0056 §C, §D).
 *
 * Built from an M2 `CoreDecisionRequest` plus the exact protocol identity, a correlation id, and an
 * injected canonical instant. It binds every exact identity and a DETERMINISTIC idempotency key. It
 * carries no chain-of-thought, raw provider body/header, SDK object, secret, callback, n8n command,
 * delivery mutation, or DB handle; a reply body is present only for a `REPLY`.
 */
import type {
  CoreDecisionRequest,
  KnowledgeCitation,
  OrchestrationProposalKind,
  RuntimeActor,
  RuntimePartyType,
} from '@qf-jarvis/agent-runtime';

import { CoreAdapterError } from './errors.js';
import { contentDigest, isCanonicalInstant } from './digest.js';
import { coreDecisionProtocolSchema } from './protocol.js';
import type { CoreDecisionProtocol } from './protocol.js';

/** The exact identity tuple that both the idempotency key and the response are bound to. */
export interface CoreCommandIdentity {
  readonly protocol: CoreDecisionProtocol;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
}

/** One immutable Core decision command. */
export interface CoreCommand extends CoreCommandIdentity {
  readonly correlationId: string;
  readonly assignedActor: RuntimeActor;
  readonly partyType: RuntimePartyType;
  readonly proposalKind: OrchestrationProposalKind;
  readonly structuredIntent: Readonly<Record<string, string | number | boolean>>;
  readonly policyRevision: string;
  readonly evaluationRef: string | undefined;
  readonly citations: readonly KnowledgeCitation[];
  readonly proposedReplyBody: string | undefined;
  readonly createdAt: string;
}

/** The deterministic idempotency key of a command identity. Same identity → same key. */
export function idempotencyKeyFor(args: {
  readonly protocol: CoreDecisionProtocol;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
}): string {
  return contentDigest({
    protocolName: args.protocol.name,
    protocolVersion: args.protocol.version,
    contractDigest: args.protocol.contractDigest,
    proposalId: args.proposalId,
    proposalVersion: args.proposalVersion,
    conversationId: args.conversationId,
    expectedRevision: args.expectedRevision,
  });
}

/** Build a frozen Core command. Throws `CoreAdapterError('invalid-command')` on invalid input. */
export function buildCoreCommand(args: {
  readonly request: CoreDecisionRequest;
  readonly protocol: CoreDecisionProtocol;
  readonly correlationId: string;
  readonly createdAt: string;
}): CoreCommand {
  const { request, protocol, correlationId, createdAt } = args;
  if (!coreDecisionProtocolSchema.safeParse(protocol).success || !isCanonicalInstant(createdAt)) {
    throw new CoreAdapterError('invalid-command');
  }
  const identifier = /^[A-Za-z0-9._:-]+$/;
  if (!identifier.test(correlationId) || correlationId.length > 128) {
    throw new CoreAdapterError('invalid-command');
  }
  const idempotencyKey = idempotencyKeyFor({
    protocol,
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    conversationId: request.conversationId,
    expectedRevision: request.expectedRevision,
  });
  return Object.freeze({
    protocol: Object.freeze({ ...protocol }),
    commandId: `${request.conversationId}-${request.proposalId}-r${String(request.expectedRevision)}`,
    idempotencyKey,
    correlationId,
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    conversationId: request.conversationId,
    expectedRevision: request.expectedRevision,
    assignedActor: request.assignedActor,
    partyType: request.partyType,
    proposalKind: request.proposalKind,
    structuredIntent: Object.freeze({ ...request.structuredIntent }),
    policyRevision: request.policyRevision,
    evaluationRef: request.evaluationRef,
    citations: Object.freeze(request.citations.map((c) => Object.freeze({ ...c }))),
    // A reply body is included only for the kinds that actually carry client-facing text — REPLY and
    // FOLLOW_UP (ADR-0068). ESCALATE_TO_HUMAN, REQUEST_CLARIFICATION and NO_ACTION propose no text,
    // so a body arriving with one of them is dropped rather than forwarded to Core.
    proposedReplyBody:
      request.proposalKind === 'REPLY' || request.proposalKind === 'FOLLOW_UP'
        ? request.proposedReplyBody
        : undefined,
    createdAt,
  });
}
