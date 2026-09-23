import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { createKnowledgeRecord } from '@qf-jarvis/governed-knowledge';
import type {
  KnowledgeAgentScope,
  KnowledgeAuthorityTier,
  KnowledgeContentFormat,
  KnowledgeDataClass,
  KnowledgeLifecycleState,
  KnowledgePurpose,
  KnowledgeSourceType,
} from '@qf-jarvis/governed-knowledge';
import type { GovernedKnowledgeChunk, KnowledgeSourceLayer } from '@qf-jarvis/knowledge-ingestion';
import type {
  HybridCandidateSearchResult,
  HybridCandidateStore,
  HybridKnowledgeSearchRequest,
  RankedChunkCandidate,
} from '@qf-jarvis/knowledge-index';
import { KNOWLEDGE_EMBEDDING_DIMENSION_V1 } from '@qf-jarvis/knowledge-index';

import { PostgresKnowledgeIndexError } from './errors.js';

interface CandidateRow {
  chunk_id: string;
  knowledge_id: string;
  version: number;
  chunk_index: number;
  heading_path: string[];
  source_start: number;
  source_end: number;
  content: string;
  content_digest: string;
  topic: string;
  source_layer: KnowledgeSourceLayer;
  source_type: KnowledgeSourceType;
  authority_tier: KnowledgeAuthorityTier;
  content_format: KnowledgeContentFormat;
  parent_content_digest: string;
  source_ref: string;
  source_revision: string;
  owner_ref: string;
  approved_by: string | null;
  approved_at: Date | null;
  effective_from: Date;
  expires_at: Date | null;
  classification: KnowledgeDataClass;
  lifecycle_state: KnowledgeLifecycleState;
  tenant_scope: string;
  allowed_agent_scopes: KnowledgeAgentScope[];
  allowed_purposes: KnowledgePurpose[];
  subject_ref: string | null;
  chunk_count: number;
  score: number;
}

const REVISION = /^[A-Za-z0-9._:-]{1,128}$/u;

const SELECT_COLUMNS = [
  'c.chunk_id',
  'c.knowledge_id',
  'c.version',
  'c.chunk_index',
  'c.heading_path',
  'c.source_start',
  'c.source_end',
  'c.content',
  'c.content_digest',
  'd.topic',
  'd.source_layer',
  'd.source_type',
  'd.authority_tier',
  'd.content_format',
  'd.content_digest AS parent_content_digest',
  'd.source_ref',
  'd.source_revision',
  'd.owner_ref',
  'd.approved_by',
  'd.approved_at',
  'd.effective_from',
  'd.expires_at',
  'd.classification',
  'd.lifecycle_state',
  'd.tenant_scope',
  'd.allowed_agent_scopes',
  'd.allowed_purposes',
  'd.subject_ref',
  'd.chunk_count',
].join(',');

const BASE_FROM = [
  ' FROM qf_jarvis_knowledge.release_document rd',
  ' JOIN qf_jarvis_knowledge.document_version d',
  '   ON d.knowledge_id=rd.knowledge_id AND d.version=rd.version',
  ' JOIN qf_jarvis_knowledge.chunk c',
  '   ON c.knowledge_id=d.knowledge_id AND c.version=d.version',
].join(' ');

function filters(offset: number): string {
  const p = (n: number): string => '$' + String(offset + n);
  return [
    "d.lifecycle_state='ACTIVE'",
    'd.superseded_by_knowledge_id IS NULL',
    'd.subject_ref IS NULL',
    'd.effective_from <= ' + p(1) + '::timestamptz',
    '(d.expires_at IS NULL OR d.expires_at > ' + p(1) + '::timestamptz)',
    "(d.tenant_scope='GLOBAL' OR d.tenant_scope=" + p(2) + ')',
    p(3) + ' = ANY(d.allowed_agent_scopes)',
    p(4) + ' = ANY(d.allowed_purposes)',
    'd.classification = ANY(' + p(5) + '::text[])',
    '(cardinality(' + p(6) + '::text[]) = 0 OR d.topic = ANY(' + p(6) + '::text[]))',
    'rd.revision=' + p(7),
  ].join(' AND ');
}

function allowedClasses(dataClass: KnowledgeDataClass): readonly KnowledgeDataClass[] {
  if (dataClass === 'HOSTED_ALLOWED') return ['HOSTED_ALLOWED'];
  if (dataClass === 'LOCAL_ONLY') return ['HOSTED_ALLOWED', 'LOCAL_ONLY'];
  return [];
}

