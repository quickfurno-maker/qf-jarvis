/**
 * The signature envelope, and a **strict, adversarial, hand-written parser**.
 *
 * The envelope travels alongside the raw body and describes how it was signed:
 *
 * ```
 * { algorithm, keyId, signedAt, bodyDigest: 'sha256:<hex>', signature: <88-char base64> }
 * ```
 *
 * The parser treats the envelope as fully hostile. It:
 *
 * - accepts only a **plain object** — prototype `Object.prototype` **or** `null`
 *   (a null-prototype object is the safest carrier of all; class instances, arrays and
 *   other exotic objects are rejected);
 * - uses `Reflect.ownKeys`, so **symbol** and **non-enumerable** extras are detected —
 *   a hidden key cannot ride along;
 * - requires **exactly** the five approved string keys and rejects any symbol key;
 * - reads only **own data-property descriptor values** — it never invokes a getter,
 *   never triggers a setter, and never reads an inherited value;
 * - requires each approved property to be **enumerable**;
 * - wraps every reflective operation in `try/catch`, so a hostile `Proxy` that throws
 *   from a trap yields `signature-malformed` rather than propagating the throw.
 *
 * **No untrusted envelope can make the parser (or `verifySignature`) throw.**
 *
 * It validates *shape and field format* (verification order step 2). Whether the
 * algorithm is the supported one (step 3) and whether `signedAt` is a real instant
 * (step 4) are deliberately left to later steps, so those failures get their own
 * specific reason codes.
 */
import { decodeEd25519Signature, isValidKeyId } from './field-formats.js';
import { BODY_DIGEST_HEX_LENGTH, BODY_DIGEST_PREFIX } from './limits.js';
import { type SignatureVerificationReason } from './reason-codes.js';

/** The parsed, shape-valid signature envelope. All fields are non-empty strings. */
export interface SignatureEnvelope {
  /** Claimed algorithm. Validated against the supported algorithm at step 3. */
  readonly algorithm: string;
  /** Identifies which public key verifies this signature. Format-validated here; looked up at step 5. */
  readonly keyId: string;
  /** ISO-8601 UTC instant the body was signed. Instant-validated at step 4. */
  readonly signedAt: string;
  /** The signer's claimed body digest, `sha256:<64 hex>`. Compared to the computed digest at step 10. */
  readonly bodyDigest: string;
  /** The 88-character Base64 Ed25519 signature. Shape-validated here; cryptographically verified at step 13. */
  readonly signature: string;
}

/** Result of parsing an untrusted value as a signature envelope. */
export type EnvelopeParseResult =
  | { readonly ok: true; readonly envelope: SignatureEnvelope }
  | { readonly ok: false; readonly reason: SignatureVerificationReason };

const ENVELOPE_KEYS = ['algorithm', 'keyId', 'signedAt', 'bodyDigest', 'signature'] as const;
const APPROVED_KEYS: ReadonlySet<string> = new Set<string>(ENVELOPE_KEYS);

const MAX_ALGORITHM_LENGTH = 64;
const LOWERCASE_HEX = /^[0-9a-f]+$/;

function malformed(): EnvelopeParseResult {
  return { ok: false, reason: 'signature-malformed' };
}

function missing(): EnvelopeParseResult {
  return { ok: false, reason: 'signature-missing' };
}

/**
 * Read an own **data** property's string value without ever invoking an accessor.
 * Returns the string, or a sentinel describing why it could not: `absent`, `accessor`,
 * `non-enumerable`, or `not-a-string`.
 */
type FieldRead =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' };

function readStringField(input: object, key: string): FieldRead {
  const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined) {
    return { kind: 'absent' };
  }
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
    return { kind: 'invalid' };
  }
  if (descriptor.enumerable !== true) {
    return { kind: 'invalid' };
  }
  const value: unknown = descriptor.value;
  if (typeof value !== 'string') {
    return { kind: 'invalid' };
  }
  return { kind: 'value', value };
}

/**
 * Parse and strictly validate an untrusted value as a signature envelope.
 *
 * `signature-missing` when the envelope (or its `signature`) is genuinely absent or an
 * empty string; `signature-malformed` for anything present but wrong.
 */
export function parseSignatureEnvelope(input: unknown): EnvelopeParseResult {
  if (input === null || input === undefined) {
    return missing();
  }
  if (typeof input !== 'object') {
    return malformed();
  }

  try {
    if (Array.isArray(input)) {
      return malformed();
    }

    // Plain object only: Object.prototype or a null prototype. Class instances and
    // other exotic prototypes are rejected before any field is read.
    const prototype = Reflect.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return malformed();
    }

    // The signature/missing distinction takes precedence, and never invokes a getter.
    const signatureRead = readStringField(input, 'signature');
    if (signatureRead.kind === 'absent') {
      return missing();
    }
    if (signatureRead.kind === 'invalid') {
      return malformed();
    }
    if (signatureRead.value.length === 0) {
      return missing();
    }

    // Exactly the five approved keys — no symbol keys, no non-enumerable extras, no
    // unexpected string keys. Reflect.ownKeys surfaces all of them.
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== ENVELOPE_KEYS.length) {
      return malformed();
    }
    for (const key of ownKeys) {
      if (typeof key !== 'string' || !APPROVED_KEYS.has(key)) {
        return malformed();
      }
    }

    // Read each approved field as an own, enumerable, string data property.
    const reads = ENVELOPE_KEYS.map((key) => readStringField(input, key));
    for (const read of reads) {
      if (read.kind !== 'value') {
        return malformed();
      }
    }
    const [algorithm, keyId, signedAt, bodyDigest, signature] = reads.map((read) =>
      read.kind === 'value' ? read.value : '',
    ) as [string, string, string, string, string];

    // Field-format validation.
    if (algorithm.length === 0 || algorithm.length > MAX_ALGORITHM_LENGTH) {
      return malformed();
    }
    if (!isValidKeyId(keyId)) {
      return malformed();
    }
    if (signedAt.length === 0) {
      return malformed();
    }
    if (!bodyDigest.startsWith(BODY_DIGEST_PREFIX)) {
      return malformed();
    }
    const hex = bodyDigest.slice(BODY_DIGEST_PREFIX.length);
    if (hex.length !== BODY_DIGEST_HEX_LENGTH || !LOWERCASE_HEX.test(hex)) {
      return malformed();
    }
    if (decodeEd25519Signature(signature) === null) {
      return malformed();
    }

    return { ok: true, envelope: { algorithm, keyId, signedAt, bodyDigest, signature } };
  } catch {
    // A hostile Proxy trap threw. Untrusted input must not propagate a throw.
    return malformed();
  }
}
