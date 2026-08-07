/**
 * The bounded service error contract (RWC-P2C, ADR-0094).
 *
 * Four codes, four fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input, the store, the runtime or anything a client said.
 *
 * The turn this service handles carries a person's own words about their home. A wrapped store
 * error, a nested runtime exception or a raw `zod` issue would each carry that content — or a table
 * name, or a connection host — one layer closer to a browser. So a failure says what KIND of thing
 * went wrong, and nothing else.
 *
 * There is deliberately no `continuity-conflict`: this service never calls `compareAndSet`, so a
 * revision conflict is unreachable from a turn. A code for a path that cannot happen would imply a
 * behaviour that does not exist, and RWC-P4 is where that code will earn its place.
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
