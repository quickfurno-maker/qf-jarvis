/**
 * The closed vocabularies of Human Gold V1 authoring (HGV1-A, ADR-0108).
 *
 * ### Why a brief is almost entirely closed codes
 *
 * A brief is a WRITING ASSIGNMENT, and it has to survive being read by a dozen different authors over
 * several weeks without drifting. Free prose drifts: two people read "handle the objection well" and
 * write two different corpora. A closed list of required journey events and forbidden shortcuts says
 * the same thing to everybody, and — the part that actually matters — it can be VALIDATED.
 *
 * It also keeps briefs structurally incapable of becoming training rows. There is no field a finished
 * customer or assistant sentence could live in, so a brief cannot be quietly promoted into the corpus
 * it was written to produce.
 */
import type { RIYA_DATASET_SPLITS } from '../../contracts/vocabularies.js';

/** The five authoring waves. Balanced by construction, calibrated after the first. */
export const RIYA_GOLD_WAVES = [1, 2, 3, 4, 5] as const;
export type RiyaGoldWave = (typeof RIYA_GOLD_WAVES)[number];

/** Two assignments per wave, language and primary kind. Never one, never three. */
export const RIYA_GOLD_ORDINALS = [1, 2] as const;
export type RiyaGoldOrdinal = (typeof RIYA_GOLD_ORDINALS)[number];

/**
 * The split each wave lands in.
 *
 * Waves 1–4 TRAIN, wave 5 VALIDATION, and Gold V1 populates NO holdout. A corpus committed to Git is
 * visible to everyone who authors against the repository, so calling part of it "hidden" would be a
 * comforting label on something that is not true. A genuinely hidden holdout needs a separately
 * governed, restricted store, and it is deferred rather than faked.
 *
 * RID-F1 still supports `HOLDOUT` generically. Gold V1 simply does not use it.
 */
export const RIYA_GOLD_WAVE_SPLITS: Readonly<
  Record<RiyaGoldWave, (typeof RIYA_DATASET_SPLITS)[number]>
> = Object.freeze({
  1: 'TRAIN',
  2: 'TRAIN',
  3: 'TRAIN',
  4: 'TRAIN',
  5: 'VALIDATION',
});

/**
 * What a Gold trajectory must actually DO, as closed events.
 *
 * These are the beats a reviewer checks for. Naming them is what stops "a good objection reply" from
 * meaning something different to each author.
 */
export const RIYA_GOLD_JOURNEY_EVENTS = [
  'ACKNOWLEDGE_CONCERN',
  'USE_KNOWN_CONTEXT',
  'CAPTURE_NEW_FACT',
  'APPLY_CORRECTION',
  'CITE_AUTHORITY',
  'ASK_ONE_DISCOVERY_QUESTION',
  'COMPARE_SCOPE_HONESTLY',
  'EXPLAIN_PROCESS',
  'PROPOSE_NEXT_STEP',
  'HAND_OFF_TO_HUMAN',
  'REFUSE_OUT_OF_SCOPE',
  'ANSWER_WITHOUT_REOPENING',
] as const;
export type RiyaGoldJourneyEvent = (typeof RIYA_GOLD_JOURNEY_EVENTS)[number];

/**
 * The shortcuts an author must not take.
 *
 * Every one of these is a way to write a reply that READS well and teaches something harmful. A
 * fabricated discount reads persuasive; an invented warranty reads confident; a canned opener repeated
 * three hundred times reads professional right up until it is the only thing the model knows how to
 * say.
 */
export const RIYA_GOLD_FORBIDDEN_PATTERNS = [
  'INSTANT_DISCOUNT',
  'FALSE_URGENCY',
  'FALSE_SCARCITY',
  'INVENTED_PRICE',
  'INVENTED_WARRANTY',
  'INVENTED_AVAILABILITY',
  'INVENTED_RATING_OR_REVIEW',
  'INVENTED_VENDOR_COUNT',
  'COMPETITOR_ATTACK',
  'MULTIPLE_DISCOVERY_QUESTIONS',
  'REPEATED_KNOWN_QUESTION',
  'PRESSURE_AFTER_HUMAN_REQUEST',
  'APOLOGY_LOOP',
  'CANNED_OPENER',
  'CANNED_CTA',
  'GUILT_OR_FEAR',
  'DEMOGRAPHIC_STEREOTYPE',
  'AI_SELF_REFERENCE',
  'SYSTEM_PROMPT_DISCLOSURE',
  'CHAIN_OF_THOUGHT',
  'REOPEN_COMPLETED_INTAKE',
  'CLAIM_ACTION_NOT_TAKEN',
] as const;
export type RiyaGoldForbiddenPattern = (typeof RIYA_GOLD_FORBIDDEN_PATTERNS)[number];

/** How the reply should sound. Register, not wording. */
export const RIYA_GOLD_STYLE_CODES = [
  'CONCISE_WHATSAPP',
  'WARM_NOT_EFFUSIVE',
  'NO_JARGON',
  'MATCH_CUSTOMER_BREVITY',
  'PLAIN_NUMBERS',
  'NATURAL_DEVANAGARI',
  'NATURAL_CODE_SWITCHING',
  'CALM_UNDER_FRUSTRATION',
] as const;
export type RiyaGoldStyleCode = (typeof RIYA_GOLD_STYLE_CODES)[number];

/** Where an assignment sits in its authoring lifecycle. Workflow metadata, never content. */
export const RIYA_GOLD_PROGRESS_STATUSES = [
  'NOT_STARTED',
  'DRAFTING',
  'READY_FOR_REVIEW',
  'ACCEPTED',
  'REJECTED',
] as const;
export type RiyaGoldProgressStatus = (typeof RIYA_GOLD_PROGRESS_STATUSES)[number];

/** The final Gold V1 shape, as numbers a validator can assert. */
export const RIYA_GOLD_V1_TOTAL = 360;
export const RIYA_GOLD_V1_PER_WAVE = 72;
export const RIYA_GOLD_V1_PER_PAIR_PER_WAVE = 2;
export const RIYA_GOLD_V1_TRAIN_TOTAL = 288;
export const RIYA_GOLD_V1_VALIDATION_TOTAL = 72;
export const RIYA_GOLD_V1_HOLDOUT_TOTAL = 0;

/** Depth bounds. Below four an example teaches a reply; above twelve it teaches a transcript. */
export const RIYA_GOLD_MIN_ASSISTANT_TURNS = 4;
export const RIYA_GOLD_MAX_ASSISTANT_TURNS = 12;
