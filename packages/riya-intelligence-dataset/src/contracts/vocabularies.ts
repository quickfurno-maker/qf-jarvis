/**
 * The closed vocabularies of the Riya intelligence dataset (RID-F1, ADR-0107).
 *
 * ### What is reused rather than reinvented
 *
 * Language modes, interaction kinds, quality dimensions and discovery fields come from
 * `@qf-jarvis/riya-quality-evaluation`. A second sales taxonomy beside P10's would make dataset
 * coverage and evaluation coverage incomparable — you could not say "the corpus covers what the exam
 * measures" — and the two would drift the first time either was extended.
 *
 * Phases and provenance come from `@qf-jarvis/riya-conversation-continuity` for the same reason.
 *
 * ### What is new here, and why
 *
 * Everything below describes a TRAINING EXAMPLE rather than a conversation or an evaluation: which
 * split it belongs to, who the simulated customer is, how hard and how risky the situation is, where
 * the example came from, and what the assistant was trying to do. None of it exists at runtime and
 * none of it is a business authority.
 */
import {
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_DISCOVERY_FIELDS,
  RIYA_QUALITY_INTERACTION_KINDS,
  RIYA_QUALITY_LANGUAGE_MODES,
} from '@qf-jarvis/riya-quality-evaluation';
import type {
  RiyaQualityDimension,
  RiyaQualityDiscoveryField,
  RiyaQualityInteractionKind,
  RiyaQualityLanguageMode,
} from '@qf-jarvis/riya-quality-evaluation';

// ---------------------------------------------------------------------------
// Reused, not forked.
// ---------------------------------------------------------------------------

export const RIYA_DATASET_LANGUAGE_MODES = RIYA_QUALITY_LANGUAGE_MODES;
export type RiyaDatasetLanguageMode = RiyaQualityLanguageMode;

export const RIYA_DATASET_INTERACTION_KINDS = RIYA_QUALITY_INTERACTION_KINDS;
export type RiyaDatasetInteractionKind = RiyaQualityInteractionKind;

export const RIYA_DATASET_QUALITY_DIMENSIONS = RIYA_QUALITY_DIMENSIONS;
export type RiyaDatasetQualityDimension = RiyaQualityDimension;

export const RIYA_DATASET_DISCOVERY_FIELDS = RIYA_QUALITY_DISCOVERY_FIELDS;
export type RiyaDatasetDiscoveryField = RiyaQualityDiscoveryField;

// ---------------------------------------------------------------------------
// Splits.
// ---------------------------------------------------------------------------

/**
 * The three dataset splits.
 *
 * The RWC-P10 golden corpus is deliberately NOT here. It is protected EXAM data, not a fourth split:
 * a split is something a dataset owns and may draw from, and the moment the exam appeared in that
 * list somebody would legitimately partition against it. It is guarded by a leakage firewall
 * instead, which is a different mechanism because it answers a different question.
 */
export const RIYA_DATASET_SPLITS = ['TRAIN', 'VALIDATION', 'HOLDOUT'] as const;
export type RiyaDatasetSplit = (typeof RIYA_DATASET_SPLITS)[number];

// ---------------------------------------------------------------------------
// Who the simulated customer is.
// ---------------------------------------------------------------------------

/**
 * Conversational personas. BEHAVIOUR only.
 *
 * Every value describes how somebody writes and decides, never who they are. There is deliberately
 * no religion, caste, ethnicity, region-as-identity, gender, age, medical or political trait — a
 * training corpus that carried those would teach Riya to condition its selling on them, and no
 * amount of downstream evaluation would reliably catch that.
 */
export const RIYA_DATASET_PERSONAS = [
  'DECISIVE',
  'EXPLORING',
  'PRICE_SENSITIVE',
  'PREMIUM',
  'SKEPTICAL',
  'BUSY_SHORT_REPLY',
  'CONFUSED',
  'FRUSTRATED',
] as const;
export type RiyaDatasetPersona = (typeof RIYA_DATASET_PERSONAS)[number];

/** How hard the situation is. Coverage input, never a gate on its own. */
export const RIYA_DATASET_DIFFICULTIES = ['BASIC', 'STANDARD', 'HARD', 'EDGE'] as const;
export type RiyaDatasetDifficulty = (typeof RIYA_DATASET_DIFFICULTIES)[number];

/**
 * How much damage a wrong answer here would do.
 *
 * This controls REVIEW EFFORT and nothing else. `HIGH_RISK` covers price, discount, payment,
 * warranty, policy, consent, human handoff, complaint, business action, current availability,
 * identity and privacy situations — the ones where a plausible-sounding wrong reply becomes a
 * commitment somebody has to honour.
 */
export const RIYA_DATASET_RISK_CLASSES = ['STANDARD', 'HIGH_RISK'] as const;
export type RiyaDatasetRiskClass = (typeof RIYA_DATASET_RISK_CLASSES)[number];

// ---------------------------------------------------------------------------
// Where an example came from.
// ---------------------------------------------------------------------------

/**
 * Release-eligible source kinds. SYNTHETIC ONLY, and the list is the enforcement.
 *
 * There is no `LIVE_CHAT`, `PRODUCTION_EXPORT`, `CRM_EXPORT`, `WHATSAPP_EXPORT` or `REAL_CUSTOMER`
 * value, so a real conversation is not representable in this contract — not merely discouraged.
 * A future authorized flow (consent → redaction → candidate → human review → release) would add its
 * own value under its own ADR, and it would never be `LIVE_CHAT → TRAIN`.
 */
