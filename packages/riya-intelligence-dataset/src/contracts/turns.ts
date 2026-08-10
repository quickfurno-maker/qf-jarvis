/**
 * The three turn types (RID-F1, ADR-0107 §16–§18).
 *
 * ### The assistant annotation is the actual training signal
 *
 * A reply on its own teaches a sentence. The annotation beside it teaches a STRATEGY: what the
 * assistant decided to do, what it learned from the customer, which authoritative facts it was
 * entitled to lean on, what it was trying to achieve, and where the conversation should be
 * afterwards.
 *
 * That distinction is the whole design. A corpus of `intent → canned reply` produces a model that
 * pattern-matches to phrasing it has seen; a corpus of state, context, decision and objective
 * produces one that can handle a situation it has not.
 *
 * ### No hidden reasoning, anywhere
 *
 * There is no chain-of-thought field, no rationale, no scratchpad, no teacher explanation. Training
 * on a teacher's reasoning trace teaches a model to imitate the SHAPE of reasoning rather than to
 * reach the conclusion, and the traces are unverifiable — nobody reviews them, so a confidently
 * wrong one is indistinguishable from a good one. The decision and the objective are the claim; the
 * reply is the evidence.
 */
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import { createRiyaConversationObservationBatch } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationObservationBatchV1 } from '@qf-jarvis/riya-conversation-evolution';
import { z } from 'zod';

import { RiyaDatasetError } from './errors.js';
import {
  RIYA_DATASET_ASSISTANT_DECISIONS,
  RIYA_DATASET_CONTEXT_AUTHORITIES,
  RIYA_DATASET_DISCOVERY_FIELDS,
  RIYA_DATASET_FACT_CLASSES,
  RIYA_DATASET_RESPONSE_OBJECTIVES,
} from './vocabularies.js';
import type {
  RiyaDatasetAssistantDecision,
  RiyaDatasetContextAuthority,
  RiyaDatasetDiscoveryField,
  RiyaDatasetFactClass,
  RiyaDatasetResponseObjective,
} from './vocabularies.js';

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const TURN_TEXT = z.string().min(1).max(4000);
const FACT_VALUE = z.string().min(1).max(1000);

// ---------------------------------------------------------------------------
// USER.
// ---------------------------------------------------------------------------

export interface RiyaDatasetUserTurnV1 {
  readonly type: 'USER';
  readonly turnRef: string;
  readonly text: string;
}

const userSchema = z.object({ type: z.literal('USER'), turnRef: REF, text: TURN_TEXT }).strict();

/** Validate and freeze a synthetic customer turn. Throws `invalid-turn`. */
export function createRiyaDatasetUserTurn(input: {
  readonly type: 'USER';
  readonly turnRef: string;
  readonly text: string;
}): RiyaDatasetUserTurnV1 {
  const parsed = userSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-turn');
  }
  return Object.freeze({
    type: 'USER' as const,
    turnRef: parsed.data.turnRef,
    text: parsed.data.text,
  });
}

// ---------------------------------------------------------------------------
// AUTHORITATIVE_CONTEXT.
// ---------------------------------------------------------------------------

/** One simulated business fact. Every value is invented; none is a QuickFurno record. */
export interface RiyaDatasetAuthoritativeFactV1 {
  readonly factRef: string;
  readonly value: string;
  readonly factClass: RiyaDatasetFactClass;
}

export interface RiyaDatasetContextTurnV1 {
  readonly type: 'AUTHORITATIVE_CONTEXT';
  readonly turnRef: string;
  readonly authority: RiyaDatasetContextAuthority;
  readonly facts: readonly RiyaDatasetAuthoritativeFactV1[];
}

