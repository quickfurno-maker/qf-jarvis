/**
 * Closed vocabularies for the AI-synthetic lane (AS1, ADR-0143).
 *
 * ### Why a separate set
 *
 * The generic RID-F1 vocabularies describe a trajectory. These describe a GENERATION PLAN and the
 * automated gate that judges what came back — concepts that did not exist while every corpus was
 * human-authored, and that must not leak into the generic surface where they would imply the human
 * lane had acquired a critic.
 *
 * ### Everything here is closed
 *
 * Not a string, not an open record. A behaviour the planner cannot name is a behaviour the corpus
 * cannot be asked for, which is the point: an open field would eventually carry a sentence.
 */
/**
 * How a corpus earns acceptance.
 *
 * `HUMAN_REVIEW` is what every existing release already is, and it stays the default everywhere.
 * `AUTOMATED_SYNTHETIC` is reachable ONLY through this subpath's validator, and only for a corpus
 * that is entirely teacher-generated (ADR-0143 §8).
 */
export const RIYA_AI_SYNTHETIC_REVIEW_MODES = ['HUMAN_REVIEW', 'AUTOMATED_SYNTHETIC'] as const;
export type RiyaAiSyntheticReviewMode = (typeof RIYA_AI_SYNTHETIC_REVIEW_MODES)[number];

/**
 * Where a candidate's dialogue actually came from (AS1-B).
 *
 * Two modes, and the distinction is the whole point of the vocabulary. `IN_REPO_GENERATED_SYNTHETIC`
 * is a candidate the AS2 harness produced inside this repository, under an allocated planner,
 * simulator, teacher and annotation verifier that a config inventory can name. `EXTERNAL_MANUAL_
 * SYNTHETIC_INTAKE` is a candidate produced OUTSIDE the harness and handed over as files.
 *
 * The second cannot honestly claim the first's role allocation, and the cheapest way to let it into
 * canonical acceptance evidence would have been to fill those four config refs with plausible
 * strings. That is fabrication: the refs would name an inventory allocation that never happened, and
 * nothing downstream could ever tell the invented ones from the real ones.
 *
 * So the two modes are separate record shapes with separate constructors, and neither can be
 * constructed as the other — see `external-intake-provenance.ts`.
 */
export const RIYA_AI_SYNTHETIC_PROVENANCE_MODES = [
  'IN_REPO_GENERATED_SYNTHETIC',
  'EXTERNAL_MANUAL_SYNTHETIC_INTAKE',
] as const;
export type RiyaAiSyntheticProvenanceMode = (typeof RIYA_AI_SYNTHETIC_PROVENANCE_MODES)[number];

/**
 * What a deterministic verifier run concluded (AS1-B).
 *
 * Deliberately NOT `RIYA_DATASET_REVIEW_DECISIONS`. `ACCEPTED`/`REJECTED` is the vocabulary of a
 * judgement about quality — a human reviewer's, or a critic's. A deterministic verifier does not
 * judge; it runs a fixed algorithm over a record and reports whether the record satisfied it. Giving
 * the two the same word would make a validator run readable as a review, which is exactly the
 * substitution ADR-0143 §17 refuses everywhere else.
 */
export const RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS = ['PASSED', 'FAILED'] as const;
export type RiyaAiSyntheticVerifierVerdict = (typeof RIYA_AI_SYNTHETIC_VERIFIER_VERDICTS)[number];

/**
 * How a synthetic customer behaves. **Behaviour, never identity.**
 *
 * ADR-0143 §11: authenticity comes from behavioural diversity, not from copying real messages. So
 * the planner varies how a customer answers — tersely, at length, with typos, with a correction two
 * turns late — and has no vocabulary at all for who the customer is.
 *
 * There is deliberately no code for caste, religion, ethnicity, politics, medical status, gender or
 * age. A corpus that could be planned around those would teach Riya to sell differently to different
 * kinds of people, and no downstream gate would catch it because every individual row would look
 * reasonable.
 */
