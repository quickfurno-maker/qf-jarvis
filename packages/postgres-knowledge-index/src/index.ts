export { POSTGRES_KNOWLEDGE_INDEX_ERROR_CODES, PostgresKnowledgeIndexError } from './errors.js';
export type { PostgresKnowledgeIndexErrorCode } from './errors.js';

export { applyKnowledgeIndexMigration } from './migration.js';
export type { KnowledgeIndexMigrationResult } from './migration.js';

export { createPostgresKnowledgeIndexWriter } from './writer.js';
export type {
  KnowledgeDocumentRef,
  KnowledgeIndexStageResult,
  KnowledgeIndexPublishResult,
  KnowledgeReleaseSealResult,
  PostgresKnowledgeIndexWriter,
} from './writer.js';

export { createPostgresHybridCandidateStore } from './store.js';

export { buildStreamingKnowledgeRelease } from './publisher.js';
export type {
  StreamingKnowledgeReleaseOptions,
  StreamingKnowledgeReleaseResult,
} from './publisher.js';
