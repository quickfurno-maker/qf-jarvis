export {
  KNOWLEDGE_SOURCE_LAYERS,
  MAX_SOURCE_DOCUMENT_CHARS,
  MAX_STRUCTURED_FIELDS,
  DEFAULT_CHUNKING_PROFILE,
} from './contracts.js';
export type {
  KnowledgeSourceLayer,
  StructuredKnowledgeField,
  KnowledgeSourcePayload,
  KnowledgeSourceDocumentInput,
  KnowledgeGovernanceEnvelope,
  NormalizedKnowledgeDocument,
  ChunkingProfile,
  GovernedKnowledgeChunk,
  EmbeddingReuseGroup,
  PreparedKnowledgeBatch,
} from './contracts.js';
export { KnowledgeIngestionError, KNOWLEDGE_INGESTION_ERROR_CODES } from './errors.js';
export type { KnowledgeIngestionErrorCode } from './errors.js';
export {
  sha256Hex,
  normalizeKnowledgeText,
  renderStructuredKnowledge,
  normalizeSourceDocument,
} from './normalize.js';
export { chunkKnowledgeDocument } from './chunk.js';
export {
  EXTRACTED_KNOWLEDGE_MEDIA_TYPES,
  createExtractedKnowledgeSource,
} from './source-adapter.js';
export type {
  ExtractedKnowledgeMediaType,
  ExtractedKnowledgeSourceInput,
} from './source-adapter.js';
export { prepareKnowledgeBatch } from './pipeline.js';
