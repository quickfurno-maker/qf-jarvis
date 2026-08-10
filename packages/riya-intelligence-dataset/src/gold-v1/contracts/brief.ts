/**
 * One Human Gold V1 authoring brief (HGV1-A, ADR-0108).
 *
 * ### A brief is a writing assignment, and it must stay one
 *
 * `customerSituation` and `conversationGoal` are short INSTRUCTIONS to a human author — "customer
 * compares a lower competitor quote; separate scope from price and advance to one low-pressure next
 * step". They are not dialogue, they must not become dialogue, and the constructor refuses anything
 * shaped like it.
 *
 * That refusal matters more than it looks. Briefs and trajectories live in the same repository and
 * carry similar-sounding fields, and the shortest path from "we need 360 conversations" to "we have
 * 360 conversations" is to quietly promote the instructions into the corpus. What comes out is a
 * corpus of paraphrased instructions written in the same voice — exactly the canned-template matcher
 * this whole programme exists to avoid.
 *
 * So a brief has no `turns`, no `text`, no `reply`, no speaker field; quotation marks and speaker
 * prefixes are rejected outright; and a spec asserts a brief cannot be parsed as a trajectory.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { RIYA_DATASET_QUALITY_DIMENSIONS } from '../../contracts/vocabularies.js';
import type { RiyaDatasetQualityDimension } from '../../contracts/vocabularies.js';
import {
  RIYA_GOLD_FORBIDDEN_PATTERNS,
  RIYA_GOLD_JOURNEY_EVENTS,
  RIYA_GOLD_STYLE_CODES,
} from './vocabularies.js';
import type {
  RiyaGoldForbiddenPattern,
  RiyaGoldJourneyEvent,
  RiyaGoldStyleCode,
} from './vocabularies.js';

/** Which synthetic authority facts the author must supply, and from which authority. */
export interface RiyaGoldAuthorityPlanEntry {
  readonly authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC' | 'CORE_RUNTIME_SYNTHETIC';
  readonly factClass: string;
  /** A SYNTHETIC placeholder ref the author should use. Never a real value. */
  readonly suggestedFactRef: string;
}

export interface RiyaGoldV1BriefV1 {
  readonly version: 1;
  readonly briefRef: string;
  readonly assignmentId: string;
  /** Short instruction. Who the customer is and what they have just done. */
  readonly customerSituation: string;
  /** Short instruction. What a good Riya turn sequence achieves here. */
  readonly conversationGoal: string;
  readonly requiredJourneyEvents: readonly RiyaGoldJourneyEvent[];
  readonly forbiddenShortcuts: readonly RiyaGoldForbiddenPattern[];
  readonly authorityPlan: readonly RiyaGoldAuthorityPlanEntry[];
  readonly stylePlan: readonly RiyaGoldStyleCode[];
  readonly reviewFocus: readonly RiyaDatasetQualityDimension[];
}

export type RiyaGoldV1BriefInput = RiyaGoldV1BriefV1;

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** Instruction prose: long enough to be useful, short enough not to be a script. */
const INSTRUCTION = z.string().min(20).max(400);

const briefSchema = z
  .object({
    version: z.literal(1),
    briefRef: REF,
    assignmentId: REF,
    customerSituation: INSTRUCTION,
    conversationGoal: INSTRUCTION,
    requiredJourneyEvents: z
      .array(z.enum(RIYA_GOLD_JOURNEY_EVENTS))
      .min(1)
      .max(RIYA_GOLD_JOURNEY_EVENTS.length),
    forbiddenShortcuts: z
      .array(z.enum(RIYA_GOLD_FORBIDDEN_PATTERNS))
      .min(1)
      .max(RIYA_GOLD_FORBIDDEN_PATTERNS.length),
    authorityPlan: z
      .array(
        z
          .object({
            authority: z.enum(['GOVERNED_KNOWLEDGE_SYNTHETIC', 'CORE_RUNTIME_SYNTHETIC']),
            factClass: z.string().min(1).max(64),
            suggestedFactRef: REF,
          })
          .strict(),
      )
      .max(8),
    stylePlan: z.array(z.enum(RIYA_GOLD_STYLE_CODES)).min(1).max(RIYA_GOLD_STYLE_CODES.length),
    reviewFocus: z
      .array(z.enum(RIYA_DATASET_QUALITY_DIMENSIONS))
      .min(1)
      .max(RIYA_DATASET_QUALITY_DIMENSIONS.length),
  })
  .strict();

/**
 * Shapes that mean somebody wrote dialogue where an instruction belongs.
 *
 * Quotation marks are the giveaway — an instruction has no reason to quote a sentence — and a speaker
 * prefix is unambiguous.
 */
const DIALOGUE_SHAPES: readonly RegExp[] = Object.freeze([
  /["“”]/u,
  /(?:^|\s)(?:user|customer|assistant|riya|bot|agent)\s*:/iu,
  /(?:^|\n)\s*[-*]\s*(?:user|assistant)\b/iu,
]);

const hasDuplicates = (values: readonly string[]): boolean =>
  new Set(values).size !== values.length;

/** Validate and freeze one authoring brief. Throws `invalid-gold-brief`. */
export function createRiyaGoldV1Brief(input: RiyaGoldV1BriefInput): RiyaGoldV1BriefV1 {
  const parsed = briefSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-gold-brief');
  }
  for (const prose of [parsed.data.customerSituation, parsed.data.conversationGoal]) {
    for (const shape of DIALOGUE_SHAPES) {
      if (shape.test(prose)) {
        throw new RiyaDatasetError('invalid-gold-brief');
      }
    }
  }
  if (
    hasDuplicates(parsed.data.requiredJourneyEvents) ||
    hasDuplicates(parsed.data.forbiddenShortcuts) ||
    hasDuplicates(parsed.data.stylePlan) ||
    hasDuplicates(parsed.data.reviewFocus) ||
    hasDuplicates(parsed.data.authorityPlan.map((entry) => entry.suggestedFactRef))
  ) {
    throw new RiyaDatasetError('invalid-gold-brief');
  }

  return Object.freeze({
    version: 1 as const,
    briefRef: parsed.data.briefRef,
    assignmentId: parsed.data.assignmentId,
    customerSituation: parsed.data.customerSituation,
    conversationGoal: parsed.data.conversationGoal,
    requiredJourneyEvents: Object.freeze([...parsed.data.requiredJourneyEvents].sort()),
    forbiddenShortcuts: Object.freeze([...parsed.data.forbiddenShortcuts].sort()),
    authorityPlan: Object.freeze(
      parsed.data.authorityPlan.map((entry) => Object.freeze({ ...entry })),
    ),
    stylePlan: Object.freeze([...parsed.data.stylePlan].sort()),
    reviewFocus: Object.freeze([...parsed.data.reviewFocus].sort()),
  });
}
