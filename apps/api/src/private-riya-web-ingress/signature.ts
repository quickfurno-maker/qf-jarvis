/**
 * Ed25519 request authentication for the private ingress (ADR-0097).
 *
 * ### Why asymmetric, and not a shared secret
 *
 * QuickFurno Core holds the PRIVATE signing key. Jarvis holds only PUBLIC verification keys. That
 * asymmetry is the whole design: with a shared HMAC secret, anything able to verify a QuickFurno
 * request is also able to FORGE one, so a compromise of this repository — or of one deployment of
 * it, or of a log line, or of a backup — would hand an attacker the ability to impersonate the
 * business authority. A public key cannot do that. Jarvis is deliberately incapable of producing a
 * signature it would accept.
 *
 * For the same reason there is no browser bearer token, cookie, session token, body API key, Basic
 * Auth or IP allowlist here. An IP is a hint about a network path, not proof of who wrote a message.
 *
 * ### What a valid signature proves, and what it does not
 *
 * It proves the request came through the configured private QuickFurno trust boundary and arrived
 * BYTE-IDENTICAL to what was signed. It does not authorize a reply, a lead, a consent state, a vendor
 * action or a delivery. Authentication is not authorization: whether client-facing text may exist is
 * still decided by the existing M2/M3 Core-decision chain, and reaches this layer only as
 * `authorizedReply`.
 *
 * ### Never an oracle
 *
 * Every failure here returns the same `authentication-failed`. Distinguishing "unknown key id" from
 * "bad signature" from "stale timestamp" helps only somebody who does not already hold the private
 * key. Nothing logs, echoes or returns key bytes, signature bytes or the raw body.
 */
import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

import {
  PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
  PRIVATE_RIYA_WEB_INGRESS_CALLER,
  PRIVATE_RIYA_WEB_INGRESS_METHOD,
  PRIVATE_RIYA_WEB_INGRESS_PATH,
} from './contracts.js';
import { PrivateRiyaWebIngressError } from './errors.js';

/** The header carrying the key id. Lowercase because Node lowercases incoming header names. */
export const KEY_ID_HEADER = 'x-qfj-key-id';
/** The header carrying the base64url Ed25519 signature bytes. */
export const SIGNATURE_HEADER = 'x-qfj-signature';

/** The signing-input domain tag. Version it, so a v2 input can never be replayed as a v1. */
export const SIGNING_INPUT_DOMAIN = 'qfj.riya.web.ingress.sig.v1';

/** Owner-locked freshness window, in milliseconds. `issuedAt` must be within ±60 seconds. */
export const FRESHNESS_WINDOW_MS = 60_000;

/** The key-ring bounds. One key is enough to run; four is enough to rotate through. */
export const MIN_VERIFICATION_KEYS = 1;
export const MAX_VERIFICATION_KEYS = 4;

/** A key id: bounded and identifier-shaped, so it is safe to compare and safe to store. */
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u;

/** One configured verification key. `publicKeyPem` is an SPKI PEM — never a private key. */
export interface PrivateRiyaWebIngressVerificationKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
}

/** The immutable, validated key ring the handler verifies against. */
export interface VerificationKeyRing {
  /** The key for this id, or `undefined`. An unknown id is an authentication failure, not an error. */
  readonly get: (keyId: string) => KeyObject | undefined;
  /** The configured key ids, for construction-time proofs. Never the key material. */
  readonly keyIds: readonly string[];
}

/**
 * Validate and freeze a key ring. Throws at CONSTRUCTION — never mid-request.
 *
 * A ring that is empty, oversized, duplicated, malformed or not Ed25519 is a deployment defect. It
 * must surface when the handler is built, not on the first request from a real gateway.
 */
export function createVerificationKeyRing(
  keys: readonly PrivateRiyaWebIngressVerificationKey[],
): VerificationKeyRing {
  if (!Array.isArray(keys) || keys.length < MIN_VERIFICATION_KEYS) {
    throw new PrivateRiyaWebIngressError('internal-invariant');
  }
  if (keys.length > MAX_VERIFICATION_KEYS) {
    throw new PrivateRiyaWebIngressError('internal-invariant');
  }
  const byId = new Map<string, KeyObject>();
  for (const entry of keys) {
    const keyId: unknown = (entry as { keyId?: unknown } | undefined)?.keyId;
    const pem: unknown = (entry as { publicKeyPem?: unknown } | undefined)?.publicKeyPem;
    if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId) || byId.has(keyId)) {
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    if (typeof pem !== 'string' || pem.length === 0) {
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    // Refuse PRIVATE key material by inspecting the PEM label, BEFORE parsing it.
    //
    // This is not belt-and-braces. `createPublicKey` accepts a private key and silently derives the
    // public half from it, and the resulting `KeyObject` reports `type: 'public'` — so a deployment
    // that pasted a signing key into this config would work perfectly, and Jarvis would be holding
    // material capable of impersonating QuickFurno Core with nothing to reveal it. The label is the
    // only place that distinction survives.
    if (pem.includes('PRIVATE KEY')) {
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    let key: KeyObject;
    try {
      key = createPublicKey(pem);
    } catch {
      // The underlying OpenSSL error is discarded: it can quote key bytes.
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    // A PRIVATE key handed in here would be a serious deployment mistake, and `createPublicKey`
    // accepts one by deriving the public half -- so the type is checked explicitly rather than
    // assumed. Jarvis must never hold signing material.
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new PrivateRiyaWebIngressError('internal-invariant');
    }
    byId.set(keyId, key);
  }
  const ids = Object.freeze([...byId.keys()]);
  return Object.freeze({
    get: (keyId: string): KeyObject | undefined => byId.get(keyId),
    keyIds: ids,
  });
}

/** base64url of the SHA-256 of the RAW body bytes. Never of a re-serialization. */
export function rawBodyDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('base64url');
}

