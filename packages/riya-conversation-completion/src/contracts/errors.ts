/**
 * The bounded error vocabulary for RWC-P6 completion semantics (ADR-0101).
 *
 * Five codes, five fixed messages. Everything this package handles describes a real person's project
 * and their decisions about it, so an error that quoted what it refused would be the one place that
 * material leaked.
 *
 * There is deliberately no transport, store or Core code: this package performs no I/O and consults
 * no authority. It receives already-governed evidence as inert values, and the only faults it can
 * observe are about the SHAPE and the PHASE of what it was given.
 */

const RIYA_CONVERSATION_COMPLETION_ERROR_CODE_VALUES = [
  /** The continuity state could not be proved canonical. */
  'invalid-state',
  /** The structured summary edit could not be proved canonical. */
  'invalid-summary-edit',
  /** The Core availability snapshot could not be proved canonical. */
  'invalid-availability-snapshot',
  /** The supplied Core evidence reference is not a well-formed opaque reference. */
  'invalid-evidence-ref',
  /**
   * The action is not one this state may take.
   *
   * Wrong phase, an already-confirmed summary, a missing summary-required value, a human-review
   * conversation, a service or city Core no longer lists, an unavailable pair, or a revision that
   * cannot advance. One code rather than nine: the caller's correct response to every one of them is
   * the same — do not proceed — and a finer vocabulary here would describe the client's situation to
   * whoever reads the log.
   */
  'action-not-permitted',
] as const;

export type RiyaConversationCompletionErrorCode =
  (typeof RIYA_CONVERSATION_COMPLETION_ERROR_CODE_VALUES)[number];

export const RIYA_CONVERSATION_COMPLETION_ERROR_CODES: readonly RiyaConversationCompletionErrorCode[] =
  Object.freeze([...RIYA_CONVERSATION_COMPLETION_ERROR_CODE_VALUES]);

const MESSAGES: Readonly<Record<RiyaConversationCompletionErrorCode, string>> = Object.freeze({
  'invalid-state': 'A Riya conversation continuity state is invalid.',
  'invalid-summary-edit': 'A Riya structured summary edit is invalid.',
  'invalid-availability-snapshot': 'A Core service availability snapshot is invalid.',
  'invalid-evidence-ref': 'A Core evidence reference is invalid.',
  'action-not-permitted': 'A Riya completion action is not permitted for this conversation.',
});

export class RiyaConversationCompletionError extends Error {
  readonly code: RiyaConversationCompletionErrorCode;

  constructor(code: RiyaConversationCompletionErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RiyaConversationCompletionError';
    this.code = code;
  }
}
