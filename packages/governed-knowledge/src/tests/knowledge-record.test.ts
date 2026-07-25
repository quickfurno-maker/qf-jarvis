/**
 * QFJ-P04.03 — knowledge-record and lifecycle contracts (ADR-0051 §C, §D).
 *
 * Matrix items 1–11: a valid record is frozen; instants, versions, and ids are validated; wildcard/
 * `latest` identity, invalid lifecycle transitions, ACTIVE-without-approval, volatile-without-expiry,
 * and arbitrary/secret metadata are all rejected.
 */
import { describe, expect, it } from 'vitest';

import { GovernedKnowledgeError } from '../contracts/errors.js';
import { createKnowledgeRecord } from '../contracts/knowledge-record.js';
import {
  KNOWLEDGE_LIFECYCLE_STATES,
  isValidLifecycleTransition,
} from '../contracts/vocabularies.js';
import { recordInput } from './fixtures.js';

function expectInvalid(input: Parameters<typeof createKnowledgeRecord>[0]): void {
  try {
    createKnowledgeRecord(input);
    throw new Error('expected createKnowledgeRecord to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(GovernedKnowledgeError);
    expect((error as GovernedKnowledgeError).code).toBe('invalid-record');
  }
}

describe('createKnowledgeRecord', () => {
  it('(1) validates and deep-freezes a valid record', () => {
    const record = createKnowledgeRecord(recordInput());
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.permissions)).toBe(true);
    expect(record.knowledgeId).toBe('kb.policy.sla');
    expect(record.version).toBe(1);
  });

  it('(2) rejects a non-canonical instant', () => {
    expectInvalid(recordInput({ effectiveFrom: '2026-01-02' }));
    expectInvalid(recordInput({ effectiveFrom: '2026-13-02T00:00:00Z' }));
    expectInvalid(recordInput({ approvedAt: 'not-a-time' }));
  });

  it('(3) requires a positive integer version', () => {
    expectInvalid(recordInput({ version: 0 }));
    expectInvalid(recordInput({ version: -1 }));
    expectInvalid(recordInput({ version: 1.5 }));
  });

  it('(4) rejects invalid or oversized identifiers', () => {
    expectInvalid(recordInput({ knowledgeId: 'has space' }));
    expectInvalid(recordInput({ knowledgeId: '' }));
    expectInvalid(recordInput({ topic: 'a'.repeat(129) }));
    expectInvalid(recordInput({ knowledgeId: 'bad*wild' }));
  });

  it('(5) rejects a wildcard / `latest` authoritative identity', () => {
    expectInvalid(recordInput({ knowledgeId: 'latest' }));
    expectInvalid(recordInput({ knowledgeId: 'LATEST' }));
    expectInvalid(recordInput({ topic: 'latest' }));
  });

  it('(6) permits only forward lifecycle transitions', () => {
    expect(isValidLifecycleTransition('UPLOADED', 'SCANNED')).toBe(true);
    expect(isValidLifecycleTransition('APPROVED', 'ACTIVE')).toBe(true);
    expect(isValidLifecycleTransition('ACTIVE', 'RETIRED')).toBe(true);
    // No skips, no backward, no revive.
    expect(isValidLifecycleTransition('UPLOADED', 'ACTIVE')).toBe(false);
    expect(isValidLifecycleTransition('ACTIVE', 'APPROVED')).toBe(false);
    expect(isValidLifecycleTransition('RETIRED', 'ACTIVE')).toBe(false);
    for (const state of KNOWLEDGE_LIFECYCLE_STATES) {
      expect(isValidLifecycleTransition(state, state)).toBe(false);
    }
  });

  it('(7) requires approval metadata for APPROVED/ACTIVE/RETIRED and forbids it earlier', () => {
    // ACTIVE without approvedBy/approvedAt is rejected.
    expectInvalid(recordInput({ lifecycleState: 'ACTIVE', approvedBy: undefined }));
    expectInvalid(recordInput({ lifecycleState: 'ACTIVE', approvedAt: undefined }));
    // A pre-approval state must NOT carry approval metadata.
    expectInvalid(recordInput({ lifecycleState: 'UPLOADED' }));
    // A coherent pre-approval record is accepted.
    const uploaded = createKnowledgeRecord(
      recordInput({ lifecycleState: 'UPLOADED', approvedBy: undefined, approvedAt: undefined }),
    );
    expect(uploaded.lifecycleState).toBe('UPLOADED');
  });

  it('(9) requires an expiry for volatile source types', () => {
    expectInvalid(recordInput({ sourceType: 'PACKAGE_REFERENCE', expiresAt: undefined }));
    expectInvalid(recordInput({ sourceType: 'WEBSITE_CONTENT', expiresAt: undefined }));
    const ok = createKnowledgeRecord(
      recordInput({ sourceType: 'PRODUCT_REFERENCE', expiresAt: '2026-06-01T00:00:00Z' }),
    );
    expect(ok.expiresAt).toBe('2026-06-01T00:00:00Z');
  });

  it('rejects an incoherent effective/expiry/approval ordering', () => {
    expectInvalid(recordInput({ expiresAt: '2026-01-01T00:00:00Z' })); // expiry <= effectiveFrom
    expectInvalid(recordInput({ approvedAt: '2026-01-03T00:00:00Z' })); // approved after effective
  });

  it('(10) rejects an arbitrary metadata bag / unknown field (no secret smuggling)', () => {
    expectInvalid(
      recordInput({ apiKey: 'sk-secret-000' } as unknown as Parameters<typeof recordInput>[0]),
    );
    expectInvalid(
      recordInput({ metadata: { x: 1 } } as unknown as Parameters<typeof recordInput>[0]),
    );
  });
});
