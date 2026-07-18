/**
 * `createEventIngestor` — the full transactional ingest composition (Stage 3.3.4, ADR-0032).
 *
 * This is the public trust boundary in front of the QF Jarvis event log. It composes the four
 * primitives that already exist — Stage 3.2 signature verification, Stage 3.3 slice-2 validated-event
 * preparation, the slice-3 persistence bridge, and the append-only ingestion-rejection store — into
 * one function with the architectural call shape ADR-0020 §10 fixed:
 *
 *   ingest(rawBody, envelope, now): Promise<IngestResult>
 *
 * ### Dependencies are injected; nothing is ambient
 *
 * There is no module-level pool, no global registry, and no `Date.now`. A caller builds an ingestor
 * once with an explicit `pool`, `keyRegistry`, and optional `verificationOptions`, and supplies the
 * current instant as `now` on every call — so freshness is deterministic and testable at a simulated
 * 2030 without mocking a clock (ADR-0020 §3, ADR-0027).
 *
 * ### The order is the contract (ADR-0020 §9, ADR-0027)
 *
 * 1. Receive the exact raw bytes and the untrusted signature envelope.
 * 2. **Verify** the signature and freshness against the exact raw bytes — before anything parses them.
 * 3. **Only after** successful verification, decode + `JSON.parse` (inside preparation).
 * 4. Validate and prepare the canonical event (the existing slice-2 primitive).
 * 5. Persist through the existing slice-3 bridge / `storeValidatedEvent`.
 * 6. Return a bounded {@link IngestResult}.
 *
 * Unauthenticated content is **never** parsed or contract-validated: preparation is called only on
 * the branch where verification already succeeded.
 *
 * ### Trust boundary and exports
 *
 * `verifySignatureWithEvidence`, `prepareValidatedEventFromVerifiedRawBody`, and `persistPreparedEvent`
 * remain **internal**. This composition is the only public ingest surface. `recordIngestionRejection`
 * stays a public trusted primitive in `@qf-jarvis/event-backbone`; `recordEventConflict` stays
 * internal there. No new deep export path or migration-runner bypass is introduced.
 */

import { recordIngestionRejection, type DatabasePool } from '@qf-jarvis/event-backbone';

import { type PublicKeyRegistry } from '../signature/public-key-registry.js';
import { type SignatureVerificationReason } from '../signature/reason-codes.js';
import { verifySignatureWithEvidence, type VerifySignatureOptions } from '../signature/verify.js';
import { persistPreparedEvent } from './persist-validated-event.js';
import { prepareValidatedEventFromVerifiedRawBody } from './prepare-validated-event.js';
import { type ValidatedEventRejectionReason } from './rejection.js';

/**
 * The stable reason an ingest attempt was refused at the boundary — either a Stage 3.2 signature
 * reason or a slice-2 preparation reason. Every member is one of the closed
 * `INGESTION_REJECTION_REASON_CODES` the audit log accepts (proven by conformance tests).
 * `duplicate-conflict` is deliberately absent: a conflict is not a rejection — it throws.
 */
export type IngestRejectionReason = SignatureVerificationReason | ValidatedEventRejectionReason;

/** A first delivery that was accepted and stored. Carries the database-generated facts. */
export interface IngestStored {
  readonly outcome: 'stored';
  /** The database ingestion sequence (a `BIGINT`, as a string). */
  readonly sequence: string;
  /** The database-generated acceptance instant. */
  readonly acceptedAt: Date;
}

/** A benign duplicate (same eventId, same semantic digest). References the ALREADY-accepted row. */
export interface IngestDuplicate {
  readonly outcome: 'duplicate';
  readonly sequence: string;
  readonly acceptedAt: Date;
}

/**
 * A refused delivery, recorded in `ingestion_rejection`. Carries only bounded operational facts: the
 * stable reason and the database-generated audit-row identity. **Never** a payload, raw body,
 * signature bytes, event id, correlation id, validator message, or field path.
 */
export interface IngestRejected {
  readonly outcome: 'rejected';
  readonly reason: IngestRejectionReason;
  /** The sequence of the committed `ingestion_rejection` audit row. */
  readonly rejectionSequence: string;
  /** The database-generated instant the rejection was recorded. */
  readonly recordedAt: Date;
}

/** The closed, discriminated result of an ingest attempt. A conflict is NOT here — it throws. */
export type IngestResult = IngestStored | IngestDuplicate | IngestRejected;

/** The explicit dependencies of an ingestor. No globals, no ambient clock, no mutable singletons. */
export interface EventIngestorDependencies {
  /** The database pool the ingestor writes through. The caller owns and closes it. */
  readonly pool: DatabasePool;
  /** The injected public-key registry. Looked up by keyId, never by trial. */
  readonly keyRegistry: PublicKeyRegistry;
  /** Optional bounded freshness window (default five minutes). */
  readonly verificationOptions?: VerifySignatureOptions;
}

