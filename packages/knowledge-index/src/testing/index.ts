import { createHash } from 'node:crypto';

import type { KnowledgeEmbeddingPort } from '../contracts.js';
import { KNOWLEDGE_EMBEDDING_DIMENSION_V1 } from '../contracts.js';

function deterministicVector(text: string): readonly number[] {
  const digest = createHash('sha256').update(text, 'utf8').digest();
  const vector = new Array<number>(KNOWLEDGE_EMBEDDING_DIMENSION_V1);
  let norm = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const byte = digest[index % digest.length] ?? 0;
    const value = (byte - 127.5) / 127.5;
    vector[index] = value;
    norm += value * value;
  }
  const scale = Math.sqrt(norm) || 1;
  return Object.freeze(vector.map((value) => value / scale));
}

export function createDeterministicTestEmbeddingPort(
  executionClass: 'HOSTED' | 'LOCAL' = 'LOCAL',
): KnowledgeEmbeddingPort {
  return Object.freeze({
    modelRef: 'test.embedding.sha256.v1',
    dimension: KNOWLEDGE_EMBEDDING_DIMENSION_V1,
    executionClass,
    embed(texts: readonly string[]) {
      return Promise.resolve(Object.freeze(texts.map(deterministicVector)));
    },
  });
}
