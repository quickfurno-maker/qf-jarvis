import { createHash, sign as ed25519Sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FRESHNESS_WINDOW_MS,
  DOMAIN_SEPARATION_PREFIX,
  MAX_FRESHNESS_WINDOW_MS,
  MAX_RAW_BODY_BYTES,
  MIN_FRESHNESS_WINDOW_MS,
  type PublicKeyRegistry,
  SignatureVerificationConfigError,
  type SignatureEnvelope,
  verifySignature,
} from '../index.js';
import { signEnvelope } from './fixtures/signer.js';
import { ALT_KEY_ID, TEST_KEY_ID, testRegistry } from './fixtures/registry.js';
import { altPrivateKey, testPrivateKey } from './fixtures/test-keys.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const SIGNED_AT = '2026-07-15T12:00:00.000Z';
const RAW = new TextEncoder().encode('{"eventId":"11111111-1111-4111-8111-111111111111"}');

function validEnvelope(signedAt: string = SIGNED_AT): SignatureEnvelope {
  return signEnvelope({ rawBody: RAW, keyId: TEST_KEY_ID, signedAt, privateKey: testPrivateKey });
}

function digestHex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Sign an arbitrary signing-input string with the primary test private key. */
function signString(input: string): string {
  return ed25519Sign(null, Buffer.from(input, 'utf8'), testPrivateKey).toString('base64');
}

describe('verifySignature — accepts a genuine event', () => {
  it('verifies a correctly signed, fresh, in-window body', () => {
    const result = verifySignature(RAW, validEnvelope(), NOW, testRegistry());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyId).toBe(TEST_KEY_ID);
      expect(result.signedAt.toISOString()).toBe(SIGNED_AT);
      expect(result.bodyDigestHex).toHaveLength(64);
    }
  });

  it('verifies under a retiring key (still verifies; just no longer signs)', () => {
    expect(
      verifySignature(RAW, validEnvelope(), NOW, testRegistry({ status: 'retiring' })).ok,
    ).toBe(true);
  });

  it('verifies empty raw bytes', () => {
    const empty = new Uint8Array(0);
    const envelope = signEnvelope({
      rawBody: empty,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: testPrivateKey,
    });
    expect(verifySignature(empty, envelope, NOW, testRegistry()).ok).toBe(true);
  });

  it('verifies a body of exactly the maximum size (262,144 bytes)', () => {
    const body = new Uint8Array(MAX_RAW_BODY_BYTES).fill(7);
    const envelope = signEnvelope({
      rawBody: body,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: testPrivateKey,
    });
    expect(verifySignature(body, envelope, NOW, testRegistry()).ok).toBe(true);
  });
});

describe('verifySignature — the thirteen reason codes', () => {
  it('body-too-large (262,145 bytes)', () => {
    const big = new Uint8Array(MAX_RAW_BODY_BYTES + 1);
    expect(verifySignature(big, validEnvelope(), NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'body-too-large',
    });
  });

  it('signature-missing', () => {
    expect(verifySignature(RAW, null, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-missing',
    });
  });

  it('signature-malformed', () => {
    expect(verifySignature(RAW, { ...validEnvelope(), extra: 'x' }, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
  });

  it('unsupported-algorithm', () => {
    expect(
      verifySignature(RAW, { ...validEnvelope(), algorithm: 'hmac-sha256' }, NOW, testRegistry()),
    ).toEqual({ ok: false, reason: 'unsupported-algorithm' });
  });

  it('signed-at-malformed', () => {
    expect(
      verifySignature(
        RAW,
        { ...validEnvelope(), signedAt: '2026-07-15T12:00:00Z' },
        NOW,
        testRegistry(),
      ),
    ).toEqual({ ok: false, reason: 'signed-at-malformed' });
  });

  it('unknown-key-id', () => {
    expect(
      verifySignature(RAW, validEnvelope(), NOW, testRegistry({ keyId: 'test-unregistered' })),
    ).toEqual({
      ok: false,
      reason: 'unknown-key-id',
    });
  });

  it('key-revoked', () => {
    expect(verifySignature(RAW, validEnvelope(), NOW, testRegistry({ status: 'revoked' }))).toEqual(
      {
        ok: false,
        reason: 'key-revoked',
      },
    );
  });

  it('key-not-yet-valid', () => {
    const registry = testRegistry({ validFrom: '2026-07-16T00:00:00.000Z' });
    expect(verifySignature(RAW, validEnvelope(), NOW, registry)).toEqual({
      ok: false,
      reason: 'key-not-yet-valid',
    });
  });

  it('key-expired', () => {
    const registry = testRegistry({ validUntil: '2026-07-14T00:00:00.000Z' });
    expect(verifySignature(RAW, validEnvelope(), NOW, registry)).toEqual({
      ok: false,
      reason: 'key-expired',
    });
  });

  it('replay-window-expired', () => {
    const signedAt = new Date(NOW.getTime() - DEFAULT_FRESHNESS_WINDOW_MS - 1).toISOString();
    expect(verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'replay-window-expired',
    });
  });

  it('replay-window-future', () => {
    const signedAt = new Date(NOW.getTime() + DEFAULT_FRESHNESS_WINDOW_MS + 1).toISOString();
    expect(verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'replay-window-future',
    });
  });

  it('body-digest-mismatch — the signature was made for a different body', () => {
    const otherBody = new TextEncoder().encode('{"eventId":"different"}');
    expect(verifySignature(otherBody, validEnvelope(), NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'body-digest-mismatch',
    });
  });

  it('signature-invalid — a forgery signed by an unregistered key', () => {
    const forged = signEnvelope({
      rawBody: RAW,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: altPrivateKey,
    });
    expect(verifySignature(RAW, forged, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-invalid',
    });
  });

  it('signature-invalid — a correctly shaped but wrong signature', () => {
    const tampered: SignatureEnvelope = {
      ...validEnvelope(),
      signature: Buffer.alloc(64, 7).toString('base64'),
    };
    expect(verifySignature(RAW, tampered, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-invalid',
    });
  });
});

