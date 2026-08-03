/**
 * The bounded runtime error contract (QFJ-P08, ADR-0083).
 *
 * Seven codes, seven fixed messages. The message is a CONSTANT chosen by the code and never built
 * from anything that arrived.
 *
 * That rule is stricter here than almost anywhere else in the repository, because of what this
 * surface handles. A `CommunicationRequestV1` names a recipient — an opaque Core entity reference,
 * but still an identity — a purpose code, an approved template and its variables, and a human-facing
 * summary. A `CommunicationAuthorizationV1` carries the reason Core refused, and that reason is
 * routinely `recipient-opted-out`, `consent-withdrawn` or `stop-received`. An error message
 * assembled from any of those would take **the fact that a specific person opted out** and put it
 * wherever the error goes: a log line, a screenshot, a support ticket, a bug report.
 *
 * So Zod's issues are discarded entirely rather than summarised, and no code below is ever
 * parameterised.
 *
 * ### Why the last three are separate codes
 *
 * `approval-required` means Core authorized a communication and no approval evidence was supplied at
 * all — the caller has an incomplete picture and must go and find the approval.
 * `approval-invalid` means evidence was supplied and does not hold up. `approval-not-approved` means
 * it holds up perfectly and says **this action was refused**. Collapsing them would hide the
 * difference between "you did not show me the approval" and "the approval you showed me says no".
 */
const COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODE_VALUES = [
  /** The supplied input is not a validation request at all. Nothing was correlated. */
  'invalid-input',
  /** The supplied communication request violates the governed contract. */
  'request-invalid',
  /** Core's authorization violates the governed contract — including a non-Core issuer. */
  'authorization-invalid',
  /** Structurally valid artifacts that do not describe each other. Fail closed. */
  'binding-mismatch',
  /** Core authorized a communication and no approval evidence was supplied. */
  'approval-required',
  /** The supplied approval evidence does not hold up under the public approval runtime. */
  'approval-invalid',
  /** The approval is valid and REFUSED this action. An authorization cannot rest on it. */
  'approval-not-approved',
] as const;

export type CommunicationAuthorizationRuntimeErrorCode =
  (typeof COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODE_VALUES)[number];

export const COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODES: readonly CommunicationAuthorizationRuntimeErrorCode[] =
  Object.freeze([...COMMUNICATION_AUTHORIZATION_RUNTIME_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<CommunicationAuthorizationRuntimeErrorCode, string>> =
  Object.freeze({
    'invalid-input': 'Communication authorization runtime input is invalid.',
    'request-invalid': 'The communication request violates the governed contract.',
    'authorization-invalid': 'The communication authorization violates the governed contract.',
    'binding-mismatch': 'The communication authorization does not match the communication request.',
    'approval-required': 'An authorized communication requires approval evidence.',
    'approval-invalid': 'The supplied approval evidence is not valid for this communication.',
    'approval-not-approved': 'The approved action for this communication was not approved.',
  });

/** A bounded runtime error. The code is the contract; the message is fixed per code. */
export class CommunicationAuthorizationRuntimeError extends Error {
  readonly code: CommunicationAuthorizationRuntimeErrorCode;

  constructor(code: CommunicationAuthorizationRuntimeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CommunicationAuthorizationRuntimeError';
    this.code = code;
  }
}
