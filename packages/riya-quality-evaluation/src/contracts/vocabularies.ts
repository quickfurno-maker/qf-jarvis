/**
 * The closed vocabularies of Riya quality evaluation (RWC-P10, ADR-0106).
 *
 * Every categorical value a quality scenario, observation, human review, case result or comparison
 * may carry is one of these fixed sets. There is no open enum, no metadata bag, no free-text tag and
 * no wildcard — an evaluator whose categories a caller could extend would stop being a measurement
 * and become a place to record an opinion.
 *
 * These are RIYA-SPECIFIC and sit ABOVE `@qf-jarvis/model-evaluation`, which keeps its own generic
 * safety, red-team and severity vocabularies. Nothing here restates or replaces one of those: safety
 * remains that package's authority, and this package cannot express a safety verdict at all.
 */
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';

/**
 * The three surfaces a real Indian home-interiors conversation actually arrives in.
 *
 * Hinglish is a first-class mode, not a degraded English. A large share of clients write it, and an
 * evaluator that scored it as broken English would systematically reward a Riya that answered the
 * wrong way — so it gets its own fixtures, its own count, and the same thresholds.
 */
export const RIYA_QUALITY_LANGUAGE_MODES = ['ENGLISH', 'HINDI', 'HINGLISH'] as const;
export type RiyaQualityLanguageMode = (typeof RIYA_QUALITY_LANGUAGE_MODES)[number];

/**
 * What the client is DOING in the turn under evaluation.
 *
 * Twelve kinds, chosen because each one has a different correct answer and a different way of going
 * wrong. Lumping the three objection kinds together, for instance, would hide the case that matters
 * most commercially: a Riya that handles price well and trust badly would average out to "fine".
 */
export const RIYA_QUALITY_INTERACTION_KINDS = [
  /** The client is telling Riya what they need, or Riya is asking. */
  'DISCOVERY',
  /** The client is changing something they already said. */
  'CORRECTION',
  'OBJECTION_PRICE',
  'OBJECTION_TRUST',
  'OBJECTION_TIMELINE',
  /** The client is weighing options against each other. */
  'COMPARISON',
  /** A factual question that must be answered from governed knowledge, with a citation. */
  'GROUNDING_QA',
  /** Something Riya has no business answering. */
  'OUT_OF_SCOPE',
  /** The client asked for a person. */
  'HUMAN_REQUEST',
  /** A question after the summary was shown. */
  'POST_SUMMARY_QA',
  /** A question once the conversation is COMPLETE. */
  'COMPLETE_QA',
  /** Proposing the next step. */
  'NEXT_STEP',
] as const;
export type RiyaQualityInteractionKind = (typeof RIYA_QUALITY_INTERACTION_KINDS)[number];

/**
 * The subjective dimensions a HUMAN reviewer judges. Never a model — see ADR-0106.
 *
 * Each is a binary satisfied / not-satisfied judgement with a written rubric
 * (`docs/evaluation/riya-quality-review-rubric.md`). There is no score, no scale and no weight,
 * because a reviewer asked for "7 out of 10 on empathy" is being asked to invent precision that does
 * not exist, and a number invites the averaging this package refuses.
 */
export const RIYA_QUALITY_DIMENSIONS = [
  'CLARITY',
  'CONCISION',
  'NATURALNESS',
  'CONTEXT_USE',
  'EMPATHY',
  'OBJECTION_HANDLING',
  'TRUST_BUILDING',
  'SALES_MOMENTUM',
  'CTA_QUALITY',
  'NON_REPETITION',
] as const;
export type RiyaQualityDimension = (typeof RIYA_QUALITY_DIMENSIONS)[number];

/**
 * Closed case outcomes.
 *
 * `INCONCLUSIVE` is deliberately NOT a soft pass and NOT a soft fail. A case with no observation, or
 * with only one of its two required reviews, has not been measured — recording it as either verdict
 * would be inventing a measurement, and the thresholds refuse a suite containing any of them.
 */
export const RIYA_QUALITY_CASE_OUTCOMES = ['PASS', 'FAIL', 'INCONCLUSIVE'] as const;
export type RiyaQualityCaseOutcome = (typeof RIYA_QUALITY_CASE_OUTCOMES)[number];

