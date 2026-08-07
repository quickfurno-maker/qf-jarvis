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
  /**
   * The deterministic digest of the exact semantic proposal Core is deciding (RWC-P2D, ADR-0096).
   *
   * ### Why identity alone was not enough
   *
   * `proposalId` is derived from `runtimeId`, `conversationId`, `messageId`, `expectedRevision`,
   * `proposalVersion` and `proposalKind`, and `idempotencyKey` from the protocol plus that identity.
   * **Neither includes model output.** So one logical turn could produce BODY_A, receive `ACCEPTED`,
   * and on a retry produce BODY_B while carrying the identical proposal and idempotency identity — and
   * a stale or cached `ACCEPTED` for BODY_A would validate perfectly against the BODY_B command.
   *
   * That was harmless while nothing consumed the body. RWC-P2D consumes it, and promises a caller the
   * exact text Core authorized, so the gap became a correctness defect: BODY_B could be presented as
   * Core-approved.
   *
   * The response must echo this digest, and `validateResponse` requires it to match. A decision about
   * different content therefore fails closed instead of being mistaken for this one's.
   *
   * It is integrity/identity evidence, **not authentication** — it proves *which* proposal a response
   * is about, not *who* produced the response. And it is a digest: no raw body text ever appears in an
   * identifier.
   */
  readonly proposalDigest: string;
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

/**
 * The body Core actually receives, for a given proposal kind (ADR-0068).
 *
 * ONE definition, used by both the command field and `proposalDigestFor`. They must never disagree:
 * a digest computed over a body Core was not sent — or omitting one it was — would bind the wrong
 * thing, and the mismatch would be invisible because both halves would still be internally
 * consistent. Deriving both from this function makes that class of drift impossible rather than
 * merely unlikely.
 *
 * `REPLY` and `FOLLOW_UP` carry client-facing text. `ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION` and
 * `NO_ACTION` propose none, so a body arriving with one of them is dropped rather than forwarded.
 */
export function effectiveProposedReplyBody(request: {
  readonly proposalKind: OrchestrationProposalKind;
  readonly proposedReplyBody: string | undefined;
}): string | undefined {
  return request.proposalKind === 'REPLY' || request.proposalKind === 'FOLLOW_UP'
    ? request.proposedReplyBody
    : undefined;
}

/**
 * The deterministic digest of the exact semantic proposal, INCLUDING the effective reply body and
 * the FULL citation tuple (`knowledgeId`, `version`, `source`, `digest`) of every citation.
 *
 * Same proposal, same body and same citations → same digest. Any of them different under the same
 * identity → different digest, which is the whole point (see `CoreCommandIdentity.proposalDigest`).
 *
 * The protocol identity is deliberately NOT an input: it is compared separately and in full by
 * `validateResponse`, and folding it in here would make one field's change silently rewrite the
 * other's meaning.
 */
export function proposalDigestFor(request: {
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
  readonly proposedReplyBody: string | undefined;
}): string {
  return contentDigest({
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    conversationId: request.conversationId,
    expectedRevision: request.expectedRevision,
    assignedActor: request.assignedActor,
    partyType: request.partyType,
    proposalKind: request.proposalKind,
    structuredIntent: request.structuredIntent,
    policyRevision: request.policyRevision,
    evaluationRef: request.evaluationRef,
    // The FULL citation tuple, field by field. A reduced projection bound only `knowledgeId` and
    // `version`, so two commands citing the same knowledge id at the same version but with a
    // different `source` or a different content `digest` produced the SAME proposal digest -- and the
    // claim that this digest binds the exact semantic proposal was therefore not literally true.
    //
    // Written out explicitly rather than as `{ ...c }`: this is the frozen v2 wire semantics, and a
    // spread would let any field added to `KnowledgeCitation` later change what v2 means without
    // anybody deciding to. Expanding the tuple must be a deliberate protocol review.
    citations: request.citations.map((c) => ({
      knowledgeId: c.knowledgeId,
      version: c.version,
      source: c.source,
      digest: c.digest,
    })),
    proposedReplyBody: effectiveProposedReplyBody(request),
  });
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
    // The idempotency key stays IDENTITY-derived and unchanged: the same logical proposal should keep
    // the same idempotency identity, so Core still deduplicates a genuine retry. The content binding
    // lives here instead. If Core returns a cached decision for older content under that same key,
    // the echoed digest differs and validation fails closed -- which is the correct outcome, and a
    // content-derived key could not produce it without also breaking deduplication.
    proposalDigest: proposalDigestFor(request),
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
    // The SAME `effectiveProposedReplyBody` the digest above bound. Sharing the definition is what
    // makes "the digest covers exactly what Core was sent" a structural fact rather than a comment.
    proposedReplyBody: effectiveProposedReplyBody(request),
    createdAt,
  });
}
