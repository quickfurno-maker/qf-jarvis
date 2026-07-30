/**
 * The closed one-shot SHADOW result contract (QFJ-S2-E-B, ADR-0065 §10, §11).
 *
 * Exactly one line of JSON, exactly these fields. Identifiers, enums, counters and durations only —
 * never a credential, a path, a digest, a reference, a prompt, or any model output.
 *
 * Reasons are deliberately COARSER than the gateway's internal codes. An operator acts the same way on
 * "file missing" and "file unreadable", and separating them would leak which one it was; a finer CLI
 * vocabulary would be information disclosure disguised as helpfulness.
 */

/** The closed set of one-shot outcomes an operator may see. */
const SHADOW_REASONS = [
  /** Stable served and the candidate shadow completed. The only PASS reason. */
  'shadow-completed',
  /** The run configuration, evidence file, or a supplied digest failed validation. */
  'config-invalid',
  /** Evidence is missing, malformed, or does not authorise SHADOW for this release. */
  'evidence-refused',
  /** The credential could not be read or was not acceptable. Folds not-found/unreadable/invalid. */
  'credential-unavailable',
  /** The rollout policy refused to serve, or the transition was rejected. */
  'policy-refused',
  /** A provider reported itself unavailable, or failed. */
  'provider-unavailable',
  /** A provider refused because a rate or quota limit was reached. */
  'rate-limited',
  /** The per-attempt timeout or the hard process deadline elapsed. */
  'timeout',
  /** The run was cancelled. */
  'cancelled',
  /** Provider output was malformed or failed the strict schema. */
  'provider-output-invalid',
  /** A hard counter would have been exceeded; the run refused before delegating. */
  'call-budget-exceeded',
  /** The policy could not be proven to be OFF at the end of the run. */
  'final-off-not-proven',
  /** An invariant was violated. */
  'internal-invariant',
] as const;

/** One closed one-shot reason. */
export type ShadowReason = (typeof SHADOW_REASONS)[number];

/** The closed reason vocabulary, frozen. */
export const SHADOW_REASONS_FROZEN: readonly ShadowReason[] = Object.freeze([...SHADOW_REASONS]);

/**
 * The single emitted result line.
 *
 * Every field is a fixed token, an identifier the operator already supplied, a boolean, or a number.
 * `modelOutput` is a constant: there is nothing else it could truthfully say.
 */
export interface ShadowRunResult {
  readonly timestamp: string;
  readonly outcome: 'PASS' | 'FAIL';
  readonly reason: ShadowReason;
  readonly mode: 'SHADOW';
  readonly finalMode: 'OFF' | 'UNKNOWN';
  readonly policyRevision: number;
  readonly finalPolicyRevision: number;
  readonly stableProviderId: string;
  readonly stableReleaseId: string;
  readonly candidateProviderId: string;
  readonly candidateReleaseId: string;
  readonly credentialBackend: 'file';
  readonly credentialResolveAttempts: number;
  readonly credentialResolveSuccesses: number;
  readonly credentialReads: number;
  readonly providerConstructions: number;
  readonly healthChecks: number;
  readonly stableInvocations: number;
  readonly candidateInvocations: number;
  readonly transportRequests: number;
  readonly stableLatencyMs: number;
  readonly candidateLatencyMs: number;
  readonly totalElapsedMs: number;
  readonly stableInputTokens: number;
  readonly stableOutputTokens: number;
  readonly candidateInputTokens: number;
  readonly candidateOutputTokens: number;
  readonly timeouts: number;
  readonly cancellations: number;
  readonly retries: 0;
  readonly fallbacks: 0;
  readonly refreshes: 0;
  readonly transitions: number;
  readonly timersArmed: number;
  readonly timersCleared: number;
  readonly modelOutput: 'DISCARDED';
  readonly authority: 'QUICKFURNO_CORE';
}

/**
 * The exact allowed key set, in emission order.
 *
 * Declared once so a spec can assert the emitted object has EXACTLY these keys — a new field cannot be
 * added by accident, and a forbidden one cannot be added at all without failing that spec.
 */
export const SHADOW_RESULT_KEYS: readonly (keyof ShadowRunResult)[] = Object.freeze([
  'timestamp',
  'outcome',
  'reason',
  'mode',
  'finalMode',
  'policyRevision',
  'finalPolicyRevision',
  'stableProviderId',
  'stableReleaseId',
  'candidateProviderId',
  'candidateReleaseId',
  'credentialBackend',
  'credentialResolveAttempts',
  'credentialResolveSuccesses',
  'credentialReads',
  'providerConstructions',
  'healthChecks',
  'stableInvocations',
  'candidateInvocations',
  'transportRequests',
  'stableLatencyMs',
  'candidateLatencyMs',
  'totalElapsedMs',
  'stableInputTokens',
  'stableOutputTokens',
  'candidateInputTokens',
  'candidateOutputTokens',
  'timeouts',
  'cancellations',
  'retries',
  'fallbacks',
  'refreshes',
  'transitions',
  'timersArmed',
  'timersCleared',
  'modelOutput',
  'authority',
]);

/** Serialise the result as ONE line. Key order is the declared order, so output is byte-stable. */
export function formatShadowRunResult(result: ShadowRunResult): string {
  const ordered: Record<string, unknown> = {};
  for (const key of SHADOW_RESULT_KEYS) {
    ordered[key] = result[key];
  }
  return JSON.stringify(ordered);
}
