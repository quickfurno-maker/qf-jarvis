/**
 * `@qf-jarvis/riya-web-conversation-service` — the PRIVATE Riya web conversation service
 * (RWC-P2C, ADR-0094).
 *
 * ### What it does
 *
 * Accepts one trusted WEB turn and delegates it EXACTLY ONCE to the already-composed authoritative
 * `JarvisRuntime`. It fixes `channel: 'WEB'`, `partyType: 'CLIENT'` and `direction: 'INBOUND'`
 * internally, loads or atomically initializes the RWC-P2A continuity state first, and returns one
 * bounded non-streaming result with that continuity **unchanged**.
 *
 * ### What it is not
 *
 * **Not a public API.** No HTTP server, route, URL, cookie, CORS or browser reachability. The
 * intended caller is a QuickFurno server gateway; that ingress is a separate, later slice, and is
 * deliberately not built here so the service and store semantics can be reviewed before anything is
 * exposed to a network.
 *
 * **Not a second orchestrator.** It composes nothing and duplicates no gate. `humanTakeover`,
 * `aiPaused`, `cancelled`, data class, party type, subject status and the revision double-gate stay
 * the runtime's, reached through the one public entry point it already exposes.
 *
 * **Not RWC-P4.** No extraction, no phase transition, no provenance merge, no summary confirmation,
 * no completion evidence, no `canSubmit`, and no fabricated `ClientSalesSignals` — the runtime's
 * behaviour seam is optional by design, and this slice reuses that supported mode rather than
 * manufacturing an input nobody supplied.
 *
 * **Not a store.** The continuity store is a PORT with no implementation and no default. A
 * deterministic in-memory fake lives under `src/tests/` and is excluded from the emitting build,
 * because an in-memory default would pass every test and lose every conversation on restart.
 *
 * ### Two things a reader should know before consuming the result
 *
 * There is **no reply text**, because the authoritative runtime deliberately exposes none: a turn
 * produces a proposal stamped `PENDING_CORE_VALIDATION`, not a message anybody is cleared to send.
 * And the served disposition is `PROCESSED`, not `RESPONDED`, for the same reason — nothing
 * responded.
 */

export { createRiyaWebConversationService } from './service/create-service.js';
export type {
  RiyaWebConversationService,
  RiyaWebConversationServiceConfig,
} from './service/create-service.js';

export { RIYA_WEB_CONVERSATION_DISPOSITIONS } from './contracts/result.js';
export type {
  RiyaWebConversationDisposition,
  RiyaWebConversationResultV1,
} from './contracts/result.js';

export { RIYA_WEB_CONVERSATION_ERROR_CODES, RiyaWebConversationError } from './contracts/errors.js';
export type { RiyaWebConversationErrorCode } from './contracts/errors.js';

export type { RiyaWebConversationTurnV1 } from './contracts/turn.js';
export type {
  RiyaContinuityCasOutcome,
  RiyaContinuityCreateResult,
  RiyaContinuityStoreKey,
  RiyaContinuityStorePort,
} from './contracts/store-port.js';
