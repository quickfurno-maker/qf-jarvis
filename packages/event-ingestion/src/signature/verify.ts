/**
 * `verifySignature` — a **pure, synchronous** Ed25519 signature verifier.
 *
 * This is the whole of Stage 3.2. It answers exactly one question: *did this raw body
 * really come from a holder of a known Core signing key, unaltered, recently enough,
 * under a key that was valid when it signed?* It does **not** parse the event, touch a
 * database, deduplicate, or decide what to do next — those are Stage 3.3 and beyond.
 *
 * ### Pure, and why that matters
 *
 * The function reads no clock, no environment, no file, and no socket. The current time
 * is **injected** as `now`, and the keys are **injected** as `registry`. Given the same
 * inputs it always returns the same result — so freshness can be tested at a simulated
 * 2030 and a simulated 2000 without waiting or mocking a clock (ADR-0020 §3). It never
 * calls `Date.now`; replacing `Date.now` with a function that throws does not affect it.
 *
 * ### Two kinds of "no"
 *
 * A rejected event returns `{ ok: false, reason }` — data the caller counts. A caller
 * *mistake* (an out-of-range window, an invalid `now`) **throws** a
 * `SignatureVerificationConfigError`. No untrusted **envelope** can make it throw.
 *
 * ### The order is the contract (ADR-0027)
 *
 * The steps below run in this exact order, and the first failure wins: cheap-and-safe
 * first (size, then shape, then metadata), and only once everything else has passed does
 * it spend a hash and an Ed25519 verification.
 */
import { timingSafeEqual, verify as ed25519Verify } from 'node:crypto';

import { ComputedBodyDigest } from './computed-body-digest.js';
import { SignatureVerificationConfigError } from './errors.js';
import { parseCanonicalTimestampMs } from './field-formats.js';
import {
  BODY_DIGEST_PREFIX,
  DEFAULT_FRESHNESS_WINDOW_MS,
  MAX_FRESHNESS_WINDOW_MS,
  MAX_RAW_BODY_BYTES,
  MIN_FRESHNESS_WINDOW_MS,
  SUPPORTED_ALGORITHM,
} from './limits.js';
import { type PublicKeyRegistry } from './public-key-registry.js';
import { type SignatureVerificationReason } from './reason-codes.js';
import { parseSignatureEnvelope } from './signature-envelope.js';
import { buildSigningInput } from './signing-input.js';

/** Optional knobs. The freshness window defaults to five minutes and is bounded. */
export interface VerifySignatureOptions {
  /** Half-width of the accepted `signedAt` window around `now`, in milliseconds. */
  readonly freshnessWindowMs?: number;
}

/** A verified event. Carries only safe metadata — never the body, signature, or key. */
export interface SignatureVerificationSuccess {
  readonly ok: true;
  /** The key id that verified the signature. */
  readonly keyId: string;
  /** The parsed `signedAt` instant. */
  readonly signedAt: Date;
  /** The verifier-computed `hex(sha256(rawBody))`. */
  readonly bodyDigestHex: string;
}

/** A refused event. Carries a stable reason and nothing else. */
export interface SignatureVerificationFailure {
  readonly ok: false;
  readonly reason: SignatureVerificationReason;
}

/** The bounded, safe result of verification. */
export type SignatureVerificationResult =
  SignatureVerificationSuccess | SignatureVerificationFailure;

function fail(reason: SignatureVerificationReason): SignatureVerificationFailure {
  return { ok: false, reason };
}

/**
 * Verify an Ed25519 signature over a raw event body.
 *
 * @param rawBody   The exact bytes as received. Never parsed here.
 * @param envelope  The untrusted signature envelope. Validated in full; cannot make this throw.
 * @param now       The current instant, injected. The verifier reads no clock.
 * @param registry  The public keys, injected. Looked up by `keyId`, never by trial.
 * @param options   Optional bounded freshness window (default 5 minutes).
 */
