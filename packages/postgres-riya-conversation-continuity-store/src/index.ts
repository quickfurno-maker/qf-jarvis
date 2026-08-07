/**
 * `@qf-jarvis/postgres-riya-conversation-continuity-store` — durable Riya conversational continuity
 * (RWC-P2B, ADR-0095).
 *
 * ### What this is
 *
 * The PostgreSQL implementation of `RiyaContinuityStorePort`, the interface RWC-P2C (ADR-0094)
 * declared REQUIRED and injected with deliberately NO default. Neither available default was safe:
 * an in-memory store passes every test and loses every conversation on restart, and a permissive one
 * turns "unknown" into "this conversation is new".
 *
 * One row per `(tenantId, conversationId)`. An atomic create-if-absent arbitrated by the primary key,
 * where the LOSER returns the committed winner's state rather than its own equivalent candidate. An
 * optimistic compare-and-set whose predicate is the concurrency control, answering exactly the
 * port's three outcomes.
 *
 * Every state is re-proved through `createRiyaConversationContinuityState` on the way in AND on the
 * way out, so "every durable row passed the RWC-P2A contract" is a property this package holds
 * rather than one it assumes. A row that cannot pass becomes a refusal — never a default, a repair,
 * a partial result or a delete.
 *
 * ### What this is not
 *
 * It is **not composed into anything**. Nothing in this repository imports it, there is no HTTP
 * route, no endpoint, no ingress, no browser reachability, no session, no cookie, no CSRF, no rate
 * limiter, no CORS and no streaming. RWC-P2C still requires an injected store; a later slice will
 * inject this one, and that slice is where composition gets reviewed.
 *
 * It is **not a decision engine**. There is no phase transition, no extraction from prose and no
 * provenance merge — RWC-P4 owns all three. The SQL CHECK constraints validate evidence; the
 * canonical constructor remains the only thing that decides whether a state is legitimate.
 *
 * It stores **no transcript** and **no business truth**: no message history, rolling summary,
 * context window, channel, user id, phone, email, name, browser or session token, provider message
 * id, credential, consent, opt-out, `canSubmit`, lead, vendor, city authority, price or package.
 *
 * There is **no retention policy**, no TTL, sweeper, cleanup or archive, and the runtime role is
 * granted neither DELETE nor TRUNCATE. Privacy and retention are not RWC-P2B's decision, and a
 * package that quietly implemented one would be making it.
 *
 * ### The public surface is small on purpose
 *
 * Three runtime values. The SQL, the table name, the row canonicalizer, the key validator, the error
 * classifier, the pool and the integration harness are all deliberately NOT exported: each is either
 * an internal detail whose misuse would weaken the boundary, or a test-only artefact that must never
 * reach a caller. There is no `delete`, `clear`, `prune`, `reset`, `list`, `count` or `all` — because
 * none of them would be safe, and the port declares none of them.
 */

export { createPostgresRiyaConversationContinuityStore } from './adapter/create-store.js';

export {
  POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES,
  PostgresRiyaContinuityStoreError,
} from './contracts/errors.js';
export type { PostgresRiyaContinuityStoreErrorCode } from './contracts/errors.js';

export type {
  PostgresRiyaContinuityStore,
  PostgresRiyaContinuityStoreConfig,
} from './contracts/api.js';
