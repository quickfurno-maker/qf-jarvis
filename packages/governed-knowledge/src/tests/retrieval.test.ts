/**
 * QFJ-P04.03 — deterministic bounded retrieval (ADR-0051 §H–§M).
 *
 * Matrix items 22–57: freshness/authority/conflict handling; tenant/agent/purpose/data-class
 * authorization; the privacy/erasure gate before content; exact bounded retrieval only; mandatory
 * citations; and content-free observability.
 */
import { describe, expect, it } from 'vitest';

import { auditLookup } from '../retrieval/audit.js';
import { createGovernedKnowledgeRegistry } from '../registry/governed-knowledge-registry.js';
import type { GovernedKnowledgeRegistry } from '../registry/governed-knowledge-registry.js';
import { createRetrievalRequest } from '../contracts/retrieval-request.js';
import type { KnowledgeRetrievalRequestInput } from '../contracts/retrieval-request.js';
import type { RetrievalPermissions } from '../contracts/permissions.js';
import type { KnowledgeEvent, KnowledgeObservabilityHook } from '../contracts/observability.js';
import { retrieveGovernedKnowledge } from '../retrieval/retrieve-governed-knowledge.js';
import { createDeterministicPrivacyGate } from '../testing/deterministic-privacy-gate.js';
import { digest, recordInput, requestInput } from './fixtures.js';

function recorder(): { hook: KnowledgeObservabilityHook; events: KnowledgeEvent[] } {
  const events: KnowledgeEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

function idRequest(
  knowledgeId: string,
  version: number,
  overrides: Partial<KnowledgeRetrievalRequestInput> = {},
): KnowledgeRetrievalRequestInput {
  return requestInput({ selectors: { ids: [{ knowledgeId, version }] }, ...overrides });
}

const baseRegistry = (): GovernedKnowledgeRegistry =>
  createGovernedKnowledgeRegistry([recordInput()]);

// ---------------------------------------------------------------------------
// Freshness, authority, conflicts (22–29).
// ---------------------------------------------------------------------------
describe('freshness, authority, and conflicts', () => {
  it('(22) excludes a not-yet-effective record', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ effectiveFrom: '2026-03-01T00:00:00Z' }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('knowledge-not-effective');
  });

  it('(23,29) excludes an expired (stale volatile) record', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        sourceType: 'PACKAGE_REFERENCE',
        effectiveFrom: '2026-01-02T00:00:00Z',
        expiresAt: '2026-01-15T00:00:00Z',
      }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-expired');
  });

  it('(24) excludes a superseded record', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        knowledgeId: 'kb.k',
        version: 1,
        contentDigest: digest('a'),
        lifecycleState: 'RETIRED',
        supersededBy: { knowledgeId: 'kb.k', version: 2 },
      }),
      recordInput({ knowledgeId: 'kb.k', version: 2, contentDigest: digest('b') }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.k', 1)),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-superseded');
  });

  it('(25,27) selects the highest permitted authority tier and never a lower one', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        knowledgeId: 'kb.core',
        version: 1,
        topic: 'sla',
        authorityTier: 'CORE_PUBLISHED_REFERENCE',
        contentDigest: digest('a'),
      }),
      recordInput({
        knowledgeId: 'kb.ext',
        version: 1,
        topic: 'sla',
        authorityTier: 'APPROVED_EXTERNAL_REFERENCE',
        contentDigest: digest('b'),
      }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(requestInput({ selectors: { topics: ['sla'] } })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toHaveLength(1);
      expect(result.records[0]?.record.authorityTier).toBe('CORE_PUBLISHED_REFERENCE');
    }
  });

  it('(26) fails closed on same-tier ambiguity (overlapping active versions)', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        knowledgeId: 'kb.one',
        version: 1,
        topic: 'sla',
        authorityTier: 'APPROVED_BUSINESS_RULE',
        contentDigest: digest('a'),
      }),
      recordInput({
        knowledgeId: 'kb.two',
        version: 1,
        topic: 'sla',
        authorityTier: 'APPROVED_BUSINESS_RULE',
        contentDigest: digest('b'),
      }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(requestInput({ selectors: { topics: ['sla'] } })),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-conflict');
  });

  it('(8) does not serve a RETIRED record as current knowledge', () => {
    const registry = createGovernedKnowledgeRegistry([recordInput({ lifecycleState: 'RETIRED' })]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-not-active');
  });

  it('(28) never fabricates an answer — an absent topic fails closed', () => {
    const result = retrieveGovernedKnowledge(
      baseRegistry(),
      createRetrievalRequest(requestInput({ selectors: { topics: ['nonexistent-topic'] } })),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-not-found');
  });
});