export function verifySignature(
  rawBody: Uint8Array,
  envelope: unknown,
  now: Date,
  registry: PublicKeyRegistry,
  options: VerifySignatureOptions = {},
): SignatureVerificationResult {
  // 1. Raw-body size is step 1 (ADR-0027): refused FIRST — before the caller-config
  //    checks, before the envelope is touched, before hashing, before cryptography.
  if (rawBody.byteLength > MAX_RAW_BODY_BYTES) {
    return fail('body-too-large');
  }

  // Caller-contract checks. These throw — they are not envelope rejections.
  if (Number.isNaN(now.getTime())) {
    throw new SignatureVerificationConfigError('now must be a valid Date');
  }
  const freshnessWindowMs = options.freshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;
  if (
    !Number.isInteger(freshnessWindowMs) ||
    freshnessWindowMs < MIN_FRESHNESS_WINDOW_MS ||
    freshnessWindowMs > MAX_FRESHNESS_WINDOW_MS
  ) {
    throw new SignatureVerificationConfigError(
      `freshnessWindowMs must be an integer within [${String(MIN_FRESHNESS_WINDOW_MS)}, ${String(MAX_FRESHNESS_WINDOW_MS)}]`,
    );
  }

  // 2. Envelope shape (strict, adversarial).
  const parsed = parseSignatureEnvelope(envelope);
  if (!parsed.ok) {
    return fail(parsed.reason);
  }
  const env = parsed.envelope;

  // 3. Algorithm.
  if (env.algorithm !== SUPPORTED_ALGORITHM) {
    return fail('unsupported-algorithm');
  }

  // 4. signedAt is a canonical instant.
  const signedAtMs = parseCanonicalTimestampMs(env.signedAt);
  if (signedAtMs === null) {
    return fail('signed-at-malformed');
  }

  // 5. Key lookup — by keyId, never by trial.
  const record = registry.find(env.keyId);
  if (record === undefined) {
    return fail('unknown-key-id');
  }

  // 6. Key status.
  if (record.status === 'revoked') {
    return fail('key-revoked');
  }

  // 7. Key validity: validFrom <= signedAt < validUntil.
  if (signedAtMs < record.validFromMs) {
    return fail('key-not-yet-valid');
  }
  if (signedAtMs >= record.validUntilMs) {
    return fail('key-expired');
  }

  // 8. Freshness: now - window <= signedAt <= now + window.
  const nowMs = now.getTime();
  if (signedAtMs < nowMs - freshnessWindowMs) {
    return fail('replay-window-expired');
  }
  if (signedAtMs > nowMs + freshnessWindowMs) {
    return fail('replay-window-future');
  }

  // 9. Compute SHA-256 over the raw body — the verifier's own digest. `ComputedBodyDigest`
  //    is a nominal type: the claimed digest string cannot masquerade as this value.
  const computedDigest = ComputedBodyDigest.fromRawBody(rawBody);

  // 10. Compare the claimed body digest to the computed one, in constant time.
  const claimedDigest = Buffer.from(env.bodyDigest.slice(BODY_DIGEST_PREFIX.length), 'hex');
  if (
    claimedDigest.length !== computedDigest.bytes.length ||
    !timingSafeEqual(claimedDigest, computedDigest.bytes)
  ) {
    return fail('body-digest-mismatch');
  }

  // 11. Build the signing input FROM THE COMPUTED DIGEST, never the envelope's claim.
  //     buildSigningInput accepts only a ComputedBodyDigest, so this is enforced by types.
  const signingInput = buildSigningInput(env.keyId, env.signedAt, computedDigest);

  // 12. Decode the signature. The parser already proved it is 88-char canonical Base64
  //     of exactly 64 bytes, so this decode cannot fail — a bad shape was signature-malformed.
  const signatureBytes = Buffer.from(env.signature, 'base64');

  // 13. Verify Ed25519. Only a correctly shaped signature that fails cryptographically
  //     reaches here as signature-invalid.
  let valid: boolean;
  try {
    valid = ed25519Verify(null, signingInput, record.publicKey, signatureBytes);
  } catch {
    valid = false;
  }
  if (!valid) {
    return fail('signature-invalid');
  }

  // 14. A bounded, safe success — no raw body, no signature bytes, no key material.
  return {
    ok: true,
    keyId: env.keyId,
    signedAt: new Date(signedAtMs),
    bodyDigestHex: computedDigest.hex,
  };
}
