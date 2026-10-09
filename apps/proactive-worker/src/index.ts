import type { DatabasePool } from '@qf-jarvis/event-backbone';
import type { ModelGateway } from '@qf-jarvis/model-gateway';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import {
  JAO5_LIMITS,
  runJao5AmbientCycle,
  type Jao5Clock,
  type Jao5TelemetryHook,
} from '@qf-jarvis/worker/internal/jao5-ambient';

import {
  runAosSupervisorShadowCycle,
  type AosSupervisorCycleInput,
  type AosSupervisorGovernanceExtensions,
} from './aos-supervisor-cycle.js';
import type { AosOwnerAttentionObservationWriter } from './aos-owner-attention-observation.js';
import type { AosShadowPersistencePort } from './aos-shadow-cycle.js';

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
  /** Explicit opt-in for the new AOS v2 supervisor. It remains SHADOW-only. */
  readonly aosV2ShadowEnabled?: boolean;
}

export type AosSupervisorSourceSnapshot = Omit<AosSupervisorCycleInput, 'cycleId' | 'generatedAt'>;

export interface ProactiveWorkerDependencies {
  readonly pool: DatabasePool;
  readonly gateway: ModelGateway;
  readonly clock: Jao5Clock;
  readonly readSystemHealthSnapshot: (signal?: AbortSignal) => Promise<unknown>;
  readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly telemetry?: Jao5TelemetryHook;
  readonly readAosSupervisorSnapshot?: (
    input: { readonly cycleId: string; readonly generatedAt: string },
    signal?: AbortSignal,
  ) => Promise<AosSupervisorSourceSnapshot>;
  readonly aosReasoner?: AosModelReasoner;
  readonly aosPersistence?: AosShadowPersistencePort;
  readonly aosGovernance?: AosSupervisorGovernanceExtensions;
  readonly aosOwnerAttentionObservation?: AosOwnerAttentionObservationWriter;
}

export interface ProactiveWorkerResult {
  readonly state: 'DORMANT' | 'STOPPED' | 'HALTED_FAILURE_BUDGET';
  readonly cyclesAttempted: number;
  readonly cyclesCompleted: number;
  readonly attentionCreated: number;
  readonly aosCyclesCompleted: number;
  readonly aosCasesObserved: number;
  readonly aosRecommendationsCreated: number;
  readonly aosAdjudicationHolds: number;
  readonly aosCanonicalRecommendations: number;
  readonly aosCanonicalProjectionFailures: number;
  readonly aosModelCalls: number;
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
  aos: Readonly<{
    cyclesCompleted: number;
    casesObserved: number;
    recommendationsCreated: number;
    adjudicationHolds: number;
    canonicalRecommendations: number;
    canonicalProjectionFailures: number;
    modelCalls: number;
  }> = Object.freeze({
    cyclesCompleted: 0,
    casesObserved: 0,
    recommendationsCreated: 0,
    adjudicationHolds: 0,
    canonicalRecommendations: 0,
    canonicalProjectionFailures: 0,
    modelCalls: 0,
  }),
): ProactiveWorkerResult {
  return Object.freeze({
    state,
    cyclesAttempted,
    cyclesCompleted,
    attentionCreated,
    aosCyclesCompleted: aos.cyclesCompleted,
    aosCasesObserved: aos.casesObserved,
    aosRecommendationsCreated: aos.recommendationsCreated,
    aosAdjudicationHolds: aos.adjudicationHolds,
    aosCanonicalRecommendations: aos.canonicalRecommendations,
    aosCanonicalProjectionFailures: aos.canonicalProjectionFailures,
    aosModelCalls: aos.modelCalls,
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
  if (config.aosV2ShadowEnabled === true && dependencies.readAosSupervisorSnapshot === undefined) {
    throw new TypeError('proactive-worker-aos-source-required');
  }

  let cyclesAttempted = 0;
  let cyclesCompleted = 0;
  let attentionCreated = 0;
  let consecutiveFailures = 0;
  const aos = {
    cyclesCompleted: 0,
    casesObserved: 0,
    recommendationsCreated: 0,
    adjudicationHolds: 0,
    canonicalRecommendations: 0,
    canonicalProjectionFailures: 0,
    modelCalls: 0,
  };

  while (!signal?.aborted) {
    cyclesAttempted += 1;
    try {
      const nowMs = dependencies.clock.nowMs();
      const identity = cycleIdentity(nowMs, config.cadenceMs);
      const generatedAt = new Date(nowMs).toISOString();
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
      if (config.aosV2ShadowEnabled === true) {
        const readAosSupervisorSnapshot = dependencies.readAosSupervisorSnapshot;
        if (readAosSupervisorSnapshot === undefined) {
          throw new TypeError('proactive-worker-aos-source-required');
        }
        const aosCycleId = 'aos.' + identity.cycleId;
        const aosSnapshot = await readAosSupervisorSnapshot(
          { cycleId: aosCycleId, generatedAt },
          signal,
        );
        const aosCycle = await runAosSupervisorShadowCycle(
          {
            ...aosSnapshot,
            cycleId: aosCycleId,
            generatedAt,
          },
          dependencies.aosReasoner,
          dependencies.aosPersistence,
          dependencies.aosGovernance,
        );
        aos.cyclesCompleted += 1;
        aos.casesObserved += aosCycle.cases.length;
        aos.recommendationsCreated += aosCycle.recommendations.length;
        aos.adjudicationHolds += aosCycle.adjudicationHolds;
        aos.canonicalRecommendations += aosCycle.canonicalRecommendations.length;
        aos.canonicalProjectionFailures += aosCycle.canonicalProjectionFailures;
        aos.modelCalls += aosCycle.modelCalls;
        if (dependencies.aosOwnerAttentionObservation !== undefined) {
          await dependencies.aosOwnerAttentionObservation.write(aosCycle, generatedAt);
        }
      }
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
          aos,
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
          aos,
        );
      }
    }
  }

  return result(
    'STOPPED',
    cyclesAttempted,
    cyclesCompleted,
    attentionCreated,
    consecutiveFailures,
    aos,
  );
}

