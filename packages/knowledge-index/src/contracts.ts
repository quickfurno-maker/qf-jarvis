import type {
  KnowledgeAgentScope,
  KnowledgeCitation,
  KnowledgeDataClass,
  KnowledgePrivacyGate,
  KnowledgePurpose,
} from '@qf-jarvis/governed-knowledge';
import type {
  GovernedKnowledgeChunk,
  PreparedKnowledgeBatch,
} from '@qf-jarvis/knowledge-ingestion';

export const KNOWLEDGE_EMBEDDING_DIMENSION_V1 = 1536;
export const MAX_HYBRID_QUERY_CHARS = 4096;
export const MAX_HYBRID_TOPIC_FILTERS = 32;
export const MAX_HYBRID_CANDIDATES = 256;
export const MAX_HYBRID_RESULTS = 16;

export type EmbeddingExecutionClass = 'HOSTED' | 'LOCAL';

export interface HybridKnowledgeSearchRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly agentScope: KnowledgeAgentScope;
  readonly purpose: KnowledgePurpose;
  readonly dataClass: KnowledgeDataClass;
  readonly asOf: string;
  readonly queryText: string;
  readonly topicFilters: readonly string[];
  readonly candidatePool: number;
  readonly maxResults: number;
  readonly maxContentChars: number;
}

export interface HybridKnowledgeSearchRequestInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly agentScope: KnowledgeAgentScope;
  readonly purpose: KnowledgePurpose;
  readonly dataClass: KnowledgeDataClass;
  readonly asOf: string;
  readonly queryText: string;
  readonly topicFilters?: readonly string[];
  readonly candidatePool?: number;
  readonly maxResults?: number;
  readonly maxContentChars?: number;
}

export interface KnowledgeEmbeddingPort {
  readonly modelRef: string;
  readonly dimension: number;
  readonly executionClass: EmbeddingExecutionClass;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

/** Content-addressed reuse only. A cache never decides whether content may be embedded. */
export interface KnowledgeEmbeddingCachePort {
  read(
    modelRef: string,
    contentDigests: readonly string[],
  ): Promise<ReadonlyMap<string, readonly number[]>>;
}

export interface EmbeddedKnowledgeChunk {
  readonly chunk: GovernedKnowledgeChunk;
  readonly embedding: readonly number[];
  readonly embeddingModelRef: string;
}

export interface EmbeddedKnowledgeBatch {
  readonly source: PreparedKnowledgeBatch;
  readonly chunks: readonly EmbeddedKnowledgeChunk[];
  readonly uniqueEmbeddingsComputed: number;
}

export interface RankedChunkCandidate {
  readonly chunk: GovernedKnowledgeChunk;
  readonly rank: number;
  readonly score: number;
}

export interface HybridCandidateSearchResult {
  readonly lexical: readonly RankedChunkCandidate[];
  readonly vector: readonly RankedChunkCandidate[];
}

/**
 * One revision-bound candidate store. Lexical and vector candidates MUST come from one consistent
 * snapshot of the same immutable knowledge release.
 */
export interface HybridCandidateStore {
  readonly knowledgeRevision: string;
  search(
    request: HybridKnowledgeSearchRequest,
    embedding: readonly number[],
    embeddingModelRef: string,
  ): Promise<HybridCandidateSearchResult>;
}

export interface FusedKnowledgeCandidate {
  readonly chunk: GovernedKnowledgeChunk;
  readonly lexicalRank: number | undefined;
  readonly vectorRank: number | undefined;
  readonly lexicalScore: number | undefined;
  readonly vectorScore: number | undefined;
  readonly fusedScore: number;
  readonly rerankScore: number;
}

export interface KnowledgeRerankerPort {
  /** Where candidate content is processed. LOCAL_ONLY content may never reach HOSTED reranking. */
  readonly executionClass: EmbeddingExecutionClass;
  rerank(
    queryText: string,
    candidates: readonly FusedKnowledgeCandidate[],
  ): Promise<readonly FusedKnowledgeCandidate[]>;
}

export interface HybridKnowledgeHit {
  readonly chunkId: string;
  readonly parentKnowledgeId: string;
  readonly parentVersion: number;
  readonly topic: string;
  readonly content: string;
  readonly contentFormat: 'PLAIN_TEXT' | 'MARKDOWN';
  readonly headingPath: readonly string[];
  readonly citation: KnowledgeCitation;
  readonly fusedScore: number;
  readonly rerankScore: number;
}

export const HYBRID_RETRIEVAL_REASONS = [
  'hybrid-served',
  'hybrid-invalid-request',
  'hybrid-query-embedding-denied',
  'hybrid-embedding-failed',
  'hybrid-candidate-store-failed',
  'hybrid-reranker-failed',
  'hybrid-reranker-data-class-denied',
  'hybrid-no-candidates',
  'hybrid-governance-refused',
  'hybrid-content-limit',
  'hybrid-invariant',
] as const;
export type HybridRetrievalReason = (typeof HYBRID_RETRIEVAL_REASONS)[number];

export type HybridKnowledgeRetrievalResult =
  | {
      readonly ok: true;
      readonly reason: 'hybrid-served';
      readonly hits: readonly HybridKnowledgeHit[];
    }
  | {
      readonly ok: false;
      readonly reason: Exclude<HybridRetrievalReason, 'hybrid-served'>;
    };

export interface HybridRetrievalEvent {
  readonly type: 'hybrid-knowledge-retrieval';
  readonly requestId: string;
  readonly reason: HybridRetrievalReason;
  readonly lexicalCandidates: number;
  readonly vectorCandidates: number;
  readonly fusedCandidates: number;
  readonly governedHits: number;
}

export interface HybridRetrievalObservability {
  onEvent(event: HybridRetrievalEvent): void;
}

export interface HybridKnowledgeRetrieverOptions {
  readonly embedding: KnowledgeEmbeddingPort;
  readonly store: HybridCandidateStore;
  readonly reranker?: KnowledgeRerankerPort;
  readonly privacyGate?: KnowledgePrivacyGate;
  readonly observability?: HybridRetrievalObservability;
}
