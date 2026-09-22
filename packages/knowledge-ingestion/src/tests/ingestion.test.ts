import { describe, expect, it } from 'vitest';

import type { KnowledgeSourceDocumentInput } from '../contracts.js';
import { DEFAULT_CHUNKING_PROFILE } from '../contracts.js';
import { KnowledgeIngestionError } from '../errors.js';
import { normalizeKnowledgeText, renderStructuredKnowledge } from '../normalize.js';
import { prepareKnowledgeBatch } from '../pipeline.js';

function base(over: Partial<KnowledgeSourceDocumentInput> = {}): KnowledgeSourceDocumentInput {
  return {
    knowledgeId: 'doc.installation',
    version: 1,
    topic: 'installation',
    sourceLayer: 'BUSINESS_DOCUMENT',
    sourceType: 'PROCESS_GUIDE',
    authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
    contentFormat: 'MARKDOWN',
    payload: { kind: 'TEXT', text: '# Installation\n\nWe measure first.\n\nThen we schedule.' },
    sourceRef: 'handbook.installation',
    sourceRevision: 'rev.1',
    owner: 'quickfurno',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
    approvedBy: 'owner.quickfurno',
    approvedAt: '2025-12-31T00:00:00.000Z',
    ...over,
  };
}

describe('knowledge ingestion', () => {
  it('normalizes unicode and whitespace deterministically', () => {
    expect(normalizeKnowledgeText('  A\r\nB\u200B   C  ')).toBe('A\nB C');
  });

  it('renders structured fields in canonical key order', () => {
    expect(
      renderStructuredKnowledge([
        { key: 'z', value: 2 },
        { key: 'a', value: 'x' },
      ]),
    ).toBe('a: "x"\nz: 2');
  });

  it('builds deterministic governed chunks and embedding reuse groups', () => {
    const one = prepareKnowledgeBatch([base()]);
    const two = prepareKnowledgeBatch([base()]);
    expect(one).toEqual(two);
    expect(one.chunks.length).toBeGreaterThan(0);
    expect(one.chunks[0]?.record.topic).toBe('installation');
    expect(one.chunks[0]?.record.lifecycleState).toBe('ACTIVE');
    expect(one.embeddingReuseGroups.length).toBe(one.chunks.length);
  });

  it('deduplicates identical source versions but rejects conflicting versions', () => {
    const duplicate = prepareKnowledgeBatch([base(), base()]);
    expect(duplicate.documents).toHaveLength(1);
    expect(duplicate.duplicateSourceVersions).toBe(1);
    expect(() =>
      prepareKnowledgeBatch([
        base(),
        base({ payload: { kind: 'TEXT', text: 'different approved text' } }),
      ]),
    ).toThrow(KnowledgeIngestionError);
  });

  it('chunks a large section-aware document under the record ceiling', () => {
    const text = ['# A', 'Sentence one. '.repeat(200), '# B', 'Sentence two. '.repeat(200)].join(
      '\n\n',
    );
    const batch = prepareKnowledgeBatch([base({ payload: { kind: 'TEXT', text } })], {
      ...DEFAULT_CHUNKING_PROFILE,
      targetChars: 512,
      maxChars: 700,
      overlapChars: 80,
    });
    expect(batch.chunks.length).toBeGreaterThan(4);
    expect(batch.chunks.every((chunk) => chunk.record.content.length <= 700)).toBe(true);
    expect(batch.chunks.some((chunk) => chunk.headingPath.includes('B'))).toBe(true);
  });

  it('accepts structured source data only through explicit key value fields', () => {
    const structured = base({
      knowledgeId: 'doc.catalog.row',
      topic: 'catalog',
      sourceLayer: 'STRUCTURED_DATA',
      contentFormat: 'PLAIN_TEXT',
      payload: {
        kind: 'STRUCTURED',
        fields: [
          { key: 'sku', value: 'ABC' },
          { key: 'available', value: true },
        ],
      },
    });
    const batch = prepareKnowledgeBatch([structured]);
    expect(batch.documents[0]?.content).toContain('sku: "ABC"');
  });
});
