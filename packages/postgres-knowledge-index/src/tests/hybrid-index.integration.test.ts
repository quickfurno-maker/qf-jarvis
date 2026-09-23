import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import type { KnowledgeSourceDocumentInput } from '@qf-jarvis/knowledge-ingestion';
import { prepareKnowledgeBatch } from '@qf-jarvis/knowledge-ingestion';
import {
  createHybridKnowledgeRetriever,
  createHybridKnowledgeSearchRequest,
  embedPreparedKnowledgeBatch,
} from '@qf-jarvis/knowledge-index';
import { createDeterministicTestEmbeddingPort } from '@qf-jarvis/knowledge-index/testing';

import {
  applyKnowledgeIndexMigration,
  assertPostgresKnowledgeReleaseReady,
  buildStreamingKnowledgeRelease,
  createPostgresHybridCandidateStore,
  createPostgresKnowledgeIndexWriter,
  pruneInactiveKnowledgeReleases,
} from '../index.js';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.length === 0) {
  throw new Error('DATABASE_URL is required for postgres knowledge-index integration tests');
}

let pool: Pool;
const embedding = createDeterministicTestEmbeddingPort('LOCAL');

function source(
  knowledgeId: string,
  version: number,
  text: string,
  topic = 'installation',
): KnowledgeSourceDocumentInput {
  return {
    knowledgeId,
    version,
    topic,
    sourceLayer: 'BUSINESS_DOCUMENT',
    sourceType: 'PROCESS_GUIDE',
    authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
    contentFormat: 'PLAIN_TEXT',
    payload: { kind: 'TEXT', text },
    sourceRef: 'test://knowledge/' + knowledgeId,
    sourceRevision: 'rev-' + String(version),
    owner: 'quickfurno',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
    approvedBy: 'owner.quickfurno',
    approvedAt: '2025-12-31T00:00:00.000Z',
  };
}

async function publish(
  revision: string,
  docs: readonly KnowledgeSourceDocumentInput[],
): Promise<void> {
  const batch = prepareKnowledgeBatch(docs, {
    targetChars: 512,
    maxChars: 900,
    overlapChars: 64,
    maxChunksPerDocument: 512,
  });
  const embedded = await embedPreparedKnowledgeBatch(batch, embedding);
  const writer = createPostgresKnowledgeIndexWriter(pool);
  await writer.stageAndPublish(revision, embedded);
}

async function retrieval(revision: string, queryText: string) {
  const store = createPostgresHybridCandidateStore(pool, revision);
  const retriever = createHybridKnowledgeRetriever({ embedding, store });
  return retriever.retrieve(
    createHybridKnowledgeSearchRequest({
      requestId: 'req.' + revision,
      tenantId: 'quickfurno',
      agentScope: 'CLIENT',
      purpose: 'CLIENT_RESPONSE',
      dataClass: 'HOSTED_ALLOWED',
      asOf: '2026-09-22T00:00:00.000Z',
      queryText,
      topicFilters: ['installation'],
      candidatePool: 32,
      maxResults: 4,
      maxContentChars: 8000,
    }),
  );
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
  await pool.query('SELECT 1');
}, 60_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DROP SCHEMA IF EXISTS qf_jarvis_knowledge CASCADE');
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(
    'DO $$ BEGIN ' +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qf_jarvis_runtime') THEN " +
      'CREATE ROLE qf_jarvis_runtime LOGIN; END IF; ' +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qf_jarvis_knowledge_ingestor') THEN " +
      'CREATE ROLE qf_jarvis_knowledge_ingestor LOGIN; END IF; ' +
      "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qf_jarvis_knowledge_maintainer') THEN " +
      'CREATE ROLE qf_jarvis_knowledge_maintainer NOLOGIN; END IF; END $$;',
  );
  await pool.query('GRANT qf_jarvis_knowledge_maintainer TO CURRENT_USER');
  const migrated = await applyKnowledgeIndexMigration(pool);
  expect(migrated.version).toBe(1);
}, 60_000);

