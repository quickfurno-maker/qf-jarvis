import type { FusedKnowledgeCandidate, KnowledgeRerankerPort } from './contracts.js';

const TOKENS = /[\p{L}\p{N}]+/gu;

function tokens(value: string): ReadonlySet<string> {
  return new Set(
    (value.toLocaleLowerCase().match(TOKENS) ?? []).filter((token) => token.length > 1),
  );
}

function overlap(query: ReadonlySet<string>, text: string): number {
  if (query.size === 0) return 0;
  const candidate = tokens(text);
  let count = 0;
  for (const token of query) if (candidate.has(token)) count += 1;
  return count / query.size;
}

export function createDeterministicKnowledgeReranker(): KnowledgeRerankerPort {
  return Object.freeze({
    executionClass: 'LOCAL' as const,
    rerank(
      queryText: string,
      candidates: readonly FusedKnowledgeCandidate[],
    ): Promise<readonly FusedKnowledgeCandidate[]> {
      const queryTokens = tokens(queryText);
      const queryLower = queryText.toLocaleLowerCase();
      return Promise.resolve(
        Object.freeze(
          candidates
            .map((candidate) => {
              const content = candidate.chunk.record.content;
              const heading = candidate.chunk.headingPath.join(' ');
              const topic = candidate.chunk.record.topic;
              const phrase = content.toLocaleLowerCase().includes(queryLower) ? 1 : 0;
              const rerankScore =
                candidate.fusedScore * 100 +
                overlap(queryTokens, content) * 0.35 +
                overlap(queryTokens, heading) * 0.25 +
                overlap(queryTokens, topic) * 0.15 +
                phrase * 0.15;
              return Object.freeze({ ...candidate, rerankScore });
            })
            .sort(
              (a, b) =>
                b.rerankScore - a.rerankScore ||
                b.fusedScore - a.fusedScore ||
                a.chunk.chunkId.localeCompare(b.chunk.chunkId),
            ),
        ),
      );
    },
  });
}
