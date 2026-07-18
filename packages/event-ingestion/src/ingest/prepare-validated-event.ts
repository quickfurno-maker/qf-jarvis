/**
 * `prepareValidatedEventFromVerifiedRawBody` — the database-free composition that turns a raw body
 * **already accepted by Stage 3.2 signature and freshness verification** into a validated
 * canonical event bound to its semantic digest (ADR-0030, Stage 3.3 slice 2). It is the step
 * between Stage 3.2 (did these bytes really come from Core, unaltered and fresh?) and the
 * persistence-touching ingest that is still gated.
 *
 * ### It has an internal CALLER PRECONDITION — it does not itself authenticate
 *
 * This function does **not** perform or prove Ed25519 verification, and it cannot. Its
 * authenticity guarantee is a **precondition the caller must satisfy**, not something the types
 * establish:
 *
 * - a future ingest composition must call {@link verifySignature} **first**;
 * - and pass this function the **actual** `SignatureVerificationSuccess` it returned together with
 *   the **exact same bytes**, immediately, with nothing mutated in between.
 *
 * Recomputing `sha256(verifiedRawBody)` and comparing it to the verification's own `bodyDigestHex`
 * detects an **accidental mispairing** of a result with the wrong body — it is a wiring guard, not
 * a signature check, and it proves nothing about authenticity on its own. TypeScript `readonly`
 * and structural types (including the `SignatureVerificationSuccess` shape) are **compile-time
 * conveniences, not security capabilities**: a caller can construct any shape it likes. Because
 * authenticity rests on the caller doing the right thing, this function is **internal** and is not
 * exported from the package barrel.
 *
 * ### What it does, in order
 *
 * 1. Guard: recompute the body digest and require it to equal the verification's `bodyDigestHex`
 *    (a mispairing throws — see above).
 * 2. Decode the bytes as **strict, fatal UTF-8** — invalid UTF-8 is refused, never replaced.
 * 3. Reject an explicit **byte-order mark**: a canonical event is UTF-8 without a BOM.
 * 4. Reject a **duplicate object member name** at any depth, compared by DECODED name, before
 *    parsing (Stage 3.3.5, ADR-0033) — `JSON.parse` would otherwise collapse `{"a":1,"a":2}`
 *    last-wins and silently, a security-relevant ambiguity for an authenticated event. Then parse
 *    with **`JSON.parse` only** — no permissive, streaming, or bespoke parser — which stays the
 *    single authority for the validity of a non-duplicate body.
 * 5. Validate against the authoritative `@qf-jarvis/contracts` registry (`safeParseCanonicalEvent`).
 * 6. On success, **canonicalise once** (ADR-0029), digest that exact canonical JSON, re-parse the
 *    *same* canonical JSON, and deeply freeze it — so the returned snapshot and the digest are one
 *    identical canonical representation. The canonical JSON is never returned, exported, or logged.
 *
 * A failure at steps 2–5 becomes a **safe**, bounded {@link ValidatedEventRejection} carrying one
 * of exactly three pinned identifiers (`contract-validation-failed`, `unknown-event-type`,
 * `unknown-event-version` — ADR-0020 §11, ADR-0027) and issues that carry **no** validator-native
 * message and **no** sender-controlled key or discriminant value (see `rejection.ts`).
 *
 * Pure: `node:crypto` for the digest, the injected verification for the precondition — no clock,
 * environment, filesystem, or network — and it logs nothing and mutates no input.
 */

import {
  CANONICAL_EVENT_REGISTRY,
  canonicalEventKey,
  safeParseCanonicalEvent,
  type CanonicalEvent,
} from '@qf-jarvis/contracts';

import { ComputedBodyDigest } from '../signature/computed-body-digest.js';
import { type SignatureVerificationSuccess } from '../signature/verify.js';
import { canonicaliseToJson } from './canonical-json.js';
import { scanForDuplicateObjectKeys } from './duplicate-object-key-scan.js';
import { digestCanonicalJson, type SemanticEventDigest } from './semantic-digest.js';
import { deepFreezeJsonValue, type DeepReadonly } from './frozen-snapshot.js';
import {
  duplicateObjectKeyIssues,
  malformedBodyIssues,
  mapSafeValidationIssues,
  unrecognisedDiscriminantIssues,
  type SafeValidationIssue,
  type SafeValidationIssues,
  type ValidatedEventRejectionReason,
} from './rejection.js';

/** U+FEFF — the byte-order mark. As UTF-8 it is the three bytes `EF BB BF`. */
const BYTE_ORDER_MARK = '﻿';

