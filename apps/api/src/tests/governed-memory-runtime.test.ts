import { describe, expect, it, vi } from 'vitest';

import { composeGovernedMemoryRuntime } from '../runtime/durable-jarvis-runtime.js';

type MemoryPool = Parameters<typeof composeGovernedMemoryRuntime>[0]['pool'];

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

function pool(query: ReturnType<typeof vi.fn>): MemoryPool {
  return { query } as unknown as MemoryPool;
}

describe('durable governed memory application composition', () => {
  it('keeps durable reads and writes disabled under the engineering default', async () => {
    const query = vi.fn();
    const memory = composeGovernedMemoryRuntime({ pool: pool(query) });

    await expect(
      memory.readActive({
        ownerAgent: 'riya',
        asOf: '2026-09-23T11:00:00.000Z',
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expect(memory.write(record)).resolves.toMatchObject({
      decision: 'REFUSE_DURABLE_DISABLED',
      memoryRecordId: record.memoryRecordId,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps erasure available even while durable writes are disabled', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ invalidated_count: 1, sampled_ids: [record.memoryRecordId] }],
      rowCount: 1,
    });
    const memory = composeGovernedMemoryRuntime({ pool: pool(query) });

    await expect(
      memory.invalidate({
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
      }),
    ).resolves.toMatchObject({ invalidatedCount: 1, truncated: false });
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'DELETE FROM qf_jarvis_memory.agent_memory_record',
    );
  });

  it('requires an explicit bounded lifecycle policy before a durable write can reach PostgreSQL', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const memory = composeGovernedMemoryRuntime({
      pool: pool(query),
      policy: {
        policyRef: 'qfj.memory.owner-approved.v1',
        durableMemoryEnabled: true,
        ownerApprovalRef: 'owner.memory.approval.1',
        retentionPolicyRef: 'policy.memory.retention.1',
        erasurePolicyRef: 'policy.memory.erasure.1',
        maxDurableRetentionDays: 90,
      },
    });

    await expect(memory.write(record)).resolves.toMatchObject({
      decision: 'ALLOW_DURABLE',
      memoryRecordId: record.memoryRecordId,
      retentionDays: 30,
    });
    expect(query).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0]?.[0])).toContain(
      'INSERT INTO qf_jarvis_memory.agent_memory_record',
    );
  });
});
