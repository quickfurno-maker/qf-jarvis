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
 *
 * ### The policy is re-proved before either gate exists
 *
 * This is a PUBLIC entry point, so the policy it is handed is a runtime value rather than a type. It
 * is re-proved through its own constructor first, because the limits are read to BUILD the gates —
 * and a zero limit does not produce a small run, it produces one that waits forever for a permit
 * nothing will grant. See the note at the re-proof itself.
 */
import type { RiyaDatasetQualityDimension } from '@qf-jarvis/riya-intelligence-dataset';
import type { RiyaAiSyntheticScenarioV1 } from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';

import { RiyaSyntheticGenerationError } from '../contracts/errors.js';
import type { RiyaSyntheticGenerationErrorCode } from '../contracts/errors.js';
import type { RiyaSyntheticConfigInventoryV1 } from '../contracts/model-config.js';
import type { RiyaSyntheticGenerationPolicyV1 } from '../contracts/policy.js';
import type { RiyaSyntheticRoleAllocationV1 } from '../contracts/role-allocation.js';
import { createRiyaSyntheticConcurrencyGate } from '../internal/concurrency.js';
import { generateRiyaSyntheticCandidateWithGate, reprovedPolicy } from './generate-candidate.js';
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
  const { items, signal } = options;

  // ---- DEEP RE-PROOF OF THE POLICY, before a gate can be built ---------------------------------
  //
  // This is the PUBLIC run entry, so `options.policy` is a runtime value and not a type. A raw or
  // cast object with `maxConcurrentCandidates: 0` type-checks perfectly well, and a zero limit is
  // not merely a small one: the gate's acquire loop waits for a permit that is never granted, so the
  // run HANGS. It hangs before any candidate reaches the deep re-proof inside
  // `generateRiyaSyntheticCandidateWithGate`, which is the only place the policy used to be proved —
  // and a harness that hangs is worse than one that throws, because there is nothing to read and
  // nothing to report.
  //
  // So the policy goes back through its own constructor FIRST, and only the re-proved value is used
  // below: for both gates, for the worker count, and for every candidate handed to generation. The
  // supplied object is never read again. `reprovedPolicy` is shared with the single-candidate path
  // rather than reimplemented, so the two entry points cannot come to disagree about what a valid
  // policy is.
  const policy = reprovedPolicy(options.policy);

  // ---- PREFLIGHT ------------------------------------------------------------------------------
  //
  // Identity collisions are checked BEFORE any worker starts, not as each item is reached. A run that
  // discovers a duplicate `generationRef` on item forty has already paid for thirty-nine candidates
  // whose evidence cannot be told apart -- and the tokens are not refundable.
  const scenarioRefs = items.map((item) => item.scenario.scenarioRef);
  if (new Set(scenarioRefs).size !== scenarioRefs.length) {
    throw new RiyaSyntheticGenerationError('invalid-run-plan');
  }
  const generationRefs = items.map((item) => item.allocation.generationRef);
  if (new Set(generationRefs).size !== generationRefs.length) {
    // Two candidates under one generation identity means two trajectories claiming one provenance
    // record, and AS1 evidence that cannot say which is which.
    throw new RiyaSyntheticGenerationError('role-config-conflict');
  }

  const invocationGateHandle = createRiyaSyntheticConcurrencyGate(policy.maxConcurrentInvocations);
  const candidateGateHandle = createRiyaSyntheticConcurrencyGate(policy.maxConcurrentCandidates);

  const outcomes: RiyaSyntheticRunOutcomeV1[] = items.map((item) => ({
    scenarioRef: item.scenario.scenarioRef,
    status: 'NOT_STARTED' as const,
  }));

  let nextIndex = 0;

  // Read through a function on purpose. `aborted` is a value that CHANGES, and TypeScript narrows it
  // after the first check -- so a later `signal?.aborted === true` reads as impossible and the
  // re-check below would be eliminated as dead code. The call defeats that narrowing.
  const runAborted = (): boolean => signal?.aborted === true;

  const worker = async (): Promise<void> => {
    for (;;) {
      // An aborted run stops SCHEDULING immediately. In-flight candidates receive the same signal
      // and unwind on their own; nothing new is started.
      if (runAborted()) return;

      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      const item = items[index];
      /* c8 ignore next 3 -- index is bounded by the length check above */
      if (item === undefined) return;

      // Held for the whole candidate, so the peak reflects candidates in flight rather than workers
      // that happen to exist.
      const lease = await candidateGateHandle.acquire();

      // RE-CHECK after the await. Abort can land between the check at the top of the loop and the
      // permit being granted, and a candidate started in that window would spend tokens on a run
      // somebody has already cancelled. Leaving the outcome NOT_STARTED rather than FAILED matters
      // too: it was never attempted, and recording it as a failure would misreport the run.
      if (runAborted()) {
        lease.release();
        return;
      }

      try {
        const candidate = await generateRiyaSyntheticCandidateWithGate({
          scenario: item.scenario,
          allocation: item.allocation,
          inventory: options.inventory,
          // The RE-PROVED policy, never `options.policy`.
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
