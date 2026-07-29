/**
 * The production Model Gateway composition (QFJ-S2-B, ADR-0062 §1, §2, §3).
 *
 * It CALLS `createModelGateway`. It copies no routing, selection, retry, fallback, circuit, budget or
 * validation logic — every behaviour below is either an existing `ModelGatewayConfig` field or a
 * construction-time refusal decided from injected declarations. `gateway.ts` is not modified.
 *
 * The composition is born OFF and cannot be activated from this package:
 *   - `mode` is fixed to `OFF`, so the gateway's own `invoke` refuses BEFORE provider selection, before
 *     any `health()` call, and before any credential could be touched;
 *   - an `ACTIVE`/`CANARY`/`SHADOW`/`FALLBACK` configuration is refused at CONSTRUCTION;
 *   - no rollout controller is constructed, passed to the gateway, or returned — `transition()` and
 *     `emergencyDisable()` are unreachable through this package, which is stronger than documenting
 *     that they must not be called;
 *   - `allowFallback` is `false` and a non-zero `retryBudget` is refused at admission.
 *
 * No environment variable, no filesystem, no network, no database, no secret. Providers arrive already
 * constructed, so the credential-resolver seam is never invoked. QuickFurno Core remains final authority.
 */
import {
  createModelGateway,
  ModelGatewayError,
  type ModelGateway,
  type ModelGatewayInvokeOptions,
  type ModelProvider,
  type ModelResponse,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';

import type {
  ProductionCompositionConfig,
  ProductionCompositionRefusal,
  ProductionCompositionResult,
} from './contracts/production-composition-config.js';

/** Identity tokens that may never bind a production release. Mirrors the S1 staging-binding rule. */
const WILDCARDS: ReadonlySet<string> = new Set(['*', 'latest']);

/** The only retry budget this slice admits, and the only fallback setting it composes. */
const LOCKED_RETRY_BUDGET = 0;
const LOCKED_ALLOW_FALLBACK = false;

function refuse(reason: ProductionCompositionRefusal): ProductionCompositionResult {
  return Object.freeze({ ok: false as const, reason });
}

/** True iff any identity field of a release is a wildcard or a `latest` sentinel. */
function hasWildcardIdentity(release: ProviderReleaseRef): boolean {
  return [
    release.releaseId,
    release.providerId,
    release.modelId,
    release.modelVersion,
    release.configDigest,
  ].some((value) => WILDCARDS.has(value.toLowerCase()));
}

/**
 * The bounded admission guard that pins `retryBudget` to 0 (ADR-0062 §3).
 *
 * `retryBudget` is a REQUEST field, not a `ModelGatewayConfig` field, so it cannot be locked by
 * configuration alone. This performs ONE scalar comparison on an already-shaped candidate and delegates
 * everything else — it selects nothing, validates nothing else, and retries nothing. A malformed
 * candidate is passed straight through so the gateway's own `validateModelRequest` remains the single
 * authority on request validity.
 */
function retryBudgetIsLocked(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) {
    return true;
  }
  const value = (candidate as { readonly retryBudget?: unknown }).retryBudget;
  return value === undefined || value === LOCKED_RETRY_BUDGET;
}

/**
 * Compose the production gateway. Fail-closed: every refusal is decided BEFORE `createModelGateway` is
 * called, and no partial composition is returned.
 */
export function createProductionModelGateway(
  config: ProductionCompositionConfig,
): ProductionCompositionResult {
  // 1. Mode. S2-B serves nothing; anything above OFF is refused rather than silently downgraded.
  if (config.mode !== 'OFF') {
    return refuse('mode-not-off');
  }
  // 2. The locked reliability posture.
  if (
    config.defaultRetryBudget !== undefined &&
    config.defaultRetryBudget !== LOCKED_RETRY_BUDGET
  ) {
    return refuse('retry-budget-not-zero');
  }
  if (config.allowFallback !== undefined && config.allowFallback !== LOCKED_ALLOW_FALLBACK) {
    return refuse('fallback-not-disabled');
  }
  // 3. A composition with nothing approved, or nothing to serve it, is refused rather than built empty.
  if (config.approvedReleases.length === 0 || config.providers.length === 0) {
    return refuse('empty-composition');
  }

  // 4. Every approved release must be exact, registered, and backed by a matching provider instance.
  //    `capabilities()` is a pure local declaration getter; `health()` and `invoke()` are NOT called,
  //    so no provider is exercised and no transport is opened during construction.
  const providersById = new Map<string, ModelProvider>();
  for (const provider of config.providers) {
    providersById.set(provider.descriptor.providerId, provider);
  }

  for (const release of config.approvedReleases) {
    if (hasWildcardIdentity(release)) {
      return refuse('wildcard-identity');
    }
    const profile = config.capabilityRegistry.getByReleaseId(release.releaseId);
    if (profile === undefined) {
      return refuse('unregistered-release');
    }
    if (
      profile.release.providerId !== release.providerId ||
      profile.release.modelId !== release.modelId ||
      profile.release.modelVersion !== release.modelVersion ||
      profile.release.configDigest !== release.configDigest ||
      profile.release.executionClass !== release.executionClass
    ) {
      return refuse('capability-profile-mismatch');
    }
    const provider = providersById.get(release.providerId);
    if (provider === undefined) {
      return refuse('unregistered-provider');
    }
    const declared = provider.capabilities();
    if (
      provider.descriptor.executionClass !== release.executionClass ||
      declared.providerId !== release.providerId ||
      declared.modelId !== release.modelId ||
      declared.modelVersion !== release.modelVersion
    ) {
      return refuse('provider-release-mismatch');
    }
  }

  // 5. Compose the EXISTING gateway. No rollout controller and no routing profile are supplied, so the
  //    rollout and hybrid paths are not merely unused — they are unreachable through this composition.
  const inner = createModelGateway({
    mode: 'OFF',
    providers: config.providers,
    clock: config.clock,
    budgetPolicy: config.budgetPolicy,
    killSwitch: config.killSwitch,
    concurrency: config.concurrency,
    circuit: config.circuit,
    allowFallback: LOCKED_ALLOW_FALLBACK,
    capabilityRegistry: config.capabilityRegistry,
    ...(config.observability === undefined ? {} : { observability: config.observability }),
  });

  const gateway: ModelGateway = Object.freeze({
    invoke(request: unknown, options?: ModelGatewayInvokeOptions): Promise<ModelResponse> {
      if (!retryBudgetIsLocked(request)) {
        return Promise.reject(new ModelGatewayError('request-invalid'));
      }
      return inner.invoke(request, options);
    },
  });

  return Object.freeze({
    ok: true as const,
    composition: Object.freeze({
      gateway,
      status: Object.freeze({
        mode: 'OFF' as const,
        activatable: false,
        retryBudget: LOCKED_RETRY_BUDGET,
        fallbackEnabled: LOCKED_ALLOW_FALLBACK,
        providerIds: Object.freeze(config.providers.map((p) => p.descriptor.providerId)),
        releaseIds: Object.freeze(config.approvedReleases.map((r) => r.releaseId)),
        credentialResolverSupplied: config.credentialResolver !== undefined,
      }),
    }),
  });
}
