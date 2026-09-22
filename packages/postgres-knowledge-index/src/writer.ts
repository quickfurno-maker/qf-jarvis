import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import type { EmbeddedKnowledgeBatch, EmbeddedKnowledgeChunk } from '@qf-jarvis/knowledge-index';
import { KNOWLEDGE_EMBEDDING_DIMENSION_V1 } from '@qf-jarvis/knowledge-index';
import type {
  KnowledgeGovernanceEnvelope,
  NormalizedKnowledgeDocument,
} from '@qf-jarvis/knowledge-ingestion';

import { PostgresKnowledgeIndexError } from './errors.js';

const INSERT_BATCH = 128;
const VERIFY_BATCH = 2_000;
const RELEASE_REF_BATCH = 2_000;
const REVISION = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface KnowledgeDocumentRef {
  readonly knowledgeId: string;
  readonly version: number;
}

export interface KnowledgeIndexStageResult {
  readonly documentsStaged: number;
  readonly chunksStaged: number;
}

export interface KnowledgeIndexPublishResult extends KnowledgeIndexStageResult {
  readonly revision: string;
  readonly documentsPublished: number;
}

export interface KnowledgeReleaseSealResult {
  readonly revision: string;
  readonly documentCount: number;
}

export interface PostgresKnowledgeIndexWriter {
  stage(batch: EmbeddedKnowledgeBatch): Promise<KnowledgeIndexStageResult>;
  beginRelease(revision: string, embeddingModelRef: string): Promise<void>;
  addReleaseDocuments(revision: string, refs: readonly KnowledgeDocumentRef[]): Promise<void>;
  sealRelease(revision: string): Promise<KnowledgeReleaseSealResult>;
  activateRelease(revision: string): Promise<void>;
  stageAndPublish(
    revision: string,
    batch: EmbeddedKnowledgeBatch,
  ): Promise<KnowledgeIndexPublishResult>;
}

function validateRevision(revision: string): void {
  if (!REVISION.test(revision) || revision === '*' || revision.toLocaleLowerCase() === 'latest') {
    throw new PostgresKnowledgeIndexError('release-conflict');
  }
}

function parentKey(knowledgeId: string, version: number): string {
  return knowledgeId + '@' + String(version);
}