/**
 * The exact bytes a caller signs.
 *
 * Nine LF-delimited lines, no trailing newline, no trimming, no JSON re-serialization anywhere. The
 * body is bound as a digest of its RAW bytes, so a single byte changed after signing — a re-encoded
 * space, a reordered key, an added field — fails. Method, path, caller and audience are bound too:
 * a signature captured for this route cannot be replayed against another, and one issued for a
 * different audience is not valid here at all.
 */
export function canonicalSigningInput(args: {
  readonly method: string;
  readonly path: string;
  readonly caller: string;
  readonly audience: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return [
    SIGNING_INPUT_DOMAIN,
    args.method,
    args.path,
    args.caller,
    args.audience,
    args.requestId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}

/** Decode a base64url signature, or `undefined`. Ed25519 signatures are exactly 64 bytes. */
function decodeSignature(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) {
    return undefined;
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, 'base64url');
  } catch {
    return undefined;
  }
  return bytes.length === 64 ? bytes : undefined;
}

/** A single header value, or `undefined` when absent, duplicated or malformed. */
export function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  // A DUPLICATED header is refused rather than resolved. Node exposes repeats as an array, and
  // picking one would let a caller present two key ids and have the ingress choose -- which is how
  // request smuggling turns into signature confusion.
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value;
  return trimmed.length === 0 || trimmed.length > 1024 ? undefined : trimmed;
}

/** `true` iff `issuedAt` is a real instant inside the ±60s window around `now`. */
export function isFresh(issuedAt: string, now: string): boolean {
  const issued = Date.parse(issuedAt);
  const current = Date.parse(now);
  if (Number.isNaN(issued) || Number.isNaN(current)) {
    return false;
  }
  // Symmetric: a clock skewed FORWARD is as much a problem as a stale replay, because it would
  // extend a signature's usable life beyond the window this guard is supposed to bound.
  return Math.abs(current - issued) <= FRESHNESS_WINDOW_MS;
}

/**
 * Verify one request's authentication. Throws the single bounded failure, or returns.
 *
 * Order is deliberate: cheap structural checks first, the Ed25519 verification last. Nothing here
 * branches on which check failed in what it reports.
 */
export function verifyIngressSignature(args: {
  readonly keyRing: VerificationKeyRing;
  readonly keyIdHeader: string | readonly string[] | undefined;
  readonly signatureHeader: string | readonly string[] | undefined;
  readonly method: string;
  readonly path: string;
  readonly caller: string;
  readonly audience: string;
  readonly requestId: string;
  readonly issuedAt: string;
  readonly rawBody: Buffer;
  readonly now: string;
}): void {
  const fail = (): never => {
    throw new PrivateRiyaWebIngressError('authentication-failed');
  };

  const keyId = singleHeader(args.keyIdHeader);
  const signatureValue = singleHeader(args.signatureHeader);
  if (keyId === undefined || signatureValue === undefined || !KEY_ID_PATTERN.test(keyId)) {
    return fail();
  }
  // The caller/audience a signature commits to must be the ones this ingress serves. Checked before
  // the crypto so a signature for another audience can never even be evaluated here.
  if (
    args.caller !== PRIVATE_RIYA_WEB_INGRESS_CALLER ||
    args.audience !== PRIVATE_RIYA_WEB_INGRESS_AUDIENCE ||
    args.method !== PRIVATE_RIYA_WEB_INGRESS_METHOD ||
    args.path !== PRIVATE_RIYA_WEB_INGRESS_PATH
  ) {
    return fail();
  }
  if (!isFresh(args.issuedAt, args.now)) {
    return fail();
  }
  const signature = decodeSignature(signatureValue);
  const key = args.keyRing.get(keyId);
  if (signature === undefined || key === undefined) {
    return fail();
  }
  const input = Buffer.from(
    canonicalSigningInput({
      method: args.method,
      path: args.path,
      caller: args.caller,
      audience: args.audience,
      requestId: args.requestId,
      issuedAt: args.issuedAt,
      keyId,
      bodyDigest: rawBodyDigest(args.rawBody),
    }),
    'utf8',
  );
  let valid: boolean;
  try {
    // `null` is the required algorithm for Ed25519 in `crypto.verify`.
    valid = verify(null, input, key, signature);
  } catch {
    // A crypto error is discarded rather than surfaced: it can name key parameters.
    return fail();
  }
  if (!valid) {
    return fail();
  }
}

/** Constant-time equality for two digests of equal length. Used by the replay guard. */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
