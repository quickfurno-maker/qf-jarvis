/**
 * The rollout transition matrix (QFJ-P04.01E, ADR-0049).
 *
 * A pure validation of a proposed transition from the current policy to the next. It enforces: matching
 * rollout id and stable anchor; optimistic `expectedRevision`; a strictly monotonic revision; the strict
 * mode matrix (promotion OFF→SHADOW→CANARY→ACTIVE, the rollback/demotion paths, and ANY→OFF; never
 * OFF→ACTIVE or SHADOW→ACTIVE); a safe restart to SHADOW/OFF when the candidate release changes; and the
 * approval mode/canary ceilings for a candidate-bearing mode. There is no automatic promotion and no
 * self-approval; the controller consumes an already-authorized attestation.
 */
import type { GatewayMode } from '../contracts/enums.js';
import { approvalPermitsCanary, approvalPermitsMode } from './rollout-approval.js';
import type { ProviderRolloutPolicy } from './rollout-policy.js';
import { sameRelease } from './provider-release.js';
import type { RolloutRefusalReason } from './rollout-reasons.js';

/** The allowed next modes from each mode (same-mode adjustments and ANY→OFF are always permitted). */
const ALLOWED_NEXT: Readonly<Record<GatewayMode, readonly GatewayMode[]>> = Object.freeze({
  OFF: Object.freeze(['OFF', 'SHADOW'] as const),
  SHADOW: Object.freeze(['SHADOW', 'CANARY', 'OFF'] as const),
  CANARY: Object.freeze(['CANARY', 'ACTIVE', 'SHADOW', 'OFF'] as const),
  ACTIVE: Object.freeze(['ACTIVE', 'CANARY', 'SHADOW', 'FALLBACK', 'OFF'] as const),
  FALLBACK: Object.freeze(['FALLBACK', 'OFF'] as const),
});

export type TransitionCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: RolloutRefusalReason };

function candidateChanged(current: ProviderRolloutPolicy, next: ProviderRolloutPolicy): boolean {
  if (current.candidate === undefined && next.candidate === undefined) {
    return false;
  }
  if (current.candidate === undefined || next.candidate === undefined) {
    return true;
  }
  return !sameRelease(current.candidate, next.candidate);
}

/** Validate a proposed transition. Emergency disable (ANY→OFF) is handled separately by the controller. */
export function validateTransition(
  current: ProviderRolloutPolicy,
  next: ProviderRolloutPolicy,
  expectedRevision: number,
): TransitionCheck {
  if (current.rolloutId !== next.rolloutId) {
    return { ok: false, reason: 'invalid-transition' };
  }
  if (expectedRevision !== current.revision) {
    return { ok: false, reason: 'stale-revision' };
  }
  if (next.revision <= current.revision) {
    return { ok: false, reason: 'stale-revision' };
  }
  if (!sameRelease(current.stable, next.stable)) {
    // The stable anchor is fixed for a rollout id; changing it is a new rollout, not a transition.
    return { ok: false, reason: 'invalid-transition' };
  }
  if (!ALLOWED_NEXT[current.mode].includes(next.mode)) {
    return { ok: false, reason: 'invalid-transition' };
  }
  // A changed candidate requires a safe restart to OFF or SHADOW (re-shadow before any exposure).
  if (candidateChanged(current, next) && next.mode !== 'OFF' && next.mode !== 'SHADOW') {
    return { ok: false, reason: 'invalid-transition' };
  }
  // A candidate-bearing mode must be within the binding approval's ceilings.
  if (next.candidate !== undefined && next.mode !== 'OFF') {
    if (next.approval === undefined) {
      return { ok: false, reason: 'approval-missing' };
    }
    if (!approvalPermitsMode(next.approval, next.mode)) {
      return { ok: false, reason: 'approval-mode-ceiling' };
    }
    if (next.mode === 'CANARY' && !approvalPermitsCanary(next.approval, next.canaryBasisPoints)) {
      return { ok: false, reason: 'approval-canary-ceiling' };
    }
  }
  return { ok: true };
}
