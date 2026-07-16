import { describe, expect, it } from 'vitest';

import { SIGNATURE_VERIFICATION_REASONS } from '../index.js';

describe('SIGNATURE_VERIFICATION_REASONS', () => {
  it('is exactly the thirteen mandated Stage 3.2 reason codes, in verification order', () => {
    expect([...SIGNATURE_VERIFICATION_REASONS]).toEqual([
      'body-too-large',
      'signature-missing',
      'signature-malformed',
      'unsupported-algorithm',
      'signed-at-malformed',
      'unknown-key-id',
      'key-revoked',
      'key-not-yet-valid',
      'key-expired',
      'replay-window-expired',
      'replay-window-future',
      'body-digest-mismatch',
      'signature-invalid',
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(SIGNATURE_VERIFICATION_REASONS).size).toBe(
      SIGNATURE_VERIFICATION_REASONS.length,
    );
  });

  it('does not leak an ingestion-stage reason (those belong to Stage 3.3)', () => {
    const asStrings: readonly string[] = SIGNATURE_VERIFICATION_REASONS;
    expect(asStrings).not.toContain('contract-validation-failed');
    expect(asStrings).not.toContain('unknown-event-type');
    expect(asStrings).not.toContain('unknown-event-version');
    expect(asStrings).not.toContain('duplicate-conflict');
  });
});