describe('verifySignature — first failure wins (the order is the contract)', () => {
  it('an oversized body is refused before the envelope is even accessed', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('envelope must not be touched');
        },
        get() {
          throw new Error('envelope must not be touched');
        },
        getOwnPropertyDescriptor() {
          throw new Error('envelope must not be touched');
        },
        getPrototypeOf() {
          throw new Error('envelope must not be touched');
        },
      },
    );
    expect(
      verifySignature(new Uint8Array(MAX_RAW_BODY_BYTES + 1), hostile, NOW, testRegistry()),
    ).toEqual({ ok: false, reason: 'body-too-large' });
  });

  it('refuses an oversized body FIRST — before caller-config checks and before envelope access', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('envelope must not be touched');
        },
        get() {
          throw new Error('envelope must not be touched');
        },
        getOwnPropertyDescriptor() {
          throw new Error('envelope must not be touched');
        },
        getPrototypeOf() {
          throw new Error('envelope must not be touched');
        },
      },
    );
    // Invalid now AND an out-of-range window AND a hostile envelope: size is step 1, so
    // this returns body-too-large rather than throwing a config error or a trap error.
    const result = verifySignature(
      new Uint8Array(MAX_RAW_BODY_BYTES + 1),
      hostile,
      new Date('not-a-date'),
      testRegistry(),
      { freshnessWindowMs: -999 },
    );
    expect(result).toEqual({ ok: false, reason: 'body-too-large' });
  });

  it('a malformed envelope never reaches key lookup', () => {
    let finds = 0;
    const base = testRegistry();
    const spy: PublicKeyRegistry = new Proxy(base, {
      get(target, prop, receiver): unknown {
        if (prop === 'find') {
          return (keyId: string) => {
            finds += 1;
            return target.find(keyId);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    expect(verifySignature(RAW, [1, 2, 3], NOW, spy)).toEqual({
      ok: false,
      reason: 'signature-malformed',
    });
    expect(finds).toBe(0);
  });

  it('a bad algorithm is reported before a bad signedAt', () => {
    const bad = { ...validEnvelope(), algorithm: 'hmac-sha256', signedAt: 'not-a-time' };
    expect(verifySignature(RAW, bad, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'unsupported-algorithm',
    });
  });

  it('a revoked key is reported before freshness is checked', () => {
    const stale = validEnvelope(
      new Date(NOW.getTime() - 10 * DEFAULT_FRESHNESS_WINDOW_MS).toISOString(),
    );
    expect(verifySignature(RAW, stale, NOW, testRegistry({ status: 'revoked' }))).toEqual({
      ok: false,
      reason: 'key-revoked',
    });
  });

  it('a digest mismatch is reported before the Ed25519 verification runs', () => {
    const forged = signEnvelope({
      rawBody: RAW,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: altPrivateKey,
    });
    const otherBody = new TextEncoder().encode('{"eventId":"different"}');
    expect(verifySignature(otherBody, forged, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'body-digest-mismatch',
    });
  });
});

describe('verifySignature — freshness and validity boundaries', () => {
  it('accepts signedAt exactly at the lower freshness boundary', () => {
    const signedAt = new Date(NOW.getTime() - DEFAULT_FRESHNESS_WINDOW_MS).toISOString();
    expect(verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry()).ok).toBe(true);
  });

  it('accepts signedAt exactly at the upper freshness boundary', () => {
    const signedAt = new Date(NOW.getTime() + DEFAULT_FRESHNESS_WINDOW_MS).toISOString();
    expect(verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry()).ok).toBe(true);
  });

  it('rejects one millisecond below the lower boundary', () => {
    const signedAt = new Date(NOW.getTime() - DEFAULT_FRESHNESS_WINDOW_MS - 1).toISOString();
    expect(verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry()).ok).toBe(false);
  });

  it('rejects one millisecond above the upper boundary', () => {
    const signedAt = new Date(NOW.getTime() + DEFAULT_FRESHNESS_WINDOW_MS + 1).toISOString();
    expect(verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry()).ok).toBe(false);
  });

  it('accepts signedAt exactly equal to validFrom (inclusive)', () => {
    const registry = testRegistry({ validFrom: SIGNED_AT });
    expect(verifySignature(RAW, validEnvelope(), NOW, registry).ok).toBe(true);
  });

  it('rejects signedAt exactly equal to validUntil (exclusive) as key-expired', () => {
    const registry = testRegistry({ validFrom: '2026-01-01T00:00:00.000Z', validUntil: SIGNED_AT });
    expect(verifySignature(RAW, validEnvelope(), NOW, registry)).toEqual({
      ok: false,
      reason: 'key-expired',
    });
  });
});

