import type { FusedKnowledgeCandidate, RankedChunkCandidate } from './contracts.js';

const RRF_K = 60;
const LEXICAL_WEIGHT = 0.55;
const VECTOR_WEIGHT = 0.45;

interface MutableFusion {
  chunk: RankedChunkCandidate['chunk'];
  lexicalRank?: number;
  vectorRank?: number;
  lexicalScore?: number;
  vectorScore?: number;
  fusedScore: number;
}

export function fuseHybridCandidates(
  lexical: readonly RankedChunkCandidate[],
  vector: readonly RankedChunkCandidate[],
  maxCandidates: number,
): readonly FusedKnowledgeCandidate[] {
  const byId = new Map<string, MutableFusion>();

  const add = (
    candidate: RankedChunkCandidate,
    kind: 'LEXICAL' | 'VECTOR',
    weight: number,
  ): void => {
    const id = candidate.chunk.chunkId;
    const current = byId.get(id) ?? {
      chunk: candidate.chunk,
      fusedScore: 0,
    };
    current.fusedScore += weight / (RRF_K + candidate.rank);
    if (kind === 'LEXICAL') {
      current.lexicalRank = candidate.rank;
      current.lexicalScore = candidate.score;
    } else {
      current.vectorRank = candidate.rank;
      current.vectorScore = candidate.score;
    }
    byId.set(id, current);
  };

  lexical.forEach((candidate) => {
    add(candidate, 'LEXICAL', LEXICAL_WEIGHT);
  });
  vector.forEach((candidate) => {
    add(candidate, 'VECTOR', VECTOR_WEIGHT);
  });

  return Object.freeze(
    [...byId.values()]
      .sort((a, b) => b.fusedScore - a.fusedScore || a.chunk.chunkId.localeCompare(b.chunk.chunkId))
      .slice(0, maxCandidates)
      .map((candidate) =>
        Object.freeze({
          chunk: candidate.chunk,
          lexicalRank: candidate.lexicalRank,
          vectorRank: candidate.vectorRank,
          lexicalScore: candidate.lexicalScore,
          vectorScore: candidate.vectorScore,
          fusedScore: candidate.fusedScore,
          rerankScore: candidate.fusedScore,
        }),
      ),
  );
}