/** A configured ingestor. `ingest` preserves the ADR-0020 §10 call shape. */
export interface EventIngestor {
  /**
   * Ingest one delivery: verify → (reject) → prepare → (reject) → persist → return.
   *
   * @param rawBody   The exact bytes as received. Verified before anything parses them.
   * @param envelope  The untrusted signature envelope. Validated in full by the verifier.
   * @param now       The current instant, injected. The verifier reads no clock.
   * @returns A bounded {@link IngestResult}. A conflicting duplicate throws
   *   `ConflictingEventDigestError` (from the store, after its audit row commits); infrastructure,
   *   consistency, and configuration failures throw their existing typed errors.
   */
  ingest(rawBody: Uint8Array, envelope: unknown, now: Date): Promise<IngestResult>;
}

/**
 * Build an ingestor from explicit dependencies. Returns a function-shaped object; opening no socket
 * and reading no clock or environment at construction.
 */
export function createEventIngestor(deps: EventIngestorDependencies): EventIngestor {
  const { pool, keyRegistry, verificationOptions } = deps;

  return Object.freeze<EventIngestor>({
    async ingest(rawBody: Uint8Array, envelope: unknown, now: Date): Promise<IngestResult> {
      // 2. Verify the exact raw bytes FIRST. The evidence-bearing verifier is used so the accepted
      //    path has the signature evidence persistence needs — produced from this one verification.
      //    Nothing is parsed here; on failure only the stable reason is available.
      const verified = verifySignatureWithEvidence(
        rawBody,
        envelope,
        now,
        keyRegistry,
        verificationOptions,
      );

      if (!verified.ok) {
        // Signature/freshness rejection (ADR-0032 §4). A rejected delivery never reaches the event
        // store. Append exactly one audit row; the verify FAILURE result exposes no safe key/body
        // evidence, so key_id and body_digest are omitted (null) and the issue set is empty. The
        // rejected result is returned ONLY after the row commits; a persistence failure propagates.
        const recorded = await recordIngestionRejection(pool, {
          reasonCode: verified.reason,
          issueCodes: [],
          issueCount: 0,
          issuesTruncated: false,
        });
        return Object.freeze<IngestRejected>({
          outcome: 'rejected',
          reason: verified.reason,
          rejectionSequence: recorded.sequence,
          recordedAt: recorded.recordedAt,
        });
      }

      const evidence = verified.evidence;

      // 3–4. ONLY NOW decode + parse + contract-validate. Preparation is handed the verification
      //      projected from the same evidence and the exact same bytes it was taken over.
      const prepared = prepareValidatedEventFromVerifiedRawBody({
        verification: {
          ok: true,
          keyId: evidence.keyId,
          signedAt: new Date(evidence.signedAtIso),
          bodyDigestHex: evidence.bodyDigestHex,
        },
        verifiedRawBody: rawBody,
      });

      if (!prepared.ok) {
        // Preparation rejection (ADR-0032 §5): malformed body / contract-validation-failed /
        // unknown type / unknown version. Persist only the safe issue codes, the retained issue
        // count, and the independent truncation flag — never a path, message, payload, or envelope
        // identifier. The store deduplicates and sorts the codes. Returned only after the row commits.
        const recorded = await recordIngestionRejection(pool, {
          reasonCode: prepared.reason,
          issueCodes: prepared.issues.map((issue) => issue.code),
          issueCount: prepared.issues.length,
          issuesTruncated: prepared.issuesTruncated,
        });
        return Object.freeze<IngestRejected>({
          outcome: 'rejected',
          reason: prepared.reason,
          rejectionSequence: recorded.sequence,
          recordedAt: recorded.recordedAt,
        });
      }

      // 5. Persist through the existing bridge. This is the ONLY transaction: `storeValidatedEvent`
      //    owns it. First delivery → stored; same digest → duplicate; a different digest records the
      //    conflict IN its transaction, commits, then throws ConflictingEventDigestError — which we
      //    let propagate. No ingestion_rejection is written for a conflict, and no second transaction
      //    is opened here.
      const outcome = await persistPreparedEvent(pool, prepared, evidence);

      // 6. Return the bounded, frozen result.
      if (outcome.outcome === 'stored') {
        return Object.freeze<IngestStored>({
          outcome: 'stored',
          sequence: outcome.sequence,
          acceptedAt: outcome.acceptedAt,
        });
      }
      return Object.freeze<IngestDuplicate>({
        outcome: 'duplicate',
        sequence: outcome.sequence,
        acceptedAt: outcome.acceptedAt,
      });
    },
  });
}