describe('verifySignature — signing-input bindings', () => {
  it('a signature over a different domain prefix is signature-invalid', () => {
    const dh = digestHex(RAW);
    const wrong = `wrong-prefix-v1\n${TEST_KEY_ID}\n${SIGNED_AT}\n${dh}`;
    const envelope = {
      algorithm: 'ed25519',
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      bodyDigest: `sha256:${dh}`,
      signature: signString(wrong),
    };
    expect(verifySignature(RAW, envelope, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-invalid',
    });
  });

  it('a signature bound to a different keyId is signature-invalid', () => {
    const dh = digestHex(RAW);
    const wrong = `${DOMAIN_SEPARATION_PREFIX}\n${ALT_KEY_ID}\n${SIGNED_AT}\n${dh}`;
    const envelope = {
      algorithm: 'ed25519',
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      bodyDigest: `sha256:${dh}`,
      signature: signString(wrong),
    };
    expect(verifySignature(RAW, envelope, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-invalid',
    });
  });

  it('a signature bound to a different signedAt is signature-invalid', () => {
    const dh = digestHex(RAW);
    const wrong = `${DOMAIN_SEPARATION_PREFIX}\n${TEST_KEY_ID}\n2026-07-15T12:00:00.001Z\n${dh}`;
    const envelope = {
      algorithm: 'ed25519',
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      bodyDigest: `sha256:${dh}`,
      signature: signString(wrong),
    };
    expect(verifySignature(RAW, envelope, NOW, testRegistry())).toEqual({
      ok: false,
      reason: 'signature-invalid',
    });
  });
});

describe('verifySignature — configurable, bounded freshness window', () => {
  it('accepts a wider window within bounds', () => {
    const signedAt = new Date(NOW.getTime() - 10 * 60_000).toISOString();
    expect(
      verifySignature(RAW, validEnvelope(signedAt), NOW, testRegistry(), {
        freshnessWindowMs: 15 * 60_000,
      }).ok,
    ).toBe(true);
  });

  it('throws for a window below the minimum', () => {
    expect(() =>
      verifySignature(RAW, validEnvelope(), NOW, testRegistry(), {
        freshnessWindowMs: MIN_FRESHNESS_WINDOW_MS - 1,
      }),
    ).toThrow(SignatureVerificationConfigError);
  });

  it('throws for a window above the maximum', () => {
    expect(() =>
      verifySignature(RAW, validEnvelope(), NOW, testRegistry(), {
        freshnessWindowMs: MAX_FRESHNESS_WINDOW_MS + 1,
      }),
    ).toThrow(SignatureVerificationConfigError);
  });

  it('throws for a non-integer window', () => {
    expect(() =>
      verifySignature(RAW, validEnvelope(), NOW, testRegistry(), { freshnessWindowMs: 1.5 }),
    ).toThrow(SignatureVerificationConfigError);
  });

  it('throws for an invalid now', () => {
    expect(() =>
      verifySignature(RAW, validEnvelope(), new Date('not-a-date'), testRegistry()),
    ).toThrow(SignatureVerificationConfigError);
  });
});

describe('verifySignature — pure and deterministic (reads no clock)', () => {
  it('returns an identical result for identical inputs', () => {
    const envelope = validEnvelope();
    expect(verifySignature(RAW, envelope, NOW, testRegistry())).toEqual(
      verifySignature(RAW, envelope, NOW, testRegistry()),
    );
  });

  it('still verifies when Date.now is replaced with a function that throws', () => {
    const realDateNow = Date.now;
    Date.now = () => {
      throw new Error('the verifier must not read the wall clock');
    };
    try {
      expect(verifySignature(RAW, validEnvelope(), NOW, testRegistry()).ok).toBe(true);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('depends only on the injected now: fresh at signing time, stale an hour later', () => {
    const envelope = validEnvelope();
    expect(verifySignature(RAW, envelope, NOW, testRegistry()).ok).toBe(true);
    expect(
      verifySignature(RAW, envelope, new Date(NOW.getTime() + 60 * 60_000), testRegistry()),
    ).toEqual({ ok: false, reason: 'replay-window-expired' });
  });
});
