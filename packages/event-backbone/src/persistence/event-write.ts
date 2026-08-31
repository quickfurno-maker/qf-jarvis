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
 * ### Provenance comes from control flow, not from caller data
 *
 * The writer does not accept a record. It accepts an {@link AuthenticatedEventWrite}, a class with a
 * `#private` field and a `private constructor`. TypeScript's structural typing does not apply to a
 * class carrying a `#private` member, so **no object literal can satisfy this type** — not
 * `{ verified: true }`, not `{ trusted: true }`, not `{ source: 'ingestion' }`, not a hand-built
 * record wrapped to look the part. There is no boolean, no string tag and no caller-selectable
 * discriminator anywhere in this capability. The only way to obtain one is
 * {@link AuthenticatedEventWrite.fromVerifiedIngestion}, and the only code permitted to import it is
 * the governed bridge that builds its record from a verified signature's evidence bound to an
 * already contract-validated prepared event.
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
 * An unforgeable capability to append ONE already-authenticated, contract-validated event.
 *
 * The `#record` field is a true private field, which makes this class **nominally** typed: a value
 * of this type cannot be produced by writing an object literal, by spreading, or by any structural
 * look-alike. The constructor is `private` AND guarded by a module-private mint symbol, so it cannot
 * be produced with `new` either — not by a TypeScript caller, and not by a cast or a JavaScript
 * caller, who gets {@link UnmintedEventWriteError} instead. The single mint is
 * {@link fromVerifiedIngestion}, reachable only from the one file lint permits to import this
 * module.
 *
 * The token carries no authority of its own beyond the record it wraps: it is evidence that the
 * governed bridge built this record, not a claim that any particular signature was valid. The
 * verification itself happens upstream, in `@qf-jarvis/event-ingestion`, and cannot be expressed as
 * a type here — this package must never depend on that one.
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
   * Mint the capability for a record the governed ingestion bridge has just built from a verified
   * signature's immutable evidence bound to an already contract-validated prepared event.
   *
   * This is deliberately not a validator: it cannot re-check a signature, because the evidence types
   * live in `@qf-jarvis/event-ingestion` and the dependency direction is one-way. Its guarantee is
   * reachability — only the governed bridge may call it — not cryptography.
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
