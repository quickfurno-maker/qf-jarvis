/**
 * `@qf-jarvis/riya-conversation-completion` — Riya's post-summary conversation semantics
 * (RWC-P6, ADR-0101).
 *
 * ### What this package is for
 *
 * RWC-P4A stops at `SUMMARY` and says so in its own note. This is what happens after: the client is
 * shown their answers, changes one or agrees to them, and the conversation walks `SUMMARY → CONTACT →
 * CONSENT → COMPLETE` as governed evidence arrives.
 *
 * ### It is where `user_confirmed` comes from, and the only place
 *
 * P4A can set `summaryConfirmed` false and never true. P4B forbids the model from claiming
 * `user_confirmed`. P5 refuses to upgrade a validated reference to it. All three defer here, because
 * `user_confirmed` means *the client was shown this and agreed it is right* — and only a structured
 * surface that actually showed it can say so. Nothing in this package reads prose.
 *
 * ### Pure by construction
 *
 * No model, no prompt, no clock, no randomness, no database, no compare-and-set, no HTTP, no
 * environment read, no Core call. RWC-P6B owns the composition — the store, the CAS, the Core port,
 * the idempotency — and keeping it out means these semantics can be reviewed on their own and re-run
 * identically during a reconciliation.
 *
 * ### One Riya
 *
 * Nothing here is web- or WhatsApp-specific, and there is no channel field. A future surface reuses
 * these rules rather than growing a second set that agrees until the day one is corrected.
 *
 * ### The boundaries it holds
 *
 * **RWC-P4A remains the only discovery reducer.** Every edit and confirmation builds a canonical P4A
 * observation batch and calls the real reducer; nothing here merges a field, ranks a provenance or
 * decides a phase from discovery.
 *
 * **RWC-P5 authority is mandatory.** A structured edit reaches `serviceInterest` and `location`
 * without a model, so both the asserted reference and the prospective pair are checked against the
 * SAME shared Core policy the model path uses.
 *
 * **Contact and consent stay Core's.** These functions consume opaque evidence as inert values. They
 * hold no phone, email, name, consent wording or consent boolean, and they cannot fetch one — the
 * contact reference is required as proof the caller had a governed answer, then discarded, because
 * continuity has no field for it and must not acquire one.
 *
 * **Completion evidence is Core's word.** `COMPLETE` is reachable only carrying a reference Core
 * issued for an accepted submission.
 */

export {
  RIYA_CONVERSATION_COMPLETION_ERROR_CODES,
  RiyaConversationCompletionError,
} from './contracts/errors.js';
export type { RiyaConversationCompletionErrorCode } from './contracts/errors.js';

export { createRiyaSummaryEditV1 } from './contracts/summary-edit.js';
export type {
  RiyaSummaryEditOperation,
  RiyaSummaryEditV1,
  RiyaSummaryFieldEditV1,
} from './contracts/summary-edit.js';

export { confirmRiyaSummary, evolveRiyaSummaryEdit } from './summary.js';
export type { RiyaSummaryActionResultV1 } from './summary.js';

export { advanceRiyaAfterContactReady, completeRiyaAfterCoreSubmission } from './advance.js';
export type { RiyaCompletionAdvanceResultV1 } from './advance.js';