/**
 * The set of event types the registry knows, at any version. Derived once from the authoritative
 * registry keys (`type@version`), so "is this a known type?" is answered from the single source of
 * truth and cannot drift from what actually validates.
 */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(
  CANONICAL_EVENT_REGISTRY.keys().map((key) => key.slice(0, key.lastIndexOf('@'))),
);

/**
 * A caller-contract violation: `verifiedRawBody` is not the body the `verification` was computed
 * over. This is a programming/wiring error, not an ingestion rejection, so it throws. It carries
 * no bytes, no digest, and no event content — an error message becomes a log line, and this
 * boundary logs nothing sensitive (ADR-0026, security-principles §5).
 */
export class ValidatedEventPreparationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ValidatedEventPreparationError';
  }
}

/** The input: a Stage 3.2 verification the caller obtained, and the exact bytes it was taken over. */
export interface VerifiedRawBody {
  /**
   * The `SignatureVerificationSuccess` the caller obtained from {@link verifySignature} for these
   * exact bytes. Its shape is a compile-time convenience, **not** a proof of authenticity — the
   * caller is responsible for having actually verified (see the module precondition).
   */
  readonly verification: SignatureVerificationSuccess;

  /**
   * The exact raw body bytes `verification` was computed over. Checked against `verification` by
   * recomputed digest to catch an accidental mispairing; a mismatch throws
   * {@link ValidatedEventPreparationError}.
   */
  readonly verifiedRawBody: Uint8Array;
}

/** A prepared, validated canonical event, bound to its semantic digest. Deeply immutable. */
export interface PreparedValidatedEvent {
  readonly ok: true;
  /** The validated canonical event, as a pristine, deeply frozen snapshot of the canonical JSON. */
  readonly canonicalEvent: DeepReadonly<CanonicalEvent>;
  /** The semantic digest (ADR-0029) computed over exactly the canonical JSON of {@link canonicalEvent}. */
  readonly semanticEventDigest: SemanticEventDigest;
  /** The key id that authenticated the body (carried from Stage 3.2). */
  readonly keyId: string;
  /** When the body was signed, as an immutable canonical ISO-8601 string (carried from Stage 3.2). */
  readonly signedAt: string;
  /** The verifier's own `hex(sha256(rawBody))` — a separate fact from the semantic digest. */
  readonly bodyDigestHex: string;
}

/** A refused authentic body: a stable reason and safe, bounded issues. Deeply immutable. */
export interface ValidatedEventRejection {
  readonly ok: false;
  readonly reason: ValidatedEventRejectionReason;
  readonly issues: readonly SafeValidationIssue[];
  /** True when unique issues were dropped by the cap. */
  readonly issuesTruncated: boolean;
}

/** The bounded, safe outcome of preparation. */
export type ValidatedEventPreparation = PreparedValidatedEvent | ValidatedEventRejection;

function reject(
  reason: ValidatedEventRejectionReason,
  safe: SafeValidationIssues,
): ValidatedEventRejection {
  return Object.freeze({
    ok: false as const,
    reason,
    issues: safe.issues,
    issuesTruncated: safe.issuesTruncated,
  });
}

/**
 * Classify a contract-validation failure into exactly one pinned identifier, deterministically and
 * against the registry, with the discriminants read **independently and in this order** — an
 * unknown type is identified **before** the submitted version is interpreted, and neither
 * discriminant is coerced, trimmed, case-folded, or given a fallback:
 *
 * 1. non-object root, or missing / wrong-type `eventType` → `contract-validation-failed`;
 * 2. `eventType` is a string but not a registered type → `unknown-event-type`;
 * 3. known type, but `eventVersion` missing or wrong type → `contract-validation-failed`;
 * 4. known type, numeric version, but unsupported → `unknown-event-version`;
 * 5. registered `type@version` whose envelope or payload is invalid → `contract-validation-failed`.
 */
function classifyContractFailure(parsed: unknown): ValidatedEventRejectionReason {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'contract-validation-failed';
  }
  const record = parsed as Record<string, unknown>;

  const eventType = record['eventType'];
  if (typeof eventType !== 'string') {
    return 'contract-validation-failed';
  }
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    return 'unknown-event-type';
  }

  const eventVersion = record['eventVersion'];
  if (typeof eventVersion !== 'number') {
    return 'contract-validation-failed';
  }
  if (!CANONICAL_EVENT_REGISTRY.has(canonicalEventKey(eventType, eventVersion))) {
    return 'unknown-event-version';
  }
  return 'contract-validation-failed';
}

