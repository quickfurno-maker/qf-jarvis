/**
 * Closed, safe vocabularies for hybrid routing (QFJ-P04.01D, ADR-0048).
 *
 * Every routing decision is described with these bounded codes only — never a prompt, message, subject
 * reference, secret, or raw provider body. They are the safe surface a consumer or an observability sink
 * may read to explain a decision.
 */

/** The closed set of MVP routing profiles. No cost/latency/learning/random profile exists. */
export const ROUTING_PROFILES = ['HOSTED_FIRST', 'LOCAL_FIRST'] as const;
export type RoutingProfile = (typeof ROUTING_PROFILES)[number];

/** Why a provider was excluded from a routing plan. */
export const ROUTING_EXCLUSION_REASONS = [
  'data-class-mismatch',
  'not-in-policy',
  'capability-mismatch',
  'circuit-open',
  'unhealthy',
] as const;
export type RoutingExclusionReason = (typeof ROUTING_EXCLUSION_REASONS)[number];

/** The outcome of the fallback decision. The first two are ALLOW; the rest are DENY. */
export const FALLBACK_DECISION_REASONS = [
  'fallback-eligible-transient',
  'primary-circuit-open',
  'primary-accepted',
  'fallback-disabled',
  'no-eligible-fallback',
  'budget-exhausted',
  'cancelled',
  'data-class-forbids-fallback',
  'primary-non-retryable',
  'primary-malformed',
  'primary-structured-invalid',
] as const;
export type FallbackDecisionReason = (typeof FALLBACK_DECISION_REASONS)[number];

/** The two ALLOW reasons; any other reason denies the fallback. */
export const FALLBACK_ALLOW_REASONS = [
  'fallback-eligible-transient',
  'primary-circuit-open',
] as const;

/**
 * The closed allowlist of PRIMARY terminal failure codes that MAY permit a fallback attempt (a transient
 * category). A circuit-open primary is handled separately (pre-invocation). Everything else is terminal.
 */
export const FALLBACK_TRANSIENT_CODES = ['provider-unavailable', 'timeout'] as const;
export type FallbackTransientCode = (typeof FALLBACK_TRANSIENT_CODES)[number];
