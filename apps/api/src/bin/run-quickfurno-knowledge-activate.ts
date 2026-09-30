#!/usr/bin/env node
import { isAbsolute } from 'node:path';

import { closeDatabasePool, createDatabasePool } from '@qf-jarvis/event-backbone';
import {
  assertPostgresKnowledgeReleaseReady,
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

    // Activation is intentionally separate from candidate construction. The writer refuses anything
    // not already SEALED, and the post-check proves that the exact revision + embedding model became
    // the one active retrieval release.
    await writer.activateRelease(revision);
    await assertPostgresKnowledgeReleaseReady(pool, revision, config.embedding.modelRef);

    process.stdout.write(
      `qfj-knowledge-activation ACTIVE revision=${revision} embeddingModel=${config.embedding.modelRef}\n`,
    );
  } catch {
    process.stderr.write('qfj-knowledge-activation REFUSED\n');
    process.exitCode = 1;
  } finally {
    if (pool !== undefined) await closeDatabasePool(pool).catch(() => undefined);
  }
}

await main();
