import {
  normalizeSourceDocument,
  type KnowledgeSourceDocumentInput,
} from '@qf-jarvis/knowledge-ingestion';
import { describe, expect, it } from 'vitest';

import {
  createKnowledgeFreshnessManifestSourcePort,
  KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL,
} from '../knowledge-freshness/create-manifest-source-port.js';

function document(): KnowledgeSourceDocumentInput {
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
    sourceRevision: 'source.rev.2',
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

function source() {
  const doc = document();
  return {
    fingerprint: {
      sourceRef: doc.sourceRef,
      sourceRevision: doc.sourceRevision,
      contentDigest: normalizeSourceDocument(doc).contentDigest,
      ownerRef: doc.owner,
      approvedForProduction: true,
      approvalRef: 'approval.knowledge.payment.2',
    },
    document: doc,
  };
}

function manifest(sources: readonly unknown[]) {
  return {
    protocol: KNOWLEDGE_FRESHNESS_SOURCE_MANIFEST_PROTOCOL,
    revision: 'manifest.1',
    sources,
  };
}

describe('knowledge freshness manifest source port', () => {
  it('returns detached validated source bundles', async () => {
    const original = source();
    const port = createKnowledgeFreshnessManifestSourcePort(manifest([original]));
    const first = await port.readCurrent();
    const second = await port.readCurrent();

    expect(first).toEqual([original]);
    expect(second).toEqual([original]);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
    expect(first[0]?.document).not.toBe(original.document);
  });

  it('rejects content digest drift before the coordinator sees the source', () => {
    const candidate = source();
    candidate.fingerprint.contentDigest = 'a'.repeat(64);
    expect(() => createKnowledgeFreshnessManifestSourcePort(manifest([candidate]))).toThrow(
      'knowledge-freshness-source-binding-invalid',
    );
  });

  it('rejects duplicate source identities', () => {
    const one = source();
    expect(() => createKnowledgeFreshnessManifestSourcePort(manifest([one, one]))).toThrow(
      'knowledge-source-fingerprint-invalid',
    );
  });

  it('rejects an approved fingerprint without document approval evidence', () => {
    const candidate = source();
    const contaminated = {
      ...candidate,
      document: {
        ...candidate.document,
        approvedBy: undefined,
        approvedAt: undefined,
      },
    };
    expect(() => createKnowledgeFreshnessManifestSourcePort(manifest([contaminated]))).toThrow(
      'knowledge-freshness-manifest-invalid',
    );
  });

  it('rejects extra authority-shaped manifest fields and oversized source sets', () => {
    expect(() =>
      createKnowledgeFreshnessManifestSourcePort({
        ...manifest([source()]),
        activate: true,
      }),
    ).toThrow('knowledge-freshness-manifest-invalid');

    expect(() =>
      createKnowledgeFreshnessManifestSourcePort(
        manifest(Array.from({ length: 1001 }, () => source())),
      ),
    ).toThrow('knowledge-freshness-manifest-invalid');
  });
});
