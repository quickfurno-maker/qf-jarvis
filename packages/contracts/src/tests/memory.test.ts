/**
 * Agent memory: derived, isolated, rebuildable, non-authoritative, deletion-aware.
 *
 * Memory is the one artifact in this system that persists and is *reused*. That makes it
 * the one most capable of quietly becoming a second source of truth — which ADR-0001
 * forbids and which ADR-0016 makes structurally impossible. These tests are where that
 * impossibility is checked.
 */

import { describe, expect, it } from 'vitest';

import {
  AGENT_IDS,
  MEMORY_SUBJECT_OWNERSHIP,
  safeParseAgentMemoryRecord,
  safeParseMemoryInvalidationRequest,
} from '../index.js';
import {
  cloneFixture,
  validAgentMemoryRiya,
  validMemoryInvalidationBySubject,
} from '../fixtures/index.js';

describe('memory is never authoritative, and always rebuildable', () => {
  it('accepts the honest record', () => {
    const result = safeParseAgentMemoryRecord(cloneFixture(validAgentMemoryRiya));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authoritative).toBe(false);
      expect(result.data.rebuildable).toBe(true);
    }
  });

  it('refuses memory that claims to be authoritative', () => {
    // If this parsed, an agent could reason from its own derived view in preference to
    // QuickFurno Core. Core wins, always.
    const record = { ...cloneFixture(validAgentMemoryRiya), authoritative: true };
    expect(safeParseAgentMemoryRecord(record).success).toBe(false);
  });

  it('refuses memory that claims not to be rebuildable', () => {
    // Memory that cannot be rebuilt must be preserved; memory that must be preserved is a
    // database of record.
    const record = { ...cloneFixture(validAgentMemoryRiya), rebuildable: false };
    expect(safeParseAgentMemoryRecord(record).success).toBe(false);
  });

  it('refuses memory derived from no events at all', () => {
    const record = { ...cloneFixture(validAgentMemoryRiya), sourceEventIds: [] };
    expect(safeParseAgentMemoryRecord(record).success).toBe(false);
  });
});

describe('memory is isolated: an agent may only remember its own domain', () => {
  it('every agent has a declared, non-empty memory domain', () => {
    for (const agent of AGENT_IDS) {
      expect(MEMORY_SUBJECT_OWNERSHIP[agent].length).toBeGreaterThan(0);
    }
  });

  it('Jitin may not remember an individual client or vendor', () => {
    // Marketing intelligence works in aggregate. It does not require remembering
    // individual people, so it is not permitted to.
    expect(MEMORY_SUBJECT_OWNERSHIP.jitin).not.toContain('client');
    expect(MEMORY_SUBJECT_OWNERSHIP.jitin).not.toContain('vendor');
  });

  it('Jarvis may not remember domain facts — it connects, it does not conclude', () => {
    expect(MEMORY_SUBJECT_OWNERSHIP.jarvis).not.toContain('client');
    expect(MEMORY_SUBJECT_OWNERSHIP.jarvis).not.toContain('vendor');
    expect(MEMORY_SUBJECT_OWNERSHIP.jarvis).not.toContain('lead');
  });

  const CROSS_DOMAIN: readonly { owner: string; entityType: string }[] = [
    { owner: 'anisha', entityType: 'client' },
    { owner: 'anisha', entityType: 'lead' },
    { owner: 'kabir', entityType: 'vendor' },
    { owner: 'kabir', entityType: 'client' },
    { owner: 'riya', entityType: 'vendor' },
    { owner: 'jitin', entityType: 'client' },
    { owner: 'jitin', entityType: 'vendor' },
    { owner: 'jarvis', entityType: 'client' },
    { owner: 'jarvis', entityType: 'vendor' },
  ];

  it.each(CROSS_DOMAIN)(
    'refuses $owner holding memory about a $entityType',
    ({ owner, entityType }) => {
      const record = {
        ...cloneFixture(validAgentMemoryRiya),
        ownerAgent: owner,
        subjectReferences: [{ entityType, entityId: 'CORE-SYNTHETIC-00001' }],
      };

      expect(safeParseAgentMemoryRecord(record).success).toBe(false);
    },
  );

  it.each([
    { owner: 'riya', entityType: 'client' },
    { owner: 'anisha', entityType: 'vendor' },
    { owner: 'kabir', entityType: 'lead' },
    { owner: 'jitin', entityType: 'city' },
    { owner: 'jarvis', entityType: 'recommendation' },
  ])('accepts $owner holding memory about a $entityType', ({ owner, entityType }) => {
    const record = {
      ...cloneFixture(validAgentMemoryRiya),
      ownerAgent: owner,
      subjectReferences: [{ entityType, entityId: 'CORE-SYNTHETIC-00001' }],
    };

    expect(safeParseAgentMemoryRecord(record).success).toBe(true);
  });
});

