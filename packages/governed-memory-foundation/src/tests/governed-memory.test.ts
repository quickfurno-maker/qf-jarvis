import { describe, expect, it, vi } from 'vitest';

import {
  GOVERNED_MEMORY_ENGINEERING_POLICY_V1,
  assessGovernedMemoryWrite,
  createGovernedMemoryPolicy,
  createGovernedMemoryRuntime,
  type GovernedMemoryStorePort,
} from '../index.js';

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

const enabledPolicy = createGovernedMemoryPolicy({
  policyRef: 'qfj.memory.owner.v1',
  durableMemoryEnabled: true,
  ownerApprovalRef: 'owner.memory.approval.1',
  retentionPolicyRef: 'policy.memory.retention.1',
  erasurePolicyRef: 'policy.memory.erasure.1',
  maxDurableRetentionDays: 90,
});

function store(over: Partial<GovernedMemoryStorePort> = {}): GovernedMemoryStorePort {
  return {
    readActive: vi.fn().mockResolvedValue([]),
    write: vi.fn().mockResolvedValue(undefined),
    invalidate: vi
      .fn()
      .mockResolvedValue({ invalidatedCount: 0, sampledMemoryRecordIds: [], truncated: false }),
    ...over,
  };
}

describe('governed long-term memory', () => {
  it('keeps durable memory disabled by default', () => {
    expect(assessGovernedMemoryWrite(record)).toEqual({
      decision: 'REFUSE_DURABLE_DISABLED',
      policyRef: GOVERNED_MEMORY_ENGINEERING_POLICY_V1.policyRef,
      memoryRecordId: record.memoryRecordId,
    });
  });

  it('requires explicit owner, retention and erasure policy before enablement', () => {
    expect(() =>
      createGovernedMemoryPolicy({ policyRef: 'policy.memory.1', durableMemoryEnabled: true }),
    ).toThrow('governed-memory-owner-policy-required');
  });

  it('uses the canonical memory contract and refuses authority/shape violations', () => {
    expect(assessGovernedMemoryWrite({ ...record, authoritative: true }, enabledPolicy)).toEqual({
      decision: 'REFUSE_INVALID_RECORD',
      policyRef: enabledPolicy.policyRef,
    });
  });

  it('requires a bounded expiry and refuses retention beyond the owner ceiling', () => {
    expect(
      assessGovernedMemoryWrite({ ...record, expiresAt: undefined }, enabledPolicy),
    ).toMatchObject({
      decision: 'REFUSE_EXPIRY_MISSING',
    });
    expect(
      assessGovernedMemoryWrite(
        { ...record, expiresAt: '2027-09-23T10:00:00.000Z' },
        enabledPolicy,
      ),
    ).toMatchObject({ decision: 'REFUSE_RETENTION_EXCEEDED' });
  });

  it('allows a canonical bounded record under an enabled owner policy', () => {
    expect(assessGovernedMemoryWrite(record, enabledPolicy)).toMatchObject({
      decision: 'ALLOW_DURABLE',
      memoryRecordId: record.memoryRecordId,
      retentionDays: 30,
    });
  });

  it('is a no-op read while durable memory is disabled and touches no store', async () => {
    const readActive = vi.fn();
    const runtime = createGovernedMemoryRuntime({ store: store({ readActive }) });
    await expect(
      runtime.readActive({ ownerAgent: 'riya', asOf: '2026-09-23T11:00:00.000Z', limit: 10 }),
    ).resolves.toEqual([]);
    expect(readActive).not.toHaveBeenCalled();
  });

  it('re-proves store output and refuses stale, erased or cross-agent rows', async () => {
    const runtime = createGovernedMemoryRuntime({
      policy: enabledPolicy,
      store: store({
        readActive: vi.fn().mockResolvedValue([{ ...record, ownerAgent: 'anisha' }]),
      }),
    });
    await expect(
      runtime.readActive({ ownerAgent: 'riya', asOf: '2026-09-23T11:00:00.000Z', limit: 10 }),
    ).rejects.toThrow('governed-memory-store-result-invalid');
  });

  it('writes only after admission and keeps invalidation available as a separate cleanup path', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const invalidate = vi.fn().mockResolvedValue({
      invalidatedCount: 1,
      sampledMemoryRecordIds: [record.memoryRecordId],
      truncated: false,
    });
    const runtime = createGovernedMemoryRuntime({
      policy: enabledPolicy,
      store: store({ write, invalidate }),
    });
    await expect(runtime.write(record)).resolves.toMatchObject({ decision: 'ALLOW_DURABLE' });
    expect(write).toHaveBeenCalledOnce();

    const request = {
      memoryInvalidationRequestId: 'c2000007-0000-4000-8000-000000000007',
      contractVersion: 1 as const,
      scope: 'subject' as const,
      ownerAgent: 'riya' as const,
      subjectReference: { entityType: 'client', entityId: 'client.1' },
      erasureRequestId: 'c2000008-0000-4000-8000-000000000008',
      requestedBy: {
        actorType: 'human' as const,
        actor: { entityType: 'operator', entityId: 'operator.1' },
      },
      requestedAt: '2026-09-23T11:00:00.000Z',
      reasonCode: 'erasure-requested',
      policy: { policyId: 'memory-erasure', policyVersion: 1 },
      correlationId: 'c2000006-0000-4000-8000-000000000006',
    };
    await expect(runtime.invalidate(request)).resolves.toEqual({
      invalidatedCount: 1,
      sampledMemoryRecordIds: [record.memoryRecordId],
      truncated: false,
    });
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
