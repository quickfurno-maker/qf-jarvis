import {
  normalizeSourceDocument,
  type KnowledgeSourceDocumentInput,
} from '@qf-jarvis/knowledge-ingestion';
import { describe, expect, it, vi } from 'vitest';

import {
  createKnowledgeFreshnessCoordinator,
  type KnowledgeFreshnessSourceBundle,
} from '../knowledge-freshness/create-knowledge-freshness-coordinator.js';

function document(revision = 'source.rev.2'): KnowledgeSourceDocumentInput {
  return {
    knowledgeId: 'policy.payment',
    version: 2,
    topic: 'payment-policy',
    sourceLayer: 'POLICY_FAQ',
    sourceType: 'POLICY',
    authorityTier: 'APPROVED_BUSINESS_RULE',
    contentFormat: 'MARKDOWN',
    payload: { kind: 'TEXT', text: '# Payment\nApproved payment policy.' },
    sourceRef: 'source.payment-policy',
    sourceRevision: revision,
    owner: 'owner.knowledge',
    approvedBy: 'owner.knowledge',
    approvedAt: '2026-09-23T09:00:00.000Z',
    effectiveFrom: '2026-09-23T09:00:00.000Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['CLIENT'],
      allowedPurposes: ['POLICY_LOOKUP'],
    },
  };
}

function bundle(approvedForProduction = true): KnowledgeFreshnessSourceBundle {
  const doc = document();
  return {
    document: doc,
    fingerprint: {
      sourceRef: doc.sourceRef,
      sourceRevision: doc.sourceRevision,
      contentDigest: normalizeSourceDocument(doc).contentDigest,
      ownerRef: doc.owner,
      approvedForProduction,
      ...(approvedForProduction ? { approvalRef: 'approval.knowledge.payment.2' } : {}),
    },
  };
}

function oldFingerprint(current: KnowledgeFreshnessSourceBundle['fingerprint']) {
  return {
    ...current,
    sourceRevision: 'source.rev.1',
    contentDigest: 'a'.repeat(64),
    approvalRef: 'approval.knowledge.payment.1',
  };
}

describe('knowledge freshness coordinator', () => {
  it('does not evaluate or build when the exact approved source set is unchanged', async () => {
    const current = bundle();
    const evaluate = vi.fn();
    const build = vi.fn();
    const coordinator = createKnowledgeFreshnessCoordinator({
      acceptedSources: [current.fingerprint],
      sourcePort: { readCurrent: vi.fn().mockResolvedValue([current]) },
      evaluation: { evaluate },
      builder: { build },
    });
    await expect(coordinator.run('knowledge.candidate.1')).resolves.toEqual({
      outcome: 'NO_CHANGE',
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('blocks an unapproved changed source before evaluation or build', async () => {
    const current = bundle(false);
    const evaluate = vi.fn();
    const build = vi.fn();
    const coordinator = createKnowledgeFreshnessCoordinator({
      acceptedSources: [
        oldFingerprint({
          ...current.fingerprint,
          approvedForProduction: true,
          approvalRef: 'approval.old',
        }),
      ],
      sourcePort: { readCurrent: vi.fn().mockResolvedValue([current]) },
      evaluation: { evaluate },
      builder: { build },
    });
    await expect(coordinator.run('knowledge.candidate.2')).resolves.toEqual({
      outcome: 'BLOCKED_UNAPPROVED_SOURCE',
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it('builds and seals an evaluated candidate but never activates it', async () => {
    const current = bundle();
    const build = vi.fn().mockResolvedValue({
      revision: 'knowledge.candidate.3',
      sourceDocumentsRead: 1,
      stageBatches: 1,
      chunksStaged: 2,
      documentsPublished: 1,
      activated: false,
    });
    const coordinator = createKnowledgeFreshnessCoordinator({
      acceptedSources: [oldFingerprint(current.fingerprint)],
      sourcePort: { readCurrent: vi.fn().mockResolvedValue([current]) },
      evaluation: {
        evaluate: vi.fn().mockResolvedValue({ passed: true, evidenceRef: 'evaluation.rag.3' }),
      },
      builder: { build },
    });
    await expect(coordinator.run('knowledge.candidate.3')).resolves.toEqual({
      outcome: 'CANDIDATE_SEALED_INACTIVE',
      revision: 'knowledge.candidate.3',
      evaluationEvidenceRef: 'evaluation.rag.3',
      sourceCount: 1,
      chunksStaged: 2,
    });
    expect(build).toHaveBeenCalledOnce();
  });

  it('refuses a builder that reports activation', async () => {
    const current = bundle();
    const coordinator = createKnowledgeFreshnessCoordinator({
      acceptedSources: [oldFingerprint(current.fingerprint)],
      sourcePort: { readCurrent: vi.fn().mockResolvedValue([current]) },
      evaluation: {
        evaluate: vi.fn().mockResolvedValue({ passed: true, evidenceRef: 'evaluation.rag.4' }),
      },
      builder: {
        build: vi.fn().mockResolvedValue({
          revision: 'knowledge.candidate.4',
          sourceDocumentsRead: 1,
          stageBatches: 1,
          chunksStaged: 1,
          documentsPublished: 1,
          activated: true,
        }),
      },
    });
    await expect(coordinator.run('knowledge.candidate.4')).rejects.toThrow(
      'knowledge-freshness-builder-authority-violation',
    );
  });
});
