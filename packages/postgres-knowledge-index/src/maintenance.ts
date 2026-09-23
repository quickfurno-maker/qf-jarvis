import type { Pool } from 'pg';

import { PostgresKnowledgeIndexError } from './errors.js';

export interface KnowledgeReleasePruneResult {
  readonly prunedRevisions: readonly string[];
  readonly releaseDocumentsDeleted: number;
  readonly chunksDeleted: number;
  readonly documentsDeleted: number;
}

/**
 * Keep the newest N inactive SEALED releases plus the active release.
 * The connected database role must be a member of qf_jarvis_knowledge_maintainer.
 * Runtime and ingestion roles receive no DELETE privilege and cannot call the maintenance function.
 */
export async function pruneInactiveKnowledgeReleases(
  pool: Pool,
  retainNewestInactive: number,
): Promise<KnowledgeReleasePruneResult> {
  if (
    !Number.isInteger(retainNewestInactive) ||
    retainNewestInactive < 1 ||
    retainNewestInactive > 100
  ) {
    throw new PostgresKnowledgeIndexError('release-conflict');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query<{ revision: string }>(
      [
        'SELECT r.revision',
        'FROM qf_jarvis_knowledge.knowledge_release r',
        'LEFT JOIN qf_jarvis_knowledge.active_release a ON a.revision=r.revision',
        "WHERE r.release_state='SEALED' AND a.revision IS NULL",
        'ORDER BY r.sealed_at DESC, r.revision DESC',
        'OFFSET $1',
      ].join(' '),
      [retainNewestInactive],
    );

    const pruned: string[] = [];
    let releaseDocumentsDeleted = 0;
    let chunksDeleted = 0;
    let documentsDeleted = 0;
    for (const row of rows.rows) {
      const result = await client.query<{
        pruned_revision: string;
        release_documents_deleted: number;
        chunks_deleted: number;
        documents_deleted: number;
      }>('SELECT * FROM qf_jarvis_knowledge.prune_inactive_release($1)', [row.revision]);
      const one = result.rows[0];
      if (one === undefined || result.rows.length !== 1) {
        throw new PostgresKnowledgeIndexError('release-conflict');
      }
      pruned.push(one.pruned_revision);
      releaseDocumentsDeleted += one.release_documents_deleted;
      chunksDeleted += one.chunks_deleted;
      documentsDeleted += one.documents_deleted;
    }
    await client.query('COMMIT');
    return Object.freeze({
      prunedRevisions: Object.freeze(pruned),
      releaseDocumentsDeleted,
      chunksDeleted,
      documentsDeleted,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the bounded original error.
    }
    if (error instanceof PostgresKnowledgeIndexError) throw error;
    throw new PostgresKnowledgeIndexError('release-conflict');
  } finally {
    client.release();
  }
}
