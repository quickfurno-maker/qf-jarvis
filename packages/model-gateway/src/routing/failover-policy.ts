/**
 * The bounded failover decision (QFJ-P04.01D, ADR-0048).
 *
 * A pure function: given the primary's NORMALIZED failure (code + retryable, never a raw body), the
 * policy, the plan's fallback eligibility, the data class, cancellation, and the remaining budget, it
 * returns a single ALLOW/DENY decision with a safe reason code. It never inspects a raw provider body and
 * never infers retryability from message text. Fallback is allowed ONLY for a bounded transient category
 * (or a circuit-open primary); every terminal category — cancellation, privacy, budget, auth/config,
 * malformed, structured-invalid, non-retryable — denies.
 */
import type { ProviderExecutionClass, ModelDataClass } from '../contracts/enums.js';
import type { ModelGatewayErrorCode } from '../errors/gateway-error.js';
import type { HybridRoutingPolicy } from './hybrid-routing-policy.js';
import type { FallbackDecisionReason } from './routing-reasons.js';

/** The inputs to the failover decision. All fields are already normalized/bounded — no raw provider data. */
export interface FailoverDecisionInput {
  readonly cancelled: boolean;
  readonly hasEligibleFallback: boolean;
  readonly fallbackExecutionClass: ProviderExecutionClass | undefined;
  readonly dataClass: ModelDataClass;
  /** The primary's terminal failure code (normalized). */
  readonly primaryCode: ModelGatewayErrorCode;
  /** Whether the primary was actually invoked (false only for a pre-invocation circuit-open). */
  readonly primaryInvoked: boolean;
  /** The primary failure's normalized retryability. */
  readonly primaryRetryable: boolean;
  /** Remaining provider invocations in the run's attempt ledger. */
  readonly attemptsRemaining: number;
}

export interface FailoverDecision {
  readonly allow: boolean;
  readonly reason: FallbackDecisionReason;
}

/** Decide whether to attempt the single fallback provider. Deterministic; fail closed. */
export function decideFallover(
  input: FailoverDecisionInput,
  policy: HybridRoutingPolicy,
): FailoverDecision {
  if (input.cancelled) {
    return { allow: false, reason: 'cancelled' };
  }
  if (!policy.fallbackEnabled) {
    return { allow: false, reason: 'fallback-disabled' };
  }
  if (!input.hasEligibleFallback) {
    return { allow: false, reason: 'no-eligible-fallback' };
  }
  if (input.attemptsRemaining <= 0) {
    return { allow: false, reason: 'budget-exhausted' };
  }
  // Defense in depth: a LOCAL_ONLY request must never fall back to a hosted provider (the plan already
  // guarantees this, but the gate re-checks the data class against the fallback's execution class).
  if (
    input.dataClass === 'LOCAL_ONLY' &&
    input.fallbackExecutionClass !== undefined &&
    input.fallbackExecutionClass !== 'LOCAL'
  ) {
    return { allow: false, reason: 'data-class-forbids-fallback' };
  }

  // A circuit-open primary was never invoked — a transient, pre-invocation condition; the fallback runs.
  if (!input.primaryInvoked && input.primaryCode === 'circuit-open') {
    return { allow: true, reason: 'primary-circuit-open' };
  }
  // Explicit terminal categories never fall over.
  if (input.primaryCode === 'malformed-provider-output') {
    return { allow: false, reason: 'primary-malformed' };
  }
  if (input.primaryCode === 'structured-output-invalid') {
    return { allow: false, reason: 'primary-structured-invalid' };
  }
  // A retryable failure in the bounded transient allowlist is the only remaining ALLOW.
  const transient = policy.transientFailureCodes as readonly string[];
  if (input.primaryRetryable && transient.includes(input.primaryCode)) {
    return { allow: true, reason: 'fallback-eligible-transient' };
  }
  return { allow: false, reason: 'primary-non-retryable' };
}
