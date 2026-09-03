/**
 * The synthetic scenario: a GENERATION PLAN, never a conversation (AS1, ADR-0143 §6, §11).
 *
 * ### It has nowhere to put a sentence
 *
 * A scenario says what conversation to generate — which language, which persona, which behaviours,
 * which facts the customer is holding, how deep it should go. It does not say what anybody says.
 * There is no `exampleReply`, no `idealConversation`, no `openingMessage` and no free prose field at
 * all, because a planning artifact that could carry a good answer would be handing the generator the
 * thing it was asked to produce, and the corpus would quietly become a paraphrase of the plan.
 *
 * The one place free text survives is `plannedCustomerFacts[].value`, and those are DATA VALUES — a
 * city, a scope, a budget band. The constructor holds them to that: no quotation marks, no speaker
 * prefix, no sentence-shaped run of words, and the same privacy scan the corpus gets.
 *
 * ### Lineage and split are fixed BEFORE generation
 *
 * `lineageRootRef` and `split` live here, on the plan, not on the output. ADR-0143 §6: generating
 * first and splitting afterwards is how a paraphrase lands in `VALIDATION` while its parent sits in
 * `TRAIN`, the validation score rises, and nobody can see why. AS2 receives a scenario whose split is
 * already decided and has no API for changing its mind.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import {
  RIYA_DATASET_ASSISTANT_DECISIONS,
  RIYA_DATASET_DIFFICULTIES,
  RIYA_DATASET_DISCOVERY_FIELDS,
  RIYA_DATASET_FACT_CLASSES,
  RIYA_DATASET_INTERACTION_KINDS,
  RIYA_DATASET_LANGUAGE_MODES,
  RIYA_DATASET_PERSONAS,
  RIYA_DATASET_RESPONSE_OBJECTIVES,
  RIYA_DATASET_RISK_CLASSES,
  RIYA_DATASET_SPLITS,
} from '../../contracts/vocabularies.js';
import type {
  RiyaDatasetAssistantDecision,
  RiyaDatasetDifficulty,
  RiyaDatasetDiscoveryField,
  RiyaDatasetFactClass,
  RiyaDatasetInteractionKind,
  RiyaDatasetLanguageMode,
  RiyaDatasetPersona,
  RiyaDatasetResponseObjective,
  RiyaDatasetRiskClass,
  RiyaDatasetSplit,
} from '../../contracts/vocabularies.js';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import { scanTextForPrivacy } from '../../internal/privacy-scan.js';
import { sha256OfCanonical } from '../../internal/sha256.js';
import {
  RIYA_AI_SYNTHETIC_BEHAVIOR_CODES,
  RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS,
  RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS,
  RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS,
  RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS,
} from './vocabularies.js';
import type {
  RiyaAiSyntheticBehaviorCode,
  RiyaAiSyntheticConversationEvent,
  RiyaAiSyntheticForbiddenBehavior,
} from './vocabularies.js';

/** A fact the synthetic customer is holding, as structured data rather than as something said. */
export interface RiyaAiSyntheticPlannedFactV1 {
  readonly field: RiyaDatasetDiscoveryField;
  readonly value: string;
}

export interface RiyaAiSyntheticScenarioV1 {
  readonly version: 1;
  readonly scenarioRef: string;
  /** Fixed here, before generation. Splits partition on THIS. */
  readonly lineageRootRef: string;
  readonly split: RiyaDatasetSplit;
  readonly languageMode: RiyaDatasetLanguageMode;
  readonly primaryInteractionKind: RiyaDatasetInteractionKind;
  readonly secondaryInteractionKinds: readonly RiyaDatasetInteractionKind[];
  readonly persona: RiyaDatasetPersona;
  readonly difficulty: RiyaDatasetDifficulty;
  readonly riskClass: RiyaDatasetRiskClass;
  readonly startPhase: RiyaConversationPhase;
  readonly targetAssistantTurns: number;
  readonly plannedDiscoveryFields: readonly RiyaDatasetDiscoveryField[];
  readonly plannedCustomerFacts: readonly RiyaAiSyntheticPlannedFactV1[];
  readonly requiredAuthorityFactClasses: readonly RiyaDatasetFactClass[];
  readonly requiredAssistantDecisions: readonly RiyaDatasetAssistantDecision[];
  readonly requiredResponseObjectives: readonly RiyaDatasetResponseObjective[];
  readonly customerBehaviorCodes: readonly RiyaAiSyntheticBehaviorCode[];
  readonly requiredConversationEvents: readonly RiyaAiSyntheticConversationEvent[];
  readonly forbiddenBehaviors: readonly RiyaAiSyntheticForbiddenBehavior[];
}

