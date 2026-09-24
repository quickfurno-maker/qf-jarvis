export {
  findReusableSemanticContext,
  type SemanticAuthorityBinding,
  type SemanticContextCacheEntry,
  type SemanticSimilarityPort,
} from './semantic-cache.js';

export {
  compressRetrievedContext,
  type RetrievedContextHit,
  type CompressedContext,
} from './context-compression.js';

export {
  planAdvancedRetrieval,
  type RetrievalStrategy,
  type RetrievalStrategyIntent,
} from './retrieval-planner.js';
