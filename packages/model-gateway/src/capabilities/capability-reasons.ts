/**
 * Closed, safe vocabularies for capability matching (QFJ-P04.02, ADR-0050).
 *
 * Every registry refusal / match miss is described with these bounded codes only — never a prompt,
 * message, subject reference, secret, raw provider body, or operator PII.
 */

/** Why a capability match failed, or why a registry rejected a profile. */
export const CAPABILITY_MATCH_REASONS = [
  'registry-release-missing',
  'registry-release-duplicate',
  'registry-descriptor-mismatch',
  'registry-task-unsupported',
  'registry-result-mode-unsupported',
  'registry-structured-mode-unsupported',
  'registry-context-limit',
  'registry-timeout-unsupported',
  'registry-cancellation-unsupported',
  'registry-prompt-profile-mismatch',
  'registry-invariant',
] as const;
export type CapabilityMatchReason = (typeof CAPABILITY_MATCH_REASONS)[number];

/** One bounded, content-free capability observability event. Ids/modes/limits/reasons only. */
export interface CapabilityEvent {
  readonly type: 'capability-matched' | 'capability-rejected';
  readonly runId?: string;
  readonly releaseId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly reason?: CapabilityMatchReason;
}

/** The injected sink for capability events. */
export interface CapabilityObservabilityHook {
  record(event: CapabilityEvent): void;
}

/** A hook that records nothing — the safe default. */
export const NOOP_CAPABILITY_OBSERVABILITY: CapabilityObservabilityHook = Object.freeze({
  record(): void {
    // Intentionally does nothing.
  },
});
