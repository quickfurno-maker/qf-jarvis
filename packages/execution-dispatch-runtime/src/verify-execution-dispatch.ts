import { timingSafeEqual, verify as ed25519Verify } from 'node:crypto';

import { parseExecutionIntentBody } from './body/parse-intent-body.js';
import { type ExecutionDispatchResult } from './contracts/result.js';
import { deepFreeze } from './internal/freeze.js';
import { type ExecutionDispatchKeyRegistry } from './keys/execution-dispatch-key-registry.js';
import { DispatchBodyDigest } from './protocol/computed-body-digest.js';
import { parseDispatchEnvelope } from './protocol/dispatch-envelope.js';
import { ExecutionDispatchConfigError } from './protocol/errors.js';
import { parseCanonicalTimestampMs } from './protocol/field-formats.js';
import {
  BODY_DIGEST_PREFIX,
  DEFAULT_SIGNATURE_FRESHNESS_WINDOW_MS,
  MAX_RAW_BODY_BYTES,
  MAX_SIGNATURE_FRESHNESS_WINDOW_MS,
  MIN_SIGNATURE_FRESHNESS_WINDOW_MS,
  SUPPORTED_ALGORITHM,
} from './protocol/limits.js';
import { type ExecutionDispatchReason } from './protocol/reason-codes.js';
import { buildDispatchSigningInput } from './protocol/signing-input.js';
import { type ExecutionReplayGuard } from './replay/replay-guard.js';
import { checkDispatchTemporalRules } from './time/dispatch-temporal.js';

/**
 * `verifyExecutionDispatch` — the test-only B4 execution-dispatch boundary (QFJ-P09.02, ADR-0090).
 *
 * This is the validation an n8n-side adapter would run BEFORE acting on a QuickFurno Core-issued
 * `ExecutionIntentV1`. It is the Core → n8n edge. It is not, and must never become, Jarvis → n8n:
 * there is no transport here, no endpoint, no client and no credential, and the package cannot
 * reach one.
 *
 * ### What it answers
 *
 * *Did this exact raw intent arrive authentically from Core, intact, recently enough, unexpired,
 * and not as a duplicate?* Nothing more. It does not decide whether the action may happen — that
 * was Core's decision, recorded in the intent — and it does not record that anything did.
 *
 * ### The order is the contract
 *
 * Cheap and safe first; cryptography once; interpretation last; state claimed only at the very
 * end. In particular the replay guard is called ONLY after signature, integrity, contract and
 * temporal checks have all passed — a forged or expired dispatch must never be able to reserve an
 * idempotency key, because reserving one is how an attacker would suppress the legitimate dispatch
 * that follows.
 *
 * ### Two kinds of "no"
 *
 * A refused dispatch returns `{ ok: false, reason }` — data the caller counts. A CALLER mistake (an
 * invalid `now`, an out-of-range window) throws `ExecutionDispatchConfigError`. No untrusted
 * envelope or body can make this function throw.
 */

/** Optional knobs. The freshness window defaults to two minutes and is bounded. */
export interface VerifyExecutionDispatchOptions {
  /** Half-width of the accepted `signedAt` window around `now`, in milliseconds. */
  readonly signatureFreshnessWindowMs?: number;
}

/** Everything the boundary needs. All of it injected; none of it read from the environment. */
export interface VerifyExecutionDispatchInput {
  /**
   * The exact bytes received, as one serialized `ExecutionIntentV1`.
   *
   * COPIED immediately on entry. The caller may own a pooled or reused buffer, and this function
   * awaits an injected guard partway through — so without a detached copy a caller could mutate the
   * bytes between the hash and the parse, and what was verified would not be what was returned.
   */
  readonly rawBody: Uint8Array;
  /** The untrusted signature envelope. Fully validated; cannot make this throw. */
  readonly envelope: unknown;
  /** The execution-boundary instant, injected. This module reads no clock. */
  readonly now: Date;
  /** Execution-dispatch keys. A DIFFERENT trust purpose from Core → Jarvis event keys. */
  readonly registry: ExecutionDispatchKeyRegistry;
  /** The atomic claim-or-report store. Required: there is no safe default. */
  readonly replayGuard: ExecutionReplayGuard;
  readonly options?: VerifyExecutionDispatchOptions;
}

function refuse(reason: ExecutionDispatchReason): ExecutionDispatchResult {
  return { ok: false, reason };
}