export type RiyaAiSyntheticScenarioInput = Omit<RiyaAiSyntheticScenarioV1, 'version'> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * A planned data value. Short, and deliberately not a sentence.
 *
 * 120 characters is enough for "Whitefield, Bengaluru" or "modular kitchen and one wardrobe" and far
 * too little for a reply worth training on.
 */
const FACT_VALUE = z.string().min(1).max(120);

/** Speaker prefixes, in the three languages this lane plans for. */
const SPEAKER_PREFIX = /(?:^|\s)(?:user|customer|assistant|riya|bot|agent|ग्राहक|रिया)\s*:/iu;
const QUOTE_MARK = /["“”'']/u;
/** Sentence-final punctuation followed by more words: the shape of prose, not of a value. */
const SENTENCE_RUN = /[.!?।]\s+\S/u;

const uniqueClosed = (values: readonly string[], allowed: readonly string[]): boolean =>
  new Set(values).size === values.length && values.every((one) => allowed.includes(one));

const scenarioSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added. Round-tripping is a real path: evidence deep-
    // re-proves verdicts that are themselves already constructed.
    version: z.literal(1).optional(),
    scenarioRef: REF,
    lineageRootRef: REF,
    split: z.enum(RIYA_DATASET_SPLITS),
    languageMode: z.enum(RIYA_DATASET_LANGUAGE_MODES),
    primaryInteractionKind: z.enum(RIYA_DATASET_INTERACTION_KINDS),
    secondaryInteractionKinds: z
      .array(z.enum(RIYA_DATASET_INTERACTION_KINDS))
      .max(RIYA_DATASET_INTERACTION_KINDS.length),
    persona: z.enum(RIYA_DATASET_PERSONAS),
    difficulty: z.enum(RIYA_DATASET_DIFFICULTIES),
    riskClass: z.enum(RIYA_DATASET_RISK_CLASSES),
    startPhase: z.enum(RIYA_CONVERSATION_PHASES),
    targetAssistantTurns: z
      .int()
      .min(RIYA_AI_SYNTHETIC_MIN_ASSISTANT_TURNS)
      .max(RIYA_AI_SYNTHETIC_MAX_ASSISTANT_TURNS),
    plannedDiscoveryFields: z
      .array(z.enum(RIYA_DATASET_DISCOVERY_FIELDS as readonly [string, ...string[]]))
      .max(RIYA_DATASET_DISCOVERY_FIELDS.length),
    plannedCustomerFacts: z
      .array(
        z
          .object({
            field: z.enum(RIYA_DATASET_DISCOVERY_FIELDS as readonly [string, ...string[]]),
            value: FACT_VALUE,
          })
          .strict(),
      )
      .max(RIYA_DATASET_DISCOVERY_FIELDS.length),
    requiredAuthorityFactClasses: z
      .array(z.enum(RIYA_DATASET_FACT_CLASSES))
      .max(RIYA_DATASET_FACT_CLASSES.length),
    requiredAssistantDecisions: z
      .array(z.enum(RIYA_DATASET_ASSISTANT_DECISIONS))
      .max(RIYA_DATASET_ASSISTANT_DECISIONS.length),
    requiredResponseObjectives: z
      .array(z.enum(RIYA_DATASET_RESPONSE_OBJECTIVES))
      .max(RIYA_DATASET_RESPONSE_OBJECTIVES.length),
    customerBehaviorCodes: z
      .array(z.enum(RIYA_AI_SYNTHETIC_BEHAVIOR_CODES))
      .min(1)
      .max(RIYA_AI_SYNTHETIC_BEHAVIOR_CODES.length),
    requiredConversationEvents: z
      .array(z.enum(RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS))
      .min(1)
      .max(RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS.length),
    forbiddenBehaviors: z
      .array(z.enum(RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS))
      .max(RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS.length),
  })
  .strict();

/**
 * Validate and freeze a scenario. Throws `invalid-ai-synthetic-scenario`.
 *
 * The prose checks below are the ones that matter. Everything else is a closed enum and cannot carry
 * a conversation; `plannedCustomerFacts[].value` is the single free string in the contract, so it is
 * held to being a value — and scanned for the same secrets the corpus is, because an offline
 * planning artifact still ends up in a repository.
 */
