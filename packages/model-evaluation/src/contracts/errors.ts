/**
 * The closed error vocabulary for evaluation CONSTRUCTION and EVIDENCE gating (QFJ-P04.04, ADR-0052).
 *
 * Case OUTCOMES use {@link EvaluationReason}; these codes are raised only when building a scenario,
 * suite, observation, or evidence object from invalid/conflicting input, or when an evidence gate
 * refuses. A message is a fixed, repository-owned string chosen from the code — never caller content,
 * observation content, a secret, or a real subject id.
 */
export const EVALUATION_ERROR_CODES = [
  'invalid-scenario',
  'invalid-observation',
  'invalid-suite',
  'invalid-binding',
  'invalid-thresholds',
  'duplicate-scenario',
  'binding-mismatch',
  'evidence-blocked-critical',
  'evidence-blocked-inconclusive',
  'evidence-blocked-mandatory-missing',
  'evidence-blocked-threshold',
  'evidence-blocked-violation',
  'evidence-digest-invalid',
] as const;
export type EvaluationErrorCode = (typeof EVALUATION_ERROR_CODES)[number];

const EVALUATION_ERROR_MESSAGES: Readonly<Record<EvaluationErrorCode, string>> = Object.freeze({
  'invalid-scenario': 'An evaluation scenario is invalid.',
  'invalid-observation': 'A candidate observation is invalid.',
  'invalid-suite': 'An evaluation suite is invalid.',
  'invalid-binding': 'An evaluation binding is invalid.',
  'invalid-thresholds': 'A threshold set is invalid.',
  'duplicate-scenario': 'A duplicate scenario id/version was supplied.',
  'binding-mismatch': 'A supplied binding does not match the suite binding.',
  'evidence-blocked-critical': 'Evidence is blocked by a failed critical case.',
  'evidence-blocked-inconclusive':
    'Evidence is blocked by an unresolved high/critical inconclusive.',
  'evidence-blocked-mandatory-missing': 'Evidence is blocked by a missing mandatory red-team case.',
  'evidence-blocked-threshold': 'Evidence is blocked by a category threshold.',
  'evidence-blocked-violation':
    'Evidence is blocked by a privacy/authority/data-class/scope violation.',
  'evidence-digest-invalid': 'The evidence digest does not validate.',
});

/**
 * A bounded, content-free evaluation error. It exposes only a closed `code` and a fixed message; it
 * never carries caller content, observation content, a secret, or a real subject id.
 */
export class EvaluationError extends Error {
  public readonly code: EvaluationErrorCode;

  public constructor(code: EvaluationErrorCode) {
    super(EVALUATION_ERROR_MESSAGES[code]);
    this.name = 'EvaluationError';
    this.code = code;
    Object.freeze(this);
  }
}
