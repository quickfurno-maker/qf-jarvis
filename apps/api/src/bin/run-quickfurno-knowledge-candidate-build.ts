#!/usr/bin/env node
import { isAbsolute } from 'node:path';

import { closeDatabasePool, createDatabasePool } from '@qf-jarvis/event-backbone';
import { createOpenAICompatibleEmbeddingPort } from '@qf-jarvis/openai-compatible-embedding-adapter';
import {
  buildStreamingKnowledgeRelease,
  createPostgresKnowledgeIndexWriter,
} from '@qf-jarvis/postgres-knowledge-index';

import { loadQuickFurnoKnowledgeCandidateConfig } from '../knowledge-production/knowledge-candidate-config.js';
import {
  createApprovedQuickFurnoKnowledgeSourceManifest,
  deriveQuickFurnoKnowledgeReleaseRevision,
} from '../knowledge-production/quickfurno-production-corpus.js';

function configPathOf(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== '--config') throw new Error('invalid-usage');
  const path = argv[1];
  if (path === undefined || !isAbsolute(path)) throw new Error('invalid-usage');
  return path;
}

async function main(): Promise<void> {
  let pool: ReturnType<typeof createDatabasePool> | undefined;
  try {
    const config = loadQuickFurnoKnowledgeCandidateConfig(configPathOf(process.argv.slice(2)));
    const manifest = createApprovedQuickFurnoKnowledgeSourceManifest(config.approval);
    const revision = deriveQuickFurnoKnowledgeReleaseRevision(manifest);

    pool = createDatabasePool(config.database);
    const writer = createPostgresKnowledgeIndexWriter(pool);
    const embedding = createOpenAICompatibleEmbeddingPort({
      endpoint: config.embedding.endpoint,
      modelRef: config.embedding.modelRef,
      executionClass: config.embedding.executionClass,
      ...(config.embedding.bearerToken === undefined
        ? {}
        : { bearerToken: config.embedding.bearerToken }),
      timeoutMs: config.embedding.timeoutMs,
      maxBatchItems: config.embedding.maxBatchItems,
      maxInputChars: config.embedding.maxInputChars,
    });

    const built = await buildStreamingKnowledgeRelease({
      revision,
      sources: manifest.sources.map((source) => source.document),
      embedding,
      writer,
      activateAfterSeal: false,
    });

    process.stdout.write(
      [
        'qfj-knowledge-candidate SEALED_INACTIVE',
        `revision=${built.revision}`,
        `sources=${String(built.sourceDocumentsRead)}`,
        `chunks=${String(built.chunksStaged)}`,
        `documents=${String(built.documentsPublished)}`,
        `embeddingModel=${config.embedding.modelRef}`,
      ].join(' ') + '\n',
    );
  } catch {
    process.stderr.write('qfj-knowledge-candidate REFUSED\n');
    process.exitCode = 1;
  } finally {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined);
  }
}

await main();
