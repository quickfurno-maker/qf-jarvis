/**
 * The bounded runtime error contract (QFJ-P08, ADR-0080).
 *
 * Six codes, six fixed messages. The message is a CONSTANT chosen by the code and never built from
 * anything that arrived.
 *
 * This surface handles a recommendation's rationale and evidence, a proposed action's governed
 * parameters, an approval policy citation, operator identities and Core's own decision payload. A
 * Zod issue tree echoed from here would quote whichever of those failed — and the governed-parameter
 * scan in `@qf-jarvis/contracts` is careful to report the PATH of an offending value precisely so it
 * is never quoted. So issues are discarded entirely, and so is any foreign error.
 *
 * The distinction between the last two codes is deliberate and load-bearing. `decision-invalid` means
 * Core's artifact does not satisfy its own contract — a Core-side or transport problem.
 * `decision-mismatch` means a structurally valid decision does not describe THIS request — a
 * correlation problem. Collapsing them would send an operator looking in the wrong system.
 */
const APPROVAL_RUNTIME_ERROR_CODE_VALUES = [
  /** The supplied input is not valid. Nothing was generated and nothing was correlated. */
  'invalid-input',
  /** The identity port threw, or returned something that is not an approval-request UUID. */
  'identity-failure',
  /** The supplied recommendation and its action bindings do not agree with each other. */
  'binding-mismatch',
  /** The assembled or supplied request violates the governed approval-request contract. */
  'request-invalid',
  /** Core's decision violates the governed approval-decision contract. */
  'decision-invalid',
  /** A structurally valid decision does not describe this request. Fail closed. */
  'decision-mismatch',
] as const;

export type ApprovalRuntimeErrorCode = (typeof APPROVAL_RUNTIME_ERROR_CODE_VALUES)[number];

export const APPROVAL_RUNTIME_ERROR_CODES: readonly ApprovalRuntimeErrorCode[] = Object.freeze([
  ...APPROVAL_RUNTIME_ERROR_CODE_VALUES,
]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<ApprovalRuntimeErrorCode, string>> = Object.freeze({
  'invalid-input': 'Approval runtime input is invalid.',
  'identity-failure': 'Approval request identity generation failed.',
  'binding-mismatch': 'The recommendation action binding is invalid.',
  'request-invalid': 'The approval request violates the governed approval-request contract.',
  'decision-invalid': 'The approval decision violates the governed approval-decision contract.',
  'decision-mismatch': 'The approval decision does not match the approval request.',
});

/** A bounded runtime error. The code is the contract; the message is fixed per code. */
export class ApprovalRuntimeError extends Error {
  readonly code: ApprovalRuntimeErrorCode;

  constructor(code: ApprovalRuntimeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ApprovalRuntimeError';
    this.code = code;
  }
}
