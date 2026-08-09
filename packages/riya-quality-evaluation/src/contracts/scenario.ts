/**
 * A Riya quality scenario: one fixture, and exactly what a correct answer to it looks like
 * (RWC-P10, ADR-0106 §12).
 *
 * ### It states expectations; it does not re-derive Riya
 *
 * A scenario says what the OBSERVED result must satisfy. It deliberately does not recompute RWC-P4A
 * phase transitions, RWC-P4B merge precedence or RWC-P5 availability. An evaluator that reimplemented
 * the reducer would be testing its own copy of the rules against the real ones, and the day the two
 * disagreed the suite would report a model failure for a reducer change. `allowedContinuityPhasesAfter`
 * is a membership check against a fixture author's stated expectation, nothing more.
 *
 * ### Exact identities only
 *
 * No wildcard, no `latest`. A scenario that could match "whatever the current version is" would make
 * two runs of "the same suite" mean different things, which is precisely what candidate comparison
 * depends on not happening.
 */
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import { RIYA_DISCOVERY_OBSERVATION_OPERATIONS } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaDiscoveryObservationOperation } from '@qf-jarvis/riya-conversation-evolution';
import { z } from 'zod';

import { RiyaQualityEvaluationError } from './errors.js';
import {
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_DISCOVERY_FIELDS,
  RIYA_QUALITY_EXPECTABLE_PROVENANCES,
  RIYA_QUALITY_INTERACTION_KINDS,
  RIYA_QUALITY_LANGUAGE_MODES,
} from './vocabularies.js';
import type {
  RiyaQualityDimension,
  RiyaQualityDiscoveryField,
  RiyaQualityExpectableProvenance,
  RiyaQualityInteractionKind,
  RiyaQualityLanguageMode,
} from './vocabularies.js';

/** One canonical observation a correct answer must produce. */
export interface RiyaQualityExpectedObservation {
  readonly field: RiyaQualityDiscoveryField;
  readonly operation: RiyaDiscoveryObservationOperation;
  /** Required for `SET`, forbidden for `CLEAR` — the canonical batch rule, restated as expectation. */
  readonly value?: string;
  /**
   * Which origins are acceptable for this fact. Absent means either expectable origin will do.
   *
   * A fixture whose client SAID their city should normally require `user_stated`: accepting
   * `model_inferred` there would let a candidate pass by guessing correctly, which is not the same
   * skill and fails differently in production.
   */
  readonly allowedProvenance?: readonly RiyaQualityExpectableProvenance[];
}

/** What a correct answer to this scenario must satisfy. */
export interface RiyaQualityExpectation {
  readonly maxReplyChars: number;
  readonly maxQuestions: number;
  readonly expectedObservations: readonly RiyaQualityExpectedObservation[];
  readonly forbiddenObservationFields: readonly RiyaQualityDiscoveryField[];
  readonly requiredCitation: boolean;
  readonly allowedAskedDiscoveryFields: readonly RiyaQualityDiscoveryField[];
  readonly allowedContinuityPhasesAfter: readonly RiyaConversationPhase[];
  readonly requiredQualityDimensions: readonly RiyaQualityDimension[];
}

export interface RiyaQualityScenarioV1 {
  readonly version: 1;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly phase: RiyaConversationPhase;
  readonly languageMode: RiyaQualityLanguageMode;
  readonly interactionKind: RiyaQualityInteractionKind;
  readonly expected: RiyaQualityExpectation;
}

export type RiyaQualityScenarioInput = RiyaQualityScenarioV1;

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);
const FIELD = z.enum(RIYA_QUALITY_DISCOVERY_FIELDS as readonly [string, ...string[]]);

const expectedObservationSchema = z
  .object({
    field: FIELD,
    operation: z.enum(RIYA_DISCOVERY_OBSERVATION_OPERATIONS),
    value: z.string().min(1).max(2048).optional(),
    allowedProvenance: z
      .array(z.enum(RIYA_QUALITY_EXPECTABLE_PROVENANCES))
      .min(1)
      .max(2)
      .optional(),
  })
  .strict();