function governanceDigest(g: KnowledgeGovernanceEnvelope): string {
  const canonical = JSON.stringify([
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
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
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

async function ensureEmbeddingMetadata(client: PoolClient, modelRef: string): Promise<void> {
  await client.query(
    'INSERT INTO qf_jarvis_knowledge.index_metadata (singleton, embedding_dimension, embedding_model_ref) VALUES (true,$1,$2) ON CONFLICT (singleton) DO NOTHING',
    [KNOWLEDGE_EMBEDDING_DIMENSION_V1, modelRef],
  );
  const row = await client.query<{ embedding_dimension: number; embedding_model_ref: string }>(
    'SELECT embedding_dimension, embedding_model_ref FROM qf_jarvis_knowledge.index_metadata WHERE singleton = true',
  );
  const metadata = row.rows[0];
  if (metadata === undefined || row.rows.length !== 1) {
    throw new PostgresKnowledgeIndexError('embedding-model-mismatch');
  }
  if (
    metadata.embedding_dimension !== KNOWLEDGE_EMBEDDING_DIMENSION_V1 ||
    metadata.embedding_model_ref !== modelRef
  ) {
    throw new PostgresKnowledgeIndexError('embedding-model-mismatch');
  }
}

async function insertDocument(
  client: PoolClient,
  document: NormalizedKnowledgeDocument,
  chunkCount: number,
): Promise<void> {
  const g = document.governance;
  const gDigest = governanceDigest(g);
  await client.query(
    [
      'INSERT INTO qf_jarvis_knowledge.document_version',
      '(knowledge_id,version,topic,source_layer,source_type,authority_tier,content_format,content_digest,governance_digest,',
      'source_ref,source_revision,owner_ref,approved_by,approved_at,effective_from,expires_at,classification,lifecycle_state,',
      'tenant_scope,allowed_agent_scopes,allowed_purposes,superseded_by_knowledge_id,superseded_by_version,subject_ref,chunk_count)',
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)',
      'ON CONFLICT (knowledge_id,version) DO NOTHING',
    ].join(' '),
    [
      g.knowledgeId,
      g.version,
      g.topic,
      document.sourceLayer,
      g.sourceType,
      g.authorityTier,
      g.contentFormat,
      document.contentDigest,
      gDigest,
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
      chunkCount,
    ],
  );

  const existing = await client.query<{
    content_digest: string;
    governance_digest: string;
    chunk_count: number;
  }>(
    'SELECT content_digest, governance_digest, chunk_count FROM qf_jarvis_knowledge.document_version WHERE knowledge_id=$1 AND version=$2',
    [g.knowledgeId, g.version],
  );
  const row = existing.rows[0];
  if (row === undefined || existing.rows.length !== 1) {
    throw new PostgresKnowledgeIndexError('immutable-document-conflict');
  }
  if (
    row.content_digest !== document.contentDigest ||
    row.governance_digest !== gDigest ||
    row.chunk_count !== chunkCount
  ) {
    throw new PostgresKnowledgeIndexError('immutable-document-conflict');
  }
}

async function insertChunkBatch(
  client: PoolClient,
  batch: readonly EmbeddedKnowledgeChunk[],
): Promise<void> {
  if (batch.length === 0) return;
  const params: unknown[] = [];
  const rows: string[] = [];
  let p = 1;
  for (const item of batch) {
    const chunk = item.chunk;
    rows.push(
      '(' +
        [
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
          '$' + String(p++),
        ].join(',') +
        ')',
    );
    params.push(
      chunk.chunkId,
      chunk.parentKnowledgeId,
      chunk.parentVersion,
      chunk.chunkIndex,
      [...chunk.headingPath],
      chunk.sourceStart,
      chunk.sourceEnd,
      chunk.record.content,
      chunk.record.contentDigest,
      vectorLiteral(item.embedding),
      item.embeddingModelRef,
    );
  }
  await client.query(
    [
      'INSERT INTO qf_jarvis_knowledge.chunk',
      '(chunk_id,knowledge_id,version,chunk_index,heading_path,source_start,source_end,content,content_digest,embedding,embedding_model_ref)',
      'VALUES ' + rows.join(','),
      'ON CONFLICT (chunk_id) DO NOTHING',
    ].join(' '),
    params,
  );
}

async function verifyChunks(
  client: PoolClient,
  chunks: readonly EmbeddedKnowledgeChunk[],
): Promise<void> {
  for (let offset = 0; offset < chunks.length; offset += VERIFY_BATCH) {
    const slice = chunks.slice(offset, offset + VERIFY_BATCH);
    const ids = slice.map((item) => item.chunk.chunkId);
    const expected = new Map(slice.map((item) => [item.chunk.chunkId, item]));
    const rows = await client.query<{
      chunk_id: string;
      knowledge_id: string;
      version: number;
      chunk_index: number;
      content_digest: string;
      embedding_model_ref: string;
    }>(
      'SELECT chunk_id,knowledge_id,version,chunk_index,content_digest,embedding_model_ref FROM qf_jarvis_knowledge.chunk WHERE chunk_id = ANY($1::text[])',
      [ids],
    );
    if (rows.rows.length !== ids.length) {
      throw new PostgresKnowledgeIndexError('immutable-chunk-conflict');
    }
    for (const row of rows.rows) {
      const item = expected.get(row.chunk_id);
      if (item === undefined) {
        throw new PostgresKnowledgeIndexError('immutable-chunk-conflict');
      }
      if (
        row.knowledge_id !== item.chunk.parentKnowledgeId ||
        row.version !== item.chunk.parentVersion ||
        row.chunk_index !== item.chunk.chunkIndex ||
        row.content_digest !== item.chunk.record.contentDigest ||
        row.embedding_model_ref !== item.embeddingModelRef
      ) {
        throw new PostgresKnowledgeIndexError('immutable-chunk-conflict');
      }
    }
  }
}

function batchModelRef(batch: EmbeddedKnowledgeBatch): string {
  if (batch.chunks.length === 0) {
    throw new PostgresKnowledgeIndexError('immutable-document-conflict');
  }
  const refs = new Set(batch.chunks.map((item) => item.embeddingModelRef));
  const modelRef = batch.chunks[0]?.embeddingModelRef;
  if (refs.size !== 1 || modelRef === undefined) {
    throw new PostgresKnowledgeIndexError('embedding-model-mismatch');
  }
  return modelRef;
}

function documentRefs(batch: EmbeddedKnowledgeBatch): readonly KnowledgeDocumentRef[] {
  return Object.freeze(
    batch.source.documents.map((document) =>
      Object.freeze({
        knowledgeId: document.governance.knowledgeId,
        version: document.governance.version,
      }),
    ),
  );
}

async function beginReleaseWithClient(
  client: PoolClient,
  revision: string,
  embeddingModelRef: string,
): Promise<void> {
  validateRevision(revision);
  await ensureEmbeddingMetadata(client, embeddingModelRef);
  await client.query(
    [
      'INSERT INTO qf_jarvis_knowledge.knowledge_release',
      '(revision,embedding_model_ref,release_state,document_count)',
      "VALUES ($1,$2,'STAGING',0)",
      'ON CONFLICT (revision) DO NOTHING',
    ].join(' '),
    [revision, embeddingModelRef],
  );
  const existing = await client.query<{
    embedding_model_ref: string;
    release_state: 'STAGING' | 'SEALED';
  }>(
    'SELECT embedding_model_ref,release_state FROM qf_jarvis_knowledge.knowledge_release WHERE revision=$1',
    [revision],
  );
  const row = existing.rows[0];
  if (row === undefined || existing.rows.length !== 1) {
    throw new PostgresKnowledgeIndexError('release-conflict');
  }
  if (row.embedding_model_ref !== embeddingModelRef) {
    throw new PostgresKnowledgeIndexError('release-conflict');
  }
}

async function addReleaseDocumentsWithClient(
  client: PoolClient,
  revision: string,
  refs: readonly KnowledgeDocumentRef[],
): Promise<void> {
  validateRevision(revision);
  const state = await client.query<{ release_state: 'STAGING' | 'SEALED' }>(
    'SELECT release_state FROM qf_jarvis_knowledge.knowledge_release WHERE revision=$1',
    [revision],
  );
  if (state.rows[0]?.release_state !== 'STAGING') {
    throw new PostgresKnowledgeIndexError('release-not-staging');
  }

  const unique = new Map<string, number>();
  for (const ref of refs) {
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(ref.knowledgeId) ||
      !Number.isInteger(ref.version) ||
      ref.version < 1 ||
      ref.version > 1_000_000
    ) {
      throw new PostgresKnowledgeIndexError('release-conflict');
    }
    const prior = unique.get(ref.knowledgeId);
    if (prior !== undefined && prior !== ref.version) {
      throw new PostgresKnowledgeIndexError('release-conflict');
    }
    unique.set(ref.knowledgeId, ref.version);
  }

  const ordered = [...unique.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([knowledgeId, version]) => Object.freeze({ knowledgeId, version }));

  for (let offset = 0; offset < ordered.length; offset += RELEASE_REF_BATCH) {
    const slice = ordered.slice(offset, offset + RELEASE_REF_BATCH);
    if (slice.length === 0) continue;
    const values: string[] = [];
    const params: unknown[] = [revision];
    let parameter = 2;
    for (const ref of slice) {
      values.push('($1,$' + String(parameter++) + ',$' + String(parameter++) + ')');
      params.push(ref.knowledgeId, ref.version);
    }
    await client.query(
      [
        'INSERT INTO qf_jarvis_knowledge.release_document (revision,knowledge_id,version)',
        'VALUES ' + values.join(','),
        'ON CONFLICT (revision,knowledge_id) DO NOTHING',
      ].join(' '),
      params,
    );

    const ids = slice.map((ref) => ref.knowledgeId);
    const persisted = await client.query<{ knowledge_id: string; version: number }>(
      'SELECT knowledge_id,version FROM qf_jarvis_knowledge.release_document WHERE revision=$1 AND knowledge_id=ANY($2::text[])',
      [revision, ids],
    );
    const byId = new Map(persisted.rows.map((row) => [row.knowledge_id, row.version]));
    for (const ref of slice) {
      if (byId.get(ref.knowledgeId) !== ref.version) {
        throw new PostgresKnowledgeIndexError('release-conflict');
      }
    }
  }
}

async function sealReleaseWithClient(
  client: PoolClient,
  revision: string,
): Promise<KnowledgeReleaseSealResult> {
  validateRevision(revision);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [revision]);
  const release = await client.query<{
    release_state: 'STAGING' | 'SEALED';
    document_count: number;
  }>(
    'SELECT release_state,document_count FROM qf_jarvis_knowledge.knowledge_release WHERE revision=$1 FOR UPDATE',
    [revision],
  );
  const row = release.rows[0];
  if (row === undefined || release.rows.length !== 1) {
    throw new PostgresKnowledgeIndexError('release-conflict');
  }
  if (row.release_state === 'SEALED') {
    return Object.freeze({ revision, documentCount: row.document_count });
  }

  const counts = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM qf_jarvis_knowledge.release_document WHERE revision=$1',
    [revision],
  );
  const documentCount = counts.rows[0]?.n ?? 0;
  if (documentCount < 1) {
    throw new PostgresKnowledgeIndexError('release-empty');
  }

  // Every document must have exactly the chunk count declared by its immutable document row, and
  // every chunk must use the release embedding model, before the corpus can be sealed.
  const invalid = await client.query<{ n: number }>(
    [
      'SELECT count(*)::int AS n FROM (',
      ' SELECT rd.knowledge_id,rd.version,d.chunk_count,r.embedding_model_ref,',
      '        count(c.chunk_id)::int AS actual_chunks,',
      '        bool_and(c.embedding_model_ref=r.embedding_model_ref) AS same_model',
      ' FROM qf_jarvis_knowledge.release_document rd',
      ' JOIN qf_jarvis_knowledge.knowledge_release r ON r.revision=rd.revision',
      ' JOIN qf_jarvis_knowledge.document_version d',
      '   ON d.knowledge_id=rd.knowledge_id AND d.version=rd.version',
      ' LEFT JOIN qf_jarvis_knowledge.chunk c',
      '   ON c.knowledge_id=rd.knowledge_id AND c.version=rd.version',
      ' WHERE rd.revision=$1',
      ' GROUP BY rd.knowledge_id,rd.version,d.chunk_count,r.embedding_model_ref',
      ') verified WHERE actual_chunks <> chunk_count OR same_model IS DISTINCT FROM true',
    ].join(' '),
    [revision],
  );
  if ((invalid.rows[0]?.n ?? 1) !== 0) {
    throw new PostgresKnowledgeIndexError('release-conflict');
  }

  await client.query(
    [
      'UPDATE qf_jarvis_knowledge.knowledge_release',
      "SET release_state='SEALED',document_count=$2,sealed_at=clock_timestamp()",
      "WHERE revision=$1 AND release_state='STAGING'",
    ].join(' '),
    [revision, documentCount],
  );
  return Object.freeze({ revision, documentCount });
}

