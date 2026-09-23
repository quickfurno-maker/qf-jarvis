import {
  parseAgentMemoryRecord,
  parseMemoryInvalidationRequest,
  type AgentMemoryRecordV1,
  type MemoryInvalidationRequestV1,
} from '@qf-jarvis/contracts';
import type { Pool } from 'pg';
import type {
  GovernedMemoryInvalidationResult,
  GovernedMemoryReadQuery,
  GovernedMemoryStorePort,
} from '@qf-jarvis/governed-memory-foundation';

const SAMPLE_LIMIT = 100;
const SUBJECT_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\|[A-Za-z0-9._:-]{1,128}$/u;

function subjectKey(subject: AgentMemoryRecordV1['subjectReferences'][number]): string {
  const key = `${subject.entityType}|${subject.entityId}`;
  if (!SUBJECT_KEY.test(key)) throw new TypeError('governed-memory-subject-invalid');
  return key;
}

function subjectKeys(record: AgentMemoryRecordV1): readonly string[] {
  return Object.freeze(record.subjectReferences.map(subjectKey).sort());
}

interface MemoryRow {
  readonly record_json: unknown;
}

interface InvalidationRow {
  readonly invalidated_count: number;
  readonly sampled_ids: string[] | null;
}

function invalidationPredicate(request: MemoryInvalidationRequestV1): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  if (request.scope === 'record') {
    return {
      sql: 'owner_agent = $1 AND memory_record_id = $2',
      params: [request.ownerAgent, request.memoryRecordId],
    };
  }
  if (request.scope === 'subject') {
    if (request.subjectReference === undefined) throw new TypeError('memory-invalidation-invalid');
    return {
      sql: 'owner_agent = $1 AND $2 = ANY(subject_keys)',
      params: [request.ownerAgent, subjectKey(request.subjectReference)],
    };
  }
  if (request.scope === 'agent') {
    return { sql: 'owner_agent = $1', params: [request.ownerAgent] };
  }
  return { sql: 'TRUE', params: [] };
}

/**
 * Private production adapter for derived agent memory.
 *
 * The caller owns the pool. Importing this file connects to nothing and applies no migration.
 * Reads return only non-expired records. Invalidation physically deletes the payload rather than
 * retaining personal content behind a tombstone. The deletion receipt is bounded to 100 sampled ids.
 */
export function createPostgresGovernedMemoryStore(pool: Pool): GovernedMemoryStorePort {
  return Object.freeze({
    async readActive(query: GovernedMemoryReadQuery): Promise<readonly AgentMemoryRecordV1[]> {
      const params: unknown[] = [query.ownerAgent, query.asOf, query.limit];
      let subjectClause = '';
      if (query.subjectReference !== undefined) {
        params.push(subjectKey(query.subjectReference));
        subjectClause = ' AND $4 = ANY(subject_keys)';
      }
      const result = await pool.query<MemoryRow>(
        [
          'SELECT record_json FROM qf_jarvis_memory.agent_memory_record',
          'WHERE owner_agent = $1 AND expires_at > $2::timestamptz',
          subjectClause,
          'ORDER BY updated_at DESC, memory_record_id ASC LIMIT $3',
        ].join(' '),
        params,
      );
      return Object.freeze(result.rows.map((row) => parseAgentMemoryRecord(row.record_json)));
    },

    async write(value: AgentMemoryRecordV1): Promise<void> {
      const record = parseAgentMemoryRecord(value);
      if (record.expiresAt === undefined) throw new TypeError('governed-memory-expiry-required');
      const keys = subjectKeys(record);
      const result = await pool.query(
        [
          'INSERT INTO qf_jarvis_memory.agent_memory_record AS existing',
          '(memory_record_id,owner_agent,subject_keys,record_json,created_at,updated_at,expires_at)',
          'VALUES ($1,$2,$3::text[],$4::jsonb,$5::timestamptz,$6::timestamptz,$7::timestamptz)',
          'ON CONFLICT (memory_record_id) DO UPDATE SET',
          'record_json=EXCLUDED.record_json, updated_at=EXCLUDED.updated_at, expires_at=EXCLUDED.expires_at',
          'WHERE existing.owner_agent=EXCLUDED.owner_agent',
          'AND existing.subject_keys=EXCLUDED.subject_keys',
          'AND existing.created_at=EXCLUDED.created_at',
          'AND existing.updated_at <= EXCLUDED.updated_at',
        ].join(' '),
        [
          record.memoryRecordId,
          record.ownerAgent,
          [...keys],
          JSON.stringify(record),
          record.createdAt,
          record.updatedAt,
          record.expiresAt,
        ],
      );
      if (result.rowCount !== 1) throw new TypeError('governed-memory-write-conflict');
    },

    async invalidate(
      value: MemoryInvalidationRequestV1,
    ): Promise<GovernedMemoryInvalidationResult> {
      const request = parseMemoryInvalidationRequest(value);
      const predicate = invalidationPredicate(request);
      const result = await pool.query<InvalidationRow>(
        [
          'WITH deleted AS (',
          'DELETE FROM qf_jarvis_memory.agent_memory_record WHERE',
          predicate.sql,
          'RETURNING memory_record_id',
          '), ranked AS (',
          'SELECT memory_record_id, row_number() OVER (ORDER BY memory_record_id) AS rn FROM deleted',
          ') SELECT count(*)::int AS invalidated_count,',
          `coalesce(array_agg(memory_record_id ORDER BY memory_record_id) FILTER (WHERE rn <= ${String(SAMPLE_LIMIT)}), ARRAY[]::text[]) AS sampled_ids`,
          'FROM ranked',
        ].join(' '),
        [...predicate.params],
      );
      const row = result.rows[0];
      if (row === undefined || result.rows.length !== 1) {
        throw new TypeError('governed-memory-invalidation-result-invalid');
      }
      const sampled = Object.freeze([...(row.sampled_ids ?? [])]);
      return Object.freeze({
        invalidatedCount: row.invalidated_count,
        sampledMemoryRecordIds: sampled,
        truncated: row.invalidated_count > sampled.length,
      });
    },
  });
}
