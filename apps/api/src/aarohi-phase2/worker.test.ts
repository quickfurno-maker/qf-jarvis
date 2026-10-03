import { describe, expect, it, vi } from 'vitest';

import type { AarohiPhase2CoreClient } from './core-client.js';
import { createAarohiDiscoveryProviderRegistry } from './provider-port.js';
import { createAarohiPhase2Worker } from './worker.js';

const RUN = '11111111-1111-4111-8111-111111111111';
const CONNECTOR = '22222222-2222-4222-8222-222222222222';

function core(sequence: readonly (() => Promise<Readonly<Record<string, unknown>>>)[]) {
  let index = 0;
  const calls: { kind: string; payload: Readonly<Record<string, unknown>> }[] = [];
  const client: AarohiPhase2CoreClient = {
    async call(kind, payload) {
      calls.push({ kind, payload });
      const next = sequence[index++];
      if (!next) throw new Error('unexpected-core-call');
      return next();
    },
  };
  return { client, calls };
}

describe('Aarohi Phase 2 discovery worker', () => {
  it('is idle without a claimed run and never touches a provider', async () => {
    const c = core([async () => ({ status: 'idle' })]);
    const discover = vi.fn();
    const worker = createAarohiPhase2Worker({
      workerRef: 'worker.a',
      core: c.client,
      providers: createAarohiDiscoveryProviderRegistry([
        {
          key: 'p',
          channel: 'X',
          discover,
        },
      ]),
    });
    await expect(worker.runOnce()).resolves.toEqual({ state: 'idle' });
    expect(discover).not.toHaveBeenCalled();
  });

  it('runs one provider once, submits bounded candidates, then completes', async () => {
    const c = core([
      async () => ({
        status: 'claimed',
        run: {
          runId: RUN,
          connectorId: CONNECTOR,
          channel: 'X',
          providerKey: 'provider.x',
          querySpec: { city: 'Pune' },
        },
      }),
      async () => ({ status: 'accepted', candidateIds: ['a'] }),
      async () => ({ status: 'recorded' }),
    ]);
    const discover = vi.fn(async () => [
      {
        sourceType: 'X' as const,
        externalReference: 'vendor.one',
        businessName: 'Vendor One',
        cityHint: 'Pune',
        confidence: 90,
      },
    ]);
    const worker = createAarohiPhase2Worker({
      workerRef: 'worker.a',
      core: c.client,
      providers: createAarohiDiscoveryProviderRegistry([
        { key: 'provider.x', channel: 'X', discover },
      ]),
    });
    await expect(worker.runOnce()).resolves.toEqual({
      state: 'completed',
      runId: RUN,
      candidateCount: 1,
    });
    expect(discover).toHaveBeenCalledTimes(1);
    expect(c.calls.map((call) => call.kind)).toEqual([
      'CLAIM_DISCOVERY_RUN',
      'SUBMIT_DISCOVERY_CANDIDATES',
      'COMPLETE_DISCOVERY_RUN',
    ]);
  });

  it('does not repeat provider execution when completion acknowledgement is uncertain', async () => {
    const c = core([
      async () => ({
        status: 'claimed',
        run: {
          runId: RUN,
          connectorId: CONNECTOR,
          channel: 'GOOGLE',
          providerKey: 'provider.g',
          querySpec: {},
        },
      }),
      async () => ({ status: 'accepted', candidateIds: ['a'] }),
      async () => {
        throw new Error('network-uncertain');
      },
      async () => {
        throw new Error('network-still-uncertain');
      },
    ]);
    const discover = vi.fn(async () => [
      {
        sourceType: 'GOOGLE' as const,
        externalReference: 'place.1',
        businessName: 'Interior Studio',
        confidence: 80,
      },
    ]);
    const worker = createAarohiPhase2Worker({
      workerRef: 'worker.a',
      core: c.client,
      providers: createAarohiDiscoveryProviderRegistry([
        { key: 'provider.g', channel: 'GOOGLE', discover },
      ]),
    });
    const result = await worker.runOnce();
    expect(result.state).toBe('refused');
    expect(discover).toHaveBeenCalledTimes(1);
    expect(c.calls.filter((call) => call.kind === 'COMPLETE_DISCOVERY_RUN')).toHaveLength(2);
  });

  it('fails the run rather than falling back when the provider is not configured', async () => {
    const c = core([
      async () => ({
        status: 'claimed',
        run: {
          runId: RUN,
          connectorId: CONNECTOR,
          channel: 'INSTAGRAM',
          providerKey: 'meta',
          querySpec: {},
        },
      }),
      async () => ({ status: 'recorded' }),
    ]);
    const worker = createAarohiPhase2Worker({
      workerRef: 'worker.a',
      core: c.client,
      providers: createAarohiDiscoveryProviderRegistry([]),
    });
    await expect(worker.runOnce()).resolves.toEqual({
      state: 'refused',
      runId: RUN,
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });
});
