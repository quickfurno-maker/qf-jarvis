import { describe, expect, it } from 'vitest';

import type { KnowledgeCandidateBuildPort } from '../knowledge-freshness/create-knowledge-freshness-coordinator.js';
import { buildQuickFurnoKnowledgeCandidate } from '../knowledge-production/build-quickfurno-knowledge-candidate.js';

const APPROVAL = Object.freeze({
  approvedBy: 'quickfurno.owner',
  approvedAt: '2026-10-01T00:00:00Z',
  approvalRef: 'owner.approval.quickfurno.knowledge.v1',
});

describe('QuickFurno knowledge candidate build boundary', () => {
  it('builds the exact derived revision and leaves it inactive', async () => {
    let seenRevision = '';
    let seenDocuments = 0;
    const builder: KnowledgeCandidateBuildPort = {
      build(input) {
        seenRevision = input.revision;
        seenDocuments = input.documents.length;
        return Promise.resolve({
          revision: input.revision,
          sourceDocumentsRead: input.documents.length,
          stageBatches: 1,
          chunksStaged: input.documents.length,
          documentsPublished: input.documents.length,
          activated: false,
        });
      },
    };

    const result = await buildQuickFurnoKnowledgeCandidate({ approval: APPROVAL, builder });
    expect(result.revision).toBe(seenRevision);
    expect(result.revision).toMatch(/^qfkb\.sha256\.[0-9a-f]{64}$/u);
    expect(seenDocuments).toBeGreaterThanOrEqual(7);
    expect(result.documentsPublished).toBe(seenDocuments);
  });

  it('refuses a builder that claims it activated during candidate construction', async () => {
    const builder: KnowledgeCandidateBuildPort = {
      build(input) {
        return Promise.resolve({
          revision: input.revision,
          sourceDocumentsRead: input.documents.length,
          stageBatches: 1,
          chunksStaged: input.documents.length,
          documentsPublished: input.documents.length,
          activated: true,
        });
      },
    };

    await expect(
      buildQuickFurnoKnowledgeCandidate({ approval: APPROVAL, builder }),
    ).rejects.toThrow('quickfurno-knowledge-candidate-authority-violation');
  });

  it('refuses a builder that substitutes another revision', async () => {
    const builder: KnowledgeCandidateBuildPort = {
      build(input) {
        return Promise.resolve({
          revision: input.revision + '.other',
          sourceDocumentsRead: input.documents.length,
          stageBatches: 1,
          chunksStaged: input.documents.length,
          documentsPublished: input.documents.length,
          activated: false,
        });
      },
    };

    await expect(
      buildQuickFurnoKnowledgeCandidate({ approval: APPROVAL, builder }),
    ).rejects.toThrow('quickfurno-knowledge-candidate-authority-violation');
  });
});
