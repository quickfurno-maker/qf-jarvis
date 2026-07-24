/**
 * The pure rollout serving decision (QFJ-P04.01E, ADR-0049).
 *
 * Given a frozen policy snapshot and a run id, it decides — deterministically and with no side effects —
 * which release serves, whether a candidate shadow runs (SHADOW), and whether a bounded candidate/stable
 * fallback is eligible (CANARY/FALLBACK). It reads NO personal/business input; the CANARY cohort comes
 * only from `rolloutId` + `runId`. The gateway applies privacy, readiness, and capability checks against
 * the chosen release and executes the decision; this module never invokes a provider.
 */
import { canaryCohort } from './canary-bucket.js';
import type { ProviderReleaseRef } from './provider-release.js';
import type { ProviderRolloutPolicy } from './rollout-policy.js';
import type { RolloutMode, RolloutRefusalReason, RolloutServeTarget } from './rollout-reasons.js';

/** The immutable serving decision. When `serve` is false, `reason` explains the pre-invocation refusal. */
export interface ServingDecision {
  readonly serve: boolean;
  readonly mode: RolloutMode;
  readonly reason?: RolloutRefusalReason;
  readonly servingTarget?: RolloutServeTarget;
  readonly servingRelease?: ProviderReleaseRef;
  readonly shadowRelease?: ProviderReleaseRef;
  readonly fallbackRelease?: ProviderReleaseRef;
  readonly fallbackTarget?: RolloutServeTarget;
  readonly canaryBasisPoints?: number;
  readonly canaryBucket?: number;
}

/** Decide the serving route for a run. Deterministic; no provider is invoked here. */
export function decideServing(policy: ProviderRolloutPolicy, runId: string): ServingDecision {
  const mode = policy.mode;
  if (mode === 'OFF') {
    return { serve: false, mode, reason: 'mode-off' };
  }
  const candidate = policy.candidate;
  if (candidate === undefined) {
    // Every non-OFF mode requires a candidate (the policy factory enforces this; defensive here).
    return { serve: false, mode, reason: 'candidate-required' };
  }
  const stable = policy.stable;

  switch (mode) {
    case 'SHADOW':
      return {
        serve: true,
        mode,
        servingTarget: 'stable',
        servingRelease: stable,
        ...(policy.shadow && policy.maxShadowAttempts > 0 ? { shadowRelease: candidate } : {}),
      };
    case 'CANARY': {
      const cohort = canaryCohort(policy.rolloutId, runId, policy.canaryBasisPoints);
      const servingRelease = cohort.serve === 'candidate' ? candidate : stable;
      const canFallback = cohort.serve === 'candidate' && policy.fallbackToStable;
      return {
        serve: true,
        mode,
        servingTarget: cohort.serve,
        servingRelease,
        ...(canFallback ? { fallbackRelease: stable, fallbackTarget: 'stable' } : {}),
        canaryBasisPoints: policy.canaryBasisPoints,
        canaryBucket: cohort.bucket,
      };
    }
    case 'ACTIVE':
      // The candidate serves all eligible traffic; stable is a rollback reference only (no auto fallback).
      return { serve: true, mode, servingTarget: 'candidate', servingRelease: candidate };
    case 'FALLBACK':
      // Stable serves primary; the candidate is eligible only as a bounded transient fallback.
      return {
        serve: true,
        mode,
        servingTarget: 'stable',
        servingRelease: stable,
        fallbackRelease: candidate,
        fallbackTarget: 'candidate',
      };
    default:
      return { serve: false, mode, reason: 'mode-off' };
  }
}
