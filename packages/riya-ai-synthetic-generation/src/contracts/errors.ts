/**
 * The closed AS2 error taxonomy (AS2, ADR-0143).
 *
 * ### Bounded codes, never a provider's words
 *
 * A provider error body is untrusted text that may carry a request id, an account hint, a truncated
 * prompt or an internal URL. Storing it in an artifact would put all of that in a repository, and
 * printing it would put it in a log. So a failure becomes a CODE here, and the raw body is dropped at
 * the adapter boundary rather than carried inward.
 *
 * ### Transport failure and quality failure are different things
 *
 * The split matters more than it looks. `transient-provider-failure` may be retried; a critic
 * rejection may not, and there is deliberately no code for one — a rejected candidate is not an
 * error, it is an outcome. Blurring them is how a harness ends up retrying until something passes,
 * which selects for whatever the gate happens to miss.
 */

export const RIYA_SYNTHETIC_GENERATION_ERROR_CODES = [
  'invalid-run-plan',
  'invalid-model-config',
  'invalid-config-inventory',
  'invalid-role-instruction',
  'role-config-conflict',
  'invalid-invocation-request',
  'invalid-invocation-result',
  'invalid-model-output',
  'output-schema-mismatch',
  'invocation-timeout',
  'candidate-budget-exceeded',
  'invocation-cancelled',
  'transient-provider-failure',
  'permanent-provider-failure',
  'repair-exhausted',
  'candidate-construction-failed',
  'annotation-verification-failed',
  'critic-policy-failed',
  'invalid-run-manifest',
  'invalid-generation-policy',
] as const;
export type RiyaSyntheticGenerationErrorCode =
  (typeof RIYA_SYNTHETIC_GENERATION_ERROR_CODES)[number];

const MESSAGES: Readonly<Record<RiyaSyntheticGenerationErrorCode, string>> = Object.freeze({
  'invalid-run-plan': 'A synthetic generation run plan is invalid.',
  'invalid-model-config': 'A synthetic model configuration is invalid.',
  'invalid-config-inventory': 'A synthetic model configuration inventory is invalid.',
  'invalid-role-instruction': 'A synthetic role instruction identity is invalid.',
  'role-config-conflict': 'Two generation roles share a configuration that must differ.',
  'invalid-invocation-request': 'A model invocation request is invalid.',
  'invalid-invocation-result': 'A model invocation result is invalid.',
  'invalid-model-output': 'A model returned output that could not be parsed.',
  'output-schema-mismatch': 'A model returned output that did not match its declared schema.',
  'invocation-timeout': 'A model invocation exceeded its timeout budget.',
  'candidate-budget-exceeded':
    'Turn-by-turn generation exceeded the whole-candidate budget before completing.',
  'invocation-cancelled': 'A model invocation was cancelled.',
  'transient-provider-failure': 'A model invocation failed transiently.',
  'permanent-provider-failure': 'A model invocation failed permanently.',
  'repair-exhausted': 'Structural repair did not produce valid output within its bounded attempts.',
  'candidate-construction-failed': 'A candidate trajectory could not be constructed.',
  'annotation-verification-failed': 'Structured annotation verification rejected the candidate.',
  'critic-policy-failed': 'The critic allocation does not satisfy the configured policy.',
  'invalid-run-manifest': 'A synthetic generation run manifest is invalid.',
  'invalid-generation-policy': 'A synthetic generation policy is invalid.',
});

/** A bounded, content-free generation error. */
export class RiyaSyntheticGenerationError extends Error {
  readonly code: RiyaSyntheticGenerationErrorCode;

  constructor(code: RiyaSyntheticGenerationErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RiyaSyntheticGenerationError';
    this.code = code;
  }
}