/** Choose the safe issue set for a contract-validation failure without leaking the discriminant. */
function issuesForFailure(
  reason: ValidatedEventRejectionReason,
  contractIssues: Parameters<typeof mapSafeValidationIssues>[0],
): SafeValidationIssues {
  if (reason === 'unknown-event-type') {
    return unrecognisedDiscriminantIssues('eventType');
  }
  if (reason === 'unknown-event-version') {
    return unrecognisedDiscriminantIssues('eventVersion');
  }
  return mapSafeValidationIssues(contractIssues);
}

/**
 * Prepare a validated canonical event from a raw body that has **already passed Stage 3.2
 * signature and freshness verification** (an internal caller precondition — see the module doc).
 *
 * @param input  The caller's Stage 3.2 verification and the exact bytes it was computed over.
 * @throws {ValidatedEventPreparationError} if `verifiedRawBody` is not the body `verification` was
 *   computed over — a caller wiring error, never an ingestion rejection.
 * @returns A {@link PreparedValidatedEvent} on success, or a safe {@link ValidatedEventRejection}.
 */
export function prepareValidatedEventFromVerifiedRawBody(
  input: VerifiedRawBody,
): ValidatedEventPreparation {
  // 1. Guard against an accidental body/result mispairing. The verifier's own digest identifies
  //    which bytes it authenticated; a body that does not reproduce it was not that body. This is
  //    a wiring guard, NOT a signature check.
  const recomputed = ComputedBodyDigest.fromRawBody(input.verifiedRawBody);
  if (recomputed.hex !== input.verification.bodyDigestHex) {
    throw new ValidatedEventPreparationError(
      'verifiedRawBody does not match the provided Stage 3.2 verification',
    );
  }

  // 2. Strict, fatal UTF-8. `fatal` refuses invalid sequences; `ignoreBOM` keeps a leading BOM as
  //    U+FEFF (rather than silently stripping it) so step 3 can reject it explicitly.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.verifiedRawBody);
  } catch {
    return reject('contract-validation-failed', malformedBodyIssues());
  }

  // 3. Explicit BOM rejection. A canonical event is UTF-8 with no byte-order mark.
  if (text.startsWith(BYTE_ORDER_MARK)) {
    return reject('contract-validation-failed', malformedBodyIssues());
  }

  // 3a. Duplicate-object-key rejection (Stage 3.3.5, ADR-0033). `JSON.parse` collapses a duplicate
  //     member last-wins and silently, which is a security-relevant ambiguity for an authenticated
  //     event. Reject any object with a duplicate member name — compared by DECODED name, so
  //     escaped-equivalent names (`{"a":1,"a":2}`) collide — BEFORE JSON.parse can accept it.
  //     The scanner is authoritative only for duplicates; 'malformed' defers to JSON.parse below,
  //     which stays the single authority for whether a non-duplicate body is valid. The duplicated
  //     name is never recorded — only the fixed `invalid-format` issue is (§5, ADR-0033).
  if (scanForDuplicateObjectKeys(text) === 'duplicate-object-key') {
    return reject('contract-validation-failed', duplicateObjectKeyIssues());
  }

  // 4. JSON.parse only. Duplicate keys were already refused in step 3a; on any non-duplicate body
  //    JSON.parse remains the single authority for JSON validity.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reject('contract-validation-failed', malformedBodyIssues());
  }

  // 5. Authoritative contract validation. @qf-jarvis/contracts owns the shapes and the registry.
  const result = safeParseCanonicalEvent(parsed);
  if (!result.success) {
    const reason = classifyContractFailure(parsed);
    return reject(reason, issuesForFailure(reason, result.error.issues));
  }

  // 6. Canonicalise ONCE, then derive both the digest and the returned snapshot from that single
  //    canonical JSON. A non-JSON value in the validated output (a Date, Map, accessor, symbol,
  //    non-enumerable property, …) fails HERE through the bounded semantic-canonicalisation
  //    invariant error — it is never silently converted to `{}`. Negative zero becomes `0`, and
  //    object-key ordering follows the canonical JSON.
  const canonicalJson = canonicaliseToJson(result.data);
  const semanticEventDigest = digestCanonicalJson(canonicalJson);
  const canonicalEvent = deepFreezeJsonValue(JSON.parse(canonicalJson) as CanonicalEvent);

  return Object.freeze({
    ok: true as const,
    canonicalEvent,
    semanticEventDigest,
    keyId: input.verification.keyId,
    signedAt: input.verification.signedAt.toISOString(),
    bodyDigestHex: input.verification.bodyDigestHex,
  });
}
