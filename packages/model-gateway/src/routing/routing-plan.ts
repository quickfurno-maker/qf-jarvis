/**
 * The immutable routing plan (QFJ-P04.01D, ADR-0048).
 *
 * Pure and deterministic: given the request, the injected provider roster, the health map, the circuit
 * state, and the policy, it selects exactly one primary and — when the policy permits and a distinct
 * eligible provider exists — exactly one fallback, ordered by the profile's execution-class preference and
 * then the configured provider order within a class. Privacy is enforced first: a `LOCAL_ONLY` request can
 * only reach a LOCAL provider and a hosted provider never appears, even as a fallback. The plan exposes a
 * FROZEN, content-free summary (ids/classes/reason codes only); the provider references stay internal.
 */
import { capabilitiesSatisfy } from '../contracts/capabilities.js';
import type { ModelDataClass, ProviderExecutionClass } from '../contracts/enums.js';
import type { ModelProvider } from '../contracts/provider.js';
import type { ModelRequest } from '../contracts/request.js';
import type { ModelGatewayErrorCode } from '../errors/gateway-error.js';
import { policyOrderFor, type HybridRoutingPolicy } from './hybrid-routing-policy.js';
import type { RoutingExclusionReason, RoutingProfile } from './routing-reasons.js';

/** One excluded provider and the safe reason it was excluded. */
export interface RoutingExclusion {
  readonly providerId: string;
  readonly executionClass: ProviderExecutionClass;
  readonly reason: RoutingExclusionReason;
}

/** The frozen, content-free summary of a routing plan (or a failed selection). */
export interface RoutingPlanSummary {
  readonly profile: RoutingProfile;
  readonly dataClass: ModelDataClass;
  readonly eligibleExecutionClasses: readonly ProviderExecutionClass[];
  readonly primaryProviderId: string | undefined;
  readonly primaryExecutionClass: ProviderExecutionClass | undefined;
  readonly fallbackProviderId: string | undefined;
  readonly fallbackExecutionClass: ProviderExecutionClass | undefined;
  readonly exclusions: readonly RoutingExclusion[];
}

interface Eligible {
  readonly provider: ModelProvider;
  readonly executionClass: ProviderExecutionClass;
}

/** The immutable plan. `primary`/`fallback` are internal references; `summary` is the safe surface. */
export interface RoutingPlan {
  readonly primary: ModelProvider;
  readonly primaryExecutionClass: ProviderExecutionClass;
  readonly fallback: ModelProvider | undefined;
  readonly fallbackExecutionClass: ProviderExecutionClass | undefined;
  readonly summary: RoutingPlanSummary;
}

export type RoutingPlanResult =
  | { readonly ok: true; readonly plan: RoutingPlan }
  | {
      readonly ok: false;
      readonly code: ModelGatewayErrorCode;
      readonly summary: RoutingPlanSummary;
    };

function allowedClasses(dataClass: ModelDataClass): readonly ProviderExecutionClass[] {
  return dataClass === 'LOCAL_ONLY' ? (['LOCAL'] as const) : (['HOSTED', 'LOCAL'] as const);
}

/**
 * Build a routing plan or a bounded failure code. Deterministic and fail-closed. `HUMAN_ONLY` must be
 * rejected by the caller before this is invoked (it returns `internal-invariant` defensively). Selection
 * order: data class → policy membership → capability → circuit → health, then profile execution-class
 * preference, then the configured provider order within a class.
 */
