import type { DatabasePool } from '@qf-jarvis/event-backbone';
import type { ModelGateway } from '@qf-jarvis/model-gateway';
import {
  JAO5_LIMITS,
  runJao5AmbientCycle,
  type Jao5Clock,
  type Jao5TelemetryHook,
} from '@qf-jarvis/worker/internal/jao5-ambient';

export const PROACTIVE_WORKER_MODES = ['DORMANT', 'SHADOW'] as const;
export type ProactiveWorkerMode = (typeof PROACTIVE_WORKER_MODES)[number];

export const PROACTIVE_WORKER_BOUNDS = Object.freeze({
  minCadenceMs: 60_000,
  maxCadenceMs: 3_600_000,
  recommendedCadenceMs: 900_000,
  maxConsecutiveFailures: 10,
  executionAuthority: 'NONE' as const,
  businessEffect: false as const,
  productionMutation: false as const,
  activeModeAvailable: false as const,
  overlappingCyclesAllowed: false as const,
});

export interface ProactiveWorkerConfig {
  readonly mode: ProactiveWorkerMode;
  readonly cadenceMs: number;
  readonly maxConsecutiveFailures: number;
  readonly monitorInstanceIds: readonly string[];
}

export interface ProactiveWorkerDependencies {
  readonly pool: DatabasePool;
  readonly gateway: ModelGateway;
  readonly clock: Jao5Clock;
  readonly readSystemHealthSnapshot: (signal?: AbortSignal) => Promise<unknown>;
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly telemetry?: Jao5TelemetryHook;
}

export interface ProactiveWorkerResult {
  readonly state: 'DORMANT' | 'STOPPED' | 'HALTED_FAILURE_BUDGET';
  readonly cyclesAttempted: number;
  readonly cyclesCompleted: number;
  readonly attentionCreated: number;
  readonly consecutiveFailures: number;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly productionMutation: false;
}

function validConfig(config: ProactiveWorkerConfig): boolean {
  if (!PROACTIVE_WORKER_MODES.includes(config.mode)) return false;
  if (
    !Number.isInteger(config.cadenceMs) ||
    config.cadenceMs < PROACTIVE_WORKER_BOUNDS.minCadenceMs ||
    config.cadenceMs > PROACTIVE_WORKER_BOUNDS.maxCadenceMs
  ) {
    return false;
  }
  if (
    !Number.isInteger(config.maxConsecutiveFailures) ||
    config.maxConsecutiveFailures < 1 ||
    config.maxConsecutiveFailures > PROACTIVE_WORKER_BOUNDS.maxConsecutiveFailures
  ) {
    return false;
  }
  if (config.mode === 'SHADOW') {
    if (
      config.monitorInstanceIds.length < 1 ||
      config.monitorInstanceIds.length > JAO5_LIMITS.maxMonitorsPerCycle
    ) {
      return false;
    }
  }
  return config.monitorInstanceIds.every(
    (id) => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(id),
  );
}

function result(
  state: ProactiveWorkerResult['state'],
  cyclesAttempted: number,
  cyclesCompleted: number,
  attentionCreated: number,
  consecutiveFailures: number,
): ProactiveWorkerResult {
  return Object.freeze({
    state,
    cyclesAttempted,
    cyclesCompleted,
    attentionCreated,
    consecutiveFailures,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
    productionMutation: false as const,
  });
}

function cycleIdentity(
  nowMs: number,
  cadenceMs: number,
): {
  readonly cycleId: string;
  readonly runId: string;
} {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError('proactive-worker-clock-invalid');
  }
  const slot = Math.floor(nowMs / cadenceMs);
  return Object.freeze({
    cycleId: 'proactive.cycle.' + String(slot),
    runId: 'proactive.run.' + String(slot),
  });
}

/**
 * Run the proactive ambient loop.
 *
 * DORMANT returns before touching the snapshot, database or model gateway.
 * SHADOW is sequential: the next cycle is not scheduled until the previous cycle has completed,
 * so overlap is structurally impossible. Every JAO cycle remains governed by JAO-5's durable
 * enrollment, cadence, budget, dedupe, quieting and terminal kill-switch rules.
 */
export async function runProactiveWorker(
  config: ProactiveWorkerConfig,
  dependencies: ProactiveWorkerDependencies,
  signal?: AbortSignal,
): Promise<ProactiveWorkerResult> {
  if (!validConfig(config)) throw new TypeError('proactive-worker-config-invalid');

  if (config.mode === 'DORMANT') {
    return result('DORMANT', 0, 0, 0, 0);
  }

  let cyclesAttempted = 0;
  let cyclesCompleted = 0;
  let attentionCreated = 0;
  let consecutiveFailures = 0;

  while (!signal?.aborted) {
    cyclesAttempted += 1;
    try {
      const identity = cycleIdentity(dependencies.clock.nowMs(), config.cadenceMs);
      const snapshot = await dependencies.readSystemHealthSnapshot(signal);
      const cycle = await runJao5AmbientCycle(
        {
          cycleId: identity.cycleId,
          runId: identity.runId,
          mode: 'SHADOW',
          monitorInstanceIds: [...config.monitorInstanceIds],
          snapshot,
        },
        {
          pool: dependencies.pool,
          gateway: dependencies.gateway,
          clock: dependencies.clock,
          ...(dependencies.telemetry === undefined ? {} : { telemetry: dependencies.telemetry }),
        },
        signal,
      );
      cyclesCompleted += 1;
      attentionCreated += cycle.attentionCreated;
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures += 1;
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        return result(
          'HALTED_FAILURE_BUDGET',
          cyclesAttempted,
          cyclesCompleted,
          attentionCreated,
          consecutiveFailures,
        );
      }
    }

    if (signal?.aborted) break;
    try {
      await dependencies.sleep(config.cadenceMs, signal);
    } catch {
      if (signal?.aborted) break;
      consecutiveFailures += 1;
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        return result(
          'HALTED_FAILURE_BUDGET',
          cyclesAttempted,
          cyclesCompleted,
          attentionCreated,
          consecutiveFailures,
        );
      }
    }
  }

  return result('STOPPED', cyclesAttempted, cyclesCompleted, attentionCreated, consecutiveFailures);
}