export const RIYA_AI_SYNTHETIC_BEHAVIOR_CODES = [
  'BUDGET_RELUCTANCE',
  'CHANGING_REQUIREMENT',
  'COMPARISON',
  'CORRECTION',
  'DELAYED_FACT',
  'HUMAN_REQUEST',
  'INCOMPLETE_ANSWER',
  'IRRELEVANT_DETOUR',
  'OBJECTION',
  'OUT_OF_SCOPE_REQUEST',
  'POST_SUMMARY_QA',
  'REPEATED_QUESTION',
  'SHORT_REPLY',
  'SKEPTICISM',
  'SUMMARY_CONFIRMATION',
  'TIMELINE_UNCERTAINTY',
  'TRUST_CONCERN',
  'TYPO_NOISE',
  'UNCERTAINTY',
  'VERBOSE_REPLY',
] as const;
export type RiyaAiSyntheticBehaviorCode = (typeof RIYA_AI_SYNTHETIC_BEHAVIOR_CODES)[number];

/**
 * Structural events a planned conversation must contain.
 *
 * Structural on purpose: each one is provable from annotations rather than from reading the prose.
 * "The assistant was warm" is not here, because nothing deterministic can check it and a gate that
 * pretends otherwise is a gate that passes whatever the teacher produced.
 */
export const RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS = [
  'APPLY_CORRECTION',
  'ASK_ONE_DISCOVERY_QUESTION',
  'CAPTURE_NEW_FACT',
  'CONFIRM_SUMMARY',
  'HANDOFF_TO_HUMAN',
  'REFUSE_OUT_OF_SCOPE',
  'USE_AUTHORITATIVE_FACT',
  'USE_KNOWN_CONTEXT',
] as const;
export type RiyaAiSyntheticConversationEvent =
  (typeof RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS)[number];

/**
 * Shortcuts a planned conversation must NOT contain.
 *
 * The same list the human lane forbids its authors, restated here because the teacher is far more
 * likely to reach for them: a model asked for a sales reply produces a canned opener and a canned
 * call to action unless something says not to.
 */
export const RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS = [
  'AI_SELF_REFERENCE',
  'CANNED_CTA',
  'CANNED_OPENER',
  'CHAIN_OF_THOUGHT',
  'CLAIM_ACTION_NOT_TAKEN',
  'DEMOGRAPHIC_STEREOTYPE',
  'FALSE_SCARCITY',
  'FALSE_URGENCY',
  'GUILT_OR_FEAR',
  'INVENTED_AVAILABILITY',
  'INVENTED_PRICE',
  'INVENTED_RATING_OR_REVIEW',
  'INVENTED_VENDOR_COUNT',
  'INVENTED_WARRANTY',
  'MULTIPLE_DISCOVERY_QUESTIONS',
  'REPEATED_KNOWN_QUESTION',
  'SYSTEM_PROMPT_DISCLOSURE',
] as const;
export type RiyaAiSyntheticForbiddenBehavior =
  (typeof RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS)[number];

/**
 * The candidate lifecycle (ADR-0143 §19 as implemented by AS1).
 *
 * Forward-only, and three of the eight are terminal. The ordering below IS the progression — index
 * comparison is how the state machine decides a transition is legal, so inserting a state in the
 * middle changes the contract and must be a deliberate edit.
 */
export const RIYA_AI_SYNTHETIC_ACCEPTANCE_STATES = [
  'PLANNED',
  'GENERATED',
  'DETERMINISTIC_VALIDATED',
  'CRITIC_VALIDATED',
  'DIVERSITY_VALIDATED',
  'ACCEPTED',
  'REJECTED',
  'QUARANTINED',
] as const;
export type RiyaAiSyntheticAcceptanceState = (typeof RIYA_AI_SYNTHETIC_ACCEPTANCE_STATES)[number];

/** The states that progress, in order. `REJECTED` and `QUARANTINED` are exits, not steps. */
export const RIYA_AI_SYNTHETIC_PROGRESSION: readonly RiyaAiSyntheticAcceptanceState[] =
  Object.freeze([
    'PLANNED',
    'GENERATED',
    'DETERMINISTIC_VALIDATED',
    'CRITIC_VALIDATED',
    'DIVERSITY_VALIDATED',
    'ACCEPTED',
  ]);

/**
 * Terminal states.
 *
 * `QUARANTINED` is terminal **in this lane specifically**, and that is the whole point of listing it
 * here. In the human lane a near-leakage quarantine is something a person adjudicates. There is no
 * person here, so a quarantined candidate is discarded and a different one generated later —
 * "the critic decided it was fine actually" is exactly the escape hatch that would make the
 * protected-exam firewall decorative.
 */
