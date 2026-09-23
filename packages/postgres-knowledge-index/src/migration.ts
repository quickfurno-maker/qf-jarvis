import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

import { PostgresKnowledgeIndexError } from './errors.js';

const MIGRATION_VERSION = 1;
const MIGRATION_FILENAME = '0001_hybrid_knowledge_index.sql';
const LOCK_KEY = 8_174_221_515;

async function migrationSql(): Promise<string> {
  return readFile(new URL('./migrations/' + MIGRATION_FILENAME, import.meta.url), 'utf8');
}

function digest(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export interface KnowledgeIndexMigrationResult {
  readonly applied: boolean;
  readonly version: 1;
  readonly checksum: string;
}

export async function applyKnowledgeIndexMigration(
  pool: Pool,
): Promise<KnowledgeIndexMigrationResult> {
  const sql = await migrationSql();
  const checksum = digest(sql);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);

    const exists = await client.query<{ present: string | null }>(
      "SELECT to_regclass('qf_jarvis_knowledge.schema_migration')::text AS present",
    );
    if (exists.rows[0]?.present !== null && exists.rows[0]?.present !== undefined) {
      const history = await client.query<{ checksum: string }>(
        'SELECT checksum FROM qf_jarvis_knowledge.schema_migration WHERE version = $1',
        [MIGRATION_VERSION],
      );
      if (history.rows.length > 1) {
        throw new PostgresKnowledgeIndexError('migration-failed');
      }
      const prior = history.rows[0];
      if (prior !== undefined) {
        if (prior.checksum !== checksum) {
          throw new PostgresKnowledgeIndexError('migration-checksum-mismatch');
        }
        await client.query('COMMIT');
        return Object.freeze({ applied: false, version: 1 as const, checksum });
      }
    }

    await client.query(sql);
    await client.query(
      'INSERT INTO qf_jarvis_knowledge.schema_migration (version, filename, checksum) VALUES ($1,$2,$3)',
      [MIGRATION_VERSION, MIGRATION_FILENAME, checksum],
    );
    await client.query('COMMIT');
    return Object.freeze({ applied: true, version: 1 as const, checksum });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original failure is the only externally meaningful one.
    }
    if (error instanceof PostgresKnowledgeIndexError) throw error;
    throw new PostgresKnowledgeIndexError('migration-failed');
  } finally {
    client.release();
  }
}
