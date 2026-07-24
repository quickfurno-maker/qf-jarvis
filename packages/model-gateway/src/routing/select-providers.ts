/**
 * Deterministic provider selection (QFJ-P04.01A, ADR-0045).
 *
 * Pure and side-effect-free: given the request, the providers in configured POLICY ORDER, and a health
 * map, it returns the eligible providers (in policy order) or a bounded failure code. It enforces the
 * data class BEFORE anything else — a `LOCAL_ONLY` request can reach only a LOCAL provider and can never
 * select a hosted one — then capability match, then health.
 */
import { capabilitiesSatisfy } from '../contracts/capabilities.js';
import type { ModelDataClass } from '../contracts/enums.js';
import type { ModelProvider } from '../contracts/provider.js';
import type { ModelRequest } from '../contracts/request.js';
import type { ModelGatewayErrorCode } from '../errors/gateway-error.js';

export type ProviderSelection =
  | { readonly ok: true; readonly eligible: readonly ModelProvider[] }
  | { readonly ok: false; readonly code: ModelGatewayErrorCode };

/** Whether a data class permits a provider's execution class. HUMAN_ONLY is rejected before selection. */
function dataClassAllows(dataClass: ModelDataClass, provider: ModelProvider): boolean {
  if (dataClass === 'LOCAL_ONLY') {
    return provider.descriptor.executionClass === 'LOCAL';
  }
  // HOSTED_ALLOWED may use a hosted or a local provider per policy.
  return true;
}

/**
 * Select the eligible providers for a request, in policy order, or a failure code:
 *   - LOCAL_ONLY with no LOCAL provider at all → `local-provider-required`;
 *   - no provider whose execution class the data class allows → `no-eligible-provider`;
 *   - execution-eligible providers exist but none declares the required capabilities → `capability-mismatch`;
 *   - capable providers exist but none is healthy → `no-eligible-provider`.
 */
export function selectProviders(
  request: ModelRequest,
  providers: readonly ModelProvider[],
  healthy: ReadonlyMap<string, boolean>,
): ProviderSelection {
  if (request.dataClass === 'LOCAL_ONLY') {
    const anyLocal = providers.some((p) => p.descriptor.executionClass === 'LOCAL');
    if (!anyLocal) {
      return { ok: false, code: 'local-provider-required' };
    }
  }

  const executionEligible = providers.filter((p) => dataClassAllows(request.dataClass, p));
  if (executionEligible.length === 0) {
    return { ok: false, code: 'no-eligible-provider' };
  }

  const capable = executionEligible.filter((p) =>
    capabilitiesSatisfy(p.capabilities(), request.requiredCapabilities),
  );
  if (capable.length === 0) {
    return { ok: false, code: 'capability-mismatch' };
  }

  const eligible = capable.filter((p) => healthy.get(p.descriptor.providerId) === true);
  if (eligible.length === 0) {
    return { ok: false, code: 'no-eligible-provider' };
  }

  return { ok: true, eligible };
}
