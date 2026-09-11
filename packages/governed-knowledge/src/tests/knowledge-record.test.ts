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
  KNOWLEDGE_AGENT_SCOPES,
  KNOWLEDGE_LIFECYCLE_STATES,
  KNOWLEDGE_PURPOSES,
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

describe('the permission caps follow the VOCABULARIES, not a literal that outgrows them', () => {
  it('a record may name EVERY agent scope and EVERY purpose that exists', () => {
    // The JF-4 correction added `PROSPECT` and `PROSPECT_RESPONSE` (ADR-0150 §4a). The caps used to be
    // the literal counts of the old vocabularies, so the very next addition would have made a record
    // that names every scope unrepresentable -- a governance limit created by arithmetic rather than by
    // a decision about disclosure.
    const record = createKnowledgeRecord(
      recordInput({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: [...KNOWLEDGE_AGENT_SCOPES],
          allowedPurposes: [...KNOWLEDGE_PURPOSES],
        },
      }),
    );
    expect(record.permissions.allowedAgentScopes).toHaveLength(KNOWLEDGE_AGENT_SCOPES.length);
    expect(record.permissions.allowedPurposes).toHaveLength(KNOWLEDGE_PURPOSES.length);
  });

  it('and still refuses more entries than exist, or a token that is not in either vocabulary', () => {
    // Binding the cap to the vocabulary did not remove it. A list longer than the vocabulary can only
    // be a duplicate or an invented member, and both are refused.
    expectInvalid(
      recordInput({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: [...KNOWLEDGE_AGENT_SCOPES, 'CLIENT'],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      }),
    );
    expectInvalid(
      recordInput({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['ACQUISITION'],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      } as unknown as Parameters<typeof recordInput>[0]),
    );
    expectInvalid(
      recordInput({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['PROSPECT'],
          allowedPurposes: ['PROSPECT_REPLY'],
        },
      } as unknown as Parameters<typeof recordInput>[0]),
    );
    // And an empty list is still refused: a record nobody may read is not a governed record.
    expectInvalid(
      recordInput({
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: [],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      } as unknown as Parameters<typeof recordInput>[0]),
    );
  });
});
