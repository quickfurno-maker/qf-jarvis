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
 *
 * ### Revisions are derived here too (JF-3 owner correction)
 *
 * These helpers build a real revision-bound pack and read its derived revision. There is deliberately
 * no test-only shortcut that pairs a registry with a chosen revision label: a convenience API that let
 * specs do what production cannot would be the same bug with a `test` prefix, and it would make the
 * suite unable to notice if the production path regained the ability.
 */
import { createRetrievalRequest } from '@qf-jarvis/governed-knowledge';
import type {
  KnowledgeRecordInput,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalRequestInput,
} from '@qf-jarvis/governed-knowledge';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import type { RevisionBoundKnowledgePack } from '../contracts/revision-bound-knowledge-pack.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import type { RagProvisioner } from '../service/create-rag-provisioner.js';
import { createRevisionBoundKnowledgePack } from '../service/create-revision-bound-knowledge-pack.js';
import { activeProfileInput } from '../testing/fixtures.js';

/** A 64-hex content digest built deterministically from a single seed character. */
export function digest(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

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

/** A revision-bound pack over the given synthetic records, with its revision derived from them. */
export function testPack(
  records: readonly KnowledgeRecordInput[] = [testRecordInput()],
): RevisionBoundKnowledgePack {
  return createRevisionBoundKnowledgePack(records);
}

/** A GOVERNED_EXACT backend over a pack of the given synthetic records. */
export function testBackend(
  records: readonly KnowledgeRecordInput[] = [testRecordInput()],
): RagRetrievalBackend {
  return createGovernedExactBackend({ pack: testPack(records) });
}

/**
 * An ACTIVE provisioner bound to a backend, naming that backend's own derived revision.
 *
 * The revision is read from the backend rather than written into the fixture, because there is no
 * longer any way to know it in advance — which is the correction working as intended.
 */
export function activeProvisioner(backend: RagRetrievalBackend = testBackend()): RagProvisioner {
  return createRagProvisioner(
    activeProfileInput({ knowledgeRevision: backend.knowledgeRevision }),
    {
      backend,
    },
  );
}
