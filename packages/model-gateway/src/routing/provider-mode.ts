/**
 * The V1 PROVIDER-SELECTION mode (JF-2A, ADR-0146).
 *
 * ### Two axes, and why collapsing them would be a bug
 *
 * `GatewayMode` (`OFF`/`SHADOW`/`CANARY`/`ACTIVE`/`FALLBACK`) is the ACTIVATION axis: whether the
 * gateway serves at all, and how far a rollout has progressed. `ProviderMode` is the SELECTION axis:
 * given that it serves, which hosted providers are eligible and in what order.
 *
 * They are independent. `NARA_ONLY` says nothing about whether inference is switched on, and `ACTIVE`
 * says nothing about which vendor answers. A single enum spanning both would make "run Nara only" and
 * "turn production on" the same decision — and JF-2B exists precisely because turning production on is
 * its own owner-authorized, evidence-gated decision. Nothing in this module can activate anything.
 *
 * ### What this module is, and what it is not
 *
 * It is a closed union and a deterministic mapping to the hosted provider order the EXISTING routing
 * policy already consumes. It builds no router, ranks nothing itself, and duplicates none of
 * `buildRoutingPlan`, `decideFallover`, the attempt ledger or the circuit breaker — all of which
 * already do this job and keep doing it unchanged.
 *
 * ### What a mode cannot do
 *
 * A mode narrows the HOSTED candidate list. It cannot widen anything else:
 *
 * - it cannot override a data class — `LOCAL_ONLY` still reaches only LOCAL providers, and the plan
 *   builder enforces that BEFORE it consults policy membership;
 * - it cannot override `HUMAN_ONLY`, the kill switch, or an `OFF` gateway;
 * - it cannot conjure a provider that is absent, unhealthy, circuit-open or capability-mismatched;
 * - it cannot enable fallback in a production composition that refuses fallback.
 *
 * Those properties are not claims made here; they hold because this module only ever produces an
 * ordered list of provider ids, and every gate above operates on the result.
 */
import {
  GROQ_CANONICAL_PROVIDER_ID,
  NARA_CANONICAL_PROVIDER_ID,
} from '../contracts/provider-identity.js';
import type { HybridRoutingPolicyInput } from './hybrid-routing-policy.js';

/**
 * The canonical hosted provider ids the V1 modes select between.
 *
 * Re-exported from the contracts layer rather than declared here, so the string this policy reasons
 * about and the string the adapter is REQUIRED to publish are the same constant. Two literals that
 * happened to agree would be a coincidence maintained by hand; one constant is an invariant.
 */
export const GROQ_PROVIDER_ID = GROQ_CANONICAL_PROVIDER_ID;
export const NARA_PROVIDER_ID = NARA_CANONICAL_PROVIDER_ID;

/** The closed provider-selection mode. Anything else is refused, never coerced. */
export const PROVIDER_MODES = ['AUTO', 'GROQ_ONLY', 'NARA_ONLY'] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export function isProviderMode(value: unknown): value is ProviderMode {
  return typeof value === 'string' && (PROVIDER_MODES as readonly string[]).includes(value);
}

/**
 * Parse a provider mode from untrusted input.
 *
 * Throws rather than defaulting. A silent fall back to `AUTO` on an unrecognised string would mean a
 * typo in an operator's configuration reads as "use both providers", which is the one outcome an
 * operator asking for `GROQ_ONLY` was trying to prevent.
 */
export function parseProviderMode(value: unknown): ProviderMode {
  if (!isProviderMode(value)) {
    throw new Error('An unknown provider mode was supplied.');
  }
  return value;
}

/**
 * The hosted provider order for a mode, in deterministic preference order.
 *
 * `AUTO` puts Groq first because Groq is the V1 primary (ADR-0145). The ORDER is the whole mechanism:
 * `buildRoutingPlan` ranks eligible providers by execution class and then by this order, taking
 * `ranked[0]` as primary and `ranked[1]` as the single bounded fallback. Nothing further is needed to
 * express "Groq first, Nara second".
 */
export function hostedOrderForProviderMode(mode: ProviderMode): readonly string[] {
  switch (mode) {
    case 'AUTO':
      return Object.freeze([GROQ_PROVIDER_ID, NARA_PROVIDER_ID]);
    case 'GROQ_ONLY':
      return Object.freeze([GROQ_PROVIDER_ID]);
    case 'NARA_ONLY':
      return Object.freeze([NARA_PROVIDER_ID]);
  }
}

/**
 * Whether a mode permits the single bounded cross-provider fallback.
 *
 * Only `AUTO` does. In a single-provider mode, `fallbackEnabled: false` is belt-and-braces — the hosted
 * order already contains one id — but it also stops a LOCAL provider in the roster from silently
 * becoming `ranked[1]`. An operator who asked for `GROQ_ONLY` asked for one provider, not for "Groq,
 * or whatever else happens to be eligible".
 */
export function fallbackPermittedForProviderMode(mode: ProviderMode): boolean {
  return mode === 'AUTO';
}

/** Whether a given provider id is eligible at all under a mode. */
export function providerEligibleUnderMode(mode: ProviderMode, providerId: string): boolean {
  return hostedOrderForProviderMode(mode).includes(providerId);
}

/**
 * Build the hosted half of a routing-policy input from a provider mode.
 *
 * A HELPER at the policy boundary, not a new contract: it returns the existing
 * {@link HybridRoutingPolicyInput}, which `createHybridRoutingPolicy` still validates. The local order
 * stays injected — provider mode governs the HOSTED axis and has no opinion about local inference,
 * which is postponed to post-V1 anyway (ADR-0145).
 */
export function hybridRoutingPolicyInputForProviderMode(
  mode: ProviderMode,
  options: {
    readonly maxTotalAttempts: number;
    readonly localOrder?: readonly string[];
    readonly transientFailureCodes?: readonly string[];
  },
): HybridRoutingPolicyInput {
  return {
    profile: 'HOSTED_FIRST',
    hostedOrder: hostedOrderForProviderMode(mode),
    localOrder: options.localOrder ?? [],
    fallbackEnabled: fallbackPermittedForProviderMode(mode),
    maxTotalAttempts: options.maxTotalAttempts,
    ...(options.transientFailureCodes === undefined
      ? {}
      : { transientFailureCodes: options.transientFailureCodes }),
  };
}
