/**
 * `@qf-jarvis/riya-conversation-evolution` — Riya's conversation evolution semantics
 * (RWC-P4A, ADR-0098).
 *
 * ### What this package is for
 *
 * One question: *given what Riya already carries and what this turn learned, what does the
 * conversation now know, where has it reached, and what should it ask next?*
 *
 * It is the reducer `riya-conversation-continuity` deliberately refused to contain. That package
 * records the state contract and the precedence order and says, in its own note, that acting on
 * them is a merge belonging to RWC-P4. This is RWC-P4.
 *
 * ### One Riya
 *
 * Nothing here is web- or WhatsApp-specific, and there is no channel field. The same rules must
 * produce the same conversation on every surface, so they live in a leaf package both can depend on
 * rather than inside a service that speaks HTTP.
 *
 * ### Pure by construction
 *
 * No model, no prompt, no natural-language parsing, no clock, no randomness, no database, no
 * compare-and-set, no HTTP, no environment read. RWC-P4B owns live extraction from one structured
 * model result and the persistence composition; keeping those out means the semantics can be
 * reviewed on their own, and re-run identically during a compare-and-set reconciliation.
 *
 * ### Boundaries it holds
 *
 * **The ceiling is `SUMMARY`.** `CONTACT`, `CONSENT` and `COMPLETE` belong to RWC-P6; a state
 * already in one is refused rather than reinterpreted. **Location is opaque** — whether a
 * `locationRef` names a served city is RWC-P5's question, and nothing here validates, resolves or
 * looks one up. **`ClientSalesSignals` are never fabricated**: they remain an external validated
 * input, and discovery evolution is a separate concern. **QuickFurno Core remains business
 * authority** — no consent, `canSubmit`, lead, vendor, package, price or payment field exists here
 * to express otherwise.
 *
 * No transcript, history, rolling summary, evidence quote or span, raw client text, confidence,
 * reasoning or `messageId`.
 *
 * ### The public surface is five values
 *
 * The rank map, the field mapping, the phase tables, the merge and the schemas are internal.
 * Exporting the ranks would be exporting half a reducer; exporting the phase table would invite a
 * second one beside it.
 */

export {
  RIYA_CONVERSATION_EVOLUTION_ERROR_CODES,
  RiyaConversationEvolutionError,
} from './contracts/errors.js';
export type { RiyaConversationEvolutionErrorCode } from './contracts/errors.js';

export {
  RIYA_DISCOVERY_OBSERVATION_OPERATIONS,
  createRiyaConversationObservationBatch,
} from './contracts/observation.js';
export type {
  RiyaConversationObservationBatchV1,
  RiyaDiscoveryObservationOperation,
  RiyaDiscoveryObservationV1,
} from './contracts/observation.js';

export { evolveRiyaConversation } from './evolve.js';
export type {
  RiyaConversationEvolutionResultV1,
  RiyaNextQuestionPlanV1,
  RiyaObservationRejectionReason,
} from './evolve.js';
