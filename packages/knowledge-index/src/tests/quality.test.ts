import { describe, expect, it } from 'vitest';

import type { HybridKnowledgeHit } from '../contracts.js';
import {
  compareKnowledgeQualityReports,
  evaluateKnowledgeQuality,
} from '../quality.js';

function hit(chunkId: string, knowledgeId: string): HybridKnowledgeHit {
  return {
    chunkId,
    parentKnowledgeId: knowledgeId,
    parentVersion: 1,
    topic: 'installation',
    content: 'approved fixture content',
    contentFormat: 'PLAIN_TEXT',
    headingPath: [],
    citation: {
      knowledgeId,
      version: 1,
      sourceRef: 'test://' + knowledgeId,
      sourceRevision: 'rev.1',
      authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      expiresAt: undefined,
      contentDigest: 'a'.repeat(64),
    },
    fusedScore: 1,
    rerankScore: 1,
  };
}

const thresholds = {
  minRecallAtK: 0.7,
  minPrecisionAtK: 0.5,
  minMeanReciprocalRank: 0.7,
  minCitationPrecision: 0.7,
  maxNoResultRate: 0.2,
} as const;

describe('knowledge quality evaluator', () => {
  it('scores labelled retrieval and citation quality deterministically', () => {
    const report = evaluateKnowledgeQuality(
      [
        {
          caseId: 'q.installation.1',
          expectedChunkIds: ['chunk.a'],
          expectedCitationRefs: ['doc.a@1'],
          hits: [hit('chunk.a', 'doc.a'), hit('chunk.noise', 'doc.noise')],
        },
        {
          caseId: 'q.installation.2',
          expectedChunkIds: ['chunk.b'],
          expectedCitationRefs: ['doc.b@1'],
          hits: [hit('chunk.b', 'doc.b')],
        },
      ],
      thresholds,
    );

    expect(report.metrics).toEqual({
      caseCount: 2,
      recallAtK: 1,
      precisionAtK: 0.75,
      meanReciprocalRank: 1,
      citationPrecision: 2 / 3,
      noResultRate: 0,
    });
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(['citation-precision-below-threshold']);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.metrics)).toBe(true);
  });

  it('fails quality floors and detects regression against an accepted baseline', () => {
    const baseline = evaluateKnowledgeQuality(
      [
        {
          caseId: 'q.a',
          expectedChunkIds: ['chunk.a'],
          expectedCitationRefs: ['doc.a@1'],
          hits: [hit('chunk.a', 'doc.a')],
        },
      ],
      {
        minRecallAtK: 0,
        minPrecisionAtK: 0,
        minMeanReciprocalRank: 0,
        minCitationPrecision: 0,
        maxNoResultRate: 1,
      },
    );
    const candidate = evaluateKnowledgeQuality(
      [
        {
          caseId: 'q.a',
          expectedChunkIds: ['chunk.a'],
          expectedCitationRefs: ['doc.a@1'],
          hits: [],
        },
      ],
      {
        minRecallAtK: 0,
        minPrecisionAtK: 0,
        minMeanReciprocalRank: 0,
        minCitationPrecision: 0,
        maxNoResultRate: 1,
      },
    );

    expect(
      compareKnowledgeQualityReports(baseline, candidate, {
        maxRecallDrop: 0.05,
        maxPrecisionDrop: 0.05,
        maxMrrDrop: 0.05,
        maxCitationPrecisionDrop: 0.05,
        maxNoResultRateIncrease: 0.05,
      }),
    ).toEqual({
      passed: false,
      regressions: [
        'recall-regressed',
        'precision-regressed',
        'mrr-regressed',
        'citation-precision-regressed',
        'no-result-rate-regressed',
      ],
    });
  });

  it('rejects malformed or duplicate fixture identities instead of scoring ambiguous evidence', () => {
    expect(() =>
      evaluateKnowledgeQuality(
        [
          {
            caseId: 'bad id',
            expectedChunkIds: ['a'],
            expectedCitationRefs: ['doc@1'],
            hits: [],
          },
        ],
        thresholds,
      ),
    ).toThrow('knowledge-quality-cases-invalid');

    expect(() =>
      evaluateKnowledgeQuality(
        [
          {
            caseId: 'q.dup',
            expectedChunkIds: ['a', 'a'],
            expectedCitationRefs: ['doc@1'],
            hits: [],
          },
        ],
        thresholds,
      ),
    ).toThrow('knowledge-quality-cases-invalid');
  });
});
