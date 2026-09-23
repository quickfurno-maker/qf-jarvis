import type { WorkerSloObservationInput } from './slo.js';

export interface ScaleReadinessPolicyInput {
  readonly policyRef: string;
  readonly minObservationCount: number;
  readonly minPressureFraction: number;
  readonly minPendingTurns: number;
  readonly minOldestPendingAgeMs: number;
}

export type ScaleReadinessPolicy = ScaleReadinessPolicyInput;

export type ScaleReadinessDecision =
  'INSUFFICIENT_DATA' | 'KEEP_SINGLE_OWNER' | 'ELIGIBLE_FOR_SHARED_QUEUE_DESIGN';

export interface ScaleReadinessEvaluation {
  readonly policyRef: string;
  readonly decision: ScaleReadinessDecision;
  readonly observationCount: number;
  readonly pressureObservationCount: number;
  readonly pressureFraction: number;
}

function validRef(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

export function createScaleReadinessPolicy(input: ScaleReadinessPolicyInput): ScaleReadinessPolicy {
  if (
    !validRef(input.policyRef) ||
    !Number.isInteger(input.minObservationCount) ||
    input.minObservationCount < 1 ||
    input.minObservationCount > 100_000 ||
    !Number.isFinite(input.minPressureFraction) ||
    input.minPressureFraction < 0 ||
    input.minPressureFraction > 1 ||
    !Number.isInteger(input.minPendingTurns) ||
    input.minPendingTurns < 1 ||
    input.minPendingTurns > 1_000_000 ||
    !Number.isInteger(input.minOldestPendingAgeMs) ||
    input.minOldestPendingAgeMs < 1 ||
    input.minOldestPendingAgeMs > 86_400_000
  ) {
    throw new TypeError('scale-readiness-policy-invalid');
  }
  return Object.freeze({ ...input });
}

/**
 * Decide whether measured queue pressure is sustained enough to justify DESIGNING the shared-queue
 * phase. This function never scales a worker, chooses a queue technology, or changes deployment mode.
 * The strongest result is only eligibility for a separately reviewed architecture/release decision.
 */
export function evaluateScaleReadiness(
  observations: readonly WorkerSloObservationInput[],
  policy: ScaleReadinessPolicy,
): ScaleReadinessEvaluation {
  if (observations.length < policy.minObservationCount) {
    return Object.freeze({
      policyRef: policy.policyRef,
      decision: 'INSUFFICIENT_DATA' as const,
      observationCount: observations.length,
      pressureObservationCount: 0,
      pressureFraction: 0,
    });
  }

  let pressureObservationCount = 0;
  for (const observation of observations) {
    const oldest = observation.spool.oldestPendingAgeMs ?? 0;
    const pending = observation.spool.pending;
    if (pending >= policy.minPendingTurns && oldest >= policy.minOldestPendingAgeMs) {
      pressureObservationCount += 1;
    }
  }
  const pressureFraction = pressureObservationCount / observations.length;
  return Object.freeze({
    policyRef: policy.policyRef,
    decision:
      pressureFraction >= policy.minPressureFraction
        ? ('ELIGIBLE_FOR_SHARED_QUEUE_DESIGN' as const)
        : ('KEEP_SINGLE_OWNER' as const),
    observationCount: observations.length,
    pressureObservationCount,
    pressureFraction,
  });
}
