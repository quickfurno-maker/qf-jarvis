/**
 * The bounded runtime error contract (QFJ-P09.01, ADR-0084).
 *
 * Seven codes, seven fixed messages. The message is a CONSTANT chosen by the code and never built
 * from anything that arrived.
 *
 * An execution intent names a recommendation, a Core approval decision, an approved action and the
 * exact governed parameters that action would run with; the approval evidence beside it carries a
 * recommendation's rationale, evidence and summary, and an operator's identity. An error message
 * assembled from any of that would take the most sensitive description of a pending real-world
 * effect and put it wherever the error goes. So Zod's issues are discarded entirely, and no code
 * below is ever parameterised.
 *
 * ### Why five failure codes rather than one
 *
 * Each sends someone somewhere different. `intent-invalid` means Core's artifact does not satisfy its
 * own contract — a Core-side or transport problem. `approval-invalid` means the evidence does not
 * hold up. `approval-not-approved` means it holds up perfectly and says the action was REFUSED.
 * `binding-mismatch` means valid artifacts that do not describe each other. `action-mismatch` means
 * they describe each other and the intent would run something the approved action did not say —
 * which is the substitution this package exists to catch, and it deserves its own name.
 */
const EXECUTION_INTENT_RUNTIME_ERROR_CODE_VALUES = [
  /** The supplied input is not a validation request at all. Nothing was correlated. */
  'invalid-input',
  /** Core's execution intent violates the governed contract — issuer, executor, semantics, shape. */
  'intent-invalid',
  /** The supplied approval evidence does not hold up under the public approval runtime. */
  'approval-invalid',
  /** The approval is valid and REFUSED this action. An intent cannot rest on it. */
  'approval-not-approved',
  /** Structurally valid artifacts that do not name each other. Fail closed. */
  'binding-mismatch',
  /** The intent would run something other than the approved action's exact content. */
  'action-mismatch',
  /** The artifacts' instants do not stand in a possible relationship to each other. */
  'timing-mismatch',
] as const;

export type ExecutionIntentRuntimeErrorCode =
  (typeof EXECUTION_INTENT_RUNTIME_ERROR_CODE_VALUES)[number];

export const EXECUTION_INTENT_RUNTIME_ERROR_CODES: readonly ExecutionIntentRuntimeErrorCode[] =
  Object.freeze([...EXECUTION_INTENT_RUNTIME_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<ExecutionIntentRuntimeErrorCode, string>> = Object.freeze({
  'invalid-input': 'Execution intent runtime input is invalid.',
  'intent-invalid': 'The execution intent violates the governed contract.',
  'approval-invalid': 'The supplied approval evidence is not valid for this execution intent.',
  'approval-not-approved': 'The action named by this execution intent was not approved.',
  'binding-mismatch': 'The execution intent does not match the approval evidence.',
  'action-mismatch': 'The execution intent does not reproduce the approved action.',
  'timing-mismatch': 'The execution intent instants are inconsistent with the approval evidence.',
});

/** A bounded runtime error. The code is the contract; the message is fixed per code. */
export class ExecutionIntentRuntimeError extends Error {
  readonly code: ExecutionIntentRuntimeErrorCode;

  constructor(code: ExecutionIntentRuntimeErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ExecutionIntentRuntimeError';
    this.code = code;
  }
}