export const RIYA_DATASET_SOURCE_KINDS = [
  'HUMAN_AUTHORED_SYNTHETIC',
  'TEACHER_GENERATED_SYNTHETIC',
] as const;
export type RiyaDatasetSourceKind = (typeof RIYA_DATASET_SOURCE_KINDS)[number];

// ---------------------------------------------------------------------------
// Turns.
// ---------------------------------------------------------------------------

/**
 * The three turn types.
 *
 * There is no `SYSTEM` turn, deliberately. A system prompt is model-specific formatting and it
 * changes with every prompt revision; baking one into the canonical source would make the corpus
 * obsolete the day the prompt did, and would quietly turn a dataset into a prompt artifact.
 */
export const RIYA_DATASET_TURN_TYPES = ['USER', 'AUTHORITATIVE_CONTEXT', 'ASSISTANT'] as const;
export type RiyaDatasetTurnType = (typeof RIYA_DATASET_TURN_TYPES)[number];

/** Who supplied a simulated authoritative context. Both are SIMULATED, never a real lookup. */
export const RIYA_DATASET_CONTEXT_AUTHORITIES = [
  'GOVERNED_KNOWLEDGE_SYNTHETIC',
  'CORE_RUNTIME_SYNTHETIC',
] as const;
export type RiyaDatasetContextAuthority = (typeof RIYA_DATASET_CONTEXT_AUTHORITIES)[number];

/**
 * What kind of business fact a context supplies.
 *
 * These are the classes of thing that are TRUE TODAY and false next quarter. Naming them is how the
 * firewall knows which assistant assertions need a citation.
 */
export const RIYA_DATASET_FACT_CLASSES = [
  'SERVICE_AVAILABILITY',
  'PRICE',
  'PACKAGE',
  'POLICY',
  'WARRANTY',
  'PROCESS',
  'CURRENT_STATUS',
  'OTHER_BUSINESS_FACT',
] as const;
export type RiyaDatasetFactClass = (typeof RIYA_DATASET_FACT_CLASSES)[number];

// ---------------------------------------------------------------------------
// What the assistant did.
// ---------------------------------------------------------------------------

/**
 * The closed set of assistant decisions.
 *
 * Notice what cannot be expressed: no provider call, no n8n trigger, no database write, no vendor
 * assignment, no price setting, no discount grant, no payment authority. `REQUEST_CONTROLLED_ACTION`
 * is the strongest thing here and it is a REQUEST — the deterministic business layer decides, and a
 * dataset that could express otherwise would be teaching Riya it has authority it does not have.
 */
export const RIYA_DATASET_ASSISTANT_DECISIONS = [
  'ANSWER_DIRECT',
  'ASK_DISCOVERY',
  'USE_GOVERNED_KNOWLEDGE',
  'USE_CORE_TRUTH',
  'REQUEST_CONTROLLED_ACTION',
  'HANDOFF_HUMAN',
  'REFUSE_OUT_OF_SCOPE',
] as const;
export type RiyaDatasetAssistantDecision = (typeof RIYA_DATASET_ASSISTANT_DECISIONS)[number];

/** The decisions that ASSERT volatile business truth, and therefore require a cited fact. */
export const RIYA_DATASET_FACT_BEARING_DECISIONS: ReadonlySet<RiyaDatasetAssistantDecision> =
  new Set(['USE_GOVERNED_KNOWLEDGE', 'USE_CORE_TRUTH']);

/** What the reply was FOR. The strategy label the model is meant to learn to choose. */
export const RIYA_DATASET_RESPONSE_OBJECTIVES = [
  'DISCOVER',
  'CORRECT',
  'ANSWER',
  'ADDRESS_OBJECTION',
  'BUILD_TRUST',
  'ADVANCE_NEXT_STEP',
  'HANDOFF',
  'REFUSE',
] as const;
export type RiyaDatasetResponseObjective = (typeof RIYA_DATASET_RESPONSE_OBJECTIVES)[number];

// ---------------------------------------------------------------------------
// Review.
// ---------------------------------------------------------------------------

export const RIYA_DATASET_REVIEW_DECISIONS = ['ACCEPTED', 'REJECTED'] as const;
export type RiyaDatasetReviewDecision = (typeof RIYA_DATASET_REVIEW_DECISIONS)[number];

/**
 * The dimensions EVERY trajectory must be reviewed on.
 *
 * Four, because they apply to any reply at all: was it clear, did it read like a person, did it use
 * what the customer already said, and did it avoid repeating itself.
 */
export const RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS: readonly RiyaDatasetQualityDimension[] =
  Object.freeze(['CLARITY', 'NATURALNESS', 'CONTEXT_USE', 'NON_REPETITION']);

/**
 * The additional dimensions an OBJECTION trajectory must be reviewed on.
 *
 * An objection answered clearly but coldly, or clearly and pushily, is the failure mode that
 * matters commercially — and it is invisible to the baseline four.
 */
export const RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS: readonly RiyaDatasetQualityDimension[] =
  Object.freeze([
    'EMPATHY',
    'OBJECTION_HANDLING',
    'TRUST_BUILDING',
    'SALES_MOMENTUM',
    'CTA_QUALITY',
  ]);

/** The interaction kinds that pull in the objection review dimensions. */
export const RIYA_DATASET_OBJECTION_INTERACTION_KINDS: ReadonlySet<RiyaDatasetInteractionKind> =
  new Set(['OBJECTION_PRICE', 'OBJECTION_TRUST', 'OBJECTION_TIMELINE']);

/** How many DISTINCT accepted reviews each risk class needs before release. */
export const RIYA_DATASET_REQUIRED_REVIEWS: Readonly<Record<RiyaDatasetRiskClass, number>> =
  Object.freeze({ STANDARD: 1, HIGH_RISK: 2 });