function iso(value: Date | null): string | undefined {
  return value === null ? undefined : value.toISOString();
}

function rowToChunk(row: CandidateRow): GovernedKnowledgeChunk {
  try {
    const actualDigest = createHash('sha256').update(row.content, 'utf8').digest('hex');
    if (actualDigest !== row.content_digest) {
      throw new PostgresKnowledgeIndexError('database-row-invalid');
    }
    const record = createKnowledgeRecord({
      knowledgeId: row.chunk_id,
      version: 1,
      topic: row.topic,
      sourceType: row.source_type,
      authorityTier: row.authority_tier,
      contentFormat: row.content_format,
      content: row.content,
      contentDigest: row.content_digest,
      sourceRef: row.source_ref,
      sourceRevision: row.source_revision,
      owner: row.owner_ref,
      effectiveFrom: row.effective_from.toISOString(),
      classification: row.classification,
      lifecycleState: row.lifecycle_state,
      permissions: {
        tenantScope: row.tenant_scope,
        allowedAgentScopes: row.allowed_agent_scopes,
        allowedPurposes: row.allowed_purposes,
      },
      ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }),
      ...(row.approved_at === null ? {} : { approvedAt: row.approved_at.toISOString() }),
      ...(row.expires_at === null ? {} : { expiresAt: iso(row.expires_at) }),
    });
    return Object.freeze({
      chunkId: row.chunk_id,
      parentKnowledgeId: row.knowledge_id,
      parentVersion: row.version,
      parentContentDigest: row.parent_content_digest,
      sourceLayer: row.source_layer,
      chunkIndex: row.chunk_index,
      chunkCount: row.chunk_count,
      headingPath: Object.freeze([...row.heading_path]),
      sourceStart: row.source_start,
      sourceEnd: row.source_end,
      record,
    });
  } catch {
    throw new PostgresKnowledgeIndexError('database-row-invalid');
  }
}

function ranked(rows: readonly CandidateRow[]): readonly RankedChunkCandidate[] {
  return Object.freeze(
    rows.map((row, index) =>
      Object.freeze({
        chunk: rowToChunk(row),
        rank: index + 1,
        score: row.score,
      }),
    ),
  );
}

function vectorLiteral(vector: readonly number[]): string {
  if (
    vector.length !== KNOWLEDGE_EMBEDDING_DIMENSION_V1 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new PostgresKnowledgeIndexError('invalid-embedding');
  }
  return '[' + vector.map((value) => String(value)).join(',') + ']';
}

function commonParameters(
  request: HybridKnowledgeSearchRequest,
  revision: string,
): readonly unknown[] {
  return [
    request.asOf,
    request.tenantId,
    request.agentScope,
    request.purpose,
    [...allowedClasses(request.dataClass)],
    [...request.topicFilters],
    revision,
  ];
}

export async function assertPostgresKnowledgeReleaseReady(
  pool: Pool,
  revision: string,
  embeddingModelRef: string,
): Promise<void> {
  if (!REVISION.test(revision) || revision === '*' || revision.toLocaleLowerCase() === 'latest') {
    throw new PostgresKnowledgeIndexError('knowledge-revision-mismatch');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assertRevisionAndModel(client, revision, embeddingModelRef);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the bounded original error.
    }
    if (error instanceof PostgresKnowledgeIndexError) throw error;
    throw new PostgresKnowledgeIndexError('candidate-store-failed');
  } finally {
    client.release();
  }
}

async function assertRevisionAndModel(
  client: PoolClient,
  revision: string,
  embeddingModelRef: string,
): Promise<void> {
  const active = await client.query<{
    active_revision: string;
    release_state: 'STAGING' | 'SEALED';
    release_model: string;
    index_model: string;
    embedding_dimension: number;
  }>(
    [
      'SELECT ar.revision AS active_revision,r.release_state,r.embedding_model_ref AS release_model,',
      '       m.embedding_model_ref AS index_model,m.embedding_dimension',
      'FROM qf_jarvis_knowledge.active_release ar',
      'JOIN qf_jarvis_knowledge.knowledge_release r ON r.revision=ar.revision',
      'CROSS JOIN qf_jarvis_knowledge.index_metadata m',
      'WHERE ar.singleton=true AND m.singleton=true',
    ].join(' '),
  );
  const row = active.rows[0];
  if (row === undefined || active.rows.length !== 1) {
    throw new PostgresKnowledgeIndexError('knowledge-revision-mismatch');
  }
  if (row.active_revision !== revision || row.release_state !== 'SEALED') {
    throw new PostgresKnowledgeIndexError('knowledge-revision-mismatch');
  }
  if (
    row.release_model !== embeddingModelRef ||
    row.index_model !== embeddingModelRef ||
    row.embedding_dimension !== KNOWLEDGE_EMBEDDING_DIMENSION_V1
  ) {
    throw new PostgresKnowledgeIndexError('embedding-model-mismatch');
  }
}