export function createRiyaAiSyntheticScenario(
  input: RiyaAiSyntheticScenarioInput,
): RiyaAiSyntheticScenarioV1 {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
  }
  const data = parsed.data;

  // A kind cannot be both the primary and a secondary, and secondaries do not repeat.
  if (
    data.secondaryInteractionKinds.includes(data.primaryInteractionKind) ||
    new Set(data.secondaryInteractionKinds).size !== data.secondaryInteractionKinds.length
  ) {
    throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
  }
  if (
    !uniqueClosed(data.plannedDiscoveryFields, RIYA_DATASET_DISCOVERY_FIELDS) ||
    !uniqueClosed(data.requiredAuthorityFactClasses, RIYA_DATASET_FACT_CLASSES) ||
    !uniqueClosed(data.requiredAssistantDecisions, RIYA_DATASET_ASSISTANT_DECISIONS) ||
    !uniqueClosed(data.requiredResponseObjectives, RIYA_DATASET_RESPONSE_OBJECTIVES) ||
    !uniqueClosed(data.customerBehaviorCodes, RIYA_AI_SYNTHETIC_BEHAVIOR_CODES) ||
    !uniqueClosed(data.requiredConversationEvents, RIYA_AI_SYNTHETIC_CONVERSATION_EVENTS) ||
    !uniqueClosed(data.forbiddenBehaviors, RIYA_AI_SYNTHETIC_FORBIDDEN_BEHAVIORS)
  ) {
    throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
  }

  // One planned value per field. Two values for `budget` is a plan that cannot be satisfied.
  const factFields = data.plannedCustomerFacts.map((fact) => fact.field);
  if (new Set(factFields).size !== factFields.length) {
    throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
  }

  // THE anti-dialogue check.
  for (const fact of data.plannedCustomerFacts) {
    if (
      QUOTE_MARK.test(fact.value) ||
      SPEAKER_PREFIX.test(fact.value) ||
      SENTENCE_RUN.test(fact.value) ||
      scanTextForPrivacy(fact.value).length > 0
    ) {
      throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
    }
  }

  // A decision that asserts business truth needs an authority to rest on, so a plan requiring one
  // while requiring no fact class is a plan whose output could only be an invented price.
  const needsAuthority = data.requiredAssistantDecisions.some(
    (decision) => decision === 'USE_GOVERNED_KNOWLEDGE' || decision === 'USE_CORE_TRUTH',
  );
  if (needsAuthority && data.requiredAuthorityFactClasses.length === 0) {
    throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
  }
  // And the converse: requiring the assistant to USE an authoritative fact without naming a class.
  if (
    data.requiredConversationEvents.includes('USE_AUTHORITATIVE_FACT') &&
    data.requiredAuthorityFactClasses.length === 0
  ) {
    throw new RiyaDatasetError('invalid-ai-synthetic-scenario');
  }

  return Object.freeze({
    version: 1 as const,
    scenarioRef: data.scenarioRef,
    lineageRootRef: data.lineageRootRef,
    split: data.split,
    languageMode: data.languageMode,
    primaryInteractionKind: data.primaryInteractionKind,
    secondaryInteractionKinds: Object.freeze([...data.secondaryInteractionKinds].sort()),
    persona: data.persona,
    difficulty: data.difficulty,
    riskClass: data.riskClass,
    startPhase: data.startPhase,
    targetAssistantTurns: data.targetAssistantTurns,
    plannedDiscoveryFields: Object.freeze(
      [...data.plannedDiscoveryFields].sort() as RiyaDatasetDiscoveryField[],
    ),
    plannedCustomerFacts: Object.freeze(
      [...data.plannedCustomerFacts]
        .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))
        .map((fact) =>
          Object.freeze({ field: fact.field as RiyaDatasetDiscoveryField, value: fact.value }),
        ),
    ),
    requiredAuthorityFactClasses: Object.freeze([...data.requiredAuthorityFactClasses].sort()),
    requiredAssistantDecisions: Object.freeze([...data.requiredAssistantDecisions].sort()),
    requiredResponseObjectives: Object.freeze([...data.requiredResponseObjectives].sort()),
    customerBehaviorCodes: Object.freeze([...data.customerBehaviorCodes].sort()),
    requiredConversationEvents: Object.freeze([...data.requiredConversationEvents].sort()),
    forbiddenBehaviors: Object.freeze([...data.forbiddenBehaviors].sort()),
  });
}

/** The content digest of a scenario. Evidence binds to THIS, not to a scenario ref. */
export function riyaAiSyntheticScenarioSha256(scenario: RiyaAiSyntheticScenarioV1): string {
  return sha256OfCanonical(scenario);
}
