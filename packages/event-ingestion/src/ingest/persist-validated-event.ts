/**
 * The secure bridge from a verified, prepared canonical event to a durable event-store row
 * (Stage 3.3 slice 3). It builds the persistence-ready record and hands it to the atomic
 * `storeValidatedEvent` primitive in `@qf-jarvis/event-backbone`.
 *
 * ### Only proven inputs reach persistence THROUGH THIS BRIDGE
 *
 * The `storeValidatedEvent` primitive in `@qf-jarvis/event-backbone` is a trusted low-level write
 * that verifies nothing — a package boundary cannot stop some other caller handing it a forged
 * record. **This bridge is where that trust is earned on the ingestion path.** The only way to build
 * a record *here* is {@link buildEventPersistenceRecord}, and it takes exactly two things, both
 * produced by *this package* during ingestion:
 *
 * - a {@link PreparedValidatedEvent} — an already **contract-validated**, deeply-frozen canonical
 *   event with its semantic digest (Stage 3.3 slice 2); and
 * - a {@link VerifiedSignatureEvidence} — the immutable signature evidence (algorithm and Base64
 *   signature) from a **successful Stage 3.2 verification**, produced during that same verification.
 *
 * So no raw body and no unverified JSON can reach persistence **along this bridge's path**: it has
 * no parameter that takes one. The two inputs are **bound to each other** by the body digest, the
 * key id, and the signed-at instant (all immutable strings) — so the signature evidence for one body
 * cannot be paired with a prepared event for another. A mismatch throws
 * {@link EvidencePreparationMismatchError}; it never silently stores a mispaired record.
 *
 * ### Internal
 *
 * Neither function is exported from the package barrel. They are the ingest composition, reached
 * only by a future authenticated ingest caller inside this package. The public Stage 3.2 surface
 * is unchanged and still exposes no raw body, no key, and no signature bytes.
 */

import {
  storeValidatedEvent,
  type DatabasePool,
  type EventPersistenceOutcome,
  type EventPersistenceRecord,
} from '@qf-jarvis/event-backbone';

import { type VerifiedSignatureEvidence } from '../signature/verify.js';
import { type PreparedValidatedEvent } from './prepare-validated-event.js';

/** 64 lowercase hexadecimal characters — the external form of a SHA-256 digest. */
const DIGEST_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The prepared event and the signature evidence do not describe the same verified body. This is a
 * caller wiring error (a mispaired evidence and prepared event), not an ingestion outcome, so it
 * throws. It carries no bytes, no digest, no payload, and no signature — only a fixed message.
 */
export class EvidencePreparationMismatchError extends Error {
  public readonly code = 'evidence-preparation-mismatch';

  public constructor() {
    super(
      'The signature evidence and the prepared event do not describe the same verified body. ' +
        'They must come from one verification of one body.',
    );
    this.name = 'EvidencePreparationMismatchError';
  }
}

/**
 * Convert a 64-char lowercase-hex digest to its 32 raw bytes, deterministically and safely.
 *
 * `Buffer.from(hex, 'hex')` silently truncates on a stray non-hex character, so the hex is
 * validated first. The inputs here are this package's own digest outputs, so a failure is a
 * programming error rather than hostile input — but a digest that is not exactly a digest must
 * never become a shorter `BYTEA` that the database's 32-byte CHECK would then have to catch.
 */
function hexToDigestBytes(hex: string): Buffer {
  if (!DIGEST_HEX_PATTERN.test(hex)) {
    throw new EvidencePreparationMismatchError();
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Build the persistence-ready record from a prepared event and its signature evidence.
 *
 * @throws {EvidencePreparationMismatchError} if the two inputs do not describe the same verified
 *   body (bound by body digest, key id, and signed-at).
 */
export function buildEventPersistenceRecord(
  prepared: PreparedValidatedEvent,
  evidence: VerifiedSignatureEvidence,
): EventPersistenceRecord {
  // Bind the two inputs. The body digest identifies the exact bytes; the key id and signed-at
  // pin the exact verification. All three must agree, or these inputs are not one event. Every
  // comparison is between immutable strings — `prepared.signedAt` and `evidence.signedAtIso` are
  // both canonical ISO-8601, so the binding never rests on a mutable Date.
  if (
    evidence.bodyDigestHex !== prepared.bodyDigestHex ||
    evidence.keyId !== prepared.keyId ||
    evidence.signedAtIso !== prepared.signedAt
  ) {
    throw new EvidencePreparationMismatchError();
  }

  const event = prepared.canonicalEvent;

  return Object.freeze<EventPersistenceRecord>({
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    source: event.source,
    subjectType: event.subject.entityType,
    subjectId: event.subject.entityId,
    occurredAt: event.occurredAt,
    emittedAt: event.emittedAt,
    correlationId: event.correlationId,
    causationEventId: event.causationEventId ?? null,
    // The payload only — the envelope is in the columns above. It is already deeply frozen.
    payload: event.payload,
    semanticEventDigest: hexToDigestBytes(prepared.semanticEventDigest.hex),
    bodyDigest: hexToDigestBytes(prepared.bodyDigestHex),
    signatureAlgorithm: evidence.algorithm,
    signatureKeyId: prepared.keyId,
    signatureSignedAt: prepared.signedAt,
    // Decode the immutable verified signature into a FRESH buffer. The evidence itself holds no
    // mutable buffer, so there is nothing a caller could have overwritten after verification.
    signature: Buffer.from(evidence.signatureBase64, 'base64'),
  });
}

/**
 * Persist a prepared, verified event atomically and idempotently.
 *
 * Builds the record (binding evidence to prepared event) and delegates to `storeValidatedEvent`.
 * Returns `stored` on first delivery and `duplicate` for a same-digest redelivery; a conflicting
 * redelivery throws `ConflictingEventDigestError` from the store. It performs no UPDATE or DELETE.
 */
export async function persistPreparedEvent(
  pool: DatabasePool,
  prepared: PreparedValidatedEvent,
  evidence: VerifiedSignatureEvidence,
): Promise<EventPersistenceOutcome> {
  return storeValidatedEvent(pool, buildEventPersistenceRecord(prepared, evidence));
}
