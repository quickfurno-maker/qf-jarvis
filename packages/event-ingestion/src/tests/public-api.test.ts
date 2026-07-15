import { describe, expect, it } from 'vitest';

import * as api from '../index.js';

/**
 * The public surface is a promise. This test pins the runtime export set, so adding or
 * removing an export is a deliberate, reviewed change — and test-only material and
 * internal helpers can never leak into it. (Type-only exports do not appear here.)
 */
describe('public API surface', () => {
  const runtimeExports = Object.keys(api).sort();

  it('exports exactly the intended Stage 3.2 runtime surface', () => {
    expect(runtimeExports).toEqual(
      [
        'DEFAULT_FRESHNESS_WINDOW_MS',
        'DOMAIN_SEPARATION_PREFIX',
        'EVENT_KEY_PURPOSE',
        'MAX_FRESHNESS_WINDOW_MS',
        'MAX_PUBLIC_KEY_RECORDS',
        'MAX_RAW_BODY_BYTES',
        'MIN_FRESHNESS_WINDOW_MS',
        'PublicKeyRegistry',
        'PublicKeyRegistryError',
        'SIGNATURE_VERIFICATION_REASONS',
        'SUPPORTED_ALGORITHM',
        'SignatureVerificationConfigError',
        'verifySignature',
      ].sort(),
    );
  });

  it('does not export test-only key material or the test signer', () => {
    expect(runtimeExports).not.toContain('testPrivateKey');
    expect(runtimeExports).not.toContain('testPublicKey');
    expect(runtimeExports).not.toContain('signEnvelope');
    expect(runtimeExports).not.toContain('TEST_PUBLIC_KEY_SPKI_B64');
  });

  it('does not export internal helpers', () => {
    expect(runtimeExports).not.toContain('buildSigningInput');
    expect(runtimeExports).not.toContain('parseSignatureEnvelope');
    expect(runtimeExports).not.toContain('ComputedBodyDigest');
    expect(runtimeExports).not.toContain('decodeEd25519Signature');
  });

  it('exposes no ingest / persistence surface (Stage 3.3+)', () => {
    expect(runtimeExports).not.toContain('ingest');
    expect(runtimeExports).not.toContain('createPool');
    expect(runtimeExports).not.toContain('persist');
  });
});
