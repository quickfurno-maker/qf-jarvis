import type { DatabasePool } from '@qf-jarvis/event-backbone';
import type { ModelGateway } from '@qf-jarvis/model-gateway';
import { describe, expect, it, vi } from 'vitest';

const ambient = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('@qf-jarvis/worker/internal/jao5-ambient', () => ({
  JAO5_LIMITS: { maxMonitorsPerCycle: 8 },
  runJao5AmbientCycle: ambient.run,
}));

import {
  PROACTIVE_WORKER_BOUNDS,
  runProactiveWorker,
  type ProactiveWorkerDependencies,
} from '../index.js';

function dependencies(
  options: {
    readonly onSleep?: (() => void) | undefined;
  } = {},
): {
  readonly deps: ProactiveWorkerDependencies;
  readonly readSnapshot: ReturnType<typeof vi.fn>;
  readonly sleep: ReturnType<typeof vi.fn>;
} {
  const readSnapshot = vi.fn(() => Promise.resolve({ state: 'HEALTHY' }));
  const sleep = vi.fn(() => {
    options.onSleep?.();
    return Promise.resolve();
  });
  return {
    deps: {
      pool: {} as DatabasePool,
      gateway: {} as ModelGateway,
      clock: { nowMs: () => 900_000 },
      readSystemHealthSnapshot: readSnapshot,
      sleep,
    },
    readSnapshot,
    sleep,
  };
}