async function lexicalSearch(
  client: PoolClient,
  request: HybridKnowledgeSearchRequest,
  revision: string,
): Promise<readonly RankedChunkCandidate[]> {
  const sql =
    "WITH q AS (SELECT websearch_to_tsquery('simple',$1) AS query) SELECT " +
    SELECT_COLUMNS +
    ', ts_rank_cd(c.search_tsv,q.query,32)::float8 AS score' +
    BASE_FROM +
    ' CROSS JOIN q WHERE ' +
    filters(1) +
    " AND q.query <> ''::tsquery AND c.search_tsv @@ q.query" +
    ' ORDER BY score DESC, c.chunk_id ASC LIMIT $9';
  const result = await client.query<CandidateRow>(sql, [
    request.queryText,
    ...commonParameters(request, revision),
    request.candidatePool,
  ]);
  return ranked(result.rows);
}

async function vectorSearch(
  client: PoolClient,
  request: HybridKnowledgeSearchRequest,
  revision: string,
  embedding: readonly number[],
  embeddingModelRef: string,
): Promise<readonly RankedChunkCandidate[]> {
  const vector = vectorLiteral(embedding);
  const sql =
    'SELECT ' +
    SELECT_COLUMNS +
    ', (1 - (c.embedding <=> $1::vector))::float8 AS score' +
    BASE_FROM +
    ' WHERE ' +
    filters(1) +
    ' AND c.embedding_model_ref=$9' +
    ' ORDER BY c.embedding <=> $1::vector ASC, c.chunk_id ASC LIMIT $10';
  const result = await client.query<CandidateRow>(sql, [
    vector,
    ...commonParameters(request, revision),
    embeddingModelRef,
    request.candidatePool,
  ]);
  return ranked(result.rows);
}

export function createPostgresHybridCandidateStore(
  pool: Pool,
  knowledgeRevision: string,
): HybridCandidateStore {
  if (
    !REVISION.test(knowledgeRevision) ||
    knowledgeRevision === '*' ||
    knowledgeRevision.toLocaleLowerCase() === 'latest'
  ) {
    throw new PostgresKnowledgeIndexError('knowledge-revision-mismatch');
  }

  return Object.freeze({
    knowledgeRevision,
    async search(
      request: HybridKnowledgeSearchRequest,
      embedding: readonly number[],
      embeddingModelRef: string,
    ): Promise<HybridCandidateSearchResult> {
      if (request.dataClass === 'HUMAN_ONLY') {
        return Object.freeze({ lexical: Object.freeze([]), vector: Object.freeze([]) });
      }

      const client = await pool.connect();
      try {
        // One snapshot is load-bearing: lexical and vector search must rank the same immutable corpus,
        // even while an operator atomically switches the active release for future queries.
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await assertRevisionAndModel(client, knowledgeRevision, embeddingModelRef);

        // pgvector 0.8+ iterative scans keep filtered HNSW useful when governance metadata removes many
        // neighbours. ef_search is bounded from the caller's already-bounded candidate pool.
        const efSearch = Math.max(100, Math.min(1_000, request.candidatePool * 8));
        await client.query("SET LOCAL hnsw.iterative_scan = 'strict_order'");
        await client.query('SELECT set_config($1,$2,true)', ['hnsw.ef_search', String(efSearch)]);

        const lexical = await lexicalSearch(client, request, knowledgeRevision);
        const vector = await vectorSearch(
          client,
          request,
          knowledgeRevision,
          embedding,
          embeddingModelRef,
        );
        await client.query('COMMIT');
        return Object.freeze({ lexical, vector });
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the bounded original error.
        }
        if (error instanceof PostgresKnowledgeIndexError) throw error;
        throw new PostgresKnowledgeIndexError('candidate-store-failed');
      } finally {
        client.release();
      }
    },
  });
}
