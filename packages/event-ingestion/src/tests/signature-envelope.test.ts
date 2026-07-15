import { describe, expect, it } from 'vitest';

import { parseSignatureEnvelope } from '../signature/signature-envelope.js';

/** A canonical 88-character Ed25519 signature (64 zero bytes): 86 data chars + `==`. */
const VALID_SIGNATURE = `${'A'.repeat(86)}==`;

const VALID = {
  algorithm: 'ed25519',
  keyId: 'test-core-key-a',
  signedAt: '2026-07-15T12:00:00.000Z',
  bodyDigest: `sha256:${'ab'.repeat(32)}`,
  signature: VALID_SIGNATURE,
};

describe('parseSignatureEnvelope — accepts a well-formed envelope', () => {
  it('returns the parsed envelope for a valid shape', () => {
    const result = parseSignatureEnvelope({ ...VALID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope).toEqual(VALID);
    }
  });

  it('accepts a null-prototype plain object (the safest carrier of all)', () => {
    const object = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(VALID)) {
      object[key] = value;
    }
    expect(parseSignatureEnvelope(object).ok).toBe(true);
  });
});

describe('parseSignatureEnvelope — signature-missing', () => {
  it('null is missing', () => {
    expect(parseSignatureEnvelope(null)).toEqual({ ok: false, reason: 'signature-missing' });
  });

  it('undefined is missing', () => {
    expect(parseSignatureEnvelope(undefined)).toEqual({ ok: false, reason: 'signature-missing' });
  });

  it('an absent signature field is missing, not malformed', () => {
    const { signature: _omitted, ...rest } = VALID;
    expect(parseSignatureEnvelope(rest)).toEqual({ ok: false, reason: 'signature-missing' });
  });

  it('an empty signature string is missing', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: '' })).toEqual({
      ok: false,
      reason: 'signature-missing',
    });
  });
});

describe('parseSignatureEnvelope — signature-malformed (shape)', () => {
  it('a primitive is malformed', () => {
    expect(parseSignatureEnvelope('nope')).toEqual({ ok: false, reason: 'signature-malformed' });
  });

  it('an array is malformed', () => {
    expect(parseSignatureEnvelope([VALID])).toEqual({ ok: false, reason: 'signature-malformed' });
  });

  it('an unknown extra key is malformed', () => {
    expect(parseSignatureEnvelope({ ...VALID, extra: 'x' })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('a non-string field is malformed', () => {
    expect(parseSignatureEnvelope({ ...VALID, keyId: 42 })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('an invalid keyId (contains a space) is malformed', () => {
    expect(parseSignatureEnvelope({ ...VALID, keyId: 'has space' })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('a bodyDigest without the sha256: prefix is malformed', () => {
    expect(parseSignatureEnvelope({ ...VALID, bodyDigest: 'ab'.repeat(32) })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('a bodyDigest with uppercase hex is malformed', () => {
    expect(parseSignatureEnvelope({ ...VALID, bodyDigest: `sha256:${'AB'.repeat(32)}` })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });
});

describe('parseSignatureEnvelope — exact signature format (§3)', () => {
  it('accepts exactly 88 chars = 86 data + ==', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: VALID_SIGNATURE }).ok).toBe(true);
  });

  it('rejects 87 characters', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: VALID_SIGNATURE.slice(0, 87) })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('rejects 89 characters', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: `${VALID_SIGNATURE}A` })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('rejects 88 base64 chars without the == padding', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: 'A'.repeat(88) })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('rejects a single = padding character', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: `${'A'.repeat(87)}=` })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('rejects a non-base64 alphabet character', () => {
    expect(parseSignatureEnvelope({ ...VALID, signature: `${'A'.repeat(84)}!!==` })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('rejects a non-canonical encoding of 64 bytes', () => {
    // 64 zero bytes canonically encode to 86 'A' + '=='. Setting low bits of the last
    // data char ('A' -> 'D') still decodes to zeros but is not canonical.
    const nonCanonical = `${'A'.repeat(85)}D==`;
    expect(parseSignatureEnvelope({ ...VALID, signature: nonCanonical })).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });
});
