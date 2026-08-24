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
  /**
   * MVP-P2A.2 HF4-R8. A bounded REQUEST_CONTRACT_DIAGNOSTIC ran its canaries and stopped.
   *
   * Its own code for the same reason the replication has one: it is not approval, not P10 completion
   * and not a safety result, and sharing an integer with any of those would let a run that evaluated
   * nothing be read as one that evaluated something.
   */
  'REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE',
  /**
   * POST-PR-131. A bounded SCHEMA_DIFFERENTIAL_DIAGNOSTIC ran its probes and stopped.
   *
   * Its own code, for the same reason the other two diagnostics have one: it is not approval, not
   * P10 completion and not a safety result. It is also NOT the request-contract diagnostic's code —
   * a script reading `$LASTEXITCODE` must be able to tell the two matrices apart.
   *
   * Note this code says the run COMPLETED, not that the schema was accepted. What was found is in
   * the classification line, including the case where the control itself failed.
   */
  'SCHEMA_DIFFERENTIAL_DIAGNOSTIC_COMPLETE',
  /**
   * POST-SDH4. A bounded schema-repair verification ran its probes and stopped.
   *
   * Its own code, so a script reading `$LASTEXITCODE` can tell a verification run from SDH4's
   * historical matrix. As with the others, it says the run COMPLETED, not that the schema was
   * accepted — that is in the classification line.
   */
  'POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE',
  /**
   * POST-SRV1. A bounded operational acceptance diagnostic ran its probes and stopped.
   *
   * Its own code again. It says the run COMPLETED — not that the request was accepted, not that the
   * candidate is safe, not that anything is quality-approved or release-ready. The classification
   * line carries the finding.
   */
  'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE',
  /**
   * POST-OAD3. The representative acceptance gate ran its one probe and stopped.
   *
   * Its own code, because every run goal here carries one: a shell reading the exit status must be
   * able to say WHICH bounded run produced it. It says the run COMPLETED — not that the request was
   * accepted. The classification line carries that.
   */
  'POST_OAD3_REPRESENTATIVE_ACCEPTANCE_COMPLETE',
  /**
   * POST-RA1. The neutral client acceptance gate ran its one probe and stopped.
   *
   * Its own code. It says the run COMPLETED — not that the request was accepted. RA1 exited 27 on an
   * HTTP 400, which is exactly why the exit status is never the finding.
   */
  'POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE',
  /**
   * POST-NRA1. The 120B strict model differential ran its one probe and stopped.
   *
   * Its own code. Both RA1 and NRA1 exited on an HTTP 400, which is exactly why the exit status is
   * never the finding — the classification line carries it.
   */
  'POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL_COMPLETE',
  /**
   * POST-MD120B3. The Responses API endpoint differential ran its one probe and stopped.
   *
   * Its own code. It says the run COMPLETED — not that the request was accepted, and not that the
   * reply was valid. RA1, NRA1 and MD120B3 all exited on an HTTP 400, which is exactly why the exit
   * status is never the finding: the classification line carries it, and on this goal that line has
   * a local-validation half as well as a provider one.
   */
  'POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE',
  /**
   * POST-RSP20B2. The `reasoning_effort='low'` differential ran its one probe and stopped.
   *
   * Its OWN code, and deliberately not a reuse of 30.
   *
   * The convention here is not "one integer for completed diagnostics" -- it is one integer PER
   * GOAL, which is why 22-30 are nine distinct codes rather than one repeated. Reusing 30 would make
   * a shell reading `$LASTEXITCODE` unable to tell this run from RSP20B2's, and telling bounded runs
   * apart is the entire reason the vocabulary is closed.
   *
   * It says the run COMPLETED -- not that the request was accepted, and not that the reply was valid.
   * RA1, NRA1 and MD120B3 all exited on an HTTP 400, which is exactly why the exit status is never
   * the finding: the classification line carries it, and on this goal that line distinguishes a
   * provider OUTPUT failure from a provider REQUEST rejection.
   */
  'POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE',
  /**
   * POST-RLD1. The low-reasoning 8,192 output-budget differential ran its one probe and stopped.
   *
   * Its OWN code, following the same convention every goal above it follows: one integer per goal,
   * which is why 22-31 are ten distinct codes rather than one repeated. A shell reading
   * `$LASTEXITCODE` must be able to tell this run from RLD1's, and RLD1 is CONSUMED -- its exit 31 is
   * immutable evidence of a run at the 4,096 budget.
   *
   * It says the run COMPLETED -- not that the request was accepted, not that the reply was valid, and
   * emphatically not that the production budget should move. RA1, NRA1, MD120B3 and RLD1 all exited
   * on an HTTP 400, which is exactly why the exit status is never the finding.
   */
  'POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE',
  /**
   * POST-RBD1. The best-effort json_schema (strict=false) differential ran its probe and stopped.
   *
   * Its OWN code, following the convention every goal above it follows: one integer per goal, which
   * is why 22-32 are eleven distinct codes. RBD1 is CONSUMED at 32 and RLD1 at 31; both are immutable
   * evidence of runs under strict true.
   *
   * It says the run COMPLETED -- not that the request was accepted, not that the reply was valid, and
   * emphatically not that production should change its strict posture.
   */
  'POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE',
  /**
   * POST-SFD1. The goal is recorded CONSUMED by the repository's own evidence and may not run.
   *
   * Separate from the marker refusal below, because the two are fixed in different places. This one
   * says HISTORY settled the question: a fresh workstation, a new clone, a colleague's machine would
   * all refuse it, and lifting it is a reviewed edit to the tombstone list. The other says only that
   * THIS workstation already spent it.
   *
   * Refused before any credential is read, any smoke is sent, or any provider is contacted.
   */
  'RUN_GOAL_STATICALLY_CONSUMED',
  /**
   * POST-SFD1. This workstation already claimed this governed one-shot goal.
   *
   * The incident code. SFD1 was authorized once and accidentally launched twice; the second launch
   * reached the provider because nothing but an instruction stood in the way. Now the first accepted
   * launch claims the goal atomically, and a later launch of the same marker-eligible goal on this
   * workstation is refused before any credential is read, smoke is sent, or provider is contacted.
   *
   * It does NOT cover a failure to create or write the consumption marker. That is a different
   * problem with a different fix -- an owner told they already ran something goes looking for a
   * previous run, when the directory may simply be unwritable -- and it is represented separately by
   * `RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE`.
   */
  'RUN_GOAL_ALREADY_CONSUMED',
  /**
   * POST-SFD1. The consumption marker could not be written, so a claim cannot be guaranteed.
   *
   * A THIRD code, because the guard already distinguishes this internally and collapsing it into
   * "already consumed" gives the operator the wrong remediation. An owner told their goal was
   * already spent will go looking for a previous run; an owner told the marker is unavailable will
   * go and look at the directory. Those are different problems with different fixes.
   *
   * Still a refusal, and still before any credential is read: a guard that cannot record a claim
   * must not permit the launch it is guarding.
   */
  'RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE',
  /**
   * POST-SFD1. The strict-false LOCAL-VALIDATION LOCALIZATION probe ran, and the run stopped.
   *
   * Its own code, for the same reason every diagnostic above it has one: a shell reading
   * `$LASTEXITCODE` must be able to say WHICH governed question was asked. Sharing 33 would make
   * SFD1's canonical HTTP 413 receipt and this run's stage-localized receipt indistinguishable, and
   * SFD1 is CONSUMED evidence that must stay readable.
   *
   * It means the probe was ATTEMPTED and the receipt was written. It does not mean the document was
   * accepted, does not mean a stage was localized -- a 413 localizes nothing -- and authorizes no
   * production change of strict mode, output budget or reasoning effort.
   */
  'POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE_COMPLETE',
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
  // The next unused integer; 0-22 keep meaning exactly what they meant.
  REQUEST_CONTRACT_DIAGNOSTIC_COMPLETE: 23,
  // The next unused integer; 0-23 keep meaning exactly what they meant.
  SCHEMA_DIFFERENTIAL_DIAGNOSTIC_COMPLETE: 24,
  // The next unused integer; 0-24 keep meaning exactly what they meant.
  POST_SDH4_SCHEMA_REPAIR_VERIFICATION_COMPLETE: 25,
  // The next unused integer; 0-25 keep meaning exactly what they meant.
  POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC_COMPLETE: 26,
  // The next unused integer; 0-26 keep meaning exactly what they meant.
  POST_OAD3_REPRESENTATIVE_ACCEPTANCE_COMPLETE: 27,
  // The next unused integer; 0-27 keep meaning exactly what they meant.
  POST_RA1_NEUTRAL_REPRESENTATIVE_ACCEPTANCE_COMPLETE: 28,
  // The next unused integer; 0-28 keep meaning exactly what they meant.
  POST_NRA1_GPT_OSS_120B_STRICT_MODEL_DIFFERENTIAL_COMPLETE: 29,
  // The next unused integer; 0-29 keep meaning exactly what they meant.
  POST_MD120B3_GROQ_RESPONSES_API_STRICT_DIFFERENTIAL_COMPLETE: 30,
  // The next unused integer; 0-30 keep meaning exactly what they meant.
  POST_RSP20B2_REASONING_EFFORT_LOW_DIFFERENTIAL_COMPLETE: 31,
  // The next unused integer; 0-31 keep meaning exactly what they meant.
  POST_RLD1_REASONING_LOW_OUTPUT_BUDGET_8192_DIFFERENTIAL_COMPLETE: 32,
  // The next unused integer; 0-32 keep meaning exactly what they meant.
  POST_RBD1_REASONING_LOW_OUTPUT_BUDGET_8192_STRICT_FALSE_DIFFERENTIAL_COMPLETE: 33,
  // The next unused integers; 0-33 keep meaning exactly what they meant. Two codes rather than one
  // because a shell must be able to tell "history settled this" from "this machine already ran it".
  RUN_GOAL_STATICALLY_CONSUMED: 34,
  RUN_GOAL_ALREADY_CONSUMED: 35,
  // The next unused integer; 0-35 keep meaning exactly what they meant.
  RUN_GOAL_CONSUMPTION_MARKER_UNAVAILABLE: 36,
  // The next unused integer; 0-36 keep meaning exactly what they meant. In particular 33 still means
  // SFD1's best-effort strict-false differential and never this localization run.
  POST_SFD1_STRICT_FALSE_LOCAL_VALIDATION_PROVENANCE_COMPLETE: 37,
});
