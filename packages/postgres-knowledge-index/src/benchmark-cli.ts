import { performance } from 'node:perf_hooks';

import { Pool } from 'pg';

import type { KnowledgeSourceDocumentInput } from '@qf-jarvis/knowledge-ingestion';
import {
  createHybridKnowledgeRetriever,
  createHybridKnowledgeSearchRequest,
} from '@qf-jarvis/knowledge-index';
import { createDeterministicTestEmbeddingPort } from '@qf-jarvis/knowledge-index/testing';

import {
  applyKnowledgeIndexMigration,
  buildStreamingKnowledgeRelease,
  createPostgresHybridCandidateStore,
  createPostgresKnowledgeIndexWriter,
} from './index.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
let benchmarkStep = 'bootstrap';

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('knowledge-benchmark-config-invalid');
  }
  return value;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

function source(index: number): KnowledgeSourceDocumentInput {
  const token = String(index).padStart(8, '0');
  return {
    knowledgeId: 'benchmark.installation.' + token,
    version: 1,
    topic: 'installation',
    sourceLayer: 'BUSINESS_DOCUMENT',
    sourceType: 'PROCESS_GUIDE',
    authorityTier: 'APPROVED_INTERNAL_DOCUMENT',
    contentFormat: 'PLAIN_TEXT',
    payload: {
      kind: 'TEXT',
      text:
        'QuickFurno installation benchmark marker ' +
        token +
        '. This synthetic governed document exists only to measure hybrid retrieval capacity.',
    },
    sourceRef: 'benchmark://installation/' + token,
    sourceRevision: 'benchmark-v1',
    owner: 'quickfurno',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    classification: 'HOSTED_ALLOWED',
    lifecycleState: 'ACTIVE',
    permissions: {
      tenantScope: 'GLOBAL',
      allowedAgentScopes: ['CLIENT', 'VENDOR', 'PROSPECT'],
      allowedPurposes: ['CLIENT_RESPONSE', 'VENDOR_RESPONSE', 'PROSPECT_RESPONSE'],
    },
    approvedBy: 'benchmark.owner',
    approvedAt: '2026-01-01T00:00:00.000Z',
  };
}

function* sources(count: number): Generator<KnowledgeSourceDocumentInput> {
  for (let index = 0; index < count; index += 1) yield source(index);
}

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0)
    throw new Error('DATABASE_URL-required');
  const url = new URL(databaseUrl);
  if (!LOOPBACK.has(url.hostname.toLowerCase()))
    throw new Error('knowledge-benchmark-loopback-only');

  const documents = boundedInt('QFJ_KNOWLEDGE_BENCHMARK_DOCUMENTS', 10_000, 100, 1_000_000);
  const queries = boundedInt('QFJ_KNOWLEDGE_BENCHMARK_QUERIES', 200, 10, 10_000);
  const revision = 'benchmark.' + String(documents);
  const embedding = createDeterministicTestEmbeddingPort('LOCAL');
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  // Idle socket failures are not benchmark output. Active operations still reject and fail the run;
  // this only prevents pg from turning an idle-client error event into an unhandled process crash.
  pool.on('error', () => undefined);

  try {
    benchmarkStep = 'database-connect';
    await pool.query('SELECT 1');
    benchmarkStep = 'vector-extension';
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    benchmarkStep = 'benchmark-roles';
    await pool.query(
      'DO $$ BEGIN ' +
        "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qf_jarvis_runtime') THEN CREATE ROLE qf_jarvis_runtime LOGIN; END IF; " +
        "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qf_jarvis_knowledge_ingestor') THEN CREATE ROLE qf_jarvis_knowledge_ingestor LOGIN; END IF; " +
        'END $$;',
    );
    benchmarkStep = 'schema-reset';
    await pool.query('DROP SCHEMA IF EXISTS qf_jarvis_knowledge CASCADE');
    benchmarkStep = 'knowledge-migration';
    await applyKnowledgeIndexMigration(pool);

    const writer = createPostgresKnowledgeIndexWriter(pool);
    benchmarkStep = 'knowledge-ingestion';
    const ingestStarted = performance.now();
    const published = await buildStreamingKnowledgeRelease({
      revision,
      sources: sources(documents),
      embedding,
      writer,
      maxDocumentsPerStage: 64,
      maxSourceCharsPerStage: 4_000_000,
      activateAfterSeal: true,
    });
    const ingestMs = performance.now() - ingestStarted;

    benchmarkStep = 'retrieval';
    const store = createPostgresHybridCandidateStore(pool, revision);
    const retriever = createHybridKnowledgeRetriever({ embedding, store });
    const latencies: number[] = [];
    let found = 0;

    for (let query = 0; query < queries; query += 1) {
      const index = Math.floor((query * documents) / queries);
      const token = String(index).padStart(8, '0');
      const started = performance.now();
      const result = await retriever.retrieve(
        createHybridKnowledgeSearchRequest({
          requestId: 'benchmark.query.' + String(query),
          tenantId: 'quickfurno',
          agentScope: 'CLIENT',
          purpose: 'CLIENT_RESPONSE',
          dataClass: 'HOSTED_ALLOWED',
          asOf: '2026-09-23T00:00:00.000Z',
          queryText: 'installation benchmark marker ' + token,
          topicFilters: ['installation'],
          candidatePool: 64,
          maxResults: 8,
          maxContentChars: 16_000,
        }),
      );
      latencies.push(performance.now() - started);
      if (
        result.ok &&
        result.hits.some((hit) => hit.parentKnowledgeId === 'benchmark.installation.' + token)
      ) {
        found += 1;
      }
    }

    latencies.sort((a, b) => a - b);
    const size = await pool.query<{ bytes: string }>(
      "SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='qf_jarvis_knowledge'",
    );
    process.stdout.write(
      JSON.stringify({
        protocol: 'qfj.knowledge-capacity-benchmark.v1',
        documents,
        chunks: published.chunksStaged,
        queries,
        recallAt8: found / queries,
        ingestMs: Math.round(ingestMs),
        ingestDocumentsPerSecond: Number((documents / (ingestMs / 1000)).toFixed(2)),
        latencyMs: {
          p50: Number(percentile(latencies, 0.5).toFixed(2)),
          p95: Number(percentile(latencies, 0.95).toFixed(2)),
          p99: Number(percentile(latencies, 0.99).toFixed(2)),
        },
        indexBytes: Number(size.rows[0]?.bytes ?? '0'),
        embeddingModelRef: embedding.modelRef,
      }) + '\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write('knowledge-index-benchmark-failed\n');
  if (process.env['QFJ_KNOWLEDGE_BENCHMARK_DEBUG'] === '1') {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { readonly code?: unknown }).code)
        : error instanceof Error
          ? error.name
          : 'unknown';
    process.stderr.write(`benchmark-error-class=${code} step=${benchmarkStep}\n`);
  }
  process.exitCode = 1;
});
