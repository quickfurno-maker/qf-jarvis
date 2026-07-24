/**
 * The validated, frozen hybrid-routing policy (QFJ-P04.01D, ADR-0048).
 *
 * A policy is pure configuration: a profile, the deterministic provider order per execution class, whether
 * a bounded fallback is enabled, the transient-failure allowlist, and the maximum total attempts. It
 * embeds NO provider instance, NO model/business/agent rule, and NO secret. It selects execution class
 * first (by profile) and, within a class, the configured provider order. A `LOCAL_ONLY` request always
 * routes to a LOCAL provider regardless of profile — enforced by the plan builder, not the profile.
 */
import type { ProviderExecutionClass } from '../contracts/enums.js';
import {
  FALLBACK_TRANSIENT_CODES,
  ROUTING_PROFILES,
  type FallbackTransientCode,
  type RoutingProfile,
} from './routing-reasons.js';

const PROVIDER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_TOTAL_ATTEMPTS_CEILING = 12;

/** The execution-class preference order per profile: the primary class first, then the fallback class. */
const EXECUTION_CLASS_ORDER: Readonly<Record<RoutingProfile, readonly ProviderExecutionClass[]>> =
  Object.freeze({
    HOSTED_FIRST: Object.freeze(['HOSTED', 'LOCAL'] as const),
    LOCAL_FIRST: Object.freeze(['LOCAL', 'HOSTED'] as const),
  });

/** What a caller supplies to build a policy. Provider/model identity stays injected, never defaulted. */
export interface HybridRoutingPolicyInput {
  readonly profile: RoutingProfile;
  /** HOSTED provider IDs, in deterministic preference order. */
  readonly hostedOrder: readonly string[];
  /** LOCAL provider IDs, in deterministic preference order. */
  readonly localOrder: readonly string[];
  readonly fallbackEnabled: boolean;
  readonly maxTotalAttempts: number;
  /** Optional override of the transient allowlist; must be a subset of {@link FALLBACK_TRANSIENT_CODES}. */
  readonly transientFailureCodes?: readonly string[];
}

/** The immutable, validated routing policy. */
export interface HybridRoutingPolicy {
  readonly profile: RoutingProfile;
  readonly hostedOrder: readonly string[];
  readonly localOrder: readonly string[];
  readonly fallbackEnabled: boolean;
  readonly maxTotalAttempts: number;
  readonly transientFailureCodes: readonly FallbackTransientCode[];
  readonly executionClassOrder: readonly ProviderExecutionClass[];
}

function validateOrder(order: readonly string[], label: string): void {
  if (!Array.isArray(order)) {
    throw new Error(`A routing policy ${label} must be an array of provider ids.`);
  }
  if (order.length > 64) {
    throw new Error(`A routing policy ${label} is too long.`);
  }
  for (const id of order) {
    if (typeof id !== 'string' || !PROVIDER_ID.test(id)) {
      throw new Error(`A routing policy ${label} contains an invalid provider id.`);
    }
  }
}

/**
 * Validate and freeze a hybrid-routing policy. Rejects an unknown profile, a malformed/duplicate provider
 * id (within a list OR across the two execution-class lists), an empty primary-class list for the profile,
 * an out-of-range attempt bound, and an unknown transient code. The provider order per class is
 * deterministic. Throws a fixed-message error on any violation.
 */
export function createHybridRoutingPolicy(input: HybridRoutingPolicyInput): HybridRoutingPolicy {
  if (!(ROUTING_PROFILES as readonly string[]).includes(input.profile)) {
    throw new Error('A routing policy profile must be HOSTED_FIRST or LOCAL_FIRST.');
  }
  validateOrder(input.hostedOrder, 'hostedOrder');
  validateOrder(input.localOrder, 'localOrder');

  const hosted = [...input.hostedOrder];
  const local = [...input.localOrder];

  // No duplicate id within a list, and no id shared across the two execution-class lists.
  const seen = new Set<string>();
  for (const id of [...hosted, ...local]) {
    if (seen.has(id)) {
      throw new Error('A routing policy lists a provider id more than once (or in both classes).');
    }
    seen.add(id);
  }
  if (hosted.length === 0 && local.length === 0) {
    throw new Error('A routing policy must list at least one provider.');
  }
  // The profile's PRIMARY execution class must have at least one provider.
  const primaryClass = EXECUTION_CLASS_ORDER[input.profile][0];
  if (primaryClass === 'HOSTED' && hosted.length === 0) {
    throw new Error('A HOSTED_FIRST policy requires at least one hosted provider.');
  }
  if (primaryClass === 'LOCAL' && local.length === 0) {
    throw new Error('A LOCAL_FIRST policy requires at least one local provider.');
  }

  if (
    typeof input.maxTotalAttempts !== 'number' ||
    !Number.isInteger(input.maxTotalAttempts) ||
    input.maxTotalAttempts < 1 ||
    input.maxTotalAttempts > MAX_TOTAL_ATTEMPTS_CEILING
  ) {
    throw new Error('A routing policy maxTotalAttempts must be an integer in [1, 12].');
  }
  if (typeof input.fallbackEnabled !== 'boolean') {
    throw new Error('A routing policy fallbackEnabled must be a boolean.');
  }

  let transient: FallbackTransientCode[] = [...FALLBACK_TRANSIENT_CODES];
  if (input.transientFailureCodes !== undefined) {
    const allowed = new Set<string>(FALLBACK_TRANSIENT_CODES);
    for (const code of input.transientFailureCodes) {
      if (!allowed.has(code)) {
        throw new Error('A routing policy transient code is not in the allowlist.');
      }
    }
    transient = input.transientFailureCodes.filter((c): c is FallbackTransientCode =>
      allowed.has(c),
    );
  }

  return Object.freeze({
    profile: input.profile,
    hostedOrder: Object.freeze(hosted),
    localOrder: Object.freeze(local),
    fallbackEnabled: input.fallbackEnabled,
    maxTotalAttempts: input.maxTotalAttempts,
    transientFailureCodes: Object.freeze(transient),
    executionClassOrder: EXECUTION_CLASS_ORDER[input.profile],
  });
}

/** The configured provider order for an execution class (deterministic; empty if none configured). */
export function policyOrderFor(
  policy: HybridRoutingPolicy,
  executionClass: ProviderExecutionClass,
): readonly string[] {
  return executionClass === 'HOSTED' ? policy.hostedOrder : policy.localOrder;
}
