/**
 * The narrow injected Core decision transport (QFJ-M3, ADR-0056 §F).
 *
 * It accepts a VALIDATED serialized command and returns a VALIDATED serialized response. It contains
 * no business logic, no hidden retry, and no live network implementation. A missing transport →
 * `CORE_UNAVAILABLE`; an exception/timeout (a rejected Promise) is normalized by the adapter to a safe
 * fail-closed outcome. A live Core call is a network round-trip, so the transport is asynchronous
 * (ADR-0058 §1). The only concrete implementation is the deterministic fake under `./testing`.
 */
import type { CoreCommand } from '../contracts/command.js';
import { canonicalJson } from '../contracts/digest.js';

/** Send a serialized command to Core and resolve the serialized response. Awaited; may reject. */
export interface CoreDecisionTransport {
  send(serializedCommand: string): Promise<string>;
}

/** Serialize a command to the canonical, content-free wire form the transport receives. */
export function serializeCommand(command: CoreCommand): string {
  return canonicalJson({
    protocol: command.protocol,
    commandId: command.commandId,
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    proposalId: command.proposalId,
    proposalVersion: command.proposalVersion,
    conversationId: command.conversationId,
    expectedRevision: command.expectedRevision,
    // RWC-P2D (ADR-0096). On the wire because Core must ECHO it: a digest the responder never
    // received is a digest it could only recompute from its own view of the proposal, and a
    // responder that recomputes always agrees with itself.
    proposalDigest: command.proposalDigest,
    assignedActor: command.assignedActor,
    partyType: command.partyType,
    proposalKind: command.proposalKind,
    structuredIntent: command.structuredIntent,
    policyRevision: command.policyRevision,
    evaluationRef: command.evaluationRef ?? null,
    citations: command.citations,
    proposedReplyBody: command.proposedReplyBody ?? null,
    createdAt: command.createdAt,
  });
}
