/**
 * Governed communication channels.
 *
 * **Naming a channel is not implementing one.** There is no WhatsApp client here,
 * no SMS gateway, no SMTP, and no telephony or SIP connection — and there never
 * will be in this repository. Jarvis holds no provider credential and has no
 * transport (system-boundary.md).
 *
 * These are the channels a *governed request* may name. The transport chain sits
 * entirely on the far side of the boundary:
 *
 *   n8n → QF Communications Runtime → WhatsApp adapter or QF Voice Runtime
 *       → external provider → recipient
 *
 * ### Why there is no `web` here, and never will be (JRW-0B, ADR-0092)
 *
 * `@qf-jarvis/agent-runtime` gained a `WEB` RUNTIME channel so an inbound envelope can say where a
 * turn arrived from. That is a different question from this one, and the two vocabularies must not
 * converge.
 *
 * Every member below is somewhere a provider can DELIVER TO. A browser is not: nobody can push an
 * outbound message to a closed tab. A `web` member here would let a `CommunicationRequestV1` request
 * delivery through a chain that does not exist, and would pull a web turn into the eighteen-state
 * lifecycle's `provider-accepted` and `delivered` states — states that could then only be asserted
 * by inventing them, which is exactly the false statement about the world this architecture exists
 * to prevent.
 *
 * A spec asserts the refusal rather than trusting this paragraph.
 *
 * See docs/architecture/communication-model.md, which is authoritative.
 */

import { z } from 'zod';

export const COMMUNICATION_CHANNELS = ['whatsapp', 'sms', 'email', 'voice'] as const;

export const communicationChannelSchema = z.enum(COMMUNICATION_CHANNELS);
export type CommunicationChannel = z.infer<typeof communicationChannelSchema>;

export const COMMUNICATION_CHANNEL_LABELS: Readonly<Record<CommunicationChannel, string>> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  voice: 'Voice',
};

/**
 * Voice is not just another channel.
 *
 * It is synchronous, intrusive, harder to template, and impossible to retract. It
 * carries a higher risk class and, in production, an explicit human approval on
 * every call (execution-governance.md §9). It is exposed here as a value a
 * contract may carry; it is not enabled by being nameable.
 */
export const VOICE_CHANNEL: CommunicationChannel = 'voice';
