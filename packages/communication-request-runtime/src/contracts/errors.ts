/**
 * The bounded runtime error contract (QFJ-P08, ADR-0133).
 *
 * Four codes, four fixed messages. The message is a CONSTANT chosen by the code and never built from
 * anything that arrived.
 *
 * This surface handles a recommendation's rationale and evidence, a proposed action's governed
 * parameters, a recipient reference, a purpose code, a template reference and its governed
 * variables. A Zod issue tree echoed from here would quote whichever of those failed — and the
 * governed-content scan in `@qf-jarvis/contracts` is careful to report the PATH of an offending
 * value precisely so that the value is never quoted. So issues are discarded entirely, and so is any
 * foreign error.
 *
 * The taxonomy deliberately mirrors `@qf-jarvis/approval-runtime`'s first four codes rather than
 * inventing a parallel vocabulary: this package asks a different question of the same governed
 * source, and an operator reading `binding-mismatch` should not have to learn which package emitted
 * it before knowing what went wrong.
 */
const COMMUNICATION_REQUEST_RUNTIME_ERROR_CODE_VALUES = [
  /** The supplied input is not valid. Nothing was generated and nothing was assembled. */
  'invalid-input',
  /** The identity port threw, or returned something that is not a contract UUID. */
  'identity-failure',
  /** The supplied recommendation and its action bindings do not agree with each other. */
  'binding-mismatch',
  /** The assembled request violates the governed communication-request contract. */
  'request-invalid',
] as const;

export type CommunicationRequestRuntimeErrorCode =
  (typeof COMMUNICATION_REQUEST_RUNTIME_ERROR_CODE_VALUES)[number];

export const COMMUNICATION_REQUEST_RUNTIME_ERROR_CODES: readonly CommunicationRequestRuntimeErrorCode[] =
  Object.freeze([...COMMUNICATION_REQUEST_RUNTIME_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<CommunicationRequestRuntimeErrorCode, string>> = Object.freeze({
  'invalid-input': 'Communication request runtime input is invalid.',
  'identity-failure': 'Communication request identity generation failed.',
  'binding-mismatch': 'The recommendation action binding is invalid.',
  'request-invalid':
    'The communication request violates the governed communication-request contract.',
});

/** A bounded runtime error. The code is the contract; the message is fixed per code. */
export class CommunicationRequestRuntimeError extends Error {
  readonly code: CommunicationRequestRuntimeErrorCode;

  constructor(code: CommunicationRequestRuntimeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CommunicationRequestRuntimeError';
    this.code = code;
  }
}
