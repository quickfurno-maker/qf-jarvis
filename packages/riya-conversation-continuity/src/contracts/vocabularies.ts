/**
 * The closed vocabularies of Riya's conversational continuity (RWC-P2A, ADR-0093).
 *
 * Two sets, both frozen by RWC-P0B, both restated here verbatim rather than re-derived. Neither is
 * open-ended, and neither carries a channel: WEB and WhatsApp are the same Riya, so a phase or a
 * provenance source that existed on one surface and not the other would be a second Riya wearing a
 * shared name.
 */

/**
 * The nine conversation phases, in the order RWC-P0B froze them.
 *
 * This is the CONVERSATIONAL workflow Riya is in — not a UI step, not a business state and not an
 * authority. `CONTACT`, `CONSENT` and `COMPLETE` are labels for where the conversation has reached;
 * they record nothing about whether contact details were captured, whether consent was given, or
 * whether a lead exists. Those are QuickFurno Core's, and this package holds no field that could
 * express them.
 *
 * Deliberately absent: `PREFERENCES`, `CONFIRM`, `MATCH`, `PROJECT`, `DETAILS`, `DISCOVERY`,
 * `QUALIFICATION`, `FOLLOW_UP`, and anything `WEB_`- or `WHATSAPP_`-prefixed. "Project / Details /
 * Match" is UI vocabulary and belongs to the surface, not to the governed conversation.
 */
export const RIYA_CONVERSATION_PHASES = [
  'INTRO',
  'NEED',
  'LOCATION',
  'PROJECT_DETAILS',
  'BUDGET_TIMELINE',
  'SUMMARY',
  'CONTACT',
  'CONSENT',
  'COMPLETE',
] as const;

export type RiyaConversationPhase = (typeof RIYA_CONVERSATION_PHASES)[number];

/**
 * Where a discovery field's current value came from.
 *
 * The distinction that matters is between what the SYSTEM decided and what the PERSON said. A value
 * Riya inferred from prose and a value the client typed are not equally trustworthy, and a
 * conversation that cannot tell them apart will eventually read an inference back to the client as
 * though they had said it.
 *
 * - `model_inferred` — Riya derived it from what was said. The weakest claim.
 * - `server_runtime` — a governed server-side default or entry context supplied it.
 * - `user_selected` — the client chose it from options the surface offered.
 * - `user_stated` — the client said it in their own words.
 * - `user_confirmed` — the client was shown it and agreed it is right. The strongest claim.
 *
 * `user_selected` and `user_stated` rank EQUALLY: choosing a chip and typing the same thing are the
 * same act of telling us, and ranking one above the other would mean a surface affordance changed
 * how much a client's own words counted.
 */
export const RIYA_FIELD_PROVENANCE_SOURCES = [
  'model_inferred',
  'server_runtime',
  'user_selected',
  'user_stated',
  'user_confirmed',
] as const;

export type RiyaFieldProvenance = (typeof RIYA_FIELD_PROVENANCE_SOURCES)[number];

/**
 * Phases in which the client has NOT yet been shown a summary to agree with.
 *
 * Internal. Used only to enforce the `summaryConfirmed` invariant in the constructor; it decides no
 * transition and orders nothing.
 */
export const PHASES_BEFORE_SUMMARY: readonly RiyaConversationPhase[] = Object.freeze([
  'INTRO',
  'NEED',
  'LOCATION',
  'PROJECT_DETAILS',
  'BUDGET_TIMELINE',
]);

/**
 * Phases that can only have been reached after the client agreed the summary was right.
 *
 * Internal, for the same reason as above.
 */
export const PHASES_AFTER_SUMMARY: readonly RiyaConversationPhase[] = Object.freeze([
  'CONTACT',
  'CONSENT',
  'COMPLETE',
]);
