/**
 * The durable turn coordinator port (RWC-P8, ADR-0104).
 *
 * ### Two different questions, two different layers
 *
 * ADR-0097's ingress replay guard is keyed on `(caller, requestId)`. It protects ONE SIGNED TRANSPORT
 * REQUEST inside its freshness window, and it is process-local. Both properties are correct for what
 * it does and wrong for what a conversation needs: a trusted caller can re-sign the SAME logical
 * message under a fresh `requestId` — a retry after a timeout, a queue redelivery, a second replica
 * picking up the same work — and every transport guard in the deployment would correctly let it
 * through. Riya would then run a second model turn, take a second Core decision, and possibly create a
 * second enquiry about one sentence.
 *
 * So `requestId` is TRANSPORT identity and is never logical-turn identity. This port is the
 * application layer underneath it, and both layers stay.
 *
 * ### It receives METADATA, and cannot be handed a message
 *
 * There is no `normalizedText` field on the input, no reply, no continuity, no availability snapshot,
 * no prompt, model or provider, no `requestId` and no business data. The coordinator's job is to decide
 * whether this logical turn may run; none of that helps it decide, and every one of them would end up
 * in a durable row that is not supposed to be a message archive.
 *
 * The absence is enforced by the type AND asserted by a spy in the service specs, because "we
 * remembered not to pass it" is not a property.
 *
 * ### Two stages, and the gap between them is the point
 *
 * `begin` acquires the conversation and classifies the claim, but writes NOTHING. A turn can still
 * fail its continuity load or its availability read after that, and those failures happen before any
 * model, Core call or write — so they must leave the message RETRYABLE. A ledger row written at
 * `begin` would mark a message spent that never ran.
 *
 * `startProcessing` inserts the durable claim immediately before the runtime. Everything after that
 * point is potentially spent, and ADR-0104 forbids ever re-running it automatically.
 */
import type { RuntimeDataClass } from '@qf-jarvis/agent-runtime';

import type { RiyaConversationChannel } from './channel-turn.js';

/** Exactly the non-content metadata a coordinator needs. Nothing a client wrote. */
export interface RiyaTurnCoordinatorBeginInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly channel: RiyaConversationChannel;
  /** The caller's opaque per-channel reference. A coordinator may digest it; it must not store it raw. */
  readonly channelTurnRef: string;
  readonly receivedAt: string;
  readonly dataClass: RuntimeDataClass;
  readonly subjectRef?: string;
}

/** What a `begin` decided. Closed, and every non-acquiring answer stops the turn dead. */
export const RIYA_TURN_BEGIN_OUTCOMES = [
  /** This turn owns the conversation and may proceed. */
  'ACQUIRED',
  /** Another turn for this conversation is in flight. Not a decision about this message. */
  'BUSY',
  /** This exact logical message already completed. It is spent, and nothing re-runs it. */
  'REPLAYED',
  /** This message id or source reference is being reused with different immutable identity. */
  'CONFLICT',
  /**
   * This message was claimed and its outcome is unknown.
   *
   * Deliberately its own answer and deliberately NOT retryable: a turn that reached the runtime may
   * have produced a model call, a Core decision or a durable write before it vanished, and re-running
   * it is the one thing that could double a real enquiry.
   */
  'INDETERMINATE',
] as const;

export type RiyaTurnBeginOutcome = (typeof RIYA_TURN_BEGIN_OUTCOMES)[number];

/**
 * The lease an `ACQUIRED` turn holds.
 *
 * Every method is SINGLE-USE and state-checked. A lease that could be finalized twice would be a
 * lease that could report a turn complete after it had already been marked indeterminate.
 */
export interface RiyaTurnLease {
  /**
   * Write the durable `PROCESSING` claim. Called immediately before the runtime, and never earlier.
   *
   * After this resolves, the message is potentially spent. Before it, nothing is.
   */
  startProcessing(): Promise<void>;
  /**
   * Finalize as `COMPLETED`, after a full normal result exists and BEFORE it is returned.
   *
   * Before, not after: if the finalization is lost, a caller that already received the reply would
   * retry and the ledger would let it through as a fresh claim.
   */
  complete(): Promise<void>;
  /** Finalize as `INDETERMINATE`. At most once, with no retry and no loop. */
  indeterminate(): Promise<void>;
  /**
   * Release a lease that never started processing.
   *
   * No ledger row is written and none is updated, so the same logical message stays retryable — which
   * is exactly right for a turn that failed before it could do anything.
   */
  releaseUnstarted(): Promise<void>;
}

/** What `begin` returns. A lease exists on `ACQUIRED` and on no other outcome. */
export type RiyaTurnBeginResult =
  | { readonly outcome: 'ACQUIRED'; readonly lease: RiyaTurnLease }
  | { readonly outcome: Exclude<RiyaTurnBeginOutcome, 'ACQUIRED'> };

/**
 * The injected durable coordinator.
 *
 * REQUIRED by the service, with no default and no in-memory production fallback. A permissive default
 * would answer `ACQUIRED` to everything, pass every test in this repository, and silently remove
 * duplicate protection in exactly the deployment that most needs it.
 */
export interface RiyaTurnCoordinatorPort {
  begin(input: RiyaTurnCoordinatorBeginInput): Promise<RiyaTurnBeginResult>;
}
