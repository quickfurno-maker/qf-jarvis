import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createPostgresGovernedMemoryStore } from '../store.js';

const record = {
  memoryRecordId: 'c2000004-0000-4000-8000-000000000004',
  contractVersion: 1 as const,
  ownerAgent: 'riya' as const,
  subjectReferences: [{ entityType: 'client', entityId: 'client.1' }],
  sourceEventIds: ['c2000005-0000-4000-8000-000000000005'],
  derivedSummary: 'The client prefers evening contact.',
  createdAt: '2026-09-23T10:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
  expiresAt: '2026-10-23T10:00:00.000Z',
  policy: { policyId: 'memory-policy', policyVersion: 1 },
  dataClassification: 'personal' as const,
  rebuildable: true as const,
  authoritative: false as const,
  erasureState: 'none' as const,
  reasonCode: 'relationship-context',
  correlationId: 'c2000006-0000-4000-8000-000000000006',
};

function pool(query: ReturnType<typeof vi.fn>): Pool {
  return { query } as unknown as Pool;
}

describe('postgres governed memory store', () => {
  it('reads bounded active memory and re-proves the canonical record', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ record_json: record }], rowCount: 1 });
    const store = createPostgresGovernedMemoryStore(pool(query));
    await expect(
      store.readActive({ ownerAgent: 'riya', asOf: '2026-09-23T11:00:00.000Z', limit: 10 }),
    ).resolves.toEqual([record]);
    expect(String(query.mock.calls[0]?.[0])).toContain('expires_at > $2::timestamptz');
  });

  it('fails a conflicting upsert instead of rewriting identity', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const store = createPostgresGovernedMemoryStore(pool(query));
    await expect(store.write(record)).rejects.toThrow('governed-memory-write-conflict');
  });

  it('physically deletes subject memory and returns a bounded receipt', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          invalidated_count: 125,
          sampled_ids: Array.from({ length: 100 }, (_, i) => `id.${String(i)}`),
        },
      ],
      rowCount: 1,
    });
    const store = createPostgresGovernedMemoryStore(pool(query));
    const result = await store.invalidate({
      memoryInvalidationRequestId: 'c2000007-0000-4000-8000-000000000007',
      contractVersion: 1,
      scope: 'subject',
      ownerAgent: 'riya',
      subjectReference: { entityType: 'client', entityId: 'client.1' },
      erasureRequestId: 'c2000008-0000-4000-8000-000000000008',
      requestedBy: {
        actorType: 'human',
        actor: { entityType: 'operator', entityId: 'operator.1' },
      },
      requestedAt: '2026-09-23T11:00:00.000Z',
      reasonCode: 'erasure-requested',
      policy: { policyId: 'memory-erasure', policyVersion: 1 },
      correlationId: 'c2000006-0000-4000-8000-000000000006',
    });
    expect(result).toMatchObject({ invalidatedCount: 125, truncated: true });
    expect(result.sampledMemoryRecordIds).toHaveLength(100);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'DELETE FROM qf_jarvis_memory.agent_memory_record',
    );
  });
});
