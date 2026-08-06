/**
 * The bounded continuity error contract (RWC-P2A, ADR-0093).
 *
 * Four codes, four fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input.
 *
 * That matters here because the input is conversational. A `zod` issue path would name the field
 * that failed, and a `zod` message can quote the value — so a raw validation error from this
 * constructor could carry a client's own words about their home into a log, an alert or an error
 * surface. The codes below say what KIND of thing was wrong and nothing else.
 */
const RIYA_CONVERSATION_CONTINUITY_ERROR_CODE_VALUES = [
  /** The state envelope is not valid: wrong shape, unknown key, bad identity or bad revision. */
  'invalid-input',
  /** The embedded need-discovery snapshot is not a valid `NeedDiscovery`. */
  'invalid-discovery',
  /** The provenance map contradicts the discovery it describes. */
  'invalid-provenance',
  /** The phase contradicts `summaryConfirmed` or the completion evidence. */
  'invalid-phase-state',
] as const;

export type RiyaConversationContinuityErrorCode =
  (typeof RIYA_CONVERSATION_CONTINUITY_ERROR_CODE_VALUES)[number];

export const RIYA_CONVERSATION_CONTINUITY_ERROR_CODES: readonly RiyaConversationContinuityErrorCode[] =
  Object.freeze([...RIYA_CONVERSATION_CONTINUITY_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, field-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<RiyaConversationContinuityErrorCode, string>> = Object.freeze({
  'invalid-input': 'A Riya conversation continuity state is invalid.',
  'invalid-discovery': 'A Riya conversation continuity state carries an invalid need discovery.',
  'invalid-provenance':
    'A Riya conversation continuity state carries provenance that does not match its discovery.',
  'invalid-phase-state': 'A Riya conversation continuity state carries an inconsistent phase.',
});

/** A bounded continuity error. The code is the contract; the message is fixed per code. */
export class RiyaConversationContinuityError extends Error {
  readonly code: RiyaConversationContinuityErrorCode;

  constructor(code: RiyaConversationContinuityErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RiyaConversationContinuityError';
    this.code = code;
  }
}
