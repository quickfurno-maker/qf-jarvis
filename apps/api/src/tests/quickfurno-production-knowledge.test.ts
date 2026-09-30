import { describe, expect, it } from 'vitest';

import {\n  createKnowledgeFreshnessManifestSourcePort,\n} from '../knowledge-freshness/create-manifest-source-port.js';
import {
  QUICKFURNO_KNOWLEDGE_CANDIDATE_COUNT,
  QUICKFURNO_KNOWLEDGE_SOURCE_REVISION,
  createApprovedQuickFurnoKnowledgeSourceManifest,
  deriveQuickFurnoKnowledgeReleaseRevision,
} from '../knowledge-production/quickfurno-production-corpus.js';

const APPROVAL = Object.freeze({
  approvedBy: 'quickfurno.owner',
  approvedAt: '2026-10-01T00:00:00Z',
  approvalRef: 'owner.approval.quickfurno.knowledge.v1',
});

describe('QuickFurno production knowledge v1', () => {
  it('requires attributable approval before an ACTIVE manifest can exist', () => {
    expect(() =>
      createApprovedQuickFurnoKnowledgeSourceManifest({
        ...APPROVAL,
        approvedBy: '',
      }),
    ).toThrow('quickfurno-knowledge-approval-invalid');

    expect(() =>
      createApprovedQuickFurnoKnowledgeSourceManifest({
        ...APPROVAL,
        approvedAt: 'not-an-instant',
      }),
    ).toThrow('quickfurno-knowledge-approval-invalid');
  });

  it('emits a fully governed, production-approved source manifest', async () => {
    const manifest = createApprovedQuickFurnoKnowledgeSourceManifest(APPROVAL);
    expect(manifest.sources).toHaveLength(QUICKFURNO_KNOWLEDGE_CANDIDATE_COUNT);
    expect(QUICKFURNO_KNOWLEDGE_CANDIDATE_COUNT).toBeGreaterThanOrEqual(7);

    const port = createKnowledgeFreshnessManifestSourcePort(manifest);
    const sources = await port.readCurrent();
    expect(sources).toHaveLength(manifest.sources.length);

    for (const source of sources) {
      expect(source.fingerprint.approvedForProduction).toBe(true);
      expect(source.fingerprint.approvalRef).toBe(APPROVAL.approvalRef);
      expect(source.document.lifecycleState).toBe('ACTIVE');
      expect(source.document.approvedBy).toBe(APPROVAL.approvedBy);
      expect(source.document.approvedAt).toBe(APPROVAL.approvedAt);
      expect(source.document.effectiveFrom).toBe(APPROVAL.approvedAt);
      expect(source.document.expiresAt).toBeDefined();
      expect(source.document.classification).toBe('HOSTED_ALLOWED');
      expect(source.document.subjectRef).toBeUndefined();
      expect(source.document.sourceRevision).toBe(QUICKFURNO_KNOWLEDGE_SOURCE_REVISION);
    }
  });

  it('keeps live/volatile business truth out of RAG', () => {
    const manifest = createApprovedQuickFurnoKnowledgeSourceManifest(APPROVAL);
    const corpus = manifest.sources
      .map((source) =>
        source.document.payload.kind === 'TEXT' ? source.document.payload.text : '',
      )
      .join('\n')
      .toLowerCase();

    for (const forbidden of [
      'current price is',
      'today\'s price',
      'credit balance',
      'payment status',
      'lead status is',
      'vendor status is',
      'currently available vendor',
      'guaranteed lead volume',
    ]) {
      expect(corpus).not.toContain(forbidden);
    }
    expect(corpus).not.toMatch(/₹\s*\d/u);
    expect(corpus).not.toMatch(/\brs\.?\s*\d/iu);
  });

  it('covers the three production agents without crossing agent authority', () => {
    const manifest = createApprovedQuickFurnoKnowledgeSourceManifest(APPROVAL);
    const byTopic = new Map(
      manifest.sources.map((source) => [source.document.topic, source.document]),
    );

    expect(byTopic.get('quickfurno-overview')?.permissions.allowedAgentScopes).toEqual([
      'CLIENT',
      'VENDOR',
      'PROSPECT',
    ]);
    expect(byTopic.get('matching-process')?.permissions.allowedAgentScopes).toEqual([
      'CLIENT',
      'VENDOR',
    ]);
    expect(byTopic.get('vendor-join-overview')?.permissions.allowedAgentScopes).toEqual([
      'VENDOR',
      'PROSPECT',
    ]);
    expect(byTopic.get('lead-sharing-privacy')?.permissions.allowedAgentScopes).not.toContain(
      'PROSPECT',
    );
  });

  it('derives an exact immutable release revision from content plus governance', () => {
    const a = createApprovedQuickFurnoKnowledgeSourceManifest(APPROVAL);
    const b = createApprovedQuickFurnoKnowledgeSourceManifest(APPROVAL);
    const revision = deriveQuickFurnoKnowledgeReleaseRevision(a);

    expect(revision).toMatch(/^qfkb\.sha256\.[0-9a-f]{64}$/u);
    expect(deriveQuickFurnoKnowledgeReleaseRevision(b)).toBe(revision);

    const later = createApprovedQuickFurnoKnowledgeSourceManifest({
      ...APPROVAL,
      approvedAt: '2026-10-02T00:00:00Z',
      approvalRef: 'owner.approval.quickfurno.knowledge.v1b',
    });
    expect(deriveQuickFurnoKnowledgeReleaseRevision(later)).not.toBe(revision);
  });

  it('pins every source to the exact QuickFurno repository revision reviewed for this corpus', () => {
    expect(QUICKFURNO_KNOWLEDGE_SOURCE_REVISION).toBe(
      'c567b58a2c380b53d98a246a1b87b13f92e4aeda',
    );
  });
});
