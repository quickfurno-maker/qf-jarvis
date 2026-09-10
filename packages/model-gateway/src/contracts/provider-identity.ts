/**
 * Canonical provider identities for the provider-SPECIFIC hosted adapters (JF-2A hardening, ADR-0146).
 *
 * ### The gap this closes
 *
 * `providerId` used to be an injected string that only had to satisfy an identifier grammar, and the
 * adapter published it into `descriptor.providerId` and into its capabilities. Once `ProviderMode`
 * began treating the literals `groq` and `nara` as SEMANTIC identities, that became a spoofing surface
 * in both directions:
 *
 * - a Nara adapter configured `providerId: 'groq'` would satisfy `GROQ_ONLY`, and would be ranked first
 *   under `AUTO`, while sending every request to NaraRouter;
 * - a Groq adapter configured `providerId: 'nara'` would satisfy `NARA_ONLY` while sending every
 *   request to Groq.
 *
 * Provider mode, routing order, fallback evidence, provenance and an operator's expectations all rest
 * on the provider id being TRUE, so both directions are closed.
 *
 * ### Two strengths, because the adapters are not in the same situation
 *
 * **{@link assertCanonicalProviderId} — exact.** The adapter may hold ONE identity and nothing else.
 * Used by Nara, where nothing in the repository composes the adapter under any other id, so the
 * strictest rule costs nothing and a configuration typo fails closed.
 *
 * **{@link assertNoForeignProviderIdentity} — foreign-identity refusal.** The adapter may not claim
 * ANOTHER provider's canonical id, but may carry a scoped id of its own. Used by Groq, because the
 * controlled SHADOW runner composes TWO Groq providers into ONE gateway roster — a stable leg and a
 * candidate leg — and the roster's health map, circuit breaker and routing plan are all keyed by
 * `providerId`. Collapsing both legs to `groq` makes them indistinguishable, and the gateway returns
 * `internal-invariant` rather than running the comparison. That A/B path predates this hardening and
 * is not what the hardening is about.
 *
 * The weaker rule still closes the spoof completely. `GROQ_ONLY` and `NARA_ONLY` map to the hosted
 * orders `['groq']` and `['nara']`, so a provider carrying `groq.shadow.candidate` is excluded from
 * every provider mode as `not-in-policy` and can satisfy none of them. What the rule permits is a
 * scoped Groq id in a composition that does not use provider modes at all; what it forbids is the one
 * thing that would make a mode lie.
 *
 * The residual difference is a Groq-side typo — `groq-typo` is constructible, though it can satisfy no
 * provider mode. Closing that too means giving the shadow runner a leg discriminator other than
 * `providerId`, which is a change to a merged A/B path and an owner decision, not a JF-2A one.
 *
 * ### What this is NOT
 *
 * It is not a closed enum of every provider the gateway may ever have. The gateway is provider-neutral
 * and new providers remain possible; `ModelProvider`, `ProviderDescriptor` and the identifier grammar
 * are untouched. What is constrained is narrower: an adapter written against one vendor's API may
 * never publish a different vendor's canonical identity.
 *
 * ### Why it lives in `contracts`
 *
 * Both the provider adapters and the routing-layer provider mode need these names. Putting them in the
 * contracts layer — which imports nothing — lets both depend on them without a provider ever importing
 * routing, which would invert the dependency direction and couple an adapter to a policy.
 */

/** The Groq Cloud adapter's canonical identity. */
export const GROQ_CANONICAL_PROVIDER_ID = 'groq';

/** The NaraRouter adapter's only permitted identity. */
export const NARA_CANONICAL_PROVIDER_ID = 'nara';

/**
 * Every canonical provider identity a provider MODE reasons about.
 *
 * The set an adapter may not borrow from. It grows when a provider-specific adapter is added, and it
 * is not a list of every id the gateway will accept — an unlisted id is simply not one any mode names.
 */
export const CANONICAL_PROVIDER_IDS: readonly string[] = Object.freeze([
  GROQ_CANONICAL_PROVIDER_ID,
  NARA_CANONICAL_PROVIDER_ID,
]);

/**
 * Assert that an adapter was configured with its own canonical identity, and no other value.
 *
 * An exact equality test, deliberately: there is no normalization, no case folding and no near-match.
 * `Groq`, `nara-typo` and `nara ` are all refused, because each would produce a provider whose
 * published identity is not the one the routing layer reasons about.
 *
 * The supplied value is a configuration identifier, never a secret — the key holder is a separate type
 * that redacts itself, and nothing here can reach it.
 */
export function assertCanonicalProviderId(expected: string, supplied: unknown): void {
  if (supplied !== expected) {
    throw new Error(
      `This adapter may only be configured with providerId '${expected}'; received '${String(
        supplied,
      )}'. A provider-specific adapter must not publish another provider's identity.`,
    );
  }
}

/**
 * Assert that an adapter is not claiming a DIFFERENT provider's canonical identity.
 *
 * Permits the adapter's own canonical id and any scoped id that is not another provider's. Refuses
 * every other canonical id outright, which is the half that makes a provider mode truthful: a Groq
 * adapter can never publish `nara`, so `NARA_ONLY` can never be satisfied by Groq.
 */
export function assertNoForeignProviderIdentity(own: string, supplied: unknown): void {
  if (typeof supplied !== 'string') {
    throw new Error(`This adapter requires a providerId string; received '${String(supplied)}'.`);
  }
  if (supplied !== own && CANONICAL_PROVIDER_IDS.includes(supplied)) {
    throw new Error(
      `This adapter may not publish another provider's identity; received '${supplied}' from an adapter whose canonical identity is '${own}'.`,
    );
  }
}
