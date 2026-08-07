/**
 * `@qf-jarvis/riya-conversation-continuity` — Riya's conversational continuity contract
 * (RWC-P2A, ADR-0093).
 *
 * ### What this package is for
 *
 * One question: *what is the minimum non-authoritative, content-minimised state Jarvis may carry
 * from one Riya turn to the next?* The answer is a tenant+conversation key, an independent
 * revision, a phase, the REUSED `NeedDiscovery`, per-field provenance, a `summaryConfirmed`
 * conversational fact, and an opaque completion-evidence reference.
 *
 * ### The boundaries it holds
 *
 * **Jarvis owns this.** Conversation phase, discovery progress and field provenance are the
 * conversational working state, and they belong to the runtime that produces them — not to a web
 * gateway. It is authoritative for the current workflow and for nothing else.
 *
 * **QuickFurno Core owns business truth.** Consent, opt-out, contact identity, city and service
 * catalogue validity, vendor availability, pricing, lead creation and assignment, and business
 * `canSubmit`. No field here can express any of them, so the boundary is structural rather than
 * remembered.
 *
 * **A later QuickFurno web/server gateway owns only session mechanics** — the opaque browser token,
 * same-origin, CSRF, rate limiting, size limits, per-turn idempotency and the token → routing
 * mapping. It does not own a Riya memory store.
 *
 * ### What it deliberately does not do
 *
 * No phase reducer, no extraction from prose, no provenance merge — RWC-P4 owns all three, and half
 * a reducer here would be finished by whoever needed it next. No database, migration, adapter,
 * HTTP, model call, clock, randomness or environment read. No transcript, history or rolling
 * summary. No channel field: WEB and WhatsApp are the same Riya, and they stay separate by having
 * separate conversation identities until RWC-P8's explicit Core-authorized link.
 *
 * It is also **not ADR-0016 agent memory**: that governs derived, rebuildable, cross-conversation
 * records with non-empty `sourceEventIds`, and none of its literals appear here.
 *
 * ### The public surface is five values
 *
 * The schemas, the precedence ranks, the discovery-field mapping and the validators are internal.
 * Exporting the precedence ranks would be exporting the first half of the merge RWC-P4 owns.
 */

export {
  RIYA_CONVERSATION_PHASES,
  RIYA_FIELD_PROVENANCE_SOURCES,
} from './contracts/vocabularies.js';
export type { RiyaConversationPhase, RiyaFieldProvenance } from './contracts/vocabularies.js';

export { createRiyaConversationContinuityState } from './contracts/continuity-state.js';
export type {
  RiyaContinuityFieldProvenanceMap,
  RiyaConversationContinuityStateInput,
  RiyaConversationContinuityStateV1,
} from './contracts/continuity-state.js';

export {
  RIYA_CONVERSATION_CONTINUITY_ERROR_CODES,
  RiyaConversationContinuityError,
} from './contracts/errors.js';
export type { RiyaConversationContinuityErrorCode } from './contracts/errors.js';
