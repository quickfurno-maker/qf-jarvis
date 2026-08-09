/**
 * The bounded service error contract (RWC-P2C, ADR-0094).
 *
 * Five codes, five fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input, the store, the runtime or anything a client said.
 *
 * The turn this service handles carries a person's own words about their home. A wrapped store
 * error, a nested runtime exception or a raw `zod` issue would each carry that content — or a table
 * name, or a connection host — one layer closer to a browser. So a failure says what KIND of thing
 * went wrong, and nothing else.
 *
 * `continuity-conflict` was deliberately absent while this service never called `compareAndSet`: a
 * code for a path that could not happen would have implied a behaviour that did not exist. RWC-P4B
 * is where it earned its place -- the service now evolves and persists continuity, so two writers
 * racing one conversation is reachable.
 */
const RIYA_WEB_CONVERSATION_ERROR_CODE_VALUES = [
  /** The turn, or the service configuration, is not valid. Nothing was loaded and nothing ran. */
  'invalid-input',
  /** The continuity store could not answer. Fail closed; never assume a fresh conversation. */
  'continuity-unavailable',
  /** The authoritative runtime could not answer. Fail closed; never fabricate an outcome. */
  'runtime-unavailable',
  /** Durable or runtime evidence contradicted itself. Trusting it would be worse than refusing. */
  'repository-invariant',
  /**
   * Continuity changed twice while ONE turn was trying to reconcile (RWC-P4B, ADR-0099).
   *
   * The first compare-and-set lost a race, the state was reloaded, the SAME observations were purely
   * re-merged, and the second attempt lost again. There is no third attempt: this service will not
   * guess which of two concurrent conversations should win, and looping would mean re-deciding a
   * conversation nobody is watching converge.
   */
  'continuity-conflict',
  /**
   * Another TEXT turn for this conversation is already in flight (RWC-P8, ADR-0104).
   *
   * Not a decision about this message and not a defect: one conversation runs one text turn at a
   * time, across replicas, and a caller may present this one again once the other finishes.
   */
  'turn-in-flight',
  /**
   * This exact logical message already completed. It is spent.
   *
   * No cached reply is returned with it. The ledger stores no model output, and inventing one here
   * would make a replay indistinguishable from a fresh answer to the client receiving it.
   */
  'turn-replayed',
  /**
   * A message id or a source reference is being reused with different immutable identity.
   *
   * Same message, a later `receivedAt`; same message, a changed data class or subject; the same source
   * reference under a new message id. Each is a DIFFERENT turn wearing an existing claim's key, and
   * accepting either reading would be guessing on the caller's behalf.
   */
  'turn-conflict',
  /**
   * A previous claim of this message reached the runtime and its outcome is unknown.
   *
   * Deliberately terminal for this message. A turn that got that far may have produced a model call, a
   * Core decision or a durable write before it vanished, and automatically re-running it is the one
   * thing that could double a real enquiry.
   */
  'turn-indeterminate',
  /** The durable coordinator could not answer. Fail closed; never assume a turn may run. */
  'turn-coordinator-unavailable',
  /**
   * This process is already serving as many text turns as it was configured to (RWC-P9, ADR-0105).
   *
   * Capacity protection, not a decision about the message. Nothing downstream ran -- no coordinator,
   * no database session, no availability read, no model, no Core -- and no durable claim exists, so
   * the same logical message may be presented again.
   *
   * There is no service queue behind this and no suggested retry time in the message: a wait the
   * service cannot honour is worse than an immediate, honest refusal.
   */
  'turn-overloaded',
] as const;

export type RiyaWebConversationErrorCode = (typeof RIYA_WEB_CONVERSATION_ERROR_CODE_VALUES)[number];

export const RIYA_WEB_CONVERSATION_ERROR_CODES: readonly RiyaWebConversationErrorCode[] =
  Object.freeze([...RIYA_WEB_CONVERSATION_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<RiyaWebConversationErrorCode, string>> = Object.freeze({
  'invalid-input': 'A Riya web conversation turn is invalid.',
  'continuity-unavailable': 'The Riya conversation continuity store is unavailable.',
  'runtime-unavailable': 'The Jarvis runtime is unavailable.',
  'repository-invariant': 'A Riya web conversation record is inconsistent.',
  // "change", not "update": the containment scan forbids the SQL keyword `UPDATE ` in production
  // source, and an English sentence must not be the thing that makes a database lock unenforceable.
  'continuity-conflict': 'A Riya conversation continuity change could not be reconciled.',
  // Fixed and content-free, like every message above. None names the conversation, the message, the
  // channel, the caller or anything a client wrote.
  'turn-in-flight': 'A Riya conversation turn is already in progress.',
  'turn-replayed': 'A Riya conversation turn was already processed.',
  'turn-conflict': 'A Riya conversation turn identity conflicts with a recorded turn.',
  'turn-indeterminate': 'A Riya conversation turn outcome is undetermined.',
  'turn-coordinator-unavailable': 'The Riya conversation turn coordinator is unavailable.',
  // Deliberately carries no count, no ceiling and no retry hint. A capacity number is an
  // operational fact for a metric, not something to hand a client through an error string.
  'turn-overloaded': 'The Riya conversation service is at capacity.',
});

/** A bounded service error. The code is the contract; the message is fixed per code. */
export class RiyaWebConversationError extends Error {
  readonly code: RiyaWebConversationErrorCode;

  constructor(code: RiyaWebConversationErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RiyaWebConversationError';
    this.code = code;
  }
}
