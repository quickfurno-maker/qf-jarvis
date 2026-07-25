/**
 * The immutable, content-minimized inbound envelope (QFJ-M1, ADR-0054 §F).
 *
 * A normalized record of an inbound message the runtime may reason about — ids, tenant, channel, party
 * type, direction, a received-at instant, an OPAQUE provider message reference, and a data class. The
 * optional `normalizedText` is bounded and exists ONLY for test-only runtime composition. It carries
 * no provider SDK object, token, webhook secret, or arbitrary metadata (the schema is strict).
 */
import { z } from 'zod';

import { AgentRuntimeError } from './errors.js';
import { isCanonicalInstant } from './instant.js';
import {
  RUNTIME_CHANNELS,
  RUNTIME_DATA_CLASSES,
  RUNTIME_DIRECTIONS,
  RUNTIME_PARTY_TYPES,
} from './vocabularies.js';
import type {
  RuntimeChannel,
  RuntimeDataClass,
  RuntimeDirection,
  RuntimePartyType,
} from './vocabularies.js';

/** One immutable inbound envelope. */
export interface InboundEnvelope {
  readonly runtimeId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly tenantId: string;
  readonly channel: RuntimeChannel;
  readonly partyType: RuntimePartyType;
  readonly direction: RuntimeDirection;
  readonly receivedAt: string;
  readonly providerMessageRef: string;
  readonly dataClass: RuntimeDataClass;
  readonly subjectRef: string | undefined;
  readonly normalizedText: string | undefined;
}

export interface InboundEnvelopeInput {
  readonly runtimeId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly tenantId: string;
  readonly channel: RuntimeChannel;
  readonly partyType: RuntimePartyType;
  readonly direction: RuntimeDirection;
  readonly receivedAt: string;
  readonly providerMessageRef: string;
  readonly dataClass: RuntimeDataClass;
  readonly subjectRef?: string | undefined;
  readonly normalizedText?: string | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const envelopeSchema = z
  .object({
    runtimeId: IDENTIFIER,
    conversationId: IDENTIFIER,
    messageId: IDENTIFIER,
    tenantId: IDENTIFIER,
    channel: z.enum(RUNTIME_CHANNELS),
    partyType: z.enum(RUNTIME_PARTY_TYPES),
    direction: z.enum(RUNTIME_DIRECTIONS),
    receivedAt: z.string().refine(isCanonicalInstant),
    providerMessageRef: z.string().min(1).max(256),
    dataClass: z.enum(RUNTIME_DATA_CLASSES),
    subjectRef: IDENTIFIER.optional(),
    normalizedText: z.string().max(4096).optional(),
  })
  .strict();

/** Validate and deep-freeze an inbound envelope. Throws `AgentRuntimeError('invalid-envelope')`. */
export function createInboundEnvelope(input: InboundEnvelopeInput): InboundEnvelope {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-envelope');
  }
  const e = parsed.data;
  return Object.freeze({
    runtimeId: e.runtimeId,
    conversationId: e.conversationId,
    messageId: e.messageId,
    tenantId: e.tenantId,
    channel: e.channel,
    partyType: e.partyType,
    direction: e.direction,
    receivedAt: e.receivedAt,
    providerMessageRef: e.providerMessageRef,
    dataClass: e.dataClass,
    subjectRef: e.subjectRef,
    normalizedText: e.normalizedText,
  });
}
