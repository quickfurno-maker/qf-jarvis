/**
 * The injected provider-rollout controller (QFJ-P04.01E, ADR-0049).
 *
 * A NON-global, in-memory controller that holds the current rollout policy and governs transitions. It is
 * not an authorization system — it consumes already-authorized approval attestations. `snapshot()` returns
 * the current immutable policy; `transition()` applies a validated, monotonic, optimistic-concurrency
 * transition; `emergencyDisable()` is the synchronous kill switch that jumps to a new OFF revision and
 * blocks any further serving until an explicit, non-stale re-enable. There is no environment access, no
 * persistence, no remote API, and no CLI.
 */
import { offRolloutPolicy, type ProviderRolloutPolicy } from './rollout-policy.js';
import { createProviderRolloutPolicy } from './rollout-policy.js';
import { validateTransition } from './rollout-transitions.js';
import {
  NOOP_ROLLOUT_OBSERVABILITY,
  type RolloutObservabilityHook,
  type RolloutOperatorReason,
  type RolloutRefusalReason,
} from './rollout-reasons.js';

export type TransitionResult =
  | { readonly ok: true; readonly policy: ProviderRolloutPolicy }
  | { readonly ok: false; readonly reason: RolloutRefusalReason };

export interface ProviderRolloutController {
  snapshot(): ProviderRolloutPolicy;
  transition(next: ProviderRolloutPolicy, expectedRevision: number): TransitionResult;
  emergencyDisable(
    expectedRevision: number,
    operatorReason: RolloutOperatorReason,
  ): TransitionResult;
}

/**
 * Create a rollout controller seeded with an initial policy (default OFF via {@link offRolloutPolicy}).
 * All transitions are validated by {@link validateTransition}; the emergency disable bypasses the mode
 * matrix (ANY→OFF) but still requires a matching, non-stale `expectedRevision` and a strictly higher
 * revision, so a stale caller can neither transition nor re-enable.
 */
export function createProviderRolloutController(
  initial: ProviderRolloutPolicy,
  observability: RolloutObservabilityHook = NOOP_ROLLOUT_OBSERVABILITY,
): ProviderRolloutController {
  let current = initial;

  const emit = observability.record.bind(observability);

  return {
    snapshot(): ProviderRolloutPolicy {
      return current;
    },

    transition(next: ProviderRolloutPolicy, expectedRevision: number): TransitionResult {
      const check = validateTransition(current, next, expectedRevision);
      if (!check.ok) {
        emit({
          type: 'rollout-refused',
          rolloutId: current.rolloutId,
          mode: next.mode,
          reason: check.reason,
          revision: current.revision,
        });
        return { ok: false, reason: check.reason };
      }
      current = next;
      emit({
        type: 'rollout-transitioned',
        rolloutId: current.rolloutId,
        mode: current.mode,
        operatorReason: current.operatorReason,
        revision: current.revision,
        canaryBasisPoints: current.canaryBasisPoints,
      });
      return { ok: true, policy: current };
    },

    emergencyDisable(
      expectedRevision: number,
      operatorReason: RolloutOperatorReason,
    ): TransitionResult {
      if (expectedRevision !== current.revision) {
        emit({
          type: 'rollout-refused',
          rolloutId: current.rolloutId,
          reason: 'stale-revision',
          revision: current.revision,
        });
        return { ok: false, reason: 'stale-revision' };
      }
      // Jump to a fresh OFF policy at a strictly higher revision; a stale revision cannot re-enable.
      const off = createProviderRolloutPolicy({
        rolloutId: current.rolloutId,
        revision: current.revision + 1,
        mode: 'OFF',
        stable: current.stable,
        maxServingAttempts: current.maxServingAttempts,
        operatorReason,
      });
      current = off;
      emit({
        type: 'emergency-disabled',
        rolloutId: current.rolloutId,
        mode: 'OFF',
        operatorReason,
        revision: current.revision,
      });
      return { ok: true, policy: current };
    },
  };
}

// Re-export the OFF seed helper for convenient controller construction.
export { offRolloutPolicy };
