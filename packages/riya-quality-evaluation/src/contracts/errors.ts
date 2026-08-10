/**
 * The closed error vocabulary for Riya quality CONSTRUCTION and EVIDENCE gating (RWC-P10, ADR-0106).
 *
 * Case OUTCOMES use {@link RiyaQualityObjectiveFailureCode}; these codes are raised only when
 * building a scenario, observation, review, threshold set, binding or suite from invalid input, or
 * when the evidence gate refuses.
 *
 * A message is a fixed repository-owned string chosen from the code. Never caller content, never a
 * reviewer identity, never a fragment of a conversation — the inputs this package validates include
 * synthetic client sentences, and a validation error that quoted one would put conversation text in
 * a stack trace, which is the one place nobody thinks to redact.
 */
export const RIYA_QUALITY_ERROR_CODES = [
  'invalid-scenario',
  'invalid-observation',
  'invalid-human-review',
  'invalid-thresholds',
  'invalid-candidate-binding',
  'invalid-suite',
  'invalid-comparison-policy',
  'duplicate-scenario',
  'safety-evidence-required',
  'safety-evidence-target-not-eligible',
  'safety-evidence-not-canonical',
  'safety-evidence-not-synthetic',
  'quality-not-eligible',
  'quality-digest-invalid',
] as const;
export type RiyaQualityErrorCode = (typeof RIYA_QUALITY_ERROR_CODES)[number];

const RIYA_QUALITY_ERROR_MESSAGES: Readonly<Record<RiyaQualityErrorCode, string>> = Object.freeze({
  'invalid-scenario': 'A Riya quality scenario is invalid.',
  'invalid-observation': 'A Riya quality observation is invalid.',
  'invalid-human-review': 'A Riya quality human review is invalid.',
  'invalid-thresholds': 'A Riya quality threshold set is invalid.',
  'invalid-candidate-binding': 'A Riya quality candidate binding is invalid.',
  'invalid-suite': 'A Riya quality suite is invalid.',
  'invalid-comparison-policy': 'A Riya quality comparison policy is invalid.',
  'duplicate-scenario': 'A duplicate Riya quality scenario id/version was supplied.',
  'safety-evidence-required': 'Riya quality requires generic safety approval evidence.',
  'safety-evidence-target-not-eligible':
    'The supplied safety evidence target does not support quality evaluation.',
  'safety-evidence-not-canonical':
    'The supplied safety evidence did not reconstruct through the generic evaluation contracts.',
  'safety-evidence-not-synthetic':
    'Riya quality may only be derived from synthetic, non-production-approving safety evidence.',
  'quality-not-eligible': 'Riya quality evidence is blocked because the suite is not eligible.',
  'quality-digest-invalid': 'The Riya quality result digest does not validate.',
});

/**
 * A bounded, content-free Riya quality error.
 *
 * It exposes only a closed `code` and a fixed message. It never carries caller content, reviewer
 * identity, synthetic conversation text, a prompt or a digest preimage.
 */
export class RiyaQualityEvaluationError extends Error {
  public readonly code: RiyaQualityErrorCode;

  public constructor(code: RiyaQualityErrorCode) {
    super(RIYA_QUALITY_ERROR_MESSAGES[code]);
    this.name = 'RiyaQualityEvaluationError';
    this.code = code;
    Object.freeze(this);
  }
}
