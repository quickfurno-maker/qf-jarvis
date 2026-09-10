/**
 * Deterministic SYNTHETIC governed-knowledge fixtures for the JF-3 suite (ADR-0148).
 *
 * Not a spec file. It lives under `src/tests`, which the emitting build excludes, so nothing here
 * reaches `dist/` and no composition can import it. That placement is the point: these build governed
 * RECORDS, and a record is content. The shipped `./testing` subpath deliberately builds profile inputs
 * only, so there is no route by which a production composition could obtain synthetic answers.
 *
 * Every content string below says, in the content itself, that it is synthetic. If one of these ever
 * did leak into an answer, the answer would announce the defect rather than sound plausible.
 */
import {
  createGovernedKnowledgeRegistry,
  createRetrievalRequest,
} from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeRegistry,
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalRequestInput,
} from '@qf-jarvis/governed-knowledge';

import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import type { RagProvisioner } from '../service/create-rag-provisioner.js';
import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import { activeProfileInput } from '../testing/fixtures.js';

/** A 64-hex content digest built deterministically from a single seed character. */
export function digest(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

/** The revision the synthetic test registry claims. Matches `activeProfileInput().knowledgeRevision`. */
export const TEST_KNOWLEDGE_REVISION = 'know.rev.1';

/** A valid ACTIVE, currently-effective synthetic record input; override any field for a test. */
export function testRecordInput(
  overrides: Partial<KnowledgeRecordInput> = {},
): KnowledgeRecordInput {
  return {
    knowledgeId: 'kb.synthetic.alpha',
    version: 1,
    topic: 'synthetic-alpha',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'PLAIN_TEXT',
    content: 'SYNTHETIC TEST RECORD ALPHA. Invented for a spec; not business truth.',
    contentDigest: digest('a'),
    sourceRef: 'test://synthetic/alpha',
    sourceRevision: 'rev-1',
    owner: 'owner.test',
    approvedBy: 'approver.test',
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

/** A valid bounded request resolving the base record by topic; override for a specific test. */
export function testRequestInput(
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
    selectors: { topics: ['synthetic-alpha'] },
    ...overrides,
  };
}

/** A bounded governed request built through the authority's own factory. */
export function testRequest(
  overrides: Partial<KnowledgeRetrievalRequestInput> = {},
): KnowledgeRetrievalRequest {
  return createRetrievalRequest(testRequestInput(overrides));
}

/** An immutable registry over the given synthetic records. */
export function testRegistry(
  records: readonly KnowledgeRecordInput[] = [testRecordInput()],
): GovernedKnowledgeRegistry {
  return createGovernedKnowledgeRegistry(records);
}

/** A GOVERNED_EXACT backend over the given synthetic records, at the given revision. */
export function testBackend(
  records: readonly KnowledgeRecordInput[] = [testRecordInput()],
  revision: string = TEST_KNOWLEDGE_REVISION,
): RagRetrievalBackend {
  return createGovernedExactBackend({
    registry: testRegistry(records),
    knowledgeRevision: revision,
  });
}

/** An ACTIVE provisioner bound to a backend over the given synthetic records. */
export function activeProvisioner(backend: RagRetrievalBackend = testBackend()): RagProvisioner {
  return createRagProvisioner(
    activeProfileInput({ knowledgeRevision: backend.knowledgeRevision }),
    {
      backend,
    },
  );
}