describe('proactive worker boundary', () => {
  it('DORMANT touches no snapshot, JAO cycle, database/model seam or timer', async () => {
    ambient.run.mockReset();
    const fakes = dependencies();

    const result = await runProactiveWorker(
      {
        mode: 'DORMANT',
        cadenceMs: PROACTIVE_WORKER_BOUNDS.recommendedCadenceMs,
        maxConsecutiveFailures: 3,
        monitorInstanceIds: [],
      },
      fakes.deps,
    );

    expect(result).toEqual({
      state: 'DORMANT',
      cyclesAttempted: 0,
      cyclesCompleted: 0,
      attentionCreated: 0,
      aosCyclesCompleted: 0,
      aosCasesObserved: 0,
      aosRecommendationsCreated: 0,
      aosAdjudicationHolds: 0,
      aosCanonicalRecommendations: 0,
      aosCanonicalProjectionFailures: 0,
      aosModelCalls: 0,
      consecutiveFailures: 0,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(ambient.run).not.toHaveBeenCalled();
    expect(fakes.readSnapshot).not.toHaveBeenCalled();
    expect(fakes.sleep).not.toHaveBeenCalled();
  });

  it('runs SHADOW sequentially and stops cleanly after abort', async () => {
    ambient.run.mockReset();
    let active = 0;
    let maxActive = 0;
    ambient.run.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { attentionCreated: 2 };
    });

    const controller = new AbortController();
    const fakes = dependencies({
      onSleep: () => {
        controller.abort();
      },
    });

    const result = await runProactiveWorker(
      {
        mode: 'SHADOW',
        cadenceMs: PROACTIVE_WORKER_BOUNDS.recommendedCadenceMs,
        maxConsecutiveFailures: 3,
        monitorInstanceIds: ['jao5.monitor.instance.health'],
      },
      fakes.deps,
      controller.signal,
    );

    expect(result).toMatchObject({
      state: 'STOPPED',
      cyclesAttempted: 1,
      cyclesCompleted: 1,
      attentionCreated: 2,
      consecutiveFailures: 0,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(maxActive).toBe(1);
    expect(ambient.run).toHaveBeenCalledTimes(1);
    expect(ambient.run).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'SHADOW',
        monitorInstanceIds: ['jao5.monitor.instance.health'],
      }),
      expect.objectContaining({
        pool: fakes.deps.pool,
        gateway: fakes.deps.gateway,
      }),
      controller.signal,
    );
    expect(fakes.sleep).toHaveBeenCalledTimes(1);
  });

  it('halts at the consecutive failure budget instead of rapidly retrying forever', async () => {
    ambient.run.mockReset();
    ambient.run.mockRejectedValue(new Error('hostile detail must not escape'));
    const fakes = dependencies();

    const result = await runProactiveWorker(
      {
        mode: 'SHADOW',
        cadenceMs: 60_000,
        maxConsecutiveFailures: 2,
        monitorInstanceIds: ['jao5.monitor.instance.health'],
      },
      fakes.deps,
    );

    expect(result).toMatchObject({
      state: 'HALTED_FAILURE_BUDGET',
      cyclesAttempted: 2,
      cyclesCompleted: 0,
      attentionCreated: 0,
      consecutiveFailures: 2,
    });
    expect(ambient.run).toHaveBeenCalledTimes(2);
    expect(fakes.sleep).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('hostile detail');
  });

  it('runs the AOS v2 supervisor only after explicit SHADOW opt-in and a bounded source is provided', async () => {
    ambient.run.mockReset();
    ambient.run.mockResolvedValue({ attentionCreated: 0 });
    const controller = new AbortController();
    const fakes = dependencies({
      onSleep: () => {
        controller.abort();
      },
    });
    const readAosSupervisorSnapshot = vi.fn(() =>
      Promise.resolve({
        canonicalEvents: [],
        leadDeliveries: [],
        clients: [],
        vendors: [],
        marketplaceSlices: [],
      }),
    );
    const writeAosOwnerAttention = vi.fn(() => Promise.resolve());

    const result = await runProactiveWorker(
      {
        mode: 'SHADOW',
        cadenceMs: PROACTIVE_WORKER_BOUNDS.recommendedCadenceMs,
        maxConsecutiveFailures: 3,
        monitorInstanceIds: ['jao5.monitor.instance.health'],
        aosV2ShadowEnabled: true,
      },
      {
        ...fakes.deps,
        readAosSupervisorSnapshot,
        aosOwnerAttentionObservation: { write: writeAosOwnerAttention },
      },
      controller.signal,
    );

    expect(result).toMatchObject({
      state: 'STOPPED',
      cyclesCompleted: 1,
      aosCyclesCompleted: 1,
      aosCasesObserved: 0,
      aosRecommendationsCreated: 0,
      aosAdjudicationHolds: 0,
      aosCanonicalRecommendations: 0,
      aosCanonicalProjectionFailures: 0,
      aosModelCalls: 0,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(writeAosOwnerAttention).toHaveBeenCalledTimes(1);
    expect(writeAosOwnerAttention).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: 'qfj.aos.supervisor-cycle.v1' }),
      new Date(900_000).toISOString(),
    );
    expect(readAosSupervisorSnapshot).toHaveBeenCalledTimes(1);
    expect(readAosSupervisorSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 'aos.proactive.cycle.1',
        generatedAt: new Date(900_000).toISOString(),
      }),
      controller.signal,
    );
  });

  it('refuses AOS v2 SHADOW opt-in when no authoritative source adapter is wired', async () => {
    ambient.run.mockReset();
    const fakes = dependencies();
    await expect(
      runProactiveWorker(
        {
          mode: 'SHADOW',
          cadenceMs: PROACTIVE_WORKER_BOUNDS.recommendedCadenceMs,
          maxConsecutiveFailures: 3,
          monitorInstanceIds: ['jao5.monitor.instance.health'],
          aosV2ShadowEnabled: true,
        },
        fakes.deps,
      ),
    ).rejects.toThrow('proactive-worker-aos-source-required');
    expect(ambient.run).not.toHaveBeenCalled();
  });

  it('has no ACTIVE mode and refuses malformed or unsafe activation config', async () => {
    ambient.run.mockReset();
    const fakes = dependencies();

    await expect(
      runProactiveWorker(
        {
          mode: 'ACTIVE' as 'SHADOW',
          cadenceMs: 60_000,
          maxConsecutiveFailures: 1,
          monitorInstanceIds: ['jao5.monitor.instance.health'],
        },
        fakes.deps,
      ),
    ).rejects.toThrow('proactive-worker-config-invalid');

    await expect(
      runProactiveWorker(
        {
          mode: 'SHADOW',
          cadenceMs: 999,
          maxConsecutiveFailures: 1,
          monitorInstanceIds: ['jao5.monitor.instance.health'],
        },
        fakes.deps,
      ),
    ).rejects.toThrow('proactive-worker-config-invalid');
  });
});