export function buildRoutingPlan(
  request: ModelRequest,
  roster: readonly ModelProvider[],
  healthy: ReadonlyMap<string, boolean>,
  circuitOpen: (providerId: string) => boolean,
  policy: HybridRoutingPolicy,
): RoutingPlanResult {
  const dataClass = request.dataClass;
  const classes = allowedClasses(dataClass);
  const exclusions: RoutingExclusion[] = [];

  const summaryOf = (
    primary: Eligible | undefined,
    fallback: Eligible | undefined,
  ): RoutingPlanSummary =>
    Object.freeze({
      profile: policy.profile,
      dataClass,
      eligibleExecutionClasses: classes,
      primaryProviderId: primary?.provider.descriptor.providerId,
      primaryExecutionClass: primary?.executionClass,
      fallbackProviderId: fallback?.provider.descriptor.providerId,
      fallbackExecutionClass: fallback?.executionClass,
      exclusions: Object.freeze([...exclusions]),
    });

  if (dataClass === 'HUMAN_ONLY') {
    return { ok: false, code: 'internal-invariant', summary: summaryOf(undefined, undefined) };
  }

  // A LOCAL_ONLY request with no LOCAL provider at all is a distinct, explicit failure.
  if (dataClass === 'LOCAL_ONLY') {
    const anyLocal = roster.some((p) => p.descriptor.executionClass === 'LOCAL');
    if (!anyLocal) {
      return {
        ok: false,
        code: 'local-provider-required',
        summary: summaryOf(undefined, undefined),
      };
    }
  }

  let executionEligibleCount = 0;
  let capableCount = 0;
  const eligible: Eligible[] = [];

  for (const provider of roster) {
    const id = provider.descriptor.providerId;
    const ec = provider.descriptor.executionClass;
    if (!classes.includes(ec)) {
      exclusions.push({ providerId: id, executionClass: ec, reason: 'data-class-mismatch' });
      continue;
    }
    if (!policyOrderFor(policy, ec).includes(id)) {
      exclusions.push({ providerId: id, executionClass: ec, reason: 'not-in-policy' });
      continue;
    }
    executionEligibleCount += 1;
    if (!capabilitiesSatisfy(provider.capabilities(), request.requiredCapabilities)) {
      exclusions.push({ providerId: id, executionClass: ec, reason: 'capability-mismatch' });
      continue;
    }
    capableCount += 1;
    if (circuitOpen(id)) {
      exclusions.push({ providerId: id, executionClass: ec, reason: 'circuit-open' });
      continue;
    }
    if (healthy.get(id) !== true) {
      exclusions.push({ providerId: id, executionClass: ec, reason: 'unhealthy' });
      continue;
    }
    eligible.push({ provider, executionClass: ec });
  }

  if (eligible.length === 0) {
    const code: ModelGatewayErrorCode =
      executionEligibleCount === 0
        ? 'no-eligible-provider'
        : capableCount === 0
          ? 'capability-mismatch'
          : 'no-eligible-provider';
    return { ok: false, code, summary: summaryOf(undefined, undefined) };
  }

  // Order by the profile's execution-class preference, then the configured provider order within a class.
  const classRank = new Map<ProviderExecutionClass, number>(
    policy.executionClassOrder.map((c, i) => [c, i]),
  );
  const ranked = [...eligible].sort((a, b) => {
    const ca = classRank.get(a.executionClass) ?? Number.MAX_SAFE_INTEGER;
    const cb = classRank.get(b.executionClass) ?? Number.MAX_SAFE_INTEGER;
    if (ca !== cb) {
      return ca - cb;
    }
    const orderA = policyOrderFor(policy, a.executionClass);
    const orderB = policyOrderFor(policy, b.executionClass);
    return (
      orderA.indexOf(a.provider.descriptor.providerId) -
      orderB.indexOf(b.provider.descriptor.providerId)
    );
  });

  const primary = ranked[0];
  if (primary === undefined) {
    return { ok: false, code: 'internal-invariant', summary: summaryOf(undefined, undefined) };
  }
  const fallback = policy.fallbackEnabled ? ranked[1] : undefined;

  return {
    ok: true,
    plan: {
      primary: primary.provider,
      primaryExecutionClass: primary.executionClass,
      fallback: fallback?.provider,
      fallbackExecutionClass: fallback?.executionClass,
      summary: summaryOf(primary, fallback),
    },
  };
}