describe('postgres hybrid knowledge index', () => {
  it('publishes an immutable release and retrieves through lexical + vector candidate search', async () => {
    await publish('knowledge.release.one', [
      source(
        'doc.installation',
        1,
        'Installation scheduling begins after an approved measurement. The team then confirms the next available planning step.',
      ),
    ]);

    const result = await retrieval('knowledge.release.one', 'installation scheduling measurement');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.content).toContain('Installation scheduling');

    const rows = await pool.query<{
      release_state: string;
      revision: string;
      document_count: number;
    }>(
      'SELECT r.release_state,r.revision,r.document_count ' +
        'FROM qf_jarvis_knowledge.knowledge_release r ' +
        'JOIN qf_jarvis_knowledge.active_release a ON a.revision=r.revision ' +
        'WHERE a.singleton=true',
    );
    expect(rows.rows).toEqual([
      { release_state: 'SEALED', revision: 'knowledge.release.one', document_count: 1 },
    ]);
  }, 60_000);

  it('fails closed when a retriever is bound to a release that is not the active release', async () => {
    await publish('knowledge.release.one', [
      source('doc.one', 1, 'Installation scheduling reference one.'),
    ]);
    await publish('knowledge.release.two', [
      source('doc.two', 1, 'Installation scheduling reference two.'),
    ]);

    const stale = await retrieval('knowledge.release.one', 'installation scheduling');
    expect(stale).toEqual({ ok: false, reason: 'hybrid-candidate-store-failed' });

    const current = await retrieval('knowledge.release.two', 'installation scheduling');
    expect(current.ok).toBe(true);
  }, 60_000);

  it('fails closed when PostgreSQL is unavailable during candidate retrieval', async () => {
    const unavailablePool = new Pool({
      connectionString: 'postgresql://qf_jarvis_ci:qf_jarvis_ci_only@127.0.0.1:1/qf_jarvis_test',
      connectionTimeoutMillis: 200,
      max: 1,
    });
    try {
      const store = createPostgresHybridCandidateStore(
        unavailablePool,
        'knowledge.release.unavailable',
      );
      const retriever = createHybridKnowledgeRetriever({ embedding, store });
      const result = await retriever.retrieve(
        createHybridKnowledgeSearchRequest({
          requestId: 'req.database.unavailable',
          tenantId: 'quickfurno',
          agentScope: 'CLIENT',
          purpose: 'CLIENT_RESPONSE',
          dataClass: 'HOSTED_ALLOWED',
          asOf: '2026-09-22T00:00:00.000Z',
          queryText: 'installation scheduling',
          topicFilters: ['installation'],
          candidatePool: 32,
          maxResults: 4,
          maxContentChars: 8000,
        }),
      );
      expect(result).toEqual({ ok: false, reason: 'hybrid-candidate-store-failed' });
    } finally {
      await unavailablePool.end();
    }
  }, 60_000);

  it('fails closed when stored chunk content no longer matches its sealed digest', async () => {
    await publish('knowledge.release.corrupt', [
      source('doc.corrupt', 1, 'Installation scheduling ORIGINAL integrity marker.'),
    ]);

    await pool.query(
      "UPDATE qf_jarvis_knowledge.chunk SET content='Installation scheduling CORRUPTED integrity marker.' " +
        "WHERE knowledge_id='doc.corrupt' AND version=1",
    );

    const result = await retrieval(
      'knowledge.release.corrupt',
      'installation scheduling corrupted',
    );
    expect(result).toEqual({ ok: false, reason: 'hybrid-candidate-store-failed' });
  }, 60_000);

  it('fails closed when active knowledge-index metadata is corrupted away from the sealed embedding model', async () => {
    await publish('knowledge.release.corrupt-model', [
      source('doc.corrupt-model', 1, 'Installation scheduling CORRUPT MODEL guard marker.'),
    ]);

    await pool.query(
      "UPDATE qf_jarvis_knowledge.index_metadata SET embedding_model_ref='tampered.embedding.model' WHERE singleton=true",
    );

    await expect(
      assertPostgresKnowledgeReleaseReady(
        pool,
        'knowledge.release.corrupt-model',
        embedding.modelRef,
      ),
    ).rejects.toMatchObject({ code: 'embedding-model-mismatch' });
  }, 60_000);

  it('supports atomic rollback by switching only the active sealed-release pointer', async () => {
    await publish('knowledge.release.one', [
      source('doc.one', 1, 'Installation scheduling OLD RELEASE marker.'),
    ]);
    await publish('knowledge.release.two', [
      source('doc.two', 1, 'Installation scheduling NEW RELEASE marker.'),
    ]);

    const writer = createPostgresKnowledgeIndexWriter(pool);
    await writer.activateRelease('knowledge.release.one');

    const oldAgain = await retrieval('knowledge.release.one', 'installation scheduling');
    expect(oldAgain.ok).toBe(true);
    if (oldAgain.ok) {
      expect(oldAgain.hits.some((hit) => hit.content.includes('OLD RELEASE marker'))).toBe(true);
      expect(oldAgain.hits.every((hit) => !hit.content.includes('NEW RELEASE marker'))).toBe(true);
    }

    const newNowStale = await retrieval('knowledge.release.two', 'installation scheduling');
    expect(newNowStale).toEqual({ ok: false, reason: 'hybrid-candidate-store-failed' });
  }, 60_000);

  it('refuses subject-linked records before semantic embedding or persistence', () => {
    const subject = source('doc.subject', 1, 'Installation scheduling PRIVATE SUBJECT marker.');
    expect(() => prepareKnowledgeBatch([{ ...subject, subjectRef: 'subject.private.1' }])).toThrow(
      'subject-linked-semantic-indexing-forbidden',
    );
  });
});

