import type {
  KnowledgeAuthorityTier,
  KnowledgeContentFormat,
  KnowledgeDataClass,
  KnowledgeLifecycleState,
  KnowledgeRecord,
  KnowledgeSourceType,
  KnowledgeVersionRef,
  RetrievalPermissions,
} from '@qf-jarvis/governed-knowledge';

export const KNOWLEDGE_SOURCE_LAYERS = [
  'BUSINESS_DOCUMENT',
  'POLICY_FAQ',
  'STRUCTURED_DATA',
] as const;
export type KnowledgeSourceLayer = (typeof KNOWLEDGE_SOURCE_LAYERS)[number];

export const MAX_SOURCE_DOCUMENT_CHARS = 2_000_000;
export const MAX_STRUCTURED_FIELDS = 10_000;

export interface StructuredKnowledgeField {
  readonly key: string;
  readonly value: string | number | boolean | null;
}

export type KnowledgeSourcePayload =
  | { readonly kind: 'TEXT'; readonly text: string }
  | { readonly kind: 'STRUCTURED'; readonly fields: readonly StructuredKnowledgeField[] };

export interface KnowledgeSourceDocumentInput {
  readonly knowledgeId: string;
  readonly version: number;
  readonly topic: string;
  readonly sourceLayer: KnowledgeSourceLayer;
  readonly sourceType: KnowledgeSourceType;
  readonly authorityTier: KnowledgeAuthorityTier;
  readonly contentFormat: KnowledgeContentFormat;
  readonly payload: KnowledgeSourcePayload;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly owner: string;
  readonly effectiveFrom: string;
  readonly classification: KnowledgeDataClass;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly permissions: RetrievalPermissions;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly expiresAt?: string;
  readonly supersededBy?: KnowledgeVersionRef;
  readonly subjectRef?: string;
}

export interface KnowledgeGovernanceEnvelope {
  readonly knowledgeId: string;
  readonly version: number;
  readonly topic: string;
  readonly sourceType: KnowledgeSourceType;
  readonly authorityTier: KnowledgeAuthorityTier;
  readonly contentFormat: KnowledgeContentFormat;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly owner: string;
  readonly approvedBy: string | undefined;
  readonly approvedAt: string | undefined;
  readonly effectiveFrom: string;
  readonly expiresAt: string | undefined;
  readonly classification: KnowledgeDataClass;
  readonly lifecycleState: KnowledgeLifecycleState;
  readonly permissions: RetrievalPermissions;
  readonly supersededBy: KnowledgeVersionRef | undefined;
  readonly subjectRef: string | undefined;
}

export interface NormalizedKnowledgeDocument {
  readonly sourceLayer: KnowledgeSourceLayer;
  readonly governance: KnowledgeGovernanceEnvelope;
  readonly content: string;
  readonly contentDigest: string;
}

export interface ChunkingProfile {
  readonly targetChars: number;
  readonly maxChars: number;
  readonly overlapChars: number;
  readonly maxChunksPerDocument: number;
}

export const DEFAULT_CHUNKING_PROFILE: ChunkingProfile = Object.freeze({
  targetChars: 1_200,
  maxChars: 1_800,
  overlapChars: 160,
  maxChunksPerDocument: 4_096,
});

export interface GovernedKnowledgeChunk {
  readonly chunkId: string;
  readonly parentKnowledgeId: string;
  readonly parentVersion: number;
  readonly parentContentDigest: string;
  readonly sourceLayer: KnowledgeSourceLayer;
  readonly chunkIndex: number;
  readonly chunkCount: number;
  readonly headingPath: readonly string[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly record: KnowledgeRecord;
}

export interface EmbeddingReuseGroup {
  readonly chunkDigest: string;
  readonly chunkIds: readonly string[];
  readonly content: string;
}

export interface PreparedKnowledgeBatch {
  readonly documents: readonly NormalizedKnowledgeDocument[];
  readonly chunks: readonly GovernedKnowledgeChunk[];
  readonly embeddingReuseGroups: readonly EmbeddingReuseGroup[];
  readonly duplicateSourceVersions: number;
}
