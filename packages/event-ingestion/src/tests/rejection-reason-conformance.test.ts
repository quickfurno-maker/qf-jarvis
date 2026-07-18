/**
 * The ingestion-rejection persistence vocabulary must stay aligned with the reasons this package
 * can actually emit (Stage 3.3.3, ADR-0031).
 *
 * `@qf-jarvis/event-backbone` re-declares the reason-code and issue-code vocabularies it stores,
 * because it cannot import THIS package (that would be a dependency cycle:
 * `event-ingestion → event-backbone`). This test lives here — where both packages are importable —
 * and is the guard that the two never drift: every reason this package can produce is a reason the
 * persistence layer accepts, the accepted set is EXACTLY the union of the two authoritative
 * ingestion vocabularies, and the safe issue-code vocabulary matches byte-for-byte.
 *
 * Database-free. It reads two sets of constants and compares them; it opens no pool.
 */

import { describe, expect, it } from 'vitest';

import {
  INGESTION_REJECTION_ISSUE_CODES,
  INGESTION_REJECTION_REASON_CODES,
  MAX_INGESTION_REJECTION_ISSUES,
} from '@qf-jarvis/event-backbone';

import { SIGNATURE_VERIFICATION_REASONS } from '../signature/reason-codes.js';
import {
  MAX_REJECTION_ISSUES,
  SAFE_VALIDATION_ISSUE_CODES,
  VALIDATED_EVENT_REJECTIONS,
} from '../ingest/rejection.js';

const persistenceReasons: ReadonlySet<string> = new Set(INGESTION_REJECTION_REASON_CODES);
const persistenceIssueCodes: ReadonlySet<string> = new Set(INGESTION_REJECTION_ISSUE_CODES);

/** The full authoritative union of ingestion reasons this package can emit (Stage 3.2 + 3.3). */
const authoritativeReasons: readonly string[] = [
  ...SIGNATURE_VERIFICATION_REASONS,
  ...VALIDATED_EVENT_REJECTIONS,
];

describe('the persistence vocabulary accepts every reason this package emits', () => {
  it('accepts every SignatureVerificationReason', () => {
    for (const reason of SIGNATURE_VERIFICATION_REASONS) {
      expect(persistenceReasons.has(reason)).toBe(true);
    }
  });

  it('accepts every validated-event-preparation rejection reason', () => {
    for (const reason of VALIDATED_EVENT_REJECTIONS) {
      expect(persistenceReasons.has(reason)).toBe(true);
    }
  });

  it('accepts no reason code that is not one this package emits', () => {
    // No unknown code leaks into the persistence set — it is EXACTLY the authoritative union.
    const authoritative = new Set(authoritativeReasons);
    for (const reason of INGESTION_REJECTION_REASON_CODES) {
      expect(authoritative.has(reason)).toBe(true);
    }
    expect(INGESTION_REJECTION_REASON_CODES.length).toBe(authoritative.size);
  });

  it('includes unsupported-algorithm and key-expired', () => {
    expect(persistenceReasons.has('unsupported-algorithm')).toBe(true);
    expect(persistenceReasons.has('key-expired')).toBe(true);
  });

  it('excludes duplicate-conflict — a conflict is not a rejection', () => {
    // `duplicate-conflict` belongs to qf_jarvis.event_conflict, never ingestion_rejection.
    expect(persistenceReasons.has('duplicate-conflict')).toBe(false);
  });
});

describe('the persistence safe issue-code vocabulary matches this package exactly', () => {
  it('accepts every safe validation issue code', () => {
    for (const code of SAFE_VALIDATION_ISSUE_CODES) {
      expect(persistenceIssueCodes.has(code)).toBe(true);
    }
  });

  it('accepts no issue code this package does not own', () => {
    const owned = new Set<string>(SAFE_VALIDATION_ISSUE_CODES);
    for (const code of INGESTION_REJECTION_ISSUE_CODES) {
      expect(owned.has(code)).toBe(true);
    }
    expect(INGESTION_REJECTION_ISSUE_CODES.length).toBe(SAFE_VALIDATION_ISSUE_CODES.length);
  });

  it('agrees on the maximum number of issues', () => {
    expect(MAX_INGESTION_REJECTION_ISSUES).toBe(MAX_REJECTION_ISSUES);
  });
});
