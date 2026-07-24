/**
 * The provider-operations composition surface (QFJ-P04.01E, ADR-0049).
 *
 * Re-exports ONLY the stable composition + safe observability symbols. The deterministic canary hash, the
 * serving-decision helper, the transition validator, the approval-binding helpers, and any mutable
 * internal are kept private. No provider instance, no secret, and no execution helper is exported.
 */
export { createProviderReleaseRef, type ProviderReleaseRef } from './provider-release.js';
export {
  createRolloutApprovalAttestation,
  type RolloutApprovalAttestation,
} from './rollout-approval.js';
export {
  createProviderRolloutPolicy,
  offRolloutPolicy,
  type ProviderRolloutPolicy,
  type ProviderRolloutPolicyInput,
} from './rollout-policy.js';
export {
  createProviderRolloutController,
  type ProviderRolloutController,
  type TransitionResult,
} from './rollout-controller.js';
export {
  ROLLOUT_MODES,
  ROLLOUT_SERVE_TARGETS,
  ROLLOUT_OPERATOR_REASONS,
  ROLLOUT_REFUSAL_REASONS,
  ROLLOUT_EVENT_TYPES,
  NOOP_ROLLOUT_OBSERVABILITY,
  type RolloutMode,
  type RolloutServeTarget,
  type RolloutOperatorReason,
  type RolloutRefusalReason,
  type RolloutEventType,
  type RolloutEvent,
  type RolloutObservabilityHook,
} from './rollout-reasons.js';
