/**
 * The bounded conversation-control error contract (QFJ-P08-A, ADR-0074).
 *
 * Three codes and three fixed messages. The message is a CONSTANT chosen by the code, never built
 * from the input: an operator command names a conversation and an operator, and an error string that
 * echoed either would turn a validation failure into a disclosure. Zod's own issue text is likewise
 * never surfaced — it quotes the offending value.
 *
 * There is no `cause`, no `details`, no field path and no timestamp. A caller learns WHICH of three
 * things was wrong and nothing further; that is enough to fix a wiring bug and not enough to mine.
 */
const CONVERSATION_CONTROL_ERROR_CODE_VALUES = [
  /** The command itself is not a valid control command. */
  'invalid-command',
  /** The supplied control snapshot is not a valid control fragment. */
  'invalid-state',
  /** Both are individually valid, but this command cannot be applied to this snapshot. */
  'invalid-application',
] as const;
export type ConversationControlErrorCode = (typeof CONVERSATION_CONTROL_ERROR_CODE_VALUES)[number];

export const CONVERSATION_CONTROL_ERROR_CODES: readonly ConversationControlErrorCode[] =
  Object.freeze([...CONVERSATION_CONTROL_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<ConversationControlErrorCode, string>> = Object.freeze({
  'invalid-command': 'A conversation-control command is invalid.',
  'invalid-state': 'A conversation-control snapshot is invalid.',
  'invalid-application': 'A conversation-control command cannot be applied to this snapshot.',
});

/** A bounded control error. The code is the contract; the message is fixed per code. */
export class ConversationControlError extends Error {
  readonly code: ConversationControlErrorCode;

  constructor(code: ConversationControlErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ConversationControlError';
    this.code = code;
  }
}
