import type {
  ChunkingProfile,
  EmbeddingReuseGroup,
  GovernedKnowledgeChunk,
  KnowledgeSourceDocumentInput,
  NormalizedKnowledgeDocument,
  PreparedKnowledgeBatch,
} from './contracts.js';
import { DEFAULT_CHUNKING_PROFILE } from './contracts.js';
import { chunkKnowledgeDocument } from './chunk.js';
import { KnowledgeIngestionError } from './errors.js';
import { normalizeSourceDocument } from './normalize.js';

function sourceVersionKey(document: NormalizedKnowledgeDocument): string {
  return document.governance.knowledgeId + '@' + String(document.governance.version);
}

function governanceFingerprint(document: NormalizedKnowledgeDocument): string {
  const g = document.governance;
  return JSON.stringify([
    document.sourceLayer,
    g.knowledgeId,
    g.version,
    g.topic,
    g.sourceType,
    g.authorityTier,
    g.contentFormat,
    g.sourceRef,
    g.sourceRevision,
    g.owner,
    g.approvedBy ?? null,
    g.approvedAt ?? null,
    g.effectiveFrom,
    g.expiresAt ?? null,
    g.classification,
    g.lifecycleState,
    g.permissions.tenantScope,
    [...g.permissions.allowedAgentScopes],
    [...g.permissions.allowedPurposes],
    g.supersededBy?.knowledgeId ?? null,
    g.supersededBy?.version ?? null,
    g.subjectRef ?? null,
  ]);
}

export function prepareKnowledgeBatch(
  inputs: readonly KnowledgeSourceDocumentInput[],
  profile: ChunkingProfile = DEFAULT_CHUNKING_PROFILE,
): PreparedKnowledgeBatch {
  const byVersion = new Map<string, NormalizedKnowledgeDocument>();
  let duplicateSourceVersions = 0;

  for (const input of inputs) {
    const document = normalizeSourceDocument(input);
    const key = sourceVersionKey(document);
    const existing = byVersion.get(key);
    if (existing !== undefined) {
      if (
        existing.contentDigest !== document.contentDigest ||
        governanceFingerprint(existing) !== governanceFingerprint(document)
      ) {
        throw new KnowledgeIngestionError('conflicting-source-version');
      }
      duplicateSourceVersions += 1;
      continue;
    }
    byVersion.set(key, document);
  }

  const documents = [...byVersion.values()].sort((a, b) => {
    const ak = sourceVersionKey(a);
    const bk = sourceVersionKey(b);
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });

  const chunks: GovernedKnowledgeChunk[] = [];
  for (const document of documents) {
    chunks.push(...chunkKnowledgeDocument(document, profile));
  }

  const reuse = new Map<string, { content: string; ids: string[] }>();
  for (const chunk of chunks) {
    const digest = chunk.record.contentDigest;
    const existing = reuse.get(digest);
    if (existing === undefined) {
      reuse.set(digest, { content: chunk.record.content, ids: [chunk.chunkId] });
    } else {
      existing.ids.push(chunk.chunkId);
    }
  }
  const embeddingReuseGroups: EmbeddingReuseGroup[] = [...reuse.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chunkDigest, value]) =>
      Object.freeze({
        chunkDigest,
        chunkIds: Object.freeze([...value.ids].sort()),
        content: value.content,
      }),
    );

  return Object.freeze({
    documents: Object.freeze(documents),
    chunks: Object.freeze(chunks),
    embeddingReuseGroups: Object.freeze(embeddingReuseGroups),
    duplicateSourceVersions,
  });
}
