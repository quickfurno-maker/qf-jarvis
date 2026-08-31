/**
 * The governed accepted-event write capability (D2a, ADR-0138).
 *
 * ### Why this module exists
 *
 * {@link storeValidatedEvent} is a trusted low-level primitive that verifies nothing: it takes a
 * plain {@link EventPersistenceRecord} and inserts it. Before D2a that primitive was exported from
 * this package's ROOT barrel, so any package in the repository could import it, hand-build a record,
 * and put a row into `qf_jarvis.event` that had never passed signature verification. A row's
 * existence therefore proved reachability and shape — never origin — and `eventId` is a name any
 * caller can type, not a credential.
 *
 * D2a closes that. The root barrel no longer carries the writer or its record type; the only way to
 * reach an accepted-event INSERT from outside this package is this module, published on the narrow
 * `@qf-jarvis/event-backbone/internal/event-write` subpath and restricted by lint to exactly one
 * governed file — the ingestion bridge in `@qf-jarvis/event-ingestion`.
 *
 * ### What the wrapper does, and what it does NOT do
 *
 * The writer does not accept a record. It accepts an {@link AuthenticatedEventWrite}, a class with a
 * `#private` field and a `private constructor`. TypeScript's structural typing does not apply to a
 * class carrying a `#private` member, so **no object literal can satisfy this type** — not
 * `{ verified: true }`, not `{ trusted: true }`, not `{ source: 'ingestion' }`, not a hand-built
 * record wrapped to look the part. There is no boolean, no string tag and no caller-selectable
 * discriminator anywhere in this capability.
 *
 * **That is nominal-substitution protection, and it is not the same thing as authentication.** Be
 * precise about it: {@link AuthenticatedEventWrite.fromVerifiedIngestion} is a public static factory
 * over a plain {@link EventPersistenceRecord}, so **any code permitted to import this module could
 * mint one from a hand-built record.** The class cannot prevent that, and cannot check a signature
 * either — the evidence types live in `@qf-jarvis/event-ingestion` and the dependency direction is
 * one-way. Calling this class "unforgeable" on its own would be an overclaim.
 *
 * The actual security boundary is therefore four things together, three of which live outside this
 * file:
 *
 * 1. **tested one-file import containment** — exactly one production file may import this module;
 * 2. **tested one-call-site containment** — exactly one production call to the mint exists;
 * 3. **the governed bridge's evidence binding** — it builds the record only from a verified
 *    signature's immutable evidence bound to an already contract-validated prepared event, and
 *    throws before minting if the two do not describe the same body;
 * 4. **this wrapper**, which stops accidental or careless structural substitution reaching the INSERT.
 *
 * ### What this does NOT claim
 *
 * This is repository/application-path provenance hardening. It does not make Core events live, does
 * not prove QuickFurno Core emitted anything, and does not replace Core's signatures. It also makes
 * no claim about actors outside this repository: whatever the database grants permit, a DBA or any
 * other credential holder can still write the table directly. See ADR-0138 for the exact claim and
 * its limits.
 */

import {
  storeValidatedEvent,
  type EventPersistenceOutcome,
  type EventPersistenceRecord,
} from './event-store.js';
import type { DatabasePool } from './pool.js';

/**
 * The module-private mint token. It is never exported, never returned, and appears in no type, so no
 * importer of this module can obtain one. It is the runtime half of the construction guard.
 */
const MINT = Symbol('qf-jarvis.accepted-event-write.mint');

/**
 * Someone tried to construct the write capability without the module-private mint — a cast, a
 * JavaScript caller, or a forged look-alike. It carries no record, no digest and no payload.
 */
export class UnmintedEventWriteError extends Error {
  constructor() {
    super('An AuthenticatedEventWrite can only be minted by the governed ingestion path.');
    this.name = 'UnmintedEventWriteError';
  }
}

/**
 * A **nominal, construction-guarded wrapper** around one persistence-ready record.
 *
 * The `#record` field is a true private field, which makes this class **nominally** typed: a value
 * of this type cannot be produced by writing an object literal, by spreading, or by any structural
 * look-alike. The constructor is `private` AND guarded by a module-private mint symbol, so it cannot
 * be produced with `new` either — not by a TypeScript caller, and not by a cast or a JavaScript
 * caller, who gets {@link UnmintedEventWriteError} instead.
 *
 * **It is not independent authentication evidence.** Holding one proves that *some* code called
 * {@link fromVerifiedIngestion} — not that a signature was verified. The mint accepts a plain
 * record, so the guarantee that only *verified* records are minted comes from **who may call it**
 * (one production file, enforced by lint and by a repository-wide scan) and from **what that caller
 * does** (the bridge's evidence binding), never from this type alone.
 */
export class AuthenticatedEventWrite {
  readonly #record: EventPersistenceRecord;

  /**
   * `private` stops TypeScript callers; the mint check stops everyone else. A `private constructor`
   * is erased at runtime, so a JavaScript caller — or a TypeScript one who reaches for a cast — could
   * otherwise still `new` this class into existence. {@link MINT} is a module-private symbol that no
   * importer can obtain, so the only construction that survives is the one below.
   */
  private constructor(mint: symbol, record: EventPersistenceRecord) {
    if (mint !== MINT) throw new UnmintedEventWriteError();
    this.#record = record;
  }

  /**
   * Mint the wrapper for a record the governed ingestion bridge has just built from a verified
   * signature's immutable evidence bound to an already contract-validated prepared event.
   *
   * **This is deliberately not a validator, and it verifies nothing about the record it is given.**
   * It cannot re-check a signature: the evidence types live in `@qf-jarvis/event-ingestion` and the
   * dependency direction is one-way. Its guarantee is **reachability, not cryptography** — exactly
   * one production call site is permitted to reach it, and that is asserted by test, not by trust.
   */
  static fromVerifiedIngestion(record: EventPersistenceRecord): AuthenticatedEventWrite {
    return new AuthenticatedEventWrite(MINT, record);
  }

  /** The wrapped persistence-ready record. Reading it confers nothing; writing requires the token. */
  get record(): EventPersistenceRecord {
    return this.#record;
  }
}

/**
 * Persist an authenticated event atomically and idempotently.
 *
 * This is the ONLY accepted-event write reachable from outside `@qf-jarvis/event-backbone`. It adds
 * no behaviour of its own: it unwraps the capability and delegates to {@link storeValidatedEvent}, so
 * the outcome classification, the single-transaction conflict recording, the enforced READ COMMITTED
 * isolation and the exact `eventId` idempotency semantics are unchanged by D2a.
 */
export async function storeAuthenticatedEvent(
  pool: DatabasePool,
  write: AuthenticatedEventWrite,
): Promise<EventPersistenceOutcome> {
  return storeValidatedEvent(pool, write.record);
}

export type { EventPersistenceOutcome, EventPersistenceRecord };
