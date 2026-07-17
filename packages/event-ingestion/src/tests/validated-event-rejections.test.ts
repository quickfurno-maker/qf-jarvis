/**
 * The Stage 3.3 slice-2 rejection identifiers (ADR-0030) are exactly the three pinned by
 * ADR-0020 §11 / ADR-0027, and stay disjoint from the Stage 3.2 signature-verification reasons.
 *
 * Imported from the INTERNAL module on purpose: like the digest foundation, validated-event
 * preparation is not part of the package-root public surface (see `public-api.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { SIGNATURE_VERIFICATION_REASONS } from '../index.js';
import { VALIDATED_EVENT_REJECTIONS } from '../ingest/rejection.js';

describe('VALIDATED_EVENT_REJECTIONS', () => {
  it('is exactly the three pinned ingestion-stage identifiers', () => {
    expect([...VALIDATED_EVENT_REJECTIONS]).toEqual([
      'contract-validation-failed',
      'unknown-event-type',
      'unknown-event-version',
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(VALIDATED_EVENT_REJECTIONS).size).toBe(VALIDATED_EVENT_REJECTIONS.length);
  });

  it('does not include duplicate-conflict (a later, persistence-touching slice owns it)', () => {
    const asStrings: readonly string[] = VALIDATED_EVENT_REJECTIONS;
    expect(asStrings).not.toContain('duplicate-conflict');
  });

  it('is disjoint from the Stage 3.2 signature-verification reasons', () => {
    const signature = new Set<string>(SIGNATURE_VERIFICATION_REASONS);
    for (const reason of VALIDATED_EVENT_REJECTIONS) {
      expect(signature.has(reason)).toBe(false);
    }
  });
});