export async function verifyExecutionDispatch(
  input: VerifyExecutionDispatchInput,
): Promise<ExecutionDispatchResult> {
  const { envelope, now, registry, replayGuard, options = {} } = input;

  // 1. Size first — before configuration, before the envelope is touched, before any hashing. An
  //    oversized body is refused for the cost of reading one number.
  if (input.rawBody.byteLength > MAX_RAW_BODY_BYTES) {
    return refuse('body-too-large');
  }

  // 1b. DETACHED SNAPSHOT, taken before anything else reads the bytes and before the first `await`.
  //     Everything downstream — the digest, the parse, the result — uses this copy, so a caller
  //     mutating its own buffer mid-flight cannot change what was verified.
  const rawBody = Uint8Array.prototype.slice.call(input.rawBody) as Uint8Array;

  // 2. Caller-contract checks. These THROW: they are wiring defects, not hostile input.
  if (Number.isNaN(now.getTime())) {
    throw new ExecutionDispatchConfigError('now must be a valid Date');
  }
  const freshnessWindowMs =
    options.signatureFreshnessWindowMs ?? DEFAULT_SIGNATURE_FRESHNESS_WINDOW_MS;
  if (
    !Number.isInteger(freshnessWindowMs) ||
    freshnessWindowMs < MIN_SIGNATURE_FRESHNESS_WINDOW_MS ||
    freshnessWindowMs > MAX_SIGNATURE_FRESHNESS_WINDOW_MS
  ) {
    throw new ExecutionDispatchConfigError(
      `signatureFreshnessWindowMs must be an integer within [${String(MIN_SIGNATURE_FRESHNESS_WINDOW_MS)}, ${String(MAX_SIGNATURE_FRESHNESS_WINDOW_MS)}]`,
    );
  }
  // Read the injected instant ONCE. Re-reading a caller-supplied Date mid-flight would let a
  // mutable clock answer two different questions differently.
  const nowMs = now.getTime();

  // 3. Envelope shape, strict and adversarial. Copies out primitive strings; nothing below ever
  //    re-reads the caller's object.
  const parsed = parseDispatchEnvelope(envelope);
  if (!parsed.ok) {
    return refuse(parsed.reason);
  }
  const env = parsed.envelope;

  // 4. Algorithm. One value; no negotiation and no fallback.
  if (env.algorithm !== SUPPORTED_ALGORITHM) {
    return refuse('unsupported-algorithm');
  }

  // 5. `signedAt` is a canonical instant.
  const signedAtMs = parseCanonicalTimestampMs(env.signedAt);
  if (signedAtMs === null) {
    return refuse('signed-at-malformed');
  }

  // 6. Key lookup — by id, never by trial.
  const record = registry.find(env.keyId);
  if (record === undefined) {
    return refuse('unknown-key-id');
  }

  // 7. Key status and validity AT SIGNING TIME, not at now. A key valid when it signed stays a
  //    valid explanation of that signature after it rotates out.
  if (record.status === 'revoked') {
    return refuse('key-revoked');
  }
  if (signedAtMs < record.validFromMs) {
    return refuse('key-not-yet-valid');
  }
  if (signedAtMs >= record.validUntilMs) {
    return refuse('key-expired');
  }

  // 8. Signature freshness, around the injected now. This window tolerates clock skew and is the
  //    ONLY place skew is tolerated — see `dispatch-temporal.ts`.
  if (signedAtMs < nowMs - freshnessWindowMs) {
    return refuse('signature-stale');
  }
  if (signedAtMs > nowMs + freshnessWindowMs) {
    return refuse('signature-future');
  }

  // 9. The verifier's OWN digest over the detached bytes.
  const computedDigest = DispatchBodyDigest.fromRawBody(rawBody);

  // 10. Compare the CLAIMED digest to the computed one, in constant time.
  const claimedDigest = Buffer.from(env.bodyDigest.slice(BODY_DIGEST_PREFIX.length), 'hex');
  if (
    claimedDigest.length !== computedDigest.bytes.length ||
    !timingSafeEqual(claimedDigest, computedDigest.bytes)
  ) {
    return refuse('body-digest-mismatch');
  }

  // 11. Build the signing input FROM THE COMPUTED DIGEST. The parameter type is nominal, so the
  //     claimed digest cannot be substituted here even by mistake.
  const signingInput = buildDispatchSigningInput(env.keyId, env.signedAt, computedDigest);

  // 12. Decode the signature. The parser already proved canonical 88-character Base64 of 64 bytes.
  const signatureBytes = Buffer.from(env.signature, 'base64');

  // 13. Verify Ed25519 under the B4 domain. A signature minted for Core → Jarvis event ingestion
  //     fails here, because its signing input carried a different domain prefix.
  let valid: boolean;
  try {
    valid = ed25519Verify(null, signingInput, record.publicKey, signatureBytes);
  } catch {
    valid = false;
  }
  if (!valid) {
    return refuse('signature-invalid');
  }

  // --- authenticity established. ONLY NOW is the body interpreted. ------------------------------

  // 14. Decode and validate as exactly one ExecutionIntentV1, through the one authoritative schema.
  const body = parseExecutionIntentBody(rawBody);
  if (!body.ok) {
    return refuse(body.reason);
  }
  const intent = body.intent;

  // 15. Dispatch-time temporal rules: signed-before-issued, signed-after-expiry, expired-now.
  const temporal = checkDispatchTemporalRules(intent, signedAtMs, nowMs);
  if (!temporal.ok) {
    return refuse(temporal.reason);
  }

  // 16. ONLY NOW claim replay/idempotency. Everything above had to pass first: a forged, malformed
  //     or expired dispatch must never reserve a key, or an attacker could burn the idempotency key
  //     of a legitimate dispatch that has not arrived yet.
  let outcome: string;
  try {
    outcome = await replayGuard.claim({
      executionIntentId: intent.executionIntentId,
      idempotencyKey: intent.idempotencyKey,
      // The verifier's digest, not the sender's claim.
      bodyDigestHex: computedDigest.hex,
    });
  } catch {
    // The store could not answer. It is NOT "assume first seen": an unavailable replay store is
    // exactly the moment a duplicate is most likely. Fail closed, and do not retry here — a retry
    // inside an already-authenticated boundary is how one instruction becomes two effects.
    return refuse('replay-guard-unavailable');
  }

  if (outcome === 'conflict') {
    return refuse('idempotency-conflict');
  }
  if (outcome !== 'first-seen' && outcome !== 'exact-replay') {
    // A guard that answered something outside the closed set is not a guard this boundary can
    // reason about. Treated as unavailable rather than optimistically accepted.
    return refuse('replay-guard-unavailable');
  }

  // 17. A frozen observation. Not an authorization, not an execution result.
  return deepFreeze({
    ok: true,
    kind: 'validated-dispatch-observation',
    disposition: outcome,
    intent,
    keyId: env.keyId,
    signedAtIso: new Date(signedAtMs).toISOString(),
    bodyDigestHex: computedDigest.hex,
  } as const);
}
