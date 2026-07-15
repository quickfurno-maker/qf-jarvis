/**
 * The critical invariant of Stage 3.2 (ADR-0027 §2), given its own file so a regression
 * cannot hide among the general verification tests:
 *
 *   The signing input is built from the digest the verifier computes over the raw bytes —
 *   never from the envelope's untrusted, claimed `bodyDigest` — and a claimed-vs-computed
 *   mismatch is refused BEFORE the Ed25519 verification ever runs.
 *
 * The structural half is enforced by the type system: `buildSigningInput` accepts a
 * nominal `ComputedBodyDigest`, so a plain string (the claimed digest), the whole
 * envelope, or an `unknown` cannot be passed to it. Because the quality gate type-checks
 * these test files, an attempt to weaken that boundary fails the gate.
 */
import { describe, expect, it } from 'vitest';

import { verifySignature } from '../index.js';
import { ComputedBodyDigest } from '../signature/computed-body-digest.js';
import { buildSigningInput } from '../signature/signing-input.js';
import { signEnvelope } from './fixtures/signer.js';
import { TEST_KEY_ID, testRegistry } from './fixtures/registry.js';
import { testPrivateKey } from './fixtures/test-keys.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const SIGNED_AT = '2026-07-15T12:00:00.000Z';
const RAW = new TextEncoder().encode('{"eventId":"critical-invariant"}');

describe('CRITICAL INVARIANT — signing input uses the verifier-computed digest', () => {
  it('STRUCTURAL: buildSigningInput accepts exactly (keyId, signedAt, ComputedBodyDigest) — arity 3, not the envelope', () => {
    expect(buildSigningInput).toHaveLength(3);
  });

  it('the signing input embeds hex(sha256(rawBody)); for a genuine event this equals the claimed digest, and it verifies', () => {
    const envelope = signEnvelope({
      rawBody: RAW,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: testPrivateKey,
    });
    const computed = ComputedBodyDigest.fromRawBody(RAW);
    const signingInput = buildSigningInput(TEST_KEY_ID, SIGNED_AT, computed).toString('utf8');

    expect(signingInput.endsWith(`\n${computed.hex}`)).toBe(true);
    expect(envelope.bodyDigest).toBe(`sha256:${computed.hex}`);
    expect(verifySignature(RAW, envelope, NOW, testRegistry()).ok).toBe(true);
  });

  it('a claimed bodyDigest that disagrees with the body is refused (step 10) before Ed25519 verification (step 13)', () => {
    const otherBody = new TextEncoder().encode('{"eventId":"a-different-body"}');
    const envelopeForOther = signEnvelope({
      rawBody: otherBody,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: testPrivateKey,
    });
    expect(verifySignature(RAW, envelopeForOther, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'body-digest-mismatch',
    });
  });
});

describe('CRITICAL INVARIANT — ComputedBodyDigest is truly nominal (compile-time)', () => {
  it('accepts a real ComputedBodyDigest and rejects forgeries at compile time', () => {
    const real = ComputedBodyDigest.fromRawBody(RAW);
    expect(buildSigningInput(TEST_KEY_ID, SIGNED_AT, real)).toBeInstanceOf(Buffer);

    // A structurally-matching object: same public field shape as ComputedBodyDigest.
    const forgedStructuralDigest = { hex: '00'.repeat(32), bytes: Buffer.alloc(32) };
    const claimedDigestString = '00'.repeat(32);
    const forgedEnvelope = { algorithm: 'ed25519', keyId: TEST_KEY_ID };
    const unknownValue: unknown = forgedStructuralDigest;

    // COMPILE-TIME assertions. This function is never invoked, but the root typecheck
    // type-checks test files, so tsc verifies each @ts-expect-error is a real error. If the
    // brand were removed and the nominal boundary weakened, a @ts-expect-error would become
    // unused and the typecheck would FAIL.
    function _nominalityIsEnforcedAtCompileTime(): void {
      // @ts-expect-error — ComputedBodyDigest is nominal; a structurally-matching object is not assignable.
      buildSigningInput(TEST_KEY_ID, SIGNED_AT, forgedStructuralDigest);
      // @ts-expect-error — a claimed digest string is not a ComputedBodyDigest.
      buildSigningInput(TEST_KEY_ID, SIGNED_AT, claimedDigestString);
      // @ts-expect-error — the whole envelope is not a ComputedBodyDigest.
      buildSigningInput(TEST_KEY_ID, SIGNED_AT, forgedEnvelope);
      // @ts-expect-error — unknown is not a ComputedBodyDigest.
      buildSigningInput(TEST_KEY_ID, SIGNED_AT, unknownValue);
    }

    // Reference it so it is not "unused"; it is never called, so nothing runs.
    expect(typeof _nominalityIsEnforcedAtCompileTime).toBe('function');
    expect(forgedStructuralDigest.hex).toHaveLength(64);
  });
});