it('reuses persisted vectors across release batches and later releases', async () => {
  const writer = createPostgresKnowledgeIndexWriter(pool);
  const base = createDeterministicTestEmbeddingPort('LOCAL');
  let embeddedTexts = 0;
  const counting = Object.freeze({
    ...base,
    async embed(texts: readonly string[]) {
      embeddedTexts += texts.length;
      return base.embed(texts);
    },
  });

  await buildStreamingKnowledgeRelease({
    revision: 'knowledge.release.cache.one',
    sources: [source('doc.cache.one', 1, 'Stable installation cache marker.')],
    embedding: counting,
    writer,
    activateAfterSeal: true,
  });
  expect(embeddedTexts).toBeGreaterThan(0);
  embeddedTexts = 0;

  await buildStreamingKnowledgeRelease({
    revision: 'knowledge.release.cache.two',
    sources: [
      source('doc.cache.two', 1, 'Stable installation cache marker.'),
      source('doc.cache.three', 1, 'New installation cache marker.'),
    ],
    embedding: counting,
    writer,
    activateAfterSeal: false,
  });

  expect(embeddedTexts).toBe(1);
}, 60_000);

it('prunes only old inactive releases through the maintainer-only boundary', async () => {
  await publish('knowledge.release.prune.1', [
    source('doc.prune.1', 1, 'Installation prune marker one.'),
  ]);
  await publish('knowledge.release.prune.2', [
    source('doc.prune.2', 1, 'Installation prune marker two.'),
  ]);
  await publish('knowledge.release.prune.3', [
    source('doc.prune.3', 1, 'Installation prune marker three.'),
  ]);
  await publish('knowledge.release.prune.4', [
    source('doc.prune.4', 1, 'Installation prune marker four.'),
  ]);

  // A different release may be mid-stage while maintenance retires old SEALED releases. Its
  // unreferenced chunks are not garbage: publication intentionally stages before adding release refs.
  const stagingWriter = createPostgresKnowledgeIndexWriter(pool);
  await stagingWriter.beginRelease('knowledge.release.prune.staging', embedding.modelRef);
  await stagingWriter.stage(
    await embedPreparedKnowledgeBatch(
      prepareKnowledgeBatch([
        source('doc.prune.staging', 1, 'Installation staged release must survive maintenance.'),
      ]),
      embedding,
    ),
  );

  const pruned = await pruneInactiveKnowledgeReleases(pool, 1);
  expect(pruned.prunedRevisions).toEqual([
    'knowledge.release.prune.2',
    'knowledge.release.prune.1',
  ]);
  expect(pruned.releaseDocumentsDeleted).toBe(2);
  expect(pruned.chunksDeleted).toBeGreaterThanOrEqual(2);
  expect(pruned.documentsDeleted).toBe(2);

  const remaining = await pool.query<{ revision: string }>(
    'SELECT revision FROM qf_jarvis_knowledge.knowledge_release ORDER BY revision',
  );
  expect(remaining.rows.map((row) => row.revision)).toEqual([
    'knowledge.release.prune.3',
    'knowledge.release.prune.4',
    'knowledge.release.prune.staging',
  ]);
  const stagedSurvived = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM qf_jarvis_knowledge.chunk WHERE knowledge_id='doc.prune.staging'",
  );
  expect(stagedSurvived.rows[0]?.count).toBe('1');

  await expect(
    pool.query(
      "SELECT * FROM qf_jarvis_knowledge.prune_inactive_release('knowledge.release.prune.4')",
    ),
  ).rejects.toThrow();
}, 60_000);

it('streams large releases in bounded stages and does not activate until explicitly requested', async () => {
  await publish('knowledge.release.base', [
    source('doc.base', 1, 'Installation scheduling BASE ACTIVE marker.'),
  ]);

  const writer = createPostgresKnowledgeIndexWriter(pool);
  const sources = Array.from({ length: 5 }, (_, index) =>
    source(
      'doc.stream.' + String(index + 1),
      1,
      'Installation scheduling STREAM ' + String(index + 1) + ' marker.',
    ),
  );
  const built = await buildStreamingKnowledgeRelease({
    revision: 'knowledge.release.stream',
    sources,
    embedding,
    writer,
    maxDocumentsPerStage: 2,
    maxSourceCharsPerStage: 4_000_000,
    embeddingBatch: { maxTextsPerRequest: 2, maxCharsPerRequest: 64_000 },
    activateAfterSeal: false,
  });

  expect(built).toMatchObject({
    revision: 'knowledge.release.stream',
    sourceDocumentsRead: 5,
    stageBatches: 3,
    documentsPublished: 5,
    activated: false,
  });

  const stillBase = await retrieval('knowledge.release.base', 'installation scheduling');
  expect(stillBase.ok).toBe(true);
  const notYetActive = await retrieval('knowledge.release.stream', 'installation scheduling');
  expect(notYetActive).toEqual({ ok: false, reason: 'hybrid-candidate-store-failed' });

  await writer.activateRelease('knowledge.release.stream');
  const nowActive = await retrieval('knowledge.release.stream', 'installation scheduling');
  expect(nowActive.ok).toBe(true);
  if (nowActive.ok) {
    expect(nowActive.hits.some((hit) => hit.content.includes('STREAM'))).toBe(true);
  }
}, 60_000);
