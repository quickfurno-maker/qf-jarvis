/**
 * The execution-dispatch signature envelope, and a strict, adversarial, hand-written parser.
 *
 * The envelope travels alongside the raw body and describes how it was signed:
 *
 * ```
 * { algorithm, keyId, signedAt, bodyDigest: 'sha256:<hex>', signature: <88-char base64> }
 * ```
 *
 * It is treated as fully hostile. The parser:
 *
 * - accepts only a PLAIN object — `Object.prototype` or a null prototype. Arrays, class instances
 *   and other exotic prototypes are rejected before any field is read;
 * - uses `Reflect.ownKeys`, so SYMBOL and NON-ENUMERABLE extras are detected — a hidden key cannot
 *   ride along beside the five approved ones;
 * - requires exactly the five approved string keys;
 * - reads only own DATA-property descriptor values, so it never invokes a getter, never triggers a
 *   setter, and never reads an inherited value. A field whose value is produced by an accessor is
 *   rejected without that accessor ever running;
 * - wraps every reflective operation, so a hostile `Proxy` that throws from a trap yields a stable
 *   `signature-malformed` rather than propagating the throw out of the boundary.
 *
 * No untrusted envelope can make this parser throw, and none of its values are echoed in a refusal.
 *
 * It validates SHAPE and FIELD FORMAT only. Whether the algorithm is supported, and whether
 * `signedAt` is a real instant, are deliberately later steps so those failures earn their own
 * specific reason codes rather than collapsing into "malformed".
 */
import { decodeEd25519Signature, isValidKeyId } from './field-formats.js';
import { BODY_DIGEST_HEX_LENGTH, BODY_DIGEST_PREFIX } from './limits.js';
import { type ExecutionDispatchReason } from './reason-codes.js';

/** The parsed, shape-valid dispatch envelope. All fields are non-empty strings. */
export interface DispatchSignatureEnvelope {
  /** Claimed algorithm. Checked against the supported algorithm at a later step. */
  readonly algorithm: string;
  /** Which key verifies this signature. Format-validated here; looked up later. */
  readonly keyId: string;
  /** ISO-8601 UTC instant the body was signed. Instant-validated later. */
  readonly signedAt: string;
  /** The signer's CLAIMED digest, `sha256:<64 hex>`. Only ever compared to the computed one. */
  readonly bodyDigest: string;
  /** The 88-character Base64 Ed25519 signature. Shape-validated here; verified later. */
  readonly signature: string;
}

export type DispatchEnvelopeParseResult =
  | { readonly ok: true; readonly envelope: DispatchSignatureEnvelope }
  | { readonly ok: false; readonly reason: ExecutionDispatchReason };

const ENVELOPE_KEYS = ['algorithm', 'keyId', 'signedAt', 'bodyDigest', 'signature'] as const;
const APPROVED_KEYS: ReadonlySet<string> = new Set<string>(ENVELOPE_KEYS);

const MAX_ALGORITHM_LENGTH = 64;
const LOWERCASE_HEX = /^[0-9a-f]+$/;

function malformed(): DispatchEnvelopeParseResult {
  return { ok: false, reason: 'signature-malformed' };
}

function missing(): DispatchEnvelopeParseResult {
  return { ok: false, reason: 'signature-missing' };
}

/**
 * Read an own DATA property's string value without ever invoking an accessor.
 *
 * The `accessor` case is the one that matters: a getter on the envelope could run arbitrary code,
 * observe that verification is happening, or return a different value on a second read. It is
 * refused without being called.
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
 * Parse and strictly validate an untrusted value as a dispatch signature envelope.
 *
 * `signature-missing` when the envelope or its `signature` is genuinely absent or empty;
 * `signature-malformed` for anything present but wrong.
 */
export function parseDispatchEnvelope(input: unknown): DispatchEnvelopeParseResult {
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

    const prototype = Reflect.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return malformed();
    }

    // The missing/malformed distinction is decided first, and still never invokes a getter.
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

    // Exactly the five approved keys: no symbol keys, no non-enumerable extras, no surprises.
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== ENVELOPE_KEYS.length) {
      return malformed();
    }
    for (const key of ownKeys) {
      if (typeof key !== 'string' || !APPROVED_KEYS.has(key)) {
        return malformed();
      }
    }

    const reads = ENVELOPE_KEYS.map((key) => readStringField(input, key));
    for (const read of reads) {
      if (read.kind !== 'value') {
        return malformed();
      }
    }
    const [algorithm, keyId, signedAt, bodyDigest, signature] = reads.map((read) =>
      read.kind === 'value' ? read.value : '',
    ) as [string, string, string, string, string];

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

    // Every value below is a primitive string COPIED out of the envelope. Nothing downstream ever
    // reads the caller's object again, so a mutation after this point cannot change what is
    // verified or what is returned.
    return { ok: true, envelope: { algorithm, keyId, signedAt, bodyDigest, signature } };
  } catch {
    // A hostile Proxy trap threw. Untrusted input must never propagate a throw out of the boundary.
    return malformed();
  }
}
