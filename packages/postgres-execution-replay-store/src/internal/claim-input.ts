/**
 * Claim-input validation (QFJ-P09.03, ADR-0091).
 *
 * INTERNAL. Three strings, checked before a connection is touched.
 *
 * ### This is a STORAGE check, not a second copy of `ExecutionIntentV1`
 *
 * `ReplayClaimInput` documents that every field comes from an already-verified dispatch, and this
 * package deliberately does not depend on `@qf-jarvis/contracts` or re-parse the intent: a second
 * definition of a governed contract living in a storage adapter is a definition free to drift from
 * the one that governs. What is checked here is only what the COLUMNS can hold, so that a caller
 * mistake becomes `invalid-input` at the boundary rather than a constraint violation deep in the
 * driver — which would classify as `repository-invariant` and blame the database for a bad call.
 *
 * The three checks below are exactly the storage invariants migration 0010 encodes, and no more.
 *
 * ### Exactly one field is canonicalized, and the three rules are different on purpose
 *
 * The default is that nothing is normalized: no trimming, no case folding, no Unicode
 * normalization. A replay claim is an identity comparison, and quietly making two identities equal
 * is precisely how a duplicate slips through. But "never normalize" is a rule about IDENTITY, and
 * one of these three fields has a representation that is not its identity.
 *
 * - **`executionIntentId` IS canonicalized to lowercase.** UUID hexadecimal case is representation,
 *   not identity: `A1B2…` and `a1b2…` are the same UUID, and PostgreSQL's `UUID` column agrees —
 *   it accepts either and returns canonical LOWERCASE text. So an uppercase id could be INSERTED
 *   and then compared, character by character, against the lowercase form the database handed back;
 *   the byte-identical replay of that same dispatch failed that comparison and was classified
 *   `conflict`. That is not a cosmetic misnomer: `exact-replay` means "already done, suppress" and
 *   `conflict` is a fail-closed refusal, so the boundary refused a legitimate identical redelivery —
 *   the exact thing the guard exists to recognise. Canonicalizing here makes the value this adapter
 *   compares the same value the database stores.
 *
 * - **`idempotencyKey` is NEVER normalized.** It is an opaque token chosen by the issuer, so
 *   `KEY-1` and `key-1` are two different tokens. Folding them would make two distinct claims
 *   collide — a way to LOSE a legitimate dispatch, not a way to catch a duplicate.
 *
 * - **`bodyDigestHex` is NEVER normalized.** It is verifier output and is DEFINED as lowercase hex,
 *   so an uppercase digest did not come from the verifier. It is refused rather than lowercased,
 *   because lowercasing it would silently accept something the boundary never produced.
 *
 * The distinction is not "which fields are convenient to fold". It is: a UUID has a canonical form
 * that the storage type already imposes; an opaque token and a fixed-case digest do not.
 */
import { PostgresExecutionReplayStoreError } from '../contracts/errors.js';

/**
 * The canonical dashed 8-4-4-4-12 form, case-insensitive on the hex.
 *
 * Deliberately NOT version- or variant-restricted. `executionIntentIdSchema` is the canonical
 * authority and this must not be STRICTER than it: rejecting an id the verifier accepted would turn
 * a lawful dispatch into a refusal. The `UUID` column type is the real check; this exists so an
 * obviously malformed call is named as `invalid-input` instead of reaching the server.
 */
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

/**
 * The canonical `idempotencyKeySchema` grammar, restated exactly: 16–128 of `[A-Za-z0-9._:-]`.
 *
 * The excluded characters are the point. `@`, `+`, whitespace and every punctuation mark outside
 * that set are what an email address, an E.164 phone number or a sentence would need, so an opaque
 * token is the only thing this column can hold. Migration 0010 carries the identical CHECK.
 */
const IDEMPOTENCY_KEY_SHAPE = /^[A-Za-z0-9._:-]{16,128}$/u;

/** Lowercase `hex(sha256(...))`, exactly 64 characters. What the verifier computes, and only that. */
const BODY_DIGEST_SHAPE = /^[a-f0-9]{64}$/u;

/** The three validated values, copied out as primitives so a hostile object cannot be re-read. */
export interface ValidatedClaim {
  /** CANONICAL lowercase. This is the value bound into SQL and compared against a stored row. */
  readonly executionIntentId: string;
  /** Verbatim. An opaque, case-SENSITIVE token. */
  readonly idempotencyKey: string;
  /** Verbatim. Already lowercase, because anything else was refused above. */
  readonly bodyDigestHex: string;
}

function invalid(): never {
  throw new PostgresExecutionReplayStoreError('invalid-input');
}

/**
 * Validate one claim, and canonicalize the one field that has a canonical form.
 *
 * Typed `unknown` because this is a package boundary: the declared parameter promises three
 * strings, but an untyped caller — or a caller that built the object from JSON — can supply
 * anything, including getters. Each field is read exactly ONCE into a local, so nothing below can
 * observe a different value than the one that was checked, and a getter or `Proxy` that THROWS
 * becomes `invalid-input` rather than escaping this package as hostile prose.
 */
export function validateClaim(input: unknown): ValidatedClaim {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid();
  }
  const record = input as Record<string, unknown>;

  let executionIntentId: unknown;
  let idempotencyKey: unknown;
  let bodyDigestHex: unknown;
  try {
    executionIntentId = record['executionIntentId'];
    idempotencyKey = record['idempotencyKey'];
    bodyDigestHex = record['bodyDigestHex'];
  } catch {
    // The thrown value came from the caller's own object and may quote anything. It is deliberately
    // not surfaced: a claim this adapter could not even read is a caller defect, and the message
    // must not become a channel out of the boundary.
    return invalid();
  }

  if (
    typeof executionIntentId !== 'string' ||
    typeof idempotencyKey !== 'string' ||
    typeof bodyDigestHex !== 'string'
  ) {
    return invalid();
  }
  if (
    !UUID_SHAPE.test(executionIntentId) ||
    !IDEMPOTENCY_KEY_SHAPE.test(idempotencyKey) ||
    !BODY_DIGEST_SHAPE.test(bodyDigestHex)
  ) {
    return invalid();
  }

  return {
    // Canonicalized AFTER the shape check, so an invalid id is still refused as invalid rather than
    // silently repaired into something that parses. `toLowerCase` on `[0-9a-fA-F-]` is locale- and
    // Unicode-independent: there is no character in that set whose lowering depends on either.
    executionIntentId: executionIntentId.toLowerCase(),
    idempotencyKey,
    bodyDigestHex,
  };
}