async function activateReleaseWithClient(client: PoolClient, revision: string): Promise<void> {
  validateRevision(revision);
  const release = await client.query<{ release_state: 'STAGING' | 'SEALED' }>(
    'SELECT release_state FROM qf_jarvis_knowledge.knowledge_release WHERE revision=$1',
    [revision],
  );
  if (release.rows[0]?.release_state !== 'SEALED') {
    throw new PostgresKnowledgeIndexError('release-not-sealed');
  }
  await client.query(
    [
      'INSERT INTO qf_jarvis_knowledge.active_release (singleton,revision)',
      'VALUES (true,$1)',
      'ON CONFLICT (singleton) DO UPDATE',
      'SET revision=EXCLUDED.revision,activated_at=clock_timestamp()',
    ].join(' '),
    [revision],
  );
}

export function createPostgresKnowledgeIndexWriter(pool: Pool): PostgresKnowledgeIndexWriter {
  const stage = async (batch: EmbeddedKnowledgeBatch): Promise<KnowledgeIndexStageResult> => {
    if (batch.chunks.length === 0 || batch.source.documents.length === 0) {
      return Object.freeze({ documentsStaged: 0, chunksStaged: 0 });
    }
    const modelRef = batchModelRef(batch);
    const chunksByParent = new Map<string, EmbeddedKnowledgeChunk[]>();
    for (const item of batch.chunks) {
      const key = parentKey(item.chunk.parentKnowledgeId, item.chunk.parentVersion);
      const list = chunksByParent.get(key);
      if (list === undefined) chunksByParent.set(key, [item]);
      else list.push(item);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await ensureEmbeddingMetadata(client, modelRef);
      for (const document of batch.source.documents) {
        const chunks =
          chunksByParent.get(
            parentKey(document.governance.knowledgeId, document.governance.version),
          ) ?? [];
        if (chunks.length === 0) {
          throw new PostgresKnowledgeIndexError('immutable-document-conflict');
        }
        await insertDocument(client, document, chunks.length);
      }
      for (let offset = 0; offset < batch.chunks.length; offset += INSERT_BATCH) {
        await insertChunkBatch(client, batch.chunks.slice(offset, offset + INSERT_BATCH));
      }
      await verifyChunks(client, batch.chunks);
      await client.query('COMMIT');
      return Object.freeze({
        documentsStaged: batch.source.documents.length,
        chunksStaged: batch.chunks.length,
      });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original bounded error.
      }
      if (error instanceof PostgresKnowledgeIndexError) throw error;
      throw new PostgresKnowledgeIndexError('immutable-document-conflict');
    } finally {
      client.release();
    }
  };

  const beginRelease = async (revision: string, embeddingModelRef: string): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await beginReleaseWithClient(client, revision, embeddingModelRef);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original bounded error.
      }
      if (error instanceof PostgresKnowledgeIndexError) throw error;
      throw new PostgresKnowledgeIndexError('release-conflict');
    } finally {
      client.release();
    }
  };

  const addReleaseDocuments = async (
    revision: string,
    refs: readonly KnowledgeDocumentRef[],
  ): Promise<void> => {
    if (refs.length === 0) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [revision]);
      await addReleaseDocumentsWithClient(client, revision, refs);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original bounded error.
      }
      if (error instanceof PostgresKnowledgeIndexError) throw error;
      throw new PostgresKnowledgeIndexError('release-conflict');
    } finally {
      client.release();
    }
  };

  const sealRelease = async (revision: string): Promise<KnowledgeReleaseSealResult> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await sealReleaseWithClient(client, revision);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original bounded error.
      }
      if (error instanceof PostgresKnowledgeIndexError) throw error;
      throw new PostgresKnowledgeIndexError('release-conflict');
    } finally {
      client.release();
    }
  };

  const activateRelease = async (revision: string): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [8_174_221_516]);
      await activateReleaseWithClient(client, revision);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original bounded error.
      }
      if (error instanceof PostgresKnowledgeIndexError) throw error;
      throw new PostgresKnowledgeIndexError('release-conflict');
    } finally {
      client.release();
    }
  };

  return Object.freeze({
    stage,
    beginRelease,
    addReleaseDocuments,
    sealRelease,
    activateRelease,
    async stageAndPublish(
      revision: string,
      batch: EmbeddedKnowledgeBatch,
    ): Promise<KnowledgeIndexPublishResult> {
      const modelRef = batchModelRef(batch);
      const staged = await stage(batch);

      // Small-release convenience. Large corpora use stage/add in bounded batches, then seal+activate.
      // Visibility is still one active-release pointer switch; no query can see a half-published corpus.
      await beginRelease(revision, modelRef);
      await addReleaseDocuments(revision, documentRefs(batch));
      const sealed = await sealRelease(revision);
      await activateRelease(revision);
      return Object.freeze({
        ...staged,
        revision,
        documentsPublished: sealed.documentCount,
      });
    },
  });
}
