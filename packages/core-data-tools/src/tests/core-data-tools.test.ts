import { describe, expect, it, vi } from 'vitest';

import { createCoreDataTools } from '../index.js';

describe('Core data tools', () => {
  it('exposes only read-only Core-owned tools', () => {
    const tools = createCoreDataTools({
      availabilityReader: { readCurrent: vi.fn() },
      riyaIntakePort: {
        readCurrent: vi.fn(),
        lookupSubmission: vi.fn(),
        submit: vi.fn(),
      },
    });

    expect(tools.descriptors.map((item) => item.toolId)).toEqual([
      'CORE_SERVICE_AVAILABILITY_READ',
      'CORE_RIYA_INTAKE_STATE_READ',
      'CORE_RIYA_SUBMISSION_LOOKUP',
    ]);
    expect(tools.descriptors.every((item) => item.effect === 'READ_ONLY')).toBe(true);
  });

  it('delegates service availability to the existing Core reader exactly once', async () => {
    const readCurrent = vi.fn().mockResolvedValue({ version: 1 });
    const tools = createCoreDataTools({
      availabilityReader: { readCurrent },
      riyaIntakePort: {
        readCurrent: vi.fn(),
        lookupSubmission: vi.fn(),
        submit: vi.fn(),
      },
    });

    const result = await tools.invoke('CORE_SERVICE_AVAILABILITY_READ', {
      tenantId: 'tenant.qf',
    });
    expect(readCurrent).toHaveBeenCalledOnce();
    expect(readCurrent).toHaveBeenCalledWith({ tenantId: 'tenant.qf' });
    expect(result.descriptor.resultTrust).toBe('UNTRUSTED_UNTIL_PARSED');
  });

  it('never exposes the mutating intake method', () => {
    const submit = vi.fn();
    const tools = createCoreDataTools({
      availabilityReader: { readCurrent: vi.fn() },
      riyaIntakePort: {
        readCurrent: vi.fn(),
        lookupSubmission: vi.fn(),
        submit,
      },
    });

    expect('submit' in tools).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('fails closed when a scoped read is missing required identity', async () => {
    const tools = createCoreDataTools({
      availabilityReader: { readCurrent: vi.fn() },
      riyaIntakePort: {
        readCurrent: vi.fn(),
        lookupSubmission: vi.fn(),
        submit: vi.fn(),
      },
    });

    await expect(
      tools.invoke('CORE_RIYA_INTAKE_STATE_READ', { tenantId: 'tenant.qf' }),
    ).rejects.toThrow('core-data-tool-conversation-required');
  });
});
