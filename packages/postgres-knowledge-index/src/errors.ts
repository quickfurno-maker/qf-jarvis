export const POSTGRES_KNOWLEDGE_INDEX_ERROR_CODES = [
  'migration-checksum-mismatch',
  'migration-failed',
  'embedding-model-mismatch',
  'immutable-document-conflict',
  'immutable-chunk-conflict',
  'invalid-embedding',
  'database-row-invalid',
  'candidate-store-failed',
  'knowledge-revision-mismatch',
  'release-conflict',
  'release-not-staging',
  'release-not-sealed',
  'release-empty',
] as const;

export type PostgresKnowledgeIndexErrorCode = (typeof POSTGRES_KNOWLEDGE_INDEX_ERROR_CODES)[number];

export class PostgresKnowledgeIndexError extends Error {
  readonly code: PostgresKnowledgeIndexErrorCode;

  constructor(code: PostgresKnowledgeIndexErrorCode) {
    super(code);
    this.name = 'PostgresKnowledgeIndexError';
    this.code = code;
  }
}