export const RIYA_AI_SYNTHETIC_TERMINAL_STATES: ReadonlySet<RiyaAiSyntheticAcceptanceState> =
  new Set(['ACCEPTED', 'REJECTED', 'QUARANTINED']);

/** Why the automated gate refused. A closed reason, never content. */
export const RIYA_AI_SYNTHETIC_FINDING_KINDS = [
  // There is deliberately no `REVIEW_MODE_NOT_AUTOMATED`. The acceptance policy's `reviewMode` is the
  // literal `'AUTOMATED_SYNTHETIC'`, so a policy that says anything else cannot be constructed and
  // the validator has nothing to report. Advertising a finding nothing can ever emit would suggest a
  // check is running that is not.
  'SOURCE_NOT_TEACHER_GENERATED',
  'REVIEW_RECORDS_PRESENT',
  'TEACHER_REF_MISSING',
  'TEACHER_REF_NOT_BOUND_TO_GENERATION',
  'EVIDENCE_MISSING',
  'EVIDENCE_UNMATCHED',
  'EVIDENCE_DUPLICATED',
  'TRAJECTORY_DIGEST_MISMATCH',
  'CONVERSATION_FINGERPRINT_MISMATCH',
  'SCENARIO_MISSING',
  'SCENARIO_DIGEST_MISMATCH',
  'SCENARIO_TRAJECTORY_MISMATCH',
  'SCENARIO_DEPTH_OUT_OF_TOLERANCE',
  'PROVENANCE_DIGEST_MISMATCH',
  'PROVENANCE_ROLE_NOT_SEPARATED',
  // AS1-B. An external-intake row binds the source artifact it was derived from, and a deterministic
  // verifier run stands where the in-repo route has an annotation verifier config ref.
  'EXTERNAL_SOURCE_DIGEST_MISMATCH',
  'VERIFIER_RUN_MISSING',
  'VERIFIER_RUN_NOT_BOUND_TO_TRAJECTORY',
  'VERIFIER_VERDICT_NOT_PASSED',
  'VERIFIER_NOT_INDEPENDENT',
  'CRITIC_COUNT_BELOW_POLICY',
  'CRITIC_DUPLICATE_REF',
  'CRITIC_DUPLICATE_CONFIG',
  'CRITIC_CONFIG_NOT_INDEPENDENT',
  'CRITIC_MODEL_FAMILY_NOT_DISTINCT',
  'CRITIC_REJECTED',
  'CRITIC_DIMENSION_MISSING',
  'DIVERSITY_FINGERPRINT_UNIQUENESS_BELOW_FLOOR',
  'DIVERSITY_OPENER_RECURRENCE_ABOVE_CAP',
  'DIVERSITY_CLOSER_RECURRENCE_ABOVE_CAP',
  'DIVERSITY_QUESTION_SEQUENCE_ABOVE_CAP',
  'DIVERSITY_PHASE_SEQUENCE_ABOVE_CAP',
  'DIVERSITY_LINEAGE_VARIANTS_ABOVE_CAP',
  'DIVERSITY_SAME_LINEAGE_REDUNDANCY_ABOVE_CAP',
  'DIVERSITY_DEPTH_BAND_COVERAGE_BELOW_FLOOR',
  'DIVERSITY_DECISION_COVERAGE_BELOW_FLOOR',
  'DIVERSITY_OBJECTIVE_COVERAGE_BELOW_FLOOR',
  'BASE_VALIDATION_BLOCKED',
] as const;
export type RiyaAiSyntheticFindingKind = (typeof RIYA_AI_SYNTHETIC_FINDING_KINDS)[number];

/**
 * Assistant-turn depth bounds for this lane: 4–12.
 *
 * The same range the human corpus uses, for the same reason — under four turns a conversation has no
 * strategy to learn from, and past twelve it is a transcript. The generic ceiling is far higher and
 * stays where it is; this is the lane's own tighter bound.
 *
 * That it sits inside the generic ceiling is asserted in `ai-synthetic-contracts.test.ts`. A runtime
 * `if` here would compare two literals and could never fire, so it was dead code pretending to be a
 * guard — the drift it exists to catch is a source edit, which is a test's job to notice.
 */
export const RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS = 4;
export const RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS = 12;

/** Ratios are basis points: integers, 0–10000. No float comparison decides a gate. */
export const RIYA_AI_SYNTHETIC_BASIS_POINTS_MAX = 10_000;
