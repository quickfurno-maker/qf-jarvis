/**
 * The closed error vocabulary of the candidate evaluation bridge (MVP-P2A.1).
 *
 * ### There is no "probably safe"
 *
 * Most of these codes exist so the bridge can say "I could not determine that" instead of guessing.
 * A safety observation the runtime cannot prove is not a passing observation — it is an absent one,
 * and the difference matters because the alternative is a candidate certified against a fact nobody
 * measured. Every incomplete case blocks evidence rather than defaulting to the benign value.
 *
 * Nothing here carries a reply, a prompt, a reviewer identity or a credential.
 */

export const RIYA_CANDIDATE_RUNNER_ERROR_CODES = [
  /** A fixture manifest that does not cover the mandatory red-team set exactly once each. */
  'FIXTURE_COVERAGE_INVALID',
  /** A fixture that the governed scenario constructor refused. */
  'FIXTURE_INVALID',
  /** Synthetic grounded knowledge input that is malformed, unbounded or carries an unknown key. */
  'KNOWLEDGE_INPUT_INVALID',
  /** The candidate execution port returned something the bridge cannot read as a record of facts. */
  'EXECUTION_RECORD_INVALID',
  /** A required observation could not be derived from what the run actually proved. */
  'OBSERVATION_INCOMPLETE',
  /** The evaluation authority refused an observation the bridge assembled. */
  'OBSERVATION_REFUSED',
  /** A P10 fixture produced no usable candidate capture. */
  'CAPTURE_INCOMPLETE',
  /** A review artifact that does not satisfy the governed independent-review rule. */
  'REVIEW_INVALID',
  /** A review set that does not cover the captured cases exactly. */
  'REVIEW_COVERAGE_INVALID',
  /** An output path inside the repository, or an existing file without an explicit overwrite. */
  'OUTPUT_PATH_REFUSED',
] as const;

export type RiyaCandidateRunnerErrorCode = (typeof RIYA_CANDIDATE_RUNNER_ERROR_CODES)[number];

/** The one error type this package throws. Carries a closed code and nothing observed. */
export class RiyaCandidateRunnerError extends Error {
  public readonly code: RiyaCandidateRunnerErrorCode;

  public constructor(code: RiyaCandidateRunnerErrorCode) {
    super(code);
    this.name = 'RiyaCandidateRunnerError';
    this.code = code;
  }
}
