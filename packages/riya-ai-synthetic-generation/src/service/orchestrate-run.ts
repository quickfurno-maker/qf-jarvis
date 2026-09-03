/**
 * The bounded offline run orchestrator (AS2, ADR-0143 §24).
 *
 * ### This is what makes the concurrency policy real
 *
 * Before this existed, `maxConcurrentCandidates` and `maxConcurrentInvocations` were fields nothing
 * enforced: a caller could `Promise.all` fifty candidates and exceed both while the report claimed
 * bounded concurrency. A policy field describing a guarantee the implementation does not make is
 * worse than no field, because it is quoted in evidence.
 *
 * Two limits, one implementation each:
 *
 * - **candidates** — a worker pool whose SIZE is the limit. Bounded by construction, so there is no
 *   counter to get wrong.
 * - **invocations** — one shared gate, injected into every candidate, so the ceiling holds ACROSS
 *   candidates. Five candidates each running two calls is ten concurrent calls, which a per-candidate
 *   limiter would allow and this does not.
 *
 * ### It is not AS3
 *
 * It takes an EXPLICIT finite list of scenarios and allocations. There is no "generate the corpus"
 * entry point, nothing writes a file, and the result lives in memory. AS3 decides what to spend; this
 * is the mechanism it will drive.
 *
 * ### Order is by input, never by completion
 *
 * Candidates finish out of order under concurrency. Results are placed back at their input index, so
 * a run is reproducible evidence rather than a race report.
 */
import type { RiyaDatasetQualityDimension } from '@qf-jarvis/riya-intelligence-dataset';
import type { RiyaAiSyntheticScenarioV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';

import { RiyaSyntheticGenerationError } from '../contracts/errors.js';
import type { RiyaSyntheticGenerationErrorCode } from '../contracts/errors.js';
import type { RiyaSyntheticConfigInventoryV1 } from '../contracts/model-config.js';
import type { RiyaSyntheticGenerationPolicyV1 } from '../contracts/policy.js';
import type { RiyaSyntheticRoleAllocationV1 } from '../contracts/role-allocation.js';
import { createRiyaSyntheticConcurrencyGate } from '../internal/concurrency.js';
import { generateRiyaSyntheticCandidate } from './generate-candidate.js';
import type {
  RiyaSyntheticCandidateV1,
  RiyaSyntheticInvokerRegistry,
} from './generate-candidate.js';

/** One scenario paired with the role allocation that will generate it. */
export interface RiyaSyntheticRunItem {
  readonly scenario: RiyaAiSyntheticScenarioV1;
  readonly allocation: RiyaSyntheticRoleAllocationV1;
}

export interface OrchestrateRiyaSyntheticRunOptions {
  readonly items: readonly RiyaSyntheticRunItem[];
  readonly inventory: RiyaSyntheticConfigInventoryV1;
  readonly policy: RiyaSyntheticGenerationPolicyV1;
  readonly invokers: RiyaSyntheticInvokerRegistry;
  readonly criticQualityDimensions: readonly RiyaDatasetQualityDimension[];
  readonly signal?: AbortSignal;
}

export interface RiyaSyntheticRunOutcomeV1 {
  readonly scenarioRef: string;
  readonly status: 'GENERATED' | 'FAILED' | 'NOT_STARTED';
  readonly candidate?: RiyaSyntheticCandidateV1;
  /** A closed code. Never a provider message. */
  readonly errorCode?: RiyaSyntheticGenerationErrorCode;
}

export interface RiyaSyntheticRunResultV1 {
  /** In INPUT order, whatever order they completed in. */
  readonly outcomes: readonly RiyaSyntheticRunOutcomeV1[];
  readonly peakConcurrentCandidates: number;
  readonly peakConcurrentInvocations: number;
}

/**
 * Run an explicit set of candidates under the policy's concurrency limits.
 *
 * Never throws for a candidate failure — a rejected or timed-out candidate is an OUTCOME, recorded
 * with its code. Throwing would make one bad candidate abandon a whole run, which is exactly the
 * pressure that leads somebody to retry until things pass.
 */
export async function orchestrateRiyaSyntheticRun(
  options: OrchestrateRiyaSyntheticRunOptions,
): Promise<RiyaSyntheticRunResultV1> {
  const { items, policy, signal } = options;

  const invocationGateHandle = createRiyaSyntheticConcurrencyGate(policy.maxConcurrentInvocations);
  const candidateGateHandle = createRiyaSyntheticConcurrencyGate(policy.maxConcurrentCandidates);

  const outcomes: RiyaSyntheticRunOutcomeV1[] = items.map((item) => ({
    scenarioRef: item.scenario.scenarioRef,
    status: 'NOT_STARTED' as const,
  }));

  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      // An aborted run stops SCHEDULING immediately. In-flight candidates receive the same signal
      // and unwind on their own; nothing new is started.
      if (signal?.aborted === true) return;

      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      const item = items[index];
      /* c8 ignore next 3 -- index is bounded by the length check above */
      if (item === undefined) return;

      // Held for the whole candidate, so the peak reflects candidates in flight rather than workers
      // that happen to exist.
      const lease = await candidateGateHandle.acquire();
      try {
        const candidate = await generateRiyaSyntheticCandidate({
          scenario: item.scenario,
          allocation: item.allocation,
          inventory: options.inventory,
          policy,
          invokers: options.invokers,
          criticQualityDimensions: options.criticQualityDimensions,
          // THE shared limiter. This is what makes the invocation ceiling hold across candidates.
          invocationGate: invocationGateHandle.acquire,
          ...(signal === undefined ? {} : { signal }),
        });
        outcomes[index] = {
          scenarioRef: item.scenario.scenarioRef,
          status: 'GENERATED',
          candidate,
        };
      } catch (error) {
        outcomes[index] = {
          scenarioRef: item.scenario.scenarioRef,
          status: 'FAILED',
          ...(error instanceof RiyaSyntheticGenerationError ? { errorCode: error.code } : {}),
        };
      } finally {
        lease.release();
      }
    }
  };

  // Bounded by construction: exactly `maxConcurrentCandidates` workers, never one per item.
  const workerCount = Math.max(1, Math.min(policy.maxConcurrentCandidates, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return Object.freeze({
    outcomes: Object.freeze([...outcomes]),
    peakConcurrentCandidates: candidateGateHandle.peak(),
    peakConcurrentInvocations: invocationGateHandle.peak(),
  });
}
