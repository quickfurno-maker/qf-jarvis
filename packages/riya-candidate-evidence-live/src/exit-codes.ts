/**
 * The closed operator outcome vocabulary (MVP-P2A.2).
 *
 * One integer per REASON the run stopped, so an owner reading a terminal — or a later script reading
 * `$LASTEXITCODE` — learns which gate refused without anything content-bearing being printed. A raw
 * exception never reaches the console: an unmapped throw becomes `INTERNAL_CLOSED_FAILURE`, which
 * carries no message, no stack and nothing from the original.
 *
 * `0` is the ONLY success, and it is not "the candidate is good" — it is "the bundle exists and two
 * humans have not read it yet". There is deliberately no exit code that means approved.
 */
export const OPERATOR_OUTCOMES = [
  'AWAITING_P10_HUMAN_REVIEW',
  'PRECHECK_FAILED',
  'TTY_REQUIRED',
  'SMOKE_FAILED',
  'CANDIDATE_BIND_FAILED',
  'SAFETY_INELIGIBLE',
  'SAFETY_EVIDENCE_BLOCKED',
  'P10_CAPTURE_BLOCKED',
  'REVIEW_OUTPUT_REFUSED',
  'REQUEST_LIMIT_REACHED',
  'COST_LIMIT_REACHED',
  'INTERNAL_CLOSED_FAILURE',
  /** The declared provider maxima the reservation bound rests on turned out to be wrong. */
  'USAGE_BOUND_VIOLATED',
  /**
   * A bounded SAFETY_REPLICATION completed and stopped after the safety authority (HF3).
   *
   * Deliberately NOT exit 0. Zero means a bundle exists and two humans have not read it; a
   * replication writes no bundle, and letting it share that code would let a diagnostic run
   * masquerade as the state that precedes approval. It is also not model approval and not P10
   * completion -- it says only that the requested replication ran and stopped where it promised to.
   */
  'SAFETY_REPLICATION_COMPLETE',
] as const;
export type OperatorOutcome = (typeof OPERATOR_OUTCOMES)[number];

/** Exact integers, pinned by a spec so a reordering of the vocabulary cannot renumber them. */
export const OPERATOR_EXIT_CODES: Readonly<Record<OperatorOutcome, number>> = Object.freeze({
  AWAITING_P10_HUMAN_REVIEW: 0,
  PRECHECK_FAILED: 10,
  TTY_REQUIRED: 11,
  SMOKE_FAILED: 12,
  CANDIDATE_BIND_FAILED: 13,
  SAFETY_INELIGIBLE: 14,
  SAFETY_EVIDENCE_BLOCKED: 15,
  P10_CAPTURE_BLOCKED: 16,
  REVIEW_OUTPUT_REFUSED: 17,
  REQUEST_LIMIT_REACHED: 18,
  COST_LIMIT_REACHED: 19,
  INTERNAL_CLOSED_FAILURE: 20,
  USAGE_BOUND_VIOLATED: 21,
  // The next unused integer. Codes 0-21 are untouched, because a script reading `$LASTEXITCODE`
  // against the old contract must keep meaning what it meant.
  SAFETY_REPLICATION_COMPLETE: 22,
});
