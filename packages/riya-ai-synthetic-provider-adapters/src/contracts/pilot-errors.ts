/**
 * The closed AS3A control-plane error taxonomy.
 *
 * Separate from AS2's `RiyaSyntheticGenerationError` because these are RUNNER failures, not candidate
 * failures: a refused artifact write, an unauthorized execution attempt, an exhausted budget. Folding
 * them into the generation taxonomy would let a control-plane fault be recorded as though a candidate
 * had failed, which is exactly the misattribution that makes a pilot unreadable.
 *
 * Codes, never provider text — for the reason AS2 states, and which this package must honour harder,
 * because this is the package that actually holds a credential.
 */

export const RIYA_SYNTHETIC_PILOT_ERROR_CODES = [
  'invalid-execution-budget',
  'invalid-pilot-plan',
  'execution-not-authorized',
  'missing-provider-credential',
  'preflight-rejected',
  'budget-exhausted',
  'provider-auth-failure',
  'artifact-path-escape',
  'artifact-already-exists',
] as const;
export type RiyaSyntheticPilotErrorCode = (typeof RIYA_SYNTHETIC_PILOT_ERROR_CODES)[number];

const MESSAGES: Readonly<Record<RiyaSyntheticPilotErrorCode, string>> = Object.freeze({
  'invalid-execution-budget': 'A synthetic pilot execution budget is invalid.',
  'invalid-pilot-plan': 'A synthetic pilot plan is invalid.',
  'execution-not-authorized':
    'Real provider execution requires both the execute flag and the environment opt-in.',
  'missing-provider-credential': 'A required provider credential is absent from the environment.',
  'preflight-rejected': 'Pilot preflight rejected the run before any provider invocation.',
  'budget-exhausted': 'The execution budget was exhausted.',
  'provider-auth-failure': 'A provider rejected the credential or configuration.',
  'artifact-path-escape': 'An artifact path resolved outside its base directory.',
  'artifact-already-exists': 'An artifact already exists and overwriting was not requested.',
});

/** A bounded, content-free pilot error. Never carries a credential, a path secret or provider text. */
export class RiyaSyntheticPilotError extends Error {
  readonly code: RiyaSyntheticPilotErrorCode;

  constructor(code: RiyaSyntheticPilotErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RiyaSyntheticPilotError';
    this.code = code;
  }
}
