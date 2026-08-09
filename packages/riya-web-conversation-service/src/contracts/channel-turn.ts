/**
 * The channel-neutral inbound Riya turn (RWC-P8, ADR-0104).
 *
 * ### One Riya, two surfaces
 *
 * WEB and WHATSAPP are surfaces, not agents. ADR-0092 settled that a WEB turn is the EXISTING
 * `InboundEnvelope` with an existing field set, and RWC-P8 takes the same position for WhatsApp: the
 * same reducer, the same prompts, the same gateway, the same Core boundary and the SAME continuity
 * row. A second turn type per channel would be the first half of a second Riya.
 *
 * ### Cross-channel continuity comes from the CALLER, never from inference
 *
 * A conversation is continuous across channels when — and only when — the trusted caller supplies the
 * same canonical `(tenantId, conversationId)`. Jarvis does not link a browser session to a WhatsApp
 * number by phone, email, cookie, provider id, `subjectRef`, timing or anything a model read in the
 * text. `subjectRef` is NOT a linking key.
 *
 * That restraint is the whole design. Identity resolution is the QuickFurno handshake's job, it is
 * genuinely hard, and a wrong guess here would attach one person's project to another person's chat.
 * Consuming a canonical identity somebody else is accountable for is the only safe version of this
 * feature.
 *
 * ### What a caller may state, and what it structurally cannot
 *
 * `INTERNAL` is not representable: only CLIENT inbound turns exist here. `partyType`, `direction`,
 * `runtimeId`, an actor, a model, a prompt, a tool, consent, `canSubmit`, a lead, a vendor, a package,
 * a price or an outcome are all absent from the schema, so each is a refusal rather than a value
 * quietly dropped.
 */
import { RUNTIME_DATA_CLASSES } from '@qf-jarvis/agent-runtime';
import type { RuntimeDataClass } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

/** The two surfaces one Riya serves. Closed: a third needs an ADR, not a string. */
export const RIYA_CONVERSATION_CHANNELS = ['WEB', 'WHATSAPP'] as const;

export type RiyaConversationChannel = (typeof RIYA_CONVERSATION_CHANNELS)[number];

/** The same canonical identifier grammar the rest of the Riya stack uses. */
const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/** A canonical UTC instant, matching what the runtime envelope accepts. */
const CANONICAL_INSTANT = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u);

/** One inbound Riya turn on any supported channel, as a trusted private caller supplies it. */
export interface RiyaConversationTurnV1 {
  readonly version: 1;
  readonly channel: RiyaConversationChannel;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly receivedAt: string;
  /**
   * The caller's opaque reference to THIS turn on THIS channel.
   *
   * A web turn reference or a provider message reference — never a URL, cookie, session token, phone
   * number or anything a person would recognise. RWC-P8 never persists it raw: only a non-content
   * digest of `[1, channel, channelTurnRef]` reaches the durable ledger, because a raw provider
   * reference is a correlation handle into somebody else's records.
   */
  readonly channelTurnRef: string;
  /**
   * SERVER-DERIVED classification, supplied by the trusted private caller. Never client input.
   *
   * An adapter must derive or assign this under governed server-side policy and must not forward a
   * browser- or provider-supplied value. This service cannot check that; the adapter must.
   */
  readonly dataClass: RuntimeDataClass;
  readonly subjectRef?: string;
  readonly normalizedText?: string;
}

/**
 * The strict channel-turn schema.
 *
 * `.strict()` is load-bearing rather than tidy: it is what turns "the caller tried to set
 * `partyType`" from a silently dropped field into a refusal somebody can see.
 */
export const riyaConversationTurnSchema = z
  .object({
    version: z.literal(1),
    channel: z.enum(RIYA_CONVERSATION_CHANNELS),
    tenantId: IDENTIFIER,
    conversationId: IDENTIFIER,
    messageId: IDENTIFIER,
    receivedAt: CANONICAL_INSTANT,
    channelTurnRef: z.string().min(1).max(256),
    dataClass: z.enum(RUNTIME_DATA_CLASSES),
    subjectRef: IDENTIFIER.optional(),
    // The same 4096 bound the runtime envelope already enforces. Restated so an oversized message is
    // refused at the service boundary rather than deep inside the runtime.
    normalizedText: z.string().max(4096).optional(),
  })
  .strict();
