/**
 * Deterministic test fixtures for the governed-knowledge suite (QFJ-P04.03). Not a spec file — it
 * lives under src/tests (excluded from dist) and only builds valid inputs that tests then vary.
 */
import type { KnowledgeRecordInput } from '../contracts/knowledge-record.js';
import type { KnowledgeRetrievalRequestInput } from '../contracts/retrieval-request.js';

/** A 64-hex content digest built deterministically from a single seed character. */
export function digest(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

/** A valid ACTIVE, currently-effective record input; override any field for a specific test. */
export function recordInput(overrides: Partial<KnowledgeRecordInput> = {}): KnowledgeRecordInput {
  return {
    knowledgeId: 'kb.policy.sla',
    version: 1,
    topic: 'sla-policy',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'The carpentry SLA is 48 hours.',
    contentDigest: digest('a'),
    sourceRef: 'doc://policies/sla',
    sourceRevision: 'rev-1',
    owner: 'owner.ops',
    approvedBy: 'approver.head',
    approvedAt: '2026-01-01T00:00:00Z',
    effectiveFrom: '2026-01-02T00:00:00Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['CLIENT', 'COORDINATION'],
      allowedPurposes: ['CLIENT_RESPONSE', 'POLICY_LOOKUP'],
    },
    ...overrides,
  };
}

/** A valid retrieval request that resolves the base record by topic; override for a specific test. */
export function requestInput(
  overrides: Partial<KnowledgeRetrievalRequestInput> = {},
): KnowledgeRetrievalRequestInput {
  return {
    requestId: 'run-1',
    tenantId: 'tenant-a',
    agentScope: 'CLIENT',
    purpose: 'CLIENT_RESPONSE',
    dataClass: 'HOSTED_ALLOWED',
    asOf: '2026-02-01T00:00:00Z',
    maxRecords: 8,
    maxContentChars: 10_000,
    requireCitation: true,
    selectors: { topics: ['sla-policy'] },
    ...overrides,
  };
}
