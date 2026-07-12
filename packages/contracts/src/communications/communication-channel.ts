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
