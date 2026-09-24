import { describe, expect, it } from 'vitest';

import { compressRetrievedContext } from '../index.js';

describe('extractive context compression', () => {
  it('keeps exact source substrings and citations', () => {
    const result = compressRetrievedContext({
      hits: [
        { chunkId: 'c.1', content: 'ABCDEFGHIJ', citationRef: 'kb.a.v1', score: 0.9 },
        { chunkId: 'c.2', content: 'KLMNOP', citationRef: 'kb.b.v1', score: 0.8 },
      ],
      maxChars: 12,
      maxItems: 2,
      minScore: 0.5,
    });
    expect(result.compressionMode).toBe('EXTRACTIVE_ONLY');
    expect(result.items).toEqual([
      { chunkId: 'c.1', content: 'ABCDEFGHIJ', citationRef: 'kb.a.v1', score: 0.9, truncated: false },
      { chunkId: 'c.2', content: 'KL', citationRef: 'kb.b.v1', score: 0.8, truncated: true },
    ]);
  });

  it('deduplicates equivalent content and filters low scores', () => {
    const result = compressRetrievedContext({
      hits: [
        { chunkId: 'c.1', content: 'Same  text', citationRef: 'kb.a.v1', score: 0.9 },
        { chunkId: 'c.2', content: ' same text ', citationRef: 'kb.b.v1', score: 0.8 },
        { chunkId: 'c.3', content: 'Weak', citationRef: 'kb.c.v1', score: 0.2 },
      ],
      maxChars: 100,
      maxItems: 3,
      minScore: 0.5,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.chunkId).toBe('c.1');
  });

  it('refuses duplicate chunk identities', () => {
    expect(() =>
      compressRetrievedContext({
        hits: [
          { chunkId: 'c.1', content: 'A', citationRef: 'kb.a.v1', score: 0.9 },
          { chunkId: 'c.1', content: 'B', citationRef: 'kb.b.v1', score: 0.8 },
        ],
        maxChars: 100,
        maxItems: 2,
        minScore: 0,
      }),
    ).toThrow('context-hit-invalid');
  });
});