const contextSchema = z
  .object({
    type: z.literal('AUTHORITATIVE_CONTEXT'),
    turnRef: REF,
    authority: z.enum(RIYA_DATASET_CONTEXT_AUTHORITIES),
    facts: z
      .array(
        z
          .object({ factRef: REF, value: FACT_VALUE, factClass: z.enum(RIYA_DATASET_FACT_CLASSES) })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict();

/**
 * Validate and freeze a simulated authoritative context.
 *
 * This is what "the business told Riya something" looks like in a training example. It exists so the
 * corpus can teach a model to LOOK for authority before asserting a price — without ever putting a
 * real price into the weights, where it would be wrong within a quarter and impossible to correct.
 */
export function createRiyaDatasetAuthoritativeContextTurn(input: {
  readonly type: 'AUTHORITATIVE_CONTEXT';
  readonly turnRef: string;
  readonly authority: RiyaDatasetContextAuthority;
  readonly facts: readonly RiyaDatasetAuthoritativeFactV1[];
}): RiyaDatasetContextTurnV1 {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-turn');
  }
  const refs = parsed.data.facts.map((fact) => fact.factRef);
  if (new Set(refs).size !== refs.length) {
    throw new RiyaDatasetError('invalid-turn');
  }
  return Object.freeze({
    type: 'AUTHORITATIVE_CONTEXT' as const,
    turnRef: parsed.data.turnRef,
    authority: parsed.data.authority,
    facts: Object.freeze(parsed.data.facts.map((fact) => Object.freeze({ ...fact }))),
  });
}

// ---------------------------------------------------------------------------
// ASSISTANT.
// ---------------------------------------------------------------------------

export interface RiyaDatasetAssistantAnnotationV1 {
  readonly decision: RiyaDatasetAssistantDecision;
  /** What this turn learned, re-proved through the canonical RWC-P4A constructor. */
  readonly expectedObservationBatch?: RiyaConversationObservationBatchV1;
  readonly askedDiscoveryFields: readonly RiyaDatasetDiscoveryField[];
  /** Facts from EARLIER authoritative contexts this reply is entitled to assert. */
  readonly supportedFactRefs: readonly string[];
  readonly expectedPhaseAfter?: RiyaConversationPhase;
  readonly responseObjective: RiyaDatasetResponseObjective;
}

export interface RiyaDatasetAssistantTurnV1 {
  readonly type: 'ASSISTANT';
  readonly turnRef: string;
  readonly text: string;
  readonly annotation: RiyaDatasetAssistantAnnotationV1;
}

const annotationSchema = z
  .object({
    decision: z.enum(RIYA_DATASET_ASSISTANT_DECISIONS),
    // Deliberately loose: the CANONICAL constructor below is the authority on this shape, and
    // restating its rules would be a second copy to keep in step with the first.
    expectedObservationBatch: z.unknown().optional(),
    askedDiscoveryFields: z
      .array(z.enum(RIYA_DATASET_DISCOVERY_FIELDS as readonly [string, ...string[]]))
      .max(RIYA_DATASET_DISCOVERY_FIELDS.length),
    supportedFactRefs: z.array(REF).max(32),
    expectedPhaseAfter: z.enum(RIYA_CONVERSATION_PHASES).optional(),
    responseObjective: z.enum(RIYA_DATASET_RESPONSE_OBJECTIVES),
  })
  .strict();

const assistantSchema = z
  .object({
    type: z.literal('ASSISTANT'),
    turnRef: REF,
    text: TURN_TEXT,
    annotation: z.unknown(),
  })
  .strict();

/**
 * Validate and freeze an assistant turn.
 *
 * **At most ONE discovery question per turn**, and none at all on a handoff. Two questions in one
 * message is a form; a question asked while somebody is being handed to a human is a system that did
 * not hear them. Teaching either is teaching a habit that shows up in every conversation afterwards.
 */
export function createRiyaDatasetAssistantTurn(input: {
  readonly type: 'ASSISTANT';
  readonly turnRef: string;
  readonly text: string;
  readonly annotation: RiyaDatasetAssistantAnnotationV1;
}): RiyaDatasetAssistantTurnV1 {
  const outer = assistantSchema.safeParse(input);
  if (!outer.success) {
    throw new RiyaDatasetError('invalid-turn');
  }
  const annotation = annotationSchema.safeParse(input.annotation);
  if (!annotation.success) {
    throw new RiyaDatasetError('invalid-turn');
  }
  const asked = input.annotation.askedDiscoveryFields;
  if (new Set(asked).size !== asked.length) {
    throw new RiyaDatasetError('invalid-turn');
  }
  const isHandoff = input.annotation.decision === 'HANDOFF_HUMAN';
  if (asked.length > (isHandoff ? 0 : 1)) {
    throw new RiyaDatasetError('invalid-turn');
  }
  const supported = input.annotation.supportedFactRefs;
  if (new Set(supported).size !== supported.length) {
    throw new RiyaDatasetError('invalid-turn');
  }

  // THE re-proof, and the WHOLE value goes through: a batch this package accepted but the runtime's
  // own constructor would refuse is a training target the runtime can never produce.
  let batch: RiyaConversationObservationBatchV1 | undefined;
  if (input.annotation.expectedObservationBatch !== undefined) {
    try {
      batch = createRiyaConversationObservationBatch(input.annotation.expectedObservationBatch);
    } catch {
      // The canonical error belongs to another package's vocabulary, and it can quote a value.
      throw new RiyaDatasetError('invalid-turn');
    }
  }

  return Object.freeze({
    type: 'ASSISTANT' as const,
    turnRef: outer.data.turnRef,
    text: outer.data.text,
    annotation: Object.freeze({
      decision: input.annotation.decision,
      ...(batch === undefined ? {} : { expectedObservationBatch: batch }),
      askedDiscoveryFields: Object.freeze([...asked].sort()),
      supportedFactRefs: Object.freeze([...supported].sort()),
      ...(input.annotation.expectedPhaseAfter === undefined
        ? {}
        : { expectedPhaseAfter: input.annotation.expectedPhaseAfter }),
      responseObjective: input.annotation.responseObjective,
    }),
  });
}

export type RiyaDatasetTurnV1 =
  RiyaDatasetUserTurnV1 | RiyaDatasetContextTurnV1 | RiyaDatasetAssistantTurnV1;