describe('memory carries no model internals, no credentials, no contacts', () => {
  const FORBIDDEN: readonly Record<string, unknown>[] = [
    { chainOfThought: 'First I considered the budget...' },
    { reasoningTrace: 'step 1, step 2' },
    { hiddenReasoning: 'the real reason' },
    { prompt: 'You are Riya...' },
    { systemPrompt: 'You are a helpful agent' },
    { modelResponse: 'The client seems unhappy' },
    { rawModelOutput: '{"verdict":"unhappy"}' },
    { apiKey: 'sk-SYNTHETIC-0000' },
    { token: 'bearer-SYNTHETIC' },
    { phone: '+919876543210' },
    { email: 'someone@example.com' },
    { transcript: 'Hello, is this a good time?' },
  ];

  it.each(FORBIDDEN)('refuses derived signals carrying %o', (signals) => {
    const record = { ...cloneFixture(validAgentMemoryRiya), derivedSignals: signals };
    expect(safeParseAgentMemoryRecord(record).success).toBe(false);
  });

  it('refuses a contact-shaped value even under an innocent key', () => {
    // The scan checks values, not just key names. A phone number hidden under
    // `preferredContact` is still a phone number.
    const record = {
      ...cloneFixture(validAgentMemoryRiya),
      derivedSignals: { preferredContact: 'client@example.com' },
    };
    expect(safeParseAgentMemoryRecord(record).success).toBe(false);
  });

  it('accepts ordinary derived signals', () => {
    const record = {
      ...cloneFixture(validAgentMemoryRiya),
      derivedSignals: { repliesInEvening: true, followUpCount: 2 },
    };
    expect(safeParseAgentMemoryRecord(record).success).toBe(true);
  });
});

describe('memory is deletion-aware', () => {
  it('requires an erasure state, so an un-propagated deletion is detectable', () => {
    const record = cloneFixture(validAgentMemoryRiya);
    const { erasureState: _removed, ...withoutErasureState } = record;

    expect(safeParseAgentMemoryRecord(withoutErasureState).success).toBe(false);
  });

  it.each(['none', 'deletion-requested', 'deleted', 'anonymisation-requested', 'anonymised'])(
    'accepts erasure state %s',
    (erasureState) => {
      const record = { ...cloneFixture(validAgentMemoryRiya), erasureState };
      expect(safeParseAgentMemoryRecord(record).success).toBe(true);
    },
  );

  it('a subject-scoped invalidation is the shape a deletion request takes', () => {
    const result = safeParseMemoryInvalidationRequest(
      cloneFixture(validMemoryInvalidationBySubject),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe('subject');
      // It names the erasure request that obliges it — so "did we actually delete
      // everything?" is a query rather than a hope.
      expect(result.data.erasureRequestId).toBeDefined();
    }
  });

  it('refuses a subject-scoped invalidation that names no subject', () => {
    const request = cloneFixture(validMemoryInvalidationBySubject);
    const { subjectReference: _removed, ...withoutSubject } = request;

    expect(safeParseMemoryInvalidationRequest(withoutSubject).success).toBe(false);
  });

  it('refuses an "all"-scoped invalidation that quietly narrows itself to one agent', () => {
    const request = { ...cloneFixture(validMemoryInvalidationBySubject), scope: 'all' };
    expect(safeParseMemoryInvalidationRequest(request).success).toBe(false);
  });
});
