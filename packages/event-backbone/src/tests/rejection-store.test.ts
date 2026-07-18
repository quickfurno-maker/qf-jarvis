/**
 * `recordIngestionRejection` — unit tests for the parts that need no database (Stage 3.3.3).
 *
 * The append itself is proven against a real PostgreSQL in `ingestion-rejection.integration.test.ts`.
 * Here we prove the pure behaviour with a captured fake pool: exactly one INSERT, `issueCodes`
 * deterministically sorted and deduplicated, `recordedAt`/`sequence` never sent, and the returned
 * value frozen.
 */

import { describe, expect, it } from 'vitest';

import { recordIngestionRejection, type DatabasePool } from '../index.js';

interface CapturedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A fake pool that captures the one query `recordIngestionRejection` issues. */
function capturingPool(): { pool: DatabasePool; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const client = {
    query: (text: string, values: readonly unknown[]) => {
      queries.push({ text, values });
      return Promise.resolve({
        rows: [{ sequence: '7', recorded_at: new Date('2026-07-18T00:00:00Z') }],
      });
    },
    release: () => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as DatabasePool;
  return { pool, queries };
}

describe('recordIngestionRejection — one parameterized INSERT of only caller-supplied fields', () => {
  it('issues a single parameterized INSERT that never sends sequence or recorded_at', async () => {
    const { pool, queries } = capturingPool();

    await recordIngestionRejection(pool, {
      reasonCode: 'contract-validation-failed',
      keyId: 'core-2026-a',
      bodyDigest: Buffer.alloc(32, 0xb2),
      issueCodes: ['required'],
      issueCount: 1,
      issuesTruncated: false,
    });

    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query?.text).toContain('INSERT INTO qf_jarvis.ingestion_rejection');
    expect(query?.text).toContain('RETURNING sequence, recorded_at');
    // Only the six caller columns are bound; there is no sequence or recorded_at parameter.
    expect(query?.text).not.toMatch(/INSERT[^)]*sequence/i);
    expect(query?.text).not.toMatch(/INSERT[^)]*recorded_at/i);
    expect(query?.values).toHaveLength(6);
  });

  it('deterministically sorts and deduplicates issueCodes before insertion', async () => {
    const { pool, queries } = capturingPool();

    await recordIngestionRejection(pool, {
      reasonCode: 'contract-validation-failed',
      issueCodes: ['unknown-field', 'required', 'unknown-field', 'invalid-type', 'required'],
      issueCount: 5,
      issuesTruncated: true,
    });

    const issueCodes = queries[0]?.values[3];
    // Distinct, then lexicographically sorted — regardless of input order or duplicates.
    expect(issueCodes).toStrictEqual(['invalid-type', 'required', 'unknown-field']);
  });

  it('passes null for an omitted keyId and bodyDigest', async () => {
    const { pool, queries } = capturingPool();

    await recordIngestionRejection(pool, {
      reasonCode: 'signature-missing',
      issueCodes: [],
      issueCount: 0,
      issuesTruncated: false,
    });

    const values = queries[0]?.values ?? [];
    expect(values[0]).toBe('signature-missing');
    expect(values[1]).toBeNull(); // key_id
    expect(values[2]).toBeNull(); // body_digest
    expect(values[3]).toStrictEqual([]);
  });

  it('returns a frozen object with only the database-generated facts', async () => {
    const { pool } = capturingPool();

    const recorded = await recordIngestionRejection(pool, {
      reasonCode: 'unsupported-algorithm',
      issueCodes: [],
      issueCount: 0,
      issuesTruncated: false,
    });

    expect(Object.isFrozen(recorded)).toBe(true);
    expect(recorded.sequence).toBe('7');
    expect(recorded.recordedAt).toBeInstanceOf(Date);
    expect(Object.keys(recorded).sort()).toStrictEqual(['recordedAt', 'sequence']);
  });
});
