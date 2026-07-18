/**
 * Append-only persistence of a **safe, payload-free** ingestion rejection (Stage 3.3.3, ADR-0031).
 *
 * A rejected event never enters the event log (ADR-0020 §9): a signature/freshness failure or a
 * contract-validation failure means there is nothing valid to store or replay. What IS stored is a
 * bounded audit record — a reason code, and the safe evidence that a rejection happened — so the
 * boundary's refusals can be counted and diagnosed later, **without keeping the thing that was
 * refused**.
 *
 * ### What this NEVER stores
 *
 * No raw body, no payload, no signature bytes, no event id, no correlation id, no validator
 * message, no field path, and no UNBOUNDED sender-controlled content. `reasonCode` and `issueCodes`
 * are **closed, repository-owned vocabularies** (ADR-0020 §11, ADR-0030); `bodyDigest` is the
 * verifier's OWN `sha256(rawBody)` computed by Jarvis (a one-way hash, evidence — not copied from
 * the sender). The **one sender-derived field** is the optional `keyId`: it is the *claimed*
 * signing-key id from the (sender-controlled) envelope. It is **sender-controlled**, kept only
 * because a rejection needs to say which key was claimed, and accepted **only** in the strict
 * 1..128-character machine-token format (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`) enforced by the
 * table `CHECK`. *The validator that refuses a value must not then record it.*
 *
 * ### Trusted low-level primitive
 *
 * Like `storeValidatedEvent`, this verifies nothing and trusts its caller. The future ingest
 * composition (Stage 3.3.4) owns the verify → prepare → reject pipeline that decides WHEN to call
 * this; here we only append what we are handed, bounded by the `qf_jarvis.ingestion_rejection`
 * `CHECK` constraints. Fully qualified and parameterized; nothing depends on `search_path`.
 */

import type {
  IngestionRejectionIssueCode,
  IngestionRejectionReasonCode,
} from './ingestion-rejection-reasons.js';
import type { DatabasePool } from './pool.js';
import { withClient } from './transaction.js';

/**
 * A safe, payload-free ingestion-rejection record. Every field is bounded: never `recordedAt` or
 * `sequence` (both database-generated), and never a payload, raw body, signature bytes, event id,
 * correlation id, validator message, or field path. Most fields are non-sender-controlled
 * (`reasonCode`/`issueCodes` are repository-owned; `bodyDigest` is Jarvis-computed). The optional
 * `keyId` is the exception: it is the claimed signing-key id from the sender-controlled envelope,
 * strictly bounded to the 1..128-char machine-token format.
 */
export interface IngestionRejectionRecord {
  /** One of the closed, repository-owned rejection reason codes. */
  readonly reasonCode: IngestionRejectionReasonCode;
  /**
   * The CLAIMED signing key id from the sender-controlled envelope, when one was parsed; omitted
   * otherwise. It is **sender-controlled**, kept only in the strict 1..128-char machine-token format.
   */
  readonly keyId?: string;
  /**
   * Jarvis's OWN `sha256(rawBody)` (exactly 32 bytes), computed by the verifier — not copied from
   * the sender; omitted when the rejection preceded hashing.
   */
  readonly bodyDigest?: Buffer;
  /**
   * The DISTINCT safe, repository-owned codes carried by the retained issues. Deduplicated and
   * sorted before insertion. Several retained issues (at different paths) may share one code, so
   * this set is usually smaller than {@link issueCount} — that compression is NOT truncation.
   */
  readonly issueCodes: readonly IngestionRejectionIssueCode[];
  /**
   * The number of bounded, safe issues the upstream layer RETAINED for this rejection (0..16). It
   * may exceed `issueCodes.length` when retained issues share codes.
   */
  readonly issueCount: number;
  /**
   * An INDEPENDENT flag: the upstream (already-bounded) source reported more issues than it
   * retained — its own cap was exceeded. It is **not** derivable from `issueCount` vs
   * `issueCodes.length`; the store persists it verbatim and enforces no relationship between them.
   */
  readonly issuesTruncated: boolean;
}

/** The bounded, safe outcome of appending a rejection: only the database-generated facts. */
export interface RecordedIngestionRejection {
  /** The database ingestion-rejection sequence (a `BIGINT`, returned as a string). */
  readonly sequence: string;
  /** The database-generated instant the rejection was recorded. */
  readonly recordedAt: Date;
}

const INSERT_REJECTION_SQL = `
INSERT INTO qf_jarvis.ingestion_rejection (
  reason_code, key_id, body_digest, issue_codes, issue_count, issues_truncated
) VALUES ($1, $2, $3, $4, $5, $6)
RETURNING sequence, recorded_at
`;

interface RejectionRow {
  readonly sequence: string;
  readonly recorded_at: Date;
}

/**
 * Append one safe ingestion rejection. **One parameterized INSERT**, in its own autocommit
 * transaction — a rejection has no relationship to the event log, so it is never part of the event
 * write transaction. `issueCodes` are deterministically **sorted and deduplicated** before
 * insertion, so the stored set is canonical. `sequence` and `recorded_at` are database-generated
 * and returned; they are never accepted from the caller.
 */
export async function recordIngestionRejection(
  pool: DatabasePool,
  record: IngestionRejectionRecord,
): Promise<RecordedIngestionRejection> {
  // Canonicalise the issue codes: distinct, then lexicographically sorted. Deterministic, so two
  // rejections with the same codes in any order store the same array — and the DB CHECK that
  // requires no duplicates is satisfied by construction.
  const issueCodes = [...new Set(record.issueCodes)].sort();

  return withClient(pool, async (client) => {
    const result = await client.query<RejectionRow>(INSERT_REJECTION_SQL, [
      record.reasonCode,
      record.keyId ?? null,
      record.bodyDigest ?? null,
      issueCodes,
      record.issueCount,
      record.issuesTruncated,
    ]);

    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Expected the ingestion-rejection insert to return a row');
    }

    return Object.freeze<RecordedIngestionRejection>({
      sequence: row.sequence,
      recordedAt: row.recorded_at,
    });
  });
}
