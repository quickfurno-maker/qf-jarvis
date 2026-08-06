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
 * ### Nothing here normalizes
 *
 * No trimming, no case folding, no Unicode normalization. A store that normalized its keys would
 * map two different strings onto one durable row, and a replay claim is an identity comparison —
 * quietly making two identities equal is precisely how a duplicate slips through. An uppercase
 * digest is refused rather than lowercased, because the verifier only ever computes lowercase hex,
 * so an uppercase one did not come from the verifier.
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
  readonly executionIntentId: string;
  readonly idempotencyKey: string;
  readonly bodyDigestHex: string;
}

function invalid(): never {
  throw new PostgresExecutionReplayStoreError('invalid-input');
}

/**
 * Validate one claim.
 *
 * Typed `unknown` because this is a package boundary: the declared parameter promises three
 * strings, but an untyped caller — or a caller that built the object from JSON — can supply
 * anything, including getters. Own values are read ONCE into locals, so nothing below can observe a
 * different value than the one that was checked.
 */
export function validateClaim(input: unknown): ValidatedClaim {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid();
  }
  const record = input as Record<string, unknown>;

  const executionIntentId: unknown = record['executionIntentId'];
  const idempotencyKey: unknown = record['idempotencyKey'];
  const bodyDigestHex: unknown = record['bodyDigestHex'];

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

  return { executionIntentId, idempotencyKey, bodyDigestHex };
}
