/**
 * The conversation state a training example starts from (RID-F1, ADR-0107 §15).
 *
 * ### This is training CONTEXT, not a runtime state
 *
 * It deliberately does not reimplement `RiyaConversationContinuityStateV1`. It carries what a model
 * needs in order to choose the right next move — where the conversation has reached, what is already
 * known, and how strongly each thing is known — and nothing that identifies a conversation.
 *
 * No tenant, conversation or message id. No phone, email or contact detail. No completion evidence
 * ref, no idempotency key, no provider or runtime ref, no revision counter. Those exist so a live
 * system can find and reconcile a specific person's conversation; a training corpus that carried
 * them would be a directory of people, and none of them help a model decide what to say.
 *
 * ### Provenance is here on purpose
 *
 * Knowing the budget is one thing; knowing whether the customer STATED it, was shown it and
 * CONFIRMED it, or whether Riya merely INFERRED it, is what decides whether the next reply may treat
 * it as settled. A model trained without provenance learns to read its own guesses back to people as
 * though they had said them, which is the specific failure the continuity contract was built to
 * prevent.
 */
import {
  RIYA_CONVERSATION_PHASES,
  RIYA_FIELD_PROVENANCE_SOURCES,
} from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationPhase,
  RiyaFieldProvenance,
} from '@qf-jarvis/riya-conversation-continuity';
import { z } from 'zod';

import { RiyaDatasetError } from './errors.js';
import { RIYA_DATASET_DISCOVERY_FIELDS } from './vocabularies.js';
import type { RiyaDatasetDiscoveryField } from './vocabularies.js';

export interface RiyaTrainingStateV1 {
  readonly phase: RiyaConversationPhase;
  /** What is known, field by field. An absent field is genuinely unknown. */
  readonly discovery: Readonly<Partial<Record<RiyaDatasetDiscoveryField, string>>>;
  /** How strongly each KNOWN field is known. Exactly the same key set as `discovery`. */
  readonly fieldProvenance: Readonly<
    Partial<Record<RiyaDatasetDiscoveryField, RiyaFieldProvenance>>
  >;
  readonly summaryConfirmed: boolean;
}

export interface RiyaTrainingStateInput {
  readonly phase: RiyaConversationPhase;
  readonly discovery: Partial<Record<RiyaDatasetDiscoveryField, string>>;
  readonly fieldProvenance: Partial<Record<RiyaDatasetDiscoveryField, RiyaFieldProvenance>>;
  readonly summaryConfirmed: boolean;
}

const stateSchema = z
  .object({
    phase: z.enum(RIYA_CONVERSATION_PHASES),
    // Validated key by key below: a zod enum record is exhaustive, which would force every state to
    // list all seven fields and make "unknown" unrepresentable.
    discovery: z.record(z.string(), z.unknown()),
    fieldProvenance: z.record(z.string(), z.unknown()),
    summaryConfirmed: z.boolean(),
  })
  .strict();

const FIELD_VALUE = z.string().min(1).max(2048);

/** Validate and freeze one training state. Throws `invalid-trajectory`. */
export function createRiyaTrainingState(input: RiyaTrainingStateInput): RiyaTrainingStateV1 {
  if (!stateSchema.safeParse(input).success) {
    throw new RiyaDatasetError('invalid-trajectory');
  }
  const known = new Set<string>(RIYA_DATASET_DISCOVERY_FIELDS);
  const discovery: Partial<Record<RiyaDatasetDiscoveryField, string>> = {};
  const provenance: Partial<Record<RiyaDatasetDiscoveryField, RiyaFieldProvenance>> = {};

  for (const key of Object.keys(input.discovery)) {
    if (!known.has(key)) {
      throw new RiyaDatasetError('invalid-trajectory');
    }
  }
  for (const key of Object.keys(input.fieldProvenance)) {
    if (!known.has(key)) {
      throw new RiyaDatasetError('invalid-trajectory');
    }
  }

  for (const field of RIYA_DATASET_DISCOVERY_FIELDS) {
    const value = input.discovery[field];
    const source = input.fieldProvenance[field];
    // A value with no provenance is a fact of unknown strength, and an provenance with no value is a
    // strength attached to nothing. Either would teach the model to read the pair inconsistently.
    if ((value === undefined) !== (source === undefined)) {
      throw new RiyaDatasetError('invalid-trajectory');
    }
    if (value === undefined || source === undefined) {
      continue;
    }
    if (!FIELD_VALUE.safeParse(value).success) {
      throw new RiyaDatasetError('invalid-trajectory');
    }
    if (!(RIYA_FIELD_PROVENANCE_SOURCES as readonly string[]).includes(source)) {
      throw new RiyaDatasetError('invalid-trajectory');
    }
    discovery[field] = value;
    provenance[field] = source;
  }

  return Object.freeze({
    phase: input.phase,
    discovery: Object.freeze(discovery),
    fieldProvenance: Object.freeze(provenance),
    summaryConfirmed: input.summaryConfirmed,
  });
}
