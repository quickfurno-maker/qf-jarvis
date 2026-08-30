/**
 * The identity port and the runtime surface (QFJ-P08, ADR-0133).
 *
 * ### The result is the canonical contract, and nothing wrapped around it
 *
 * `createRequest` returns a `CommunicationRequestV1` — the artifact `@qf-jarvis/contracts` already
 * owns — deeply frozen and detached. There is no envelope, no `CommunicationRequestResult`, no
 * companion observation and no side record, because every one of those would be a place to put a
 * field the contract deliberately refuses: a `canSend`, an `eligible`, a `consentValid`, a
 * `validUntil`, a `status: 'pending'`, or a mapping from this request to the approved action Core
 * has not yet named.
 *
 * A successful call means exactly one thing:
 *
 * > Jarvis has constructed a valid request asking QuickFurno Core whether a communication may
 * > proceed.
 *
 * It does not mean approved, authorized, eligible, consent-valid, can-send, can-execute,
 * ready-to-dispatch, scheduled-for-execution or delivered.
 */
import type { CommunicationRequestV1 } from '@qf-jarvis/contracts';

/**
 * Supplies the two identities the runtime stamps onto the requests it creates.
 *
 * Injectable so a test can be deterministic. It supplies IDENTITY only: it sees no recommendation,
 * no action, no recipient, no template and no policy, and cannot influence what is asked or of whom.
 * Whatever it returns is validated against the contract's UUID schemas before use — an injected port
 * is untrusted input, and so, for these purposes, is the platform.
 *
 * Two methods, because `CommunicationRequestV1` carries two distinct identities: the ASK
 * (`communicationRequestId`) and the governed COMMUNICATION the ask would open (`communicationId`),
 * whose lifecycle `CommunicationStateRecordV1` tracks separately. Collapsing them would make two
 * different things share a name in an audit trail.
 */
export interface CommunicationRequestRuntimeIdentityPort {
  nextCommunicationRequestId(): string;
  nextCommunicationId(): string;
}

/**
 * The runtime. One synchronous method, and no second.
 *
 * It reads no clock — every instant is caller-stated — and touches no I/O, so there is nothing to
 * await. There is no `authorize`, `approve`, `submit`, `execute`, `send`, `dispatch`, `persist`,
 * `enqueue`, `emit` or `callCore`: Jarvis asks, QuickFurno Core decides, and the asking is powerless
 * by construction.
 *
 * There is also no idempotency. Two calls are two asks, each with its own identities. A runtime that
 * returned the "same" request twice would be holding state about what it had already asked — which
 * is the first half of a local pending queue, and ADR-0002 puts that in Core.
 */
export interface CommunicationRequestRuntime {
  /** Build a powerless `CommunicationRequestV1` about one exact proposed action. */
  createRequest(input: unknown): CommunicationRequestV1;
}
