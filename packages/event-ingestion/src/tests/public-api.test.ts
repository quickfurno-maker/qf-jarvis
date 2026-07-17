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

  it('keeps the Stage 3.3 semantic-digest foundation INTERNAL (ADR-0029)', () => {
    // The digest primitive is compiled internally but has no public consumer yet, so the
    // package root must not expose it — nor the internal canonical-JSON serialiser.
    expect(runtimeExports).not.toContain('computeSemanticEventDigest');
    expect(runtimeExports).not.toContain('SemanticCanonicalisationError');
    expect(runtimeExports).not.toContain('canonicaliseToJson');
  });

  it('keeps the Stage 3.3 validated-event preparation INTERNAL (ADR-0030)', () => {
    // Slice 2's composition is reached only by the later, still-gated ingest path, so the
    // package root must not expose the function, its rejection identifiers, or its helpers.
    expect(runtimeExports).not.toContain('prepareValidatedEventFromVerifiedRawBody');
    expect(runtimeExports).not.toContain('ValidatedEventPreparationError');
    expect(runtimeExports).not.toContain('VALIDATED_EVENT_REJECTIONS');
    expect(runtimeExports).not.toContain('mapSafeValidationIssues');
    expect(runtimeExports).not.toContain('safeStructuralPath');
    expect(runtimeExports).not.toContain('deepFreezeJsonValue');
    expect(runtimeExports).not.toContain('digestCanonicalJson');
  });

  it('exposes no ingest / persistence surface (Stage 3.3+)', () => {
    expect(runtimeExports).not.toContain('ingest');
    expect(runtimeExports).not.toContain('createPool');
    expect(runtimeExports).not.toContain('persist');
  });

  it('keeps the Stage 3.3 slice-3 persistence bridge INTERNAL', () => {
    // The evidence-bearing verification, the record builder, and the persist composition are
    // reached only by a future authenticated ingest caller inside this package. None may leak,
    // and the public surface still exposes no signature bytes.
    expect(runtimeExports).not.toContain('verifySignatureWithEvidence');
    expect(runtimeExports).not.toContain('buildEventPersistenceRecord');
    expect(runtimeExports).not.toContain('persistPreparedEvent');
    expect(runtimeExports).not.toContain('EvidencePreparationMismatchError');
    expect(runtimeExports).not.toContain('storeValidatedEvent');
  });
});
