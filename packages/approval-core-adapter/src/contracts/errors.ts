/**
 * The bounded adapter error contract (QFJ-P08, ADR-0082).
 *
 * Five codes, five fixed messages. The message is a CONSTANT chosen by the code, never built from
 * anything that arrived and never built from anything the transport said.
 *
 * That last clause is the one this surface exists for. A submission carries an authenticated
 * operator's opaque Core identity, an authorization proof, a recommendation's summary and policy
 * citation, an action fingerprint, and whatever a transport implementation decides to put in an
 * exception — a URL, a header set, a response body, a stack from someone else's HTTP client. Any of
 * those echoed upward would be a credential and identity disclosure dressed as an error message. So
 * the foreign error is classified into one of these five codes and then DISCARDED: not wrapped, not
 * attached as a `cause`, not stringified into the message.
 *
 * The last two are distinguished deliberately, because each sends an operator to a different place.
 * `core-invalid-response` means what came back is not a well-formed Core decision at all — a Core-side
 * or transport problem. `core-decision-mismatch` means a perfectly valid decision does not describe
 * THIS request, or contradicts the human intent that was submitted — which is a correlation or safety
 * problem, and fails closed.
 */
const APPROVAL_CORE_ADAPTER_ERROR_CODE_VALUES = [
  /** The supplied submission input is not valid. Nothing was serialized and nothing was sent. */
  'invalid-input',
  /** The supplied request is not a faithful ask about the supplied source. Nothing was sent. */
  'binding-invalid',
  /** The transport did not deliver the command, or did not return. Nothing was decided. */
  'core-unavailable',
  /** Core returned something that is not a well-formed ApprovalDecisionV1. */
  'core-invalid-response',
  /** A valid decision that does not describe this request, or contradicts the human intent. */
  'core-decision-mismatch',
] as const;

export type ApprovalCoreAdapterErrorCode = (typeof APPROVAL_CORE_ADAPTER_ERROR_CODE_VALUES)[number];

export const APPROVAL_CORE_ADAPTER_ERROR_CODES: readonly ApprovalCoreAdapterErrorCode[] =
  Object.freeze([...APPROVAL_CORE_ADAPTER_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<ApprovalCoreAdapterErrorCode, string>> = Object.freeze({
  'invalid-input': 'The approval submission input is invalid.',
  'binding-invalid': 'The approval request does not match its recommendation source.',
  'core-unavailable': 'The approval decision service could not be reached.',
  'core-invalid-response': 'The approval decision service returned an invalid response.',
  'core-decision-mismatch': 'The approval decision does not match the submitted request.',
});

/** A bounded adapter error. The code is the contract; the message is fixed per code. */
export class ApprovalCoreAdapterError extends Error {
  readonly code: ApprovalCoreAdapterErrorCode;

  constructor(code: ApprovalCoreAdapterErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ApprovalCoreAdapterError';
    this.code = code;
  }
}
