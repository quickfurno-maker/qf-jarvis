/**
 * Closed, safe vocabularies for provider-rollout governance (QFJ-P04.01E, ADR-0049).
 *
 * Every rollout decision, refusal, transition, and observability event is described with these bounded
 * codes only — never a prompt, message, subject reference, secret, raw provider body, or operator PII.
 */
import { GATEWAY_MODES, type GatewayMode } from '../contracts/enums.js';

/** The rollout modes are the gateway's five modes, reused so the vocabulary stays single-sourced. */
export const ROLLOUT_MODES = GATEWAY_MODES;
export type RolloutMode = GatewayMode;

/** Which release serves a given run. */
export const ROLLOUT_SERVE_TARGETS = ['stable', 'candidate'] as const;
export type RolloutServeTarget = (typeof ROLLOUT_SERVE_TARGETS)[number];

/** The closed set of operator reasons for a transition (audit only; never free text). */
export const ROLLOUT_OPERATOR_REASONS = [
  'initial-enable',
  'promote',
  'rollback',
  'canary-adjust',
  'candidate-update',
  'emergency-disable',
  'hold',
] as const;
export type RolloutOperatorReason = (typeof ROLLOUT_OPERATOR_REASONS)[number];

/** Why a rollout refused to serve, or why a transition was rejected. */
export const ROLLOUT_REFUSAL_REASONS = [
  'mode-off',
  'approval-missing',
  'approval-stale',
  'approval-mode-ceiling',
  'approval-canary-ceiling',
  'approval-release-mismatch',
  'readiness-unhealthy',
  'privacy-forbidden',
  'no-serving-provider',
  'invalid-transition',
  'stale-revision',
  'candidate-required',
  'canary-out-of-range',
] as const;
export type RolloutRefusalReason = (typeof ROLLOUT_REFUSAL_REASONS)[number];

/** The closed set of safe, content-free rollout observability event types. */
export const ROLLOUT_EVENT_TYPES = [
  'rollout-transitioned',
  'rollout-refused',
  'emergency-disabled',
  'serving-release-selected',
  'canary-assigned',
  'shadow-started',
  'shadow-completed',
  'shadow-failed',
  'candidate-fallback-to-stable',
  'approval-mismatch',
  'rollout-health-refusal',
] as const;
export type RolloutEventType = (typeof ROLLOUT_EVENT_TYPES)[number];

/** One bounded, content-free rollout event. Ids/modes/reasons/counts only. */
export interface RolloutEvent {
  readonly type: RolloutEventType;
  readonly rolloutId: string;
  readonly runId?: string;
  readonly mode?: RolloutMode;
  readonly serve?: RolloutServeTarget;
  readonly releaseId?: string;
  readonly providerId?: string;
  readonly reason?: RolloutRefusalReason;
  readonly operatorReason?: RolloutOperatorReason;
  readonly revision?: number;
  readonly canaryBasisPoints?: number;
  readonly canaryBucket?: number;
  readonly attempts?: number;
}

/** The injected sink for rollout events. */
export interface RolloutObservabilityHook {
  record(event: RolloutEvent): void;
}

/** A hook that records nothing — the safe default. */
export const NOOP_ROLLOUT_OBSERVABILITY: RolloutObservabilityHook = Object.freeze({
  record(): void {
    // Intentionally does nothing.
  },
});
