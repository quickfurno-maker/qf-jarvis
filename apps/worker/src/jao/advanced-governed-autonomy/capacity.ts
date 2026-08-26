/**
 * The JAO-7 deterministic capacity optimiser (ADR-0121).
 *
 * ### Why the target is COMPUTED and never supplied
 *
 * "Capacity optimisation" is the part of advanced autonomy most likely to be implemented as "let the
 * model pick a number". That would put an unreviewed integer inside a governed action, where a human
 * approving the proposal would be approving whatever the model happened to say. So the target here
 * is a pure function of CLOSED METRIC BANDS and the reviewed bounds below, and the request schema has
 * no `targetConcurrency` field at all -- there is nothing to smuggle.
 *
 * The bands are deliberately coarse. A band is something an operator can argue with; a raw metric is
 * something a reader has to trust. `queueDepthBand: 'HIGH'` states a judgement that was already made
 * somewhere observable, and this function only decides what follows from it.
 *
 * ### The bounds, and why each one exists
 *
 * - **Never below 1.** Scale-to-zero is not a smaller adjustment; it is an outage with a different
 *   name, and it is not reversible in the sense this slice means.
 * - **Never above 32.** An unbounded increase is a spend decision wearing an operations costume.
 * - **Never more than ±2 in one step.** A bounded step is what makes verification meaningful: if the
 *   observed value is wrong, the distance back is small and known.
 * - **A high error rate never buys an increase.** Errors under load usually mean the thing behind the
 *   queue is unhealthy, and adding concurrency to an unhealthy dependency is how a degradation
 *   becomes an incident.
 */
import { z } from 'zod';

/** The reviewed bounds. Literal, exported, and asserted by spec rather than merely documented. */
export const JAO7_CAPACITY_BOUNDS = Object.freeze({
  minConcurrency: 1,
  maxConcurrency: 32,
  maxAbsoluteDelta: 2,
});

/**
 * The closed observation. Bands and one integer -- no free text, no raw metric, no host, no process.
 *
 * `poolCode` is a closed enum rather than a name, so this cannot become a way to point the optimiser
 * at something real.
 */
export const jao7CapacityObservationSchema = z.strictObject({
  poolCode: z.enum(['synthetic-pool-alpha', 'synthetic-pool-beta']),
  currentConcurrency: z
    .number()
    .int()
    .min(JAO7_CAPACITY_BOUNDS.minConcurrency)
    .max(JAO7_CAPACITY_BOUNDS.maxConcurrency),
  queueDepthBand: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  errorRateBand: z.enum(['LOW', 'HIGH']),
  saturationBand: z.enum(['NORMAL', 'SATURATED']),
});

export type Jao7CapacityObservation = z.infer<typeof jao7CapacityObservationSchema>;

/** What the optimiser decided, and the closed code explaining why. */
export interface Jao7CapacityDecision {
  readonly poolCode: string;
  readonly currentConcurrency: number;
  readonly targetConcurrency: number;
  readonly adjustmentReasonCode:
    'saturated-with-low-error-rate' | 'queue-depth-sustained-high' | 'over-provisioned-idle';
  /** True when the computed target equals the current value, so nothing is worth proposing. */
  readonly noAdjustmentWarranted: boolean;
}

function clamp(value: number, current: number): number {
  const withinDelta = Math.max(
    current - JAO7_CAPACITY_BOUNDS.maxAbsoluteDelta,
    Math.min(current + JAO7_CAPACITY_BOUNDS.maxAbsoluteDelta, value),
  );
  return Math.max(
    JAO7_CAPACITY_BOUNDS.minConcurrency,
    Math.min(JAO7_CAPACITY_BOUNDS.maxConcurrency, withinDelta),
  );
}

/**
 * Decide the target. Pure, total, and deterministic for a given observation.
 *
 * The order of the rules is the policy. A high error rate is checked BEFORE any increase, so it
 * cannot be outvoted by a saturated pool -- which is exactly the case where a naive optimiser would
 * add capacity to something that is failing.
 */
export function decideJao7Capacity(observation: Jao7CapacityObservation): Jao7CapacityDecision {
  const {
    currentConcurrency: current,
    errorRateBand,
    saturationBand,
    queueDepthBand,
  } = observation;

  // A high error rate never buys an increase. It may buy a decrease, because backing off a failing
  // dependency is the conservative move and is trivially reversible.
  if (errorRateBand === 'HIGH') {
    const target = clamp(current - 1, current);
    return Object.freeze({
      poolCode: observation.poolCode,
      currentConcurrency: current,
      targetConcurrency: target,
      adjustmentReasonCode: 'over-provisioned-idle' as const,
      noAdjustmentWarranted: target === current,
    });
  }

  // Saturated with a healthy error rate: add exactly one. Not two, and not "as much as the queue
  // suggests" -- a small step whose verification is unambiguous is worth more than a fast one.
  if (saturationBand === 'SATURATED') {
    const target = clamp(current + 1, current);
    return Object.freeze({
      poolCode: observation.poolCode,
      currentConcurrency: current,
      targetConcurrency: target,
      adjustmentReasonCode: 'saturated-with-low-error-rate' as const,
      noAdjustmentWarranted: target === current,
    });
  }

  // A sustained deep queue on an unsaturated pool: still worth one step, for the same reason.
  if (queueDepthBand === 'HIGH' || queueDepthBand === 'CRITICAL') {
    const target = clamp(current + 1, current);
    return Object.freeze({
      poolCode: observation.poolCode,
      currentConcurrency: current,
      targetConcurrency: target,
      adjustmentReasonCode: 'queue-depth-sustained-high' as const,
      noAdjustmentWarranted: target === current,
    });
  }

  // Idle and healthy: give one back. `saturationBand` is already NORMAL here -- the SATURATED branch
  // above returned -- so restating it would be a comparison that can only be true.
  if (queueDepthBand === 'LOW') {
    const target = clamp(current - 1, current);
    return Object.freeze({
      poolCode: observation.poolCode,
      currentConcurrency: current,
      targetConcurrency: target,
      adjustmentReasonCode: 'over-provisioned-idle' as const,
      noAdjustmentWarranted: target === current,
    });
  }

  return Object.freeze({
    poolCode: observation.poolCode,
    currentConcurrency: current,
    targetConcurrency: current,
    adjustmentReasonCode: 'over-provisioned-idle' as const,
    noAdjustmentWarranted: true,
  });
}