export { runAosShadowCycle } from './aos-shadow-cycle.js';
export type {
  AosShadowBehaviourMaterial,
  AosShadowCaseMaterial,
  AosShadowCaseReason,
  AosShadowCaseResult,
  AosShadowCycleInput,
  AosShadowCycleResult,
  AosShadowRoutingEvidence,
  AosShadowPersistencePort,
} from './aos-shadow-cycle.js';

export { runAosCanonicalEventShadowCycle } from './aos-canonical-cycle.js';
export type {
  AosCanonicalEventCycleInput,
  AosCanonicalEventCycleResult,
} from './aos-canonical-cycle.js';

export { runAosClientJourneyShadowCycle } from './aos-client-journey-cycle.js';
export type {
  AosClientJourneyShadowCycleInput,
  AosClientJourneyShadowCycleResult,
} from './aos-client-journey-cycle.js';

export { runAosClientIntelligenceShadowCycle } from './aos-client-intelligence-cycle.js';
export type {
  AosClientIntelligenceShadowCycleInput,
  AosClientIntelligenceShadowCycleResult,
} from './aos-client-intelligence-cycle.js';

export { runAosMarketplaceShadowCycle } from './aos-marketplace-cycle.js';
export type {
  AosMarketplaceShadowCycleInput,
  AosMarketplaceShadowCycleResult,
} from './aos-marketplace-cycle.js';

export { runAosLeadDeliveryShadowCycle } from './aos-lead-delivery-cycle.js';
export type {
  AosLeadDeliveryShadowCycleInput,
  AosLeadDeliveryShadowCycleResult,
} from './aos-lead-delivery-cycle.js';

export { runAosVendorSuccessShadowCycle } from './aos-vendor-success-cycle.js';
export type {
  AosVendorSuccessShadowCycleInput,
  AosVendorSuccessShadowCycleResult,
} from './aos-vendor-success-cycle.js';

export {
  buildAosOwnerAttentionObservation,
  createFileAosOwnerAttentionObservationWriter,
} from './aos-owner-attention-observation.js';
export type { AosOwnerAttentionObservationWriter } from './aos-owner-attention-observation.js';

export {
  buildAosMarketCapacityObservation,
  createFileAosMarketCapacityObservationWriter,
} from './aos-market-capacity-observation.js';
export type {
  AosMarketCapacityObservation,
  AosMarketCapacityObservationWriter,
  AosMarketCapacitySourceCoverage,
} from './aos-market-capacity-observation.js';

export { runAosSupervisorShadowCycle } from './aos-supervisor-cycle.js';
export type {
  AosSupervisorAiBudget,
  AosSupervisorClientInput,
  AosSupervisorCycleInput,
  AosSupervisorCycleResult,
} from './aos-supervisor-cycle.js';