// ---------------------------------------------------------------------------
// Permissions and privacy (30–42).
// ---------------------------------------------------------------------------
describe('permissions and privacy', () => {
  const permit = (over: Partial<RetrievalPermissions> = {}) =>
    recordInput({
      permissions: {
        tenantScope: 'GLOBAL',
        allowedAgentScopes: ['CLIENT', 'COORDINATION'],
        allowedPurposes: ['CLIENT_RESPONSE', 'POLICY_LOOKUP'],
        ...over,
      },
    });

  it('(30) requires a tenant match', () => {
    const registry = createGovernedKnowledgeRegistry([permit({ tenantScope: 'tenant-b' })]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { tenantId: 'tenant-a' })),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-tenant-denied');
  });

  it('(31) permits a GLOBAL record for any tenant', () => {
    const result = retrieveGovernedKnowledge(
      baseRegistry(),
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { tenantId: 'tenant-z' })),
    );
    expect(result.ok).toBe(true);
  });

  it('(32,33,34) enforces agent scope (CLIENT / VENDOR / COORDINATION)', () => {
    const clientOnly = createGovernedKnowledgeRegistry([
      permit({ allowedAgentScopes: ['CLIENT'] }),
    ]);
    expect(
      retrieveGovernedKnowledge(
        clientOnly,
        createRetrievalRequest(idRequest('kb.policy.sla', 1, { agentScope: 'CLIENT' })),
      ).ok,
    ).toBe(true);
    const asVendor = retrieveGovernedKnowledge(
      clientOnly,
      createRetrievalRequest(
        idRequest('kb.policy.sla', 1, { agentScope: 'VENDOR', purpose: 'VENDOR_RESPONSE' }),
      ),
    );
    expect(asVendor.ok ? null : asVendor.reason).toBe('knowledge-permission-denied');

    const coordOnly = createGovernedKnowledgeRegistry([
      permit({ allowedAgentScopes: ['COORDINATION'], allowedPurposes: ['INTERNAL_REASONING'] }),
    ]);
    expect(
      retrieveGovernedKnowledge(
        coordOnly,
        createRetrievalRequest(
          idRequest('kb.policy.sla', 1, {
            agentScope: 'COORDINATION',
            purpose: 'INTERNAL_REASONING',
          }),
        ),
      ).ok,
    ).toBe(true);
    const clientOnCoord = retrieveGovernedKnowledge(
      coordOnly,
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { agentScope: 'CLIENT' })),
    );
    expect(clientOnCoord.ok ? null : clientOnCoord.reason).toBe('knowledge-permission-denied');
  });

  it('(35) enforces the purpose/task class', () => {
    const registry = createGovernedKnowledgeRegistry([
      permit({ allowedPurposes: ['POLICY_LOOKUP'] }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { purpose: 'CLIENT_RESPONSE' })),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-permission-denied');
  });

  it('(36,38) a HOSTED_ALLOWED request never receives LOCAL_ONLY or HUMAN_ONLY knowledge', () => {
    const local = createGovernedKnowledgeRegistry([recordInput({ classification: 'LOCAL_ONLY' })]);
    const r1 = retrieveGovernedKnowledge(
      local,
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { dataClass: 'HOSTED_ALLOWED' })),
    );
    expect(r1.ok ? null : r1.reason).toBe('knowledge-data-class-denied');

    const human = createGovernedKnowledgeRegistry([recordInput({ classification: 'HUMAN_ONLY' })]);
    const r2 = retrieveGovernedKnowledge(
      human,
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { dataClass: 'HUMAN_ONLY' })),
    );
    expect(r2.ok ? null : r2.reason).toBe('knowledge-data-class-denied');
  });

  it('(37) a LOCAL_ONLY request may receive HOSTED_ALLOWED or LOCAL_ONLY knowledge', () => {
    const hosted = createGovernedKnowledgeRegistry([
      recordInput({ classification: 'HOSTED_ALLOWED' }),
    ]);
    expect(
      retrieveGovernedKnowledge(
        hosted,
        createRetrievalRequest(idRequest('kb.policy.sla', 1, { dataClass: 'LOCAL_ONLY' })),
      ).ok,
    ).toBe(true);
    const localReg = createGovernedKnowledgeRegistry([
      recordInput({ classification: 'LOCAL_ONLY' }),
    ]);
    expect(
      retrieveGovernedKnowledge(
        localReg,
        createRetrievalRequest(idRequest('kb.policy.sla', 1, { dataClass: 'LOCAL_ONLY' })),
      ).ok,
    ).toBe(true);
  });

  it('(39) a subject-linked record without a privacy gate fails closed', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ subjectRef: 'subject.person.1' }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-privacy-gate-missing');
  });

  it('(40) an erased/tombstoned/in-progress subject is blocked before content', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ subjectRef: 'subject.person.1' }),
    ]);
    for (const status of ['erased', 'anonymised', 'tombstoned', 'in-progress'] as const) {
      const gate = createDeterministicPrivacyGate({ statuses: { 'subject.person.1': status } });
      const result = retrieveGovernedKnowledge(
        registry,
        createRetrievalRequest(idRequest('kb.policy.sla', 1)),
        { privacyGate: gate },
      );
      expect(result.ok ? null : result.reason).toBe('knowledge-subject-erased');
    }
  });

  it('(41) a cleared subject passes the gate', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ subjectRef: 'subject.person.1' }),
    ]);
    const gate = createDeterministicPrivacyGate({ statuses: { 'subject.person.1': 'clear' } });
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
      { privacyGate: gate },
    );
    expect(result.ok).toBe(true);
  });

  it('(42) observability never carries a subject reference', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ subjectRef: 'subject.person.SECRET' }),
    ]);
    const gate = createDeterministicPrivacyGate({
      statuses: { 'subject.person.SECRET': 'erased' },
    });
    const { hook, events } = recorder();
    retrieveGovernedKnowledge(registry, createRetrievalRequest(idRequest('kb.policy.sla', 1)), {
      privacyGate: gate,
      observability: hook,
    });
    expect(JSON.stringify(events)).not.toContain('subject.person.SECRET');
  });
});

