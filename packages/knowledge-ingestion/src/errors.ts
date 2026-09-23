export const KNOWLEDGE_INGESTION_ERROR_CODES = [
  'invalid-source-document',
  'source-too-large',
  'structured-field-invalid',
  'conflicting-source-version',
  'subject-linked-semantic-indexing-forbidden',
  'chunking-profile-invalid',
  'chunk-limit-exceeded',
  'ingestion-invariant',
] as const;

export type KnowledgeIngestionErrorCode = (typeof KNOWLEDGE_INGESTION_ERROR_CODES)[number];

export class KnowledgeIngestionError extends Error {
  readonly code: KnowledgeIngestionErrorCode;

  constructor(code: KnowledgeIngestionErrorCode) {
    super(code);
    this.name = 'KnowledgeIngestionError';
    this.code = code;
  }
}
