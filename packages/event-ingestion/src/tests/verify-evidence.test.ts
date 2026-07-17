/**
 * The INTERNAL, evidence-bearing verification (Stage 3.3 slice 3).
 *
 * `verifySignatureWithEvidence` runs the same verification as the public `verifySignature`, but on
 * success also yields the signature bytes and algorithm the persistence path needs — produced from
 * the envelope it has just verified. Imported from the INTERNAL module: it is not part of the
 * package-root surface (`public-api.test.ts`).
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifySignature } from '../index.js';
import { verifySignatureWithEvidence } from '../signature/verify.js';
import { signEnvelope } from './fixtures/signer.js';
import { testPrivateKey } from './fixtures/test-keys.js';
import { testRegistry, TEST_KEY_ID } from './fixtures/registry.js';

const SIGNED_AT = '2026-07-11T09:00:05.000Z';
const NOW = new Date('2026-07-11T09:00:10.000Z');
const registry = testRegistry();

function signedBody(text: string): {
  bytes: Uint8Array;
  envelope: ReturnType<typeof signEnvelope>;
} {
  const bytes = new TextEncoder().encode(text);
  const envelope = signEnvelope({
    rawBody: bytes,
    keyId: TEST_KEY_ID,
    signedAt: SIGNED_AT,
    privateKey: testPrivateKey,
  });
  return { bytes, envelope };
}

describe('verifySignatureWithEvidence — success evidence', () => {
  it('carries the verified signature, the algorithm, and the raw-body digest — all as strings', () => {
    const { bytes, envelope } = signedBody('{"hello":"world"}');
    const result = verifySignatureWithEvidence(bytes, envelope, NOW, registry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { evidence } = result;

    expect(evidence.keyId).toBe(TEST_KEY_ID);
    expect(evidence.signedAtIso).toBe(SIGNED_AT);
    expect(evidence.algorithm).toBe('ed25519');

    // The signature is the canonical Base64 of exactly the 64 bytes the envelope carried.
    expect(typeof evidence.signatureBase64).toBe('string');
    const signatureBytes = Buffer.from(evidence.signatureBase64, 'base64');
    expect(signatureBytes).toHaveLength(64);
    expect(signatureBytes.equals(Buffer.from(envelope.signature, 'base64'))).toBe(true);

    // The body digest hex is the verifier's own sha256(rawBody).
    const expectedHex = createHash('sha256').update(bytes).digest('hex');
    expect(evidence.bodyDigestHex).toBe(expectedHex);
  });

  it('returns a frozen evidence object', () => {
    const { bytes, envelope } = signedBody('{"a":1}');
    const result = verifySignatureWithEvidence(bytes, envelope, NOW, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  it('is deeply immutable — its signature cannot be altered after verification', () => {
    // The evidence holds only immutable primitive strings, so there is no Buffer to reach into and
    // overwrite. (The previous test decoded a COPY and fill(0)'d that, proving nothing.) Here we
    // attempt the actual attack: reassign the verified signature on the returned evidence.
    const { bytes, envelope } = signedBody('{"a":1}');
    const result = verifySignatureWithEvidence(bytes, envelope, NOW, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { evidence } = result;

    expect(typeof evidence.signatureBase64).toBe('string');
    expect(Object.isFrozen(evidence)).toBe(true);

    const original = evidence.signatureBase64;
    const forged = Buffer.alloc(64, 0xff).toString('base64');
    // A frozen object in strict mode (this is an ES module) throws on assignment; either way the
    // verified signature is unchanged.
    expect(() => {
      (evidence as unknown as { signatureBase64: string }).signatureBase64 = forged;
    }).toThrow(TypeError);
    expect(evidence.signatureBase64).toBe(original);
  });
});

describe('verifySignatureWithEvidence — failures match the public verifier', () => {
  it('a tampered body fails with the same reason on both paths', () => {
    const { envelope } = signedBody('{"a":1}');
    const tampered = new TextEncoder().encode('{"a":2}');

    const evidenceResult = verifySignatureWithEvidence(tampered, envelope, NOW, registry);
    const publicResult = verifySignature(tampered, envelope, NOW, registry);

    expect(evidenceResult.ok).toBe(false);
    expect(publicResult.ok).toBe(false);
    if (evidenceResult.ok || publicResult.ok) return;
    expect(evidenceResult.reason).toBe(publicResult.reason);
    expect(evidenceResult.reason).toBe('body-digest-mismatch');
  });
});

describe('the PUBLIC verifySignature result stays safe (no bytes leak)', () => {
  it('exposes only keyId, signedAt, bodyDigestHex — never signature or algorithm bytes', () => {
    const { bytes, envelope } = signedBody('{"a":1}');
    const result = verifySignature(bytes, envelope, NOW, registry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(['bodyDigestHex', 'keyId', 'ok', 'signedAt'].sort());
    const asRecord = result as unknown as Record<string, unknown>;
    expect(asRecord['signature']).toBeUndefined();
    expect(asRecord['algorithm']).toBeUndefined();
    expect(asRecord['bodyDigest']).toBeUndefined();
  });
});