// ---------------------------------------------------------------------------
// Bounded retrieval (43–51).
// ---------------------------------------------------------------------------
describe('bounded retrieval', () => {
  it('(43) retrieves by exact id/version', () => {
    const result = retrieveGovernedKnowledge(
      baseRegistry(),
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
    );
    expect(result.ok && result.records[0]?.record.knowledgeId).toBe('kb.policy.sla');
  });

  it('(44,45) retrieves by exact topic and bounded multi-topic', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ knowledgeId: 'kb.a', version: 1, topic: 't-a', contentDigest: digest('a') }),
      recordInput({ knowledgeId: 'kb.b', version: 1, topic: 't-b', contentDigest: digest('b') }),
    ]);
    const one = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(requestInput({ selectors: { topics: ['t-a'] } })),
    );
    expect(one.ok && one.records).toHaveLength(1);
    const two = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(requestInput({ selectors: { topics: ['t-a', 't-b'] } })),
    );
    expect(two.ok && two.records).toHaveLength(2);
  });

  it('(46) enforces maxRecords', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({ knowledgeId: 'kb.a', version: 1, topic: 't-a', contentDigest: digest('a') }),
      recordInput({ knowledgeId: 'kb.b', version: 1, topic: 't-b', contentDigest: digest('b') }),
    ]);
    const result = retrieveGovernedKnowledge(
      registry,
      createRetrievalRequest(
        requestInput({ selectors: { topics: ['t-a', 't-b'] }, maxRecords: 1 }),
      ),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-limit-exceeded');
  });

  it('(47) enforces the content-size bound', () => {
    const result = retrieveGovernedKnowledge(
      baseRegistry(),
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { maxContentChars: 5 })),
    );
    expect(result.ok ? null : result.reason).toBe('knowledge-limit-exceeded');
  });

  it('(48) rejects any free-text / unknown query field', () => {
    expect(() =>
      createRetrievalRequest(
        requestInput({
          query: 'find me anything',
        } as unknown as Partial<KnowledgeRetrievalRequestInput>),
      ),
    ).toThrow();
    // And a request with no selector at all is invalid.
    expect(() => createRetrievalRequest(requestInput({ selectors: {} }))).toThrow();
  });

  it('(49) exposes no unrestricted list-all operation', () => {
    const registry = baseRegistry() as unknown as Record<string, unknown>;
    expect(registry['all']).toBeUndefined();
    expect(registry['listAll']).toBeUndefined();
    expect(registry['records']).toBeUndefined();
  });

  it('(50,51) is deterministic for the same request and registry (pure, no I/O)', () => {
    const registry = baseRegistry();
    const req = createRetrievalRequest(idRequest('kb.policy.sla', 1));
    const a = retrieveGovernedKnowledge(registry, req);
    const b = retrieveGovernedKnowledge(registry, req);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Citation and observability (52–57).
// ---------------------------------------------------------------------------
describe('citation and observability', () => {
  it('(52,53) every result carries an exact citation with id/version/revision/digest/dates', () => {
    const result = retrieveGovernedKnowledge(
      baseRegistry(),
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const { citation } = result.records[0] ?? { citation: undefined };
      expect(citation).toBeDefined();
      expect(citation?.knowledgeId).toBe('kb.policy.sla');
      expect(citation?.version).toBe(1);
      expect(citation?.sourceRevision).toBe('rev-1');
      expect(citation?.contentDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(citation?.effectiveFrom).toBe('2026-01-02T00:00:00Z');
    }
  });

  it('(54) a retired audit lookup cites exact id/version and never masquerades as current retrieval', () => {
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        knowledgeId: 'kb.k',
        version: 1,
        contentDigest: digest('a'),
        lifecycleState: 'RETIRED',
        supersededBy: { knowledgeId: 'kb.k', version: 2 },
      }),
      recordInput({ knowledgeId: 'kb.k', version: 2, contentDigest: digest('b') }),
    ]);
    const audit = auditLookup(registry, 'kb.k', 1);
    expect(audit?.kind).toBe('audit-citation');
    expect(audit?.lifecycleState).toBe('RETIRED');
    expect(audit?.citation.version).toBe(1);
    // It is NOT a retrieval result: no `ok`/`records`, and no content.
    expect((audit as unknown as Record<string, unknown>)['ok']).toBeUndefined();
    expect((audit as unknown as Record<string, unknown>)['records']).toBeUndefined();
    expect(JSON.stringify(audit)).not.toContain('The carpentry SLA');
  });

  it('(55) emits a safe served event', () => {
    const { hook, events } = recorder();
    retrieveGovernedKnowledge(
      baseRegistry(),
      createRetrievalRequest(idRequest('kb.policy.sla', 1)),
      { observability: hook },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('knowledge-served');
    expect(events[0]?.count).toBe(1);
  });

  it('(56) emits a safe denied/expiry/conflict event', () => {
    const { hook, events } = recorder();
    retrieveGovernedKnowledge(
      createGovernedKnowledgeRegistry([recordInput({ classification: 'HUMAN_ONLY' })]),
      createRetrievalRequest(idRequest('kb.policy.sla', 1, { dataClass: 'HUMAN_ONLY' })),
      { observability: hook },
    );
    expect(events[0]?.reason).toBe('knowledge-data-class-denied');
  });

  it('(57) events never contain content, prompt, subject, key, or token', () => {
    const { hook, events } = recorder();
    const registry = createGovernedKnowledgeRegistry([
      recordInput({
        content: 'SECRET-BODY hello',
        subjectRef: 'subject.SECRET',
        permissions: {
          tenantScope: 'GLOBAL',
          allowedAgentScopes: ['CLIENT'],
          allowedPurposes: ['CLIENT_RESPONSE'],
        },
      }),
    ]);
    const gate = createDeterministicPrivacyGate({ statuses: { 'subject.SECRET': 'clear' } });
    retrieveGovernedKnowledge(registry, createRetrievalRequest(idRequest('kb.policy.sla', 1)), {
      privacyGate: gate,
      observability: hook,
    });
    const serialized = JSON.stringify(events);
    for (const forbidden of ['SECRET-BODY', 'hello', 'subject.SECRET', 'sk-', 'Bearer ']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
