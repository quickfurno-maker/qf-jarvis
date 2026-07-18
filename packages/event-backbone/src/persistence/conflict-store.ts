/**
 * Append-only persistence of a **conflicting duplicate** (Stage 3.3.3, ADR-0031, ADR-0020 §8).
 *
 * When the same `eventId` is re-delivered with a **different** semantic digest, the original
 * acceptance stands, permanently, and the refused delivery is recorded here — counted and
 * alertable — so a conflict (a Core bug, corruption in transit, or an attack) is loud and
 * non-destructive rather than silent.
 *
 * ### INTERNAL — not exported from the package barrel
 *
 * This is called **only** by `storeValidatedEvent`, and it takes a transaction `client` (not a
 * pool) so that classifying the conflict and recording it happen in **one transaction** (see
 * `event-store.ts`). It is deliberately absent from `index.ts`: there is no external consumer, and
 * a conflict record must only ever be written by the store that just detected the conflict.
 *
 * ### What this NEVER stores
 *
 * No payload (accepted or conflicting), no raw body, no signature bytes, no subject id/type, and no
 * `original_semantic_event_digest`. The original digest lives in the immutable `qf_jarvis.event`
 * parent row and is obtained by joining `event_conflict.event_id → event.event_id`; storing it here
 * too would be a second copy that could drift. What IS stored is the refused delivery's evidence:
 * its two digests (one-way hashes), its validated correlation id, and its bounded signature
 * evidence (algorithm, key id, signed-at) — never the signature bytes.
 *
 * Fully qualified and parameterized; nothing depends on `search_path`.
 */

import type { DatabaseClient } from './pool.js';

/**
 * A payload-free record of one refused, conflicting delivery. Every field is safe to persist: two
 * one-way digests, a validated correlation id, and bounded signature evidence.
 */
export interface EventConflictRecord {
  /** The idempotency identity that conflicted. Must reference an already-accepted event. */
  readonly eventId: string;
  /** The refused delivery's semantic digest (exactly 32 bytes). Differs from the original's. */
  readonly conflictingSemanticEventDigest: Buffer;
  /** The refused delivery's raw-body digest (exactly 32 bytes). Evidence. */
  readonly conflictingBodyDigest: Buffer;
  /** The refused delivery's validated correlation id. Preserved because it passed validation. */
  readonly conflictingCorrelationId: string;
  /** The refused delivery's signature algorithm (`ed25519`). Evidence, not the signature bytes. */
  readonly conflictingSignatureAlgorithm: string;
  /** The refused delivery's signing key id. A bounded machine token. */
  readonly conflictingSignatureKeyId: string;
  /** When the refused delivery was signed (ISO-8601). Evidence. */
  readonly conflictingSignatureSignedAt: string;
}

/** The bounded, safe outcome of appending a conflict: only the database-generated facts. */
export interface RecordedEventConflict {
  /** The database event-conflict sequence (a `BIGINT`, returned as a string). */
  readonly sequence: string;
  /** The database-generated instant the conflict was recorded. */
  readonly recordedAt: Date;
}

const INSERT_CONFLICT_SQL = `
INSERT INTO qf_jarvis.event_conflict (
  event_id,
  conflicting_semantic_event_digest, conflicting_body_digest,
  conflicting_correlation_id,
  conflicting_signature_algorithm, conflicting_signature_key_id, conflicting_signature_signed_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING sequence, recorded_at
`;

interface ConflictRow {
  readonly sequence: string;
  readonly recorded_at: Date;
}

/**
 * Append one conflict record, **on the caller's transaction client**, so it commits together with
 * the classification that produced it. One parameterized INSERT. `sequence` and `recorded_at` are
 * database-generated. There is deliberately **no uniqueness constraint** that would deduplicate
 * conflict attempts: every verified conflicting delivery is a separate audit fact and gets its own
 * row (ADR-0031).
 */
export async function recordEventConflict(
  client: DatabaseClient,
  record: EventConflictRecord,
): Promise<RecordedEventConflict> {
  const result = await client.query<ConflictRow>(INSERT_CONFLICT_SQL, [
    record.eventId,
    record.conflictingSemanticEventDigest,
    record.conflictingBodyDigest,
    record.conflictingCorrelationId,
    record.conflictingSignatureAlgorithm,
    record.conflictingSignatureKeyId,
    record.conflictingSignatureSignedAt,
  ]);

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error('Expected the event-conflict insert to return a row');
  }

  return Object.freeze<RecordedEventConflict>({
    sequence: row.sequence,
    recordedAt: row.recorded_at,
  });
}
