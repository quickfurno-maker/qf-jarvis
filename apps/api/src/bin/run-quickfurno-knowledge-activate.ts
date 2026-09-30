#!/usr/bin/env node
import { isAbsolute } from 'node:path';

import { closeDatabasePool, createDatabasePool } from '@qf-jarvis/event-backbone';
import {
  assertPostgresKnowledgeReleaseReady,
  createPostgresKnowledgeIndexWriter,
} from '@qf-jarvis/postgres-knowledge-index';

import { activateQuickFurnoKnowledgeRelease } from '../knowledge-production/activate-quickfurno-knowledge.js';
import { loadQuickFurnoKnowledgeCandidateConfig } from '../knowledge-production/knowledge-candidate-config.js';

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
    const activePool = createDatabasePool(config.database);
    pool = activePool;
    const writer = createPostgresKnowledgeIndexWriter(activePool);

    const revision = await activateQuickFurnoKnowledgeRelease({
      approval: config.approval,
      embeddingModelRef: config.embedding.modelRef,
      activator: {
        activate: (candidateRevision) => writer.activateRelease(candidateRevision),
        assertReady: (candidateRevision, embeddingModelRef) =>
          assertPostgresKnowledgeReleaseReady(activePool, candidateRevision, embeddingModelRef),
      },
    });

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
