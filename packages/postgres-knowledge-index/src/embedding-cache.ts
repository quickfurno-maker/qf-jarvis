import type { Pool } from 'pg';

import {
  KNOWLEDGE_EMBEDDING_DIMENSION_V1,
  type KnowledgeEmbeddingCachePort,
} from '@qf-jarvis/knowledge-index';

import { PostgresKnowledgeIndexError } from './errors.js';

function parseVector(raw: string): readonly number[] {
  if (raw.length < 2 || !raw.startsWith('[') || !raw.endsWith(']')) {
    throw new PostgresKnowledgeIndexError('invalid-embedding');
  }
  const vector = raw
    .slice(1, -1)
    .split(',')
    .map((one) => Number(one));
  if (
    vector.length !== KNOWLEDGE_EMBEDDING_DIMENSION_V1 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new PostgresKnowledgeIndexError('invalid-embedding');
  }
  return Object.freeze(vector);
}

export function createPostgresKnowledgeEmbeddingCache(pool: Pool): KnowledgeEmbeddingCachePort {
  return Object.freeze({
    async read(modelRef: string, contentDigests: readonly string[]) {
      if (
        !/^[A-Za-z0-9._:/-]{1,256}$/u.test(modelRef) ||
        contentDigests.length > 4096 ||
        contentDigests.some((digest) => !/^[0-9a-f]{64}$/u.test(digest))
      ) {
        throw new PostgresKnowledgeIndexError('invalid-embedding');
      }
      if (contentDigests.length === 0) return new Map();

      try {
        const rows = await pool.query<{ content_digest: string; embedding: string }>(
          [
            'SELECT DISTINCT ON (content_digest) content_digest, embedding::text AS embedding',
            'FROM qf_jarvis_knowledge.chunk',
            'WHERE embedding_model_ref=$1 AND content_digest=ANY($2::text[])',
            'ORDER BY content_digest, created_at DESC, chunk_id ASC',
          ].join(' '),
          [modelRef, [...contentDigests]],
        );
        const cached = new Map<string, readonly number[]>();
        for (const row of rows.rows) {
          cached.set(row.content_digest, parseVector(row.embedding));
        }
        return cached;
      } catch (error) {
        if (error instanceof PostgresKnowledgeIndexError) throw error;
        throw new PostgresKnowledgeIndexError('candidate-store-failed');
      }
    },
  });
}
