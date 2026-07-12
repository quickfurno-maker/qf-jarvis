/**
 * The eighteen authoritative communication states.
 *
 * Taken **verbatim** from docs/architecture/communication-model.md, which is
 * authoritative. Not renamed, not merged, not extended. Eighteen, in order.
 *
 * ### Why collapsing any of these is a defect, not a simplification
 *
 * `execution submitted` is not `provider accepted`, and `provider accepted` is not
 * `delivered`. A UI that shows one green tick for all three tells a founder a
 * message arrived when it may not have — "a false statement about the world, which
 * is exactly what this architecture exists to prevent."
 *
 * The concrete failure: the founder clicks **Call vendor**, the interface shows a
 * confident tick, and Core actually refused because the vendor is on
 * do-not-contact. The founder now believes a conversation happened. Nothing did,
 * and every subsequent decision rests on a fiction the interface invented.
 *
 * ### The states Jarvis may never originate
 *
 * `authorized`, `delivered`, and `completed` are not Jarvis's to write.
 * Authorization comes from Core. Delivery comes from the provider, is reported
 * through n8n, and Core records it. Jarvis *reflects* all three; it originates
 * none of them.
 *
 * ### Opt-out is not a state
 *
 * There is deliberately no `opted-out` state, and adding one would be a mistake.
 * An opt-out is a **reason Core refused**, so it is represented as `rejected` plus
 * a machine-readable reason code (see `COMMUNICATION_REJECTION_REASONS`). Inventing
 * a nineteenth state would fork the lifecycle and let a consumer handle "rejected"
 * while quietly ignoring "opted out" — which is the one refusal that must never be
 * ignored.
 */

import { z } from 'zod';

/** The eighteen states, in the order the authoritative document lists them. */
export const COMMUNICATION_STATES = [
  'draft',
  'authorization-requested',
  'rejected',
  'authorized',
  'scheduled',
  'execution-submitted',
  'provider-accepted',
  'delivered',
  'read',
  'answered',
  'no-answer',
  'busy',
  'failed',
  'follow-up-requested',
  'human-handoff-required',
  'completed',
  'cancelled',
  'expired',
] as const;

export const COMMUNICATION_STATE_COUNT = 18;

export const communicationStateSchema = z.enum(COMMUNICATION_STATES);
export type CommunicationState = z.infer<typeof communicationStateSchema>;

/** Stable machine values above; human labels here. Never derive one from the other. */
export const COMMUNICATION_STATE_LABELS: Readonly<Record<CommunicationState, string>> = {
  draft: 'Draft',
  'authorization-requested': 'Authorization requested',
  rejected: 'Rejected',
  authorized: 'Authorized',
  scheduled: 'Scheduled',
  'execution-submitted': 'Execution submitted',
  'provider-accepted': 'Provider accepted',
  delivered: 'Delivered',
  read: 'Read',
  answered: 'Answered',
  'no-answer': 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  'follow-up-requested': 'Follow-up requested',
  'human-handoff-required': 'Human handoff required',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/**
 * States Jarvis reflects but must never originate.
 *
 * Exported so that a future coordination layer can assert this rather than
 * remember it.
 */
export const STATES_JARVIS_MAY_NOT_ORIGINATE: readonly CommunicationState[] = [
  'authorized',
  'delivered',
  'completed',
];

/**
 * Well-known reasons Core refuses a communication.
 *
 * **Not a closed enum**, and not enforced as one: Core owns the refusal taxonomy,
 * and Phase 2 has not integrated with Core. These are the mandatory controls named
 * in communication-model.md — the ones Core "must refuse or block" on, from any
 * originator, "including the founder". They are published here so that consumers
 * agree on the codes for the refusals that matter most, without pretending we have
 * enumerated Core's list.
 */
export const COMMUNICATION_REJECTION_REASONS = {
  consentWithdrawn: 'consent-withdrawn',
  optedOut: 'recipient-opted-out',
  doNotContact: 'do-not-contact',
  unverifiedIdentity: 'unverified-recipient-identity',
  quietHours: 'prohibited-quiet-hours',
  intentExpired: 'intent-expired',
  attemptLimitReached: 'attempt-limit-reached',
  securityConcern: 'security-concern',
  policyRestriction: 'legal-or-policy-restriction',
} as const;