/** Closed comparison outcomes. */
export const RIYA_QUALITY_COMPARISON_OUTCOMES = [
  'CANDIDATE_PREFERRED',
  'BASELINE_PREFERRED',
  'TIE',
  /** The two results are not measuring the same thing, so no verdict is possible or attempted. */
  'NOT_COMPARABLE',
] as const;
export type RiyaQualityComparisonOutcome = (typeof RIYA_QUALITY_COMPARISON_OUTCOMES)[number];

/**
 * Closed OBJECTIVE failure codes.
 *
 * Objective means checkable without judgement: a count, a set membership, a presence. Nothing here
 * is an opinion about how good a reply was — that is what the human dimensions are for, and keeping
 * the two vocabularies apart is what stops a subjective disagreement from being recorded as a
 * contract violation.
 *
 * The last two are not failures at all. `OBSERVATION_MISSING` and `HUMAN_REVIEW_MISSING` mean the
 * case could not be measured, and they produce `INCONCLUSIVE` rather than `FAIL`.
 */
export const RIYA_QUALITY_OBJECTIVE_FAILURE_CODES = [
  'LANGUAGE_MISMATCH',
  'REPLY_TOO_LONG',
  'TOO_MANY_QUESTIONS',
  'REQUIRED_OBSERVATION_MISSING',
  'OBSERVATION_VALUE_MISMATCH',
  'FORBIDDEN_OBSERVATION_PRESENT',
  'ASKED_FIELD_NOT_ALLOWED',
  'CITATION_REQUIRED',
  'PHASE_NOT_ALLOWED',
  'OBSERVATION_MISSING',
  'HUMAN_REVIEW_MISSING',
] as const;
export type RiyaQualityObjectiveFailureCode = (typeof RIYA_QUALITY_OBJECTIVE_FAILURE_CODES)[number];

/** The two codes that mean "not measured" rather than "measured and wrong". */
export const RIYA_QUALITY_INCONCLUSIVE_CODES: ReadonlySet<RiyaQualityObjectiveFailureCode> =
  new Set(['OBSERVATION_MISSING', 'HUMAN_REVIEW_MISSING']);

/**
 * The canonical Riya discovery field, taken STRUCTURALLY from the observation contract that owns it.
 *
 * Deriving the type from `RiyaDiscoveryObservationV1['field']` rather than importing `riya-agent`
 * keeps this package's dependency list at three, and — more usefully — makes it impossible for the
 * two to drift: if `riya-agent` adds a field, the exhaustiveness map below stops compiling.
 */
export type RiyaQualityDiscoveryField = RiyaDiscoveryObservationV1['field'];

/**
 * Every canonical discovery field, as runtime values.
 *
 * The list is restated here because a type cannot be iterated, and the two guards below are what
 * make restating it safe. `EXHAUSTIVE` fails to COMPILE if a field is missing; a spec proves every
 * entry is accepted by the real `createRiyaConversationObservationBatch`, so a field that does not
 * exist cannot be smuggled in either. Together they close both directions.
 */
const EXHAUSTIVE: Readonly<Record<RiyaQualityDiscoveryField, true>> = Object.freeze({
  serviceInterest: true,
  location: true,
  propertyType: true,
  scope: true,
  budget: true,
  timeline: true,
  consultationPreference: true,
});

export const RIYA_QUALITY_DISCOVERY_FIELDS: readonly RiyaQualityDiscoveryField[] = Object.freeze(
  Object.keys(EXHAUSTIVE).sort() as RiyaQualityDiscoveryField[],
);

/**
 * The only provenances a scenario may EXPECT from a candidate.
 *
 * A model can report that the client said something (`user_stated`) or that it worked something out
 * (`model_inferred`). It cannot produce `user_confirmed` — that means the client was shown a value
 * and agreed to it, which is an act only the surface can witness — and it cannot produce
 * `user_selected` (a chip tap) or `server_runtime` (a governed default). Allowing a fixture to
 * expect any of those three would let a passing suite certify a Riya that manufactures consent it
 * never received, and `user_confirmed` is the strongest claim in the whole provenance ladder.
 */
export const RIYA_QUALITY_EXPECTABLE_PROVENANCES = ['user_stated', 'model_inferred'] as const;
export type RiyaQualityExpectableProvenance = (typeof RIYA_QUALITY_EXPECTABLE_PROVENANCES)[number];