const scenarioSchema = z
  .object({
    version: z.literal(1),
    scenarioId: IDENTIFIER,
    scenarioVersion: VERSION,
    phase: z.enum(RIYA_CONVERSATION_PHASES),
    languageMode: z.enum(RIYA_QUALITY_LANGUAGE_MODES),
    interactionKind: z.enum(RIYA_QUALITY_INTERACTION_KINDS),
    expected: z
      .object({
        // 2500 is a ceiling on the ceiling: a fixture that permitted more than that would not be
        // measuring conversational concision at all.
        maxReplyChars: z.int().min(1).max(2500),
        // Three is the absolute maximum a fixture may permit. Riya asking four things at once is a
        // form, not a conversation, and no correct answer needs the allowance.
        maxQuestions: z.int().min(0).max(3),
        expectedObservations: z
          .array(expectedObservationSchema)
          .max(RIYA_QUALITY_DISCOVERY_FIELDS.length),
        forbiddenObservationFields: z.array(FIELD).max(RIYA_QUALITY_DISCOVERY_FIELDS.length),
        requiredCitation: z.boolean(),
        allowedAskedDiscoveryFields: z.array(FIELD).max(RIYA_QUALITY_DISCOVERY_FIELDS.length),
        allowedContinuityPhasesAfter: z
          .array(z.enum(RIYA_CONVERSATION_PHASES))
          .min(1)
          .max(RIYA_CONVERSATION_PHASES.length),
        requiredQualityDimensions: z
          .array(z.enum(RIYA_QUALITY_DIMENSIONS))
          .max(RIYA_QUALITY_DIMENSIONS.length),
      })
      .strict(),
  })
  .strict();

const rejectWildcard = (value: string): void => {
  if (value.toLowerCase() === 'latest' || value.includes('*')) {
    throw new RiyaQualityEvaluationError('invalid-scenario');
  }
};

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

/** Validate and freeze a quality scenario. Throws `invalid-scenario`. */
export function createRiyaQualityScenario(input: RiyaQualityScenarioInput): RiyaQualityScenarioV1 {
  const parsed = scenarioSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaQualityEvaluationError('invalid-scenario');
  }
  rejectWildcard(parsed.data.scenarioId);

  const expected = input.expected;
  const expectedFields = expected.expectedObservations.map((one) => one.field);

  if (
    hasDuplicates(expectedFields) ||
    hasDuplicates(expected.forbiddenObservationFields) ||
    hasDuplicates(expected.allowedAskedDiscoveryFields) ||
    hasDuplicates(expected.allowedContinuityPhasesAfter) ||
    hasDuplicates(expected.requiredQualityDimensions)
  ) {
    throw new RiyaQualityEvaluationError('invalid-scenario');
  }

  // A field that is both required and forbidden is not a strict fixture, it is an unsatisfiable one.
  // Every candidate would fail it, the dimension would look permanently broken, and the cause would
  // be a typo in the corpus rather than anything about a model.
  const forbidden = new Set(expected.forbiddenObservationFields);
  for (const field of expectedFields) {
    if (forbidden.has(field)) {
      throw new RiyaQualityEvaluationError('invalid-scenario');
    }
  }

  for (const one of expected.expectedObservations) {
    // The canonical batch rule, restated as an expectation rule: a SET without a value expects
    // nothing checkable, and a CLEAR with one expects something the runtime cannot emit.
    if (one.operation === 'SET' && one.value === undefined) {
      throw new RiyaQualityEvaluationError('invalid-scenario');
    }
    if (one.operation === 'CLEAR' && one.value !== undefined) {
      throw new RiyaQualityEvaluationError('invalid-scenario');
    }
    if (one.allowedProvenance !== undefined && hasDuplicates(one.allowedProvenance)) {
      throw new RiyaQualityEvaluationError('invalid-scenario');
    }
  }

  return Object.freeze({
    version: 1 as const,
    scenarioId: parsed.data.scenarioId,
    scenarioVersion: parsed.data.scenarioVersion,
    phase: parsed.data.phase,
    languageMode: parsed.data.languageMode,
    interactionKind: parsed.data.interactionKind,
    expected: Object.freeze({
      maxReplyChars: expected.maxReplyChars,
      maxQuestions: expected.maxQuestions,
      expectedObservations: Object.freeze(
        [...expected.expectedObservations]
          .map((one) =>
            Object.freeze({
              field: one.field,
              operation: one.operation,
              ...(one.value === undefined ? {} : { value: one.value }),
              ...(one.allowedProvenance === undefined
                ? {}
                : { allowedProvenance: Object.freeze([...one.allowedProvenance].sort()) }),
            }),
          )
          .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)),
      ),
      forbiddenObservationFields: Object.freeze([...expected.forbiddenObservationFields].sort()),
      requiredCitation: expected.requiredCitation,
      allowedAskedDiscoveryFields: Object.freeze([...expected.allowedAskedDiscoveryFields].sort()),
      allowedContinuityPhasesAfter: Object.freeze(
        [...expected.allowedContinuityPhasesAfter].sort(),
      ),
      requiredQualityDimensions: Object.freeze([...expected.requiredQualityDimensions].sort()),
    }),
  });
}

/** The exact key identifying a scenario. */
export function riyaQualityScenarioKey(scenario: RiyaQualityScenarioV1): string {
  return `${scenario.scenarioId}@${String(scenario.scenarioVersion)}`;
}
