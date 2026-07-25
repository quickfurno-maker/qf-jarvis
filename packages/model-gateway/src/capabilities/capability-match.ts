/**
 * The single capability-match authority (QFJ-P04.02, ADR-0050).
 *
 * Two pure checks, fail-closed:
 *   - `matchDescriptor` confirms a provider's neutral {@link ProviderCapabilities} descriptor is the exact
 *     release identity of a profile AND does not CLAIM MORE than the profile declares (the profile is the
 *     ceiling);
 *   - `matchRequirement` confirms a profile satisfies a run's technical {@link ModelCapabilityRequirement}.
 *
 * Matching decides technical capability only — never health, circuit, rollout, canary, failover, or any
 * business permission. On failure it returns a bounded {@link CapabilityMatchReason}; it never returns a
 * raw provider object and never reads a message/prompt.
 */
import type { ProviderCapabilities } from '../contracts/capabilities.js';
import type { ModelCapabilityProfile } from './capability-profile.js';
import type { ModelCapabilityRequirement } from './capability-requirement.js';
import type { CapabilityMatchReason } from './capability-reasons.js';

export type CapabilityMatch =
  { readonly ok: true } | { readonly ok: false; readonly reason: CapabilityMatchReason };

/** True iff the descriptor is the exact release identity of the profile and claims no more than it. */
export function matchDescriptor(
  profile: ModelCapabilityProfile,
  descriptor: ProviderCapabilities,
): CapabilityMatch {
  const r = profile.release;
  const identityMatches =
    descriptor.providerId === r.providerId &&
    descriptor.modelId === r.modelId &&
    descriptor.modelVersion === r.modelVersion &&
    descriptor.executionClass === r.executionClass;
  if (!identityMatches) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  // The profile is the ceiling: a descriptor must not advertise a capability the profile does not grant.
  const profileStructured = profile.structuredOutputMode !== 'unsupported';
  const profileStrict = profile.structuredOutputMode === 'strict-json-schema';
  if (descriptor.supportsStructuredOutput && !profileStructured) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  if (descriptor.supportsStrictJsonSchema && !profileStrict) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  if (descriptor.supportsStreaming && !profile.supportsStreaming) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  if (descriptor.supportsTimeout && !profile.supportsTimeout) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  if (descriptor.supportsCancellation && !profile.supportsCancellation) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  if (descriptor.maxInputTokens > profile.maxInputTokens) {
    return { ok: false, reason: 'registry-descriptor-mismatch' };
  }
  return { ok: true };
}

/** True iff the profile satisfies the requirement. Fail-closed with a bounded reason on any shortfall. */
export function matchRequirement(
  profile: ModelCapabilityProfile,
  requirement: ModelCapabilityRequirement,
): CapabilityMatch {
  if (requirement.taskClass !== undefined && !profile.taskClasses.includes(requirement.taskClass)) {
    return { ok: false, reason: 'registry-task-unsupported' };
  }
  if (!profile.resultModes.includes(requirement.resultMode)) {
    return { ok: false, reason: 'registry-result-mode-unsupported' };
  }
  if (requirement.structuredMode !== undefined) {
    if (requirement.structuredMode === 'strict-json-schema') {
      if (profile.structuredOutputMode !== 'strict-json-schema') {
        return { ok: false, reason: 'registry-structured-mode-unsupported' };
      }
    } else {
      // A best-effort json_object requirement is met by a strict-capable or json-object-capable profile.
      if (profile.structuredOutputMode === 'unsupported') {
        return { ok: false, reason: 'registry-structured-mode-unsupported' };
      }
    }
  }
  if (profile.maxInputTokens < requirement.minInputTokens) {
    return { ok: false, reason: 'registry-context-limit' };
  }
  if (
    requirement.minCompletionTokens !== undefined &&
    profile.maxCompletionTokens < requirement.minCompletionTokens
  ) {
    return { ok: false, reason: 'registry-context-limit' };
  }
  if (requirement.requiresTimeout && !profile.supportsTimeout) {
    return { ok: false, reason: 'registry-timeout-unsupported' };
  }
  if (requirement.requiresCancellation && !profile.supportsCancellation) {
    return { ok: false, reason: 'registry-cancellation-unsupported' };
  }
  if (requirement.requiresNonStreaming && !profile.supportsNonStreaming) {
    return { ok: false, reason: 'registry-invariant' };
  }
  if (
    requirement.promptProfileRef !== undefined &&
    requirement.promptProfileRef !== profile.promptProfileRef
  ) {
    return { ok: false, reason: 'registry-prompt-profile-mismatch' };
  }
  if (
    requirement.costProfileRef !== undefined &&
    requirement.costProfileRef !== profile.costProfileRef
  ) {
    return { ok: false, reason: 'registry-prompt-profile-mismatch' };
  }
  return { ok: true };
}
