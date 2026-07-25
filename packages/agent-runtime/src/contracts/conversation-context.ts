/**
 * The immutable conversation context (QFJ-M1, ADR-0054 §D, §I).
 *
 * The safe, content-free state the runtime reasons over for one conversation: identity, tenant, party
 * type, current state, human-takeover / AI-pause flags, data class, and an optional exact subject
 * reference. It holds NO message text and no persistence — QuickFurno Core owns the authoritative
 * conversation record.
 */
import { z } from 'zod';

import { AgentRuntimeError } from './errors.js';
import { CONVERSATION_STATES, RUNTIME_DATA_CLASSES, RUNTIME_PARTY_TYPES } from './vocabularies.js';
import type { ConversationState, RuntimeDataClass, RuntimePartyType } from './vocabularies.js';

/** One immutable, content-free conversation context. */
export interface ConversationContext {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly partyType: RuntimePartyType;
  readonly state: ConversationState;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly dataClass: RuntimeDataClass;
  readonly subjectRef: string | undefined;
}

export interface ConversationContextInput {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly partyType: RuntimePartyType;
  readonly state: ConversationState;
  readonly dataClass: RuntimeDataClass;
  readonly humanTakeover?: boolean;
  readonly aiPaused?: boolean;
  readonly subjectRef?: string | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const contextSchema = z
  .object({
    conversationId: IDENTIFIER,
    tenantId: IDENTIFIER,
    partyType: z.enum(RUNTIME_PARTY_TYPES),
    state: z.enum(CONVERSATION_STATES),
    dataClass: z.enum(RUNTIME_DATA_CLASSES),
    humanTakeover: z.boolean().default(false),
    aiPaused: z.boolean().default(false),
    subjectRef: IDENTIFIER.optional(),
  })
  .strict();

/** Validate and freeze a conversation context. Throws `AgentRuntimeError('invalid-context')`. */
export function createConversationContext(input: ConversationContextInput): ConversationContext {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-context');
  }
  const c = parsed.data;
  return Object.freeze({
    conversationId: c.conversationId,
    tenantId: c.tenantId,
    partyType: c.partyType,
    state: c.state,
    humanTakeover: c.humanTakeover,
    aiPaused: c.aiPaused,
    dataClass: c.dataClass,
    subjectRef: c.subjectRef,
  });
}
