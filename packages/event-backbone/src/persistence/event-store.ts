/**
 * Atomic, idempotent persistence of an already-authenticated, contract-validated event.
 *
 * **This is the whole of Stage 3.3 slice 3.** It is the one place a validated event becomes a
 * durable row, and it is where eventId idempotency stops being a constraint the schema *offers*
 * (migration `0001`) and becomes behaviour the application *relies on* (ADR-0020 §8).
 *
 * ### This is a TRUSTED low-level primitive. It verifies nothing.
 *
 * `storeValidatedEvent` does **no** signature verification, **no** contract parsing, and **no** JSON
 * parsing. It accepts a plain {@link EventPersistenceRecord} whose fields are already the columns of
 * `qf_jarvis.event`, and it trusts that record completely.
 *
 * **That trust is a caller obligation, not a structural guarantee this package can enforce.** This
 * is `@qf-jarvis/event-backbone`, the persistence layer; nothing here — no type, no package
 * boundary — prevents a caller from hand-building a record and storing an unauthenticated event. A
 * `Buffer` typed as `signature` is not proof that any signature was ever verified. So this file does
 * not claim raw or unverified data is *impossible* here; it states plainly that **authentication and
 * contract validation are the responsibility of the caller**.
 *
 * Today the only caller is the INTERNAL bridge in `@qf-jarvis/event-ingestion`
 * (`buildEventPersistenceRecord` → `persistPreparedEvent`), which builds a record only from a
 * verified signature's immutable evidence and an already contract-validated, deeply-frozen prepared
 * event. When the future public `ingest` composition is built, **it** — not this primitive — owns
 * the verify → parse → prepare pipeline that must run before a record ever reaches here. The
 * dependency direction is one-way (`event-ingestion` → `event-backbone`); this package must never
 * depend on `event-ingestion`, so the boundary is upheld by that discipline and this documentation,
 * not by a claim of impossibility.
 *
 * ### The three outcomes (ADR-0020 §8)
 *
 * - **First delivery of an eventId** inserts exactly one row → `stored`.
 * - **Same eventId, same `semantic_event_digest`** → `duplicate`. Nothing is written; the
 *   original row stands, unmodified.
 * - **Same eventId, a *different* `semantic_event_digest`** → a {@link ConflictingEventDigestError}.
 *   It **fails closed**: the original is never overwritten, updated, replaced, or mutated.
 *
 * ### Race-safe by construction
 *
 * The insert uses `INSERT ... ON CONFLICT ON CONSTRAINT event_event_id_unique DO NOTHING
 * RETURNING`. When two clients deliver the same eventId at once, exactly one INSERT wins; the
 * other's INSERT does nothing. The classification then reads the committed row in a **separate
 * statement**, which under `READ COMMITTED` takes a fresh snapshot *after* the winning INSERT has
 * committed — so the loser sees the winner's row and compares digests correctly. That behaviour is
 * **not left to the session default**: the transaction sets `ISOLATION LEVEL READ COMMITTED`
 * explicitly as its first statement, so an ambient `default_transaction_isolation` of REPEATABLE
 * READ or SERIALIZABLE cannot make the classifying SELECT reuse a stale first snapshot. `ON CONFLICT
 * DO UPDATE` is impossible here on purpose: the append-only trigger refuses every UPDATE, so there
 * is no no-op-update trick to reach for, and there is no UPDATE or DELETE path in this file at all.
 *
 * Everything is **fully qualified** (`qf_jarvis.event`) and **parameterized**. Nothing depends on
 * `search_path`.
 */

import type { DatabasePool } from './pool.js';
import { withTransaction } from './transaction.js';

/**
 * A persistence-ready event: exactly the columns of `qf_jarvis.event`, already derived upstream
 * from a verified, prepared canonical event. The digests and signature are raw bytes (`BYTEA`);
 * the timestamps are ISO-8601 strings; the payload is the event payload object (serialised to
 * `jsonb` here). This type carries no raw body and no unverified JSON.
 */
export interface EventPersistenceRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly source: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly occurredAt: string;
  readonly emittedAt: string;
  readonly correlationId: string;
  readonly causationEventId: string | null;
  /** The event payload only. Serialised to `jsonb`; the envelope lives in columns. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** SHA-256 of the whole validated canonical event — exactly 32 bytes. */
  readonly semanticEventDigest: Buffer;
  /** SHA-256 of the exact raw body — exactly 32 bytes. */
  readonly bodyDigest: Buffer;
  /** The one approved algorithm: `ed25519`. */
  readonly signatureAlgorithm: string;
  readonly signatureKeyId: string;
  readonly signatureSignedAt: string;
  /** The verified Ed25519 signature bytes. */
  readonly signature: Buffer;
}

/** The event was newly inserted. */
export interface StoredEvent {
  readonly outcome: 'stored';
  /** The database ingestion sequence (a `BIGINT`, returned as a string). */
  readonly sequence: string;
  /** The database-generated acceptance instant. */
  readonly acceptedAt: Date;
}

/** The event was already present with the SAME semantic digest — a benign duplicate. */
export interface DuplicateEvent {
  readonly outcome: 'duplicate';
  /** The sequence of the ALREADY-ACCEPTED row (not a new one). */
  readonly sequence: string;
  /** The acceptance instant of the already-accepted row. */
  readonly acceptedAt: Date;
}

/** The bounded, safe outcome of a persistence attempt. A conflict throws instead. */
export type EventPersistenceOutcome = StoredEvent | DuplicateEvent;

/**
 * A conflicting duplicate: the same eventId was already accepted with a **different** semantic
 * digest. Two different facts cannot share one idempotency identity, so this fails closed and the
 * original row is left untouched.
 *
 * It carries only the `eventId` — a bounded UUID that is the idempotency key. It **never** carries
 * a payload, a raw body, a signature, a digest, connection details, or any sender-controlled free
 * text: an error message becomes a log line, and a store that refused an event must not then log
 * its contents (ADR-0026, security-principles §5).
 */
export class ConflictingEventDigestError extends Error {
  /** Stable machine token. */
  public readonly code = 'conflicting-event-digest';
  /** The idempotency identity that conflicted. A UUID; bounded and safe. */
  public readonly eventId: string;

  public constructor(eventId: string) {
    super(
      `Conflicting duplicate for event ${eventId}: a different event has already been accepted ` +
        `under this eventId. The original stands, unmodified.`,
    );
    this.name = 'ConflictingEventDigestError';
    this.eventId = eventId;
  }
}

/**
 * Raised only for the impossible case: an INSERT that conflicted, followed by a read that found no
 * row. `DELETE` is refused by the append-only trigger, so a conflicting eventId's row cannot
 * vanish between the two statements. If it ever does, we fail closed rather than guess.
 */
export class EventPersistenceConsistencyError extends Error {
  public readonly code = 'event-persistence-consistency';
  public readonly eventId: string;

  public constructor(eventId: string) {
    super(
      `Event ${eventId} conflicted on insert but was not found on read. The event log is ` +
        `append-only, so this should be impossible; refusing to proceed.`,
    );
    this.name = 'EventPersistenceConsistencyError';
    this.eventId = eventId;
  }
}

const INSERT_ON_CONFLICT_SQL = `
INSERT INTO qf_jarvis.event (
  event_id, event_type, event_version, source,
  subject_type, subject_id,
  occurred_at, emitted_at,
  correlation_id, causation_event_id,
  payload, semantic_event_digest, body_digest,
  signature_algorithm, signature_key_id, signature_signed_at, signature
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
ON CONFLICT ON CONSTRAINT event_event_id_unique DO NOTHING
RETURNING sequence, accepted_at
`;

const SELECT_EXISTING_SQL = `
SELECT sequence, accepted_at, semantic_event_digest
FROM qf_jarvis.event
WHERE event_id = $1
`;

interface InsertedRow {
  readonly sequence: string;
  readonly accepted_at: Date;
}

interface ExistingRow {
  readonly sequence: string;
  readonly accepted_at: Date;
  readonly semantic_event_digest: Buffer;
}

/**
 * Atomically store a validated event, classifying a duplicate by its semantic digest.
 *
 * The insert and the classification happen in **one transaction**. Returns {@link StoredEvent} on
 * first delivery and {@link DuplicateEvent} for a benign duplicate; throws
 * {@link ConflictingEventDigestError} for a conflicting one. It never issues an UPDATE or a DELETE.
 */
export async function storeValidatedEvent(
  pool: DatabasePool,
  record: EventPersistenceRecord,
): Promise<EventPersistenceOutcome> {
  return withTransaction(pool, async (client) => {
    // Pin the isolation level BEFORE the first snapshot-taking statement. The classification below
    // depends on the SELECT taking a fresh snapshot that sees a concurrent winner's committed row —
    // which is READ COMMITTED behaviour. `withTransaction` opens a plain `BEGIN`, so without this
    // the transaction would inherit the session's ambient `default_transaction_isolation`; under
    // REPEATABLE READ or SERIALIZABLE the SELECT would reuse the transaction's first snapshot and a
    // concurrent duplicate could be misclassified (or the transaction could serialization-fail).
    // This must be the first statement in the transaction, before INSERT.
    await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

    const inserted = await client.query<InsertedRow>(INSERT_ON_CONFLICT_SQL, [
      record.eventId,
      record.eventType,
      record.eventVersion,
      record.source,
      record.subjectType,
      record.subjectId,
      record.occurredAt,
      record.emittedAt,
      record.correlationId,
      record.causationEventId,
      JSON.stringify(record.payload),
      record.semanticEventDigest,
      record.bodyDigest,
      record.signatureAlgorithm,
      record.signatureKeyId,
      record.signatureSignedAt,
      record.signature,
    ]);

    const insertedRow = inserted.rows[0];
    if (insertedRow !== undefined) {
      // First delivery of this eventId. Exactly one row now exists.
      return Object.freeze<StoredEvent>({
        outcome: 'stored',
        sequence: insertedRow.sequence,
        acceptedAt: insertedRow.accepted_at,
      });
    }

    // The INSERT did nothing, so a row with this eventId already exists — committed, and possibly
    // by a concurrent client. This SELECT is a SEPARATE statement and therefore takes a fresh
    // READ COMMITTED snapshot, so it sees that committed row.
    const existing = await client.query<ExistingRow>(SELECT_EXISTING_SQL, [record.eventId]);
    const existingRow = existing.rows[0];
    if (existingRow === undefined) {
      throw new EventPersistenceConsistencyError(record.eventId);
    }

    if (existingRow.semantic_event_digest.equals(record.semanticEventDigest)) {
      // Same identity, same semantic content: a benign duplicate. Nothing is written.
      return Object.freeze<DuplicateEvent>({
        outcome: 'duplicate',
        sequence: existingRow.sequence,
        acceptedAt: existingRow.accepted_at,
      });
    }

    // Same identity, different content: two different facts cannot share one idempotency key.
    // Fail closed. Nothing is written; the original row is untouched.
    throw new ConflictingEventDigestError(record.eventId);
  });
}
