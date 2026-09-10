/**
 * The production Model Gateway composition (QFJ-S2-B, ADR-0062 §1, §2, §3).
 *
 * It CALLS `createModelGateway`. It copies no routing, selection, retry, fallback, circuit, budget or
 * validation logic — every behaviour below is either an existing `ModelGatewayConfig` field or a
 * construction-time refusal decided from injected declarations. `gateway.ts` is not modified.
 *
 * ### JF-2B (ADR-0147): `ACTIVE` is reachable, and only through a gate
 *
 * `OFF` is unchanged and inert — the gateway's own `invoke` refuses BEFORE provider selection, before
 * any `health()` call, and before any credential could be touched.
 *
 * `ACTIVE` requires ALL of the following, each decided at CONSTRUCTION from injected declarations, with
 * no provider invoked and no `health()` consulted:
 *   - a NAMED provider mode. There is no default: defaulting an omission to `AUTO` would turn a missing
 *     line of configuration into "use both vendors";
 *   - a roster that is EXACTLY that mode's canonical providers — not a superset, no duplicate identity,
 *     no scoped diagnostic adapter;
 *   - an exact `ACTIVE_MODEL_RELEASE` production approval for EVERY provider that could return
 *     customer-facing output. Under `AUTO` that is both: a fallback answer is still an answer.
 *
 * ### What stays refused, and why it is not leftover strictness
 *
 *   - `SHADOW`/`CANARY`/`FALLBACK` are refused. They are model-RELEASE rollout stages belonging to
 *     `ProviderRolloutController`, not provider-selection stages;
 *   - NO rollout controller is ever constructed or passed. A controller takes PRECEDENCE over
 *     `routingProfile`, so supplying one to obtain those labels would silently disable provider
 *     selection — the rollout would be choosing a release while the provider mode believed it was
 *     choosing a vendor;
 *   - a non-zero `retryBudget` is still refused at admission. One primary attempt, then at most one
 *     attempt against a DIFFERENT provider;
 *   - `allowFallback` is DERIVED from the provider mode. A caller-supplied value may agree and may
 *     never contradict.
 *
 * No environment variable, no filesystem, no network, no database, no secret. Providers arrive already
 * constructed, so the credential-resolver seam is never invoked. QuickFurno Core remains final authority.
 */
import {
  createHybridRoutingPolicy,
  createModelGateway,
  hostedOrderForProviderMode,
  hybridRoutingPolicyInputForProviderMode,
  isProviderMode,
  ModelGatewayError,
  type EvaluationEvidenceVerifier,
  type ModelGateway,
  type ModelGatewayInvokeOptions,
  type ModelProvider,
  type ModelResponse,
  type ProviderMode,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';

import type {
  ProductionApprovalClaim,
  ProductionCompositionConfig,
  ProductionCompositionRefusal,
  ProductionCompositionResult,
} from './contracts/production-composition-config.js';
import { createEvaluationEvidenceRegistry } from './evidence/evaluation-evidence-registry.js';

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

/** The two modes this composition serves. Everything else belongs to the release-rollout system. */
const SUPPORTED_MODES: ReadonlySet<string> = new Set(['OFF', 'ACTIVE']);

/** The only approval target that authorizes production serving. */
const REQUIRED_APPROVAL_TARGET = 'ACTIVE_MODEL_RELEASE';

/** Map a verifier refusal onto this composition's closed vocabulary. Total over the verifier's set. */
function refusalForVerification(reason: string): ProductionCompositionRefusal {
  switch (reason) {
    case 'evidence-missing':
      return 'production-evidence-missing';
    case 'evidence-digest-mismatch':
      return 'production-evidence-digest-mismatch';
    case 'evidence-release-mismatch':
      return 'production-evidence-release-mismatch';
    case 'evidence-capability-mismatch':
      return 'production-evidence-capability-mismatch';
    case 'evidence-target-insufficient':
      return 'production-evidence-target-insufficient';
    case 'synthetic-evidence-forbidden':
      return 'production-evidence-synthetic';
    case 'production-approval-required':
      return 'production-approval-required';
    default:
      // An unmapped verifier reason must not read as success. Fail closed on the strictest code.
      return 'production-evidence-target-insufficient';
  }
}

/**
 * Verify one canonical provider's production approval.
 *
 * Returns `undefined` on success, or the refusal that stops the whole composition. Every serving
 * provider is checked; there is no "any approval will do" path, because under `AUTO` the fallback also
 * returns text a customer reads.
 */
function verifyServingProvider(
  providerId: string,
  approvals: readonly ProductionApprovalClaim[],
  verifier: EvaluationEvidenceVerifier,
): ProductionCompositionRefusal | undefined {
  const claim = approvals.find((one) => one.release.providerId === providerId);
  if (claim === undefined) {
    return 'production-approval-missing';
  }
  if (claim.approvalTarget !== REQUIRED_APPROVAL_TARGET) {
    return 'production-evidence-target-insufficient';
  }
  if (hasWildcardIdentity(claim.release)) {
    return 'wildcard-identity';
  }
  const verified = verifier.verify({
    evaluationRef: claim.evaluationRef,
    evidenceDigest: claim.evidenceDigest,
    approvalTarget: claim.approvalTarget,
    release: claim.release,
    capabilityProfileRef: claim.capabilityProfileRef,
    // ACTIVE is the mode being authorized. The verifier's own ladder decides whether the evidence
    // target reaches it, and its production rules demand non-synthetic + production-approved.
    mode: 'ACTIVE',
  });
  return verified.ok ? undefined : refusalForVerification(verified.reason);
}

/**
 * Compose the production gateway. Fail-closed: every refusal is decided BEFORE `createModelGateway` is
 * called, and no partial composition is returned.
 */
export function createProductionModelGateway(
  config: ProductionCompositionConfig,
): ProductionCompositionResult {
  // 1. Mode. OFF and ACTIVE only. A rollout stage is refused rather than reinterpreted as a provider
  //    stage — SHADOW/CANARY/FALLBACK govern a stable/candidate RELEASE pair, not a vendor choice.
  if (!SUPPORTED_MODES.has(config.mode)) {
    return refuse('mode-not-supported');
  }
  // 2. The locked reliability posture.
  if (
    config.defaultRetryBudget !== undefined &&
    config.defaultRetryBudget !== LOCKED_RETRY_BUDGET
  ) {
    return refuse('retry-budget-not-zero');
  }
  // `allowFallback` is legacy. It is DERIVED from the provider mode now, and a caller-supplied value may
  // only agree — never contradict. For OFF the only agreeable value is `false`, because OFF serves
  // nothing and a composition that claimed a fallback it cannot reach would be describing fiction. The
  // ACTIVE side is checked once the mode is known, below.
  if (
    config.mode === 'OFF' &&
    config.allowFallback !== undefined &&
    config.allowFallback !== LOCKED_ALLOW_FALLBACK
  ) {
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

  // 5. QFJ-S2-C-B (ADR-0063 §6): build the frozen evaluation-evidence registry. Invalid or conflicting
  //    evidence refuses the WHOLE composition rather than being silently dropped. The verifier this
  //    produces is deliberately NOT wired to a rollout controller — none is constructed — so registering
  //    evidence activates nothing. It exists so a later authorized slice inherits a closed gate.
  const registryResult = createEvaluationEvidenceRegistry(config.evaluationEvidence ?? []);
  if (!registryResult.ok) {
    return refuse(registryResult.reason);
  }

  // 6. ACTIVATION (JF-2B, ADR-0147). Everything below is decided from injected declarations; no
  //    provider is invoked, no health is called and no credential is read during construction.
  let providerMode: ProviderMode | undefined;
  let servingProviderIds: readonly string[] = [];
  let verifiedApprovalCount = 0;

  if (config.mode === 'ACTIVE') {
    // 6a. The provider mode is REQUIRED and never defaulted. Defaulting an omission to AUTO would turn
    //     a missing line of configuration into "use both vendors".
    if (config.providerMode === undefined) {
      return refuse('provider-mode-required');
    }
    if (!isProviderMode(config.providerMode)) {
      return refuse('provider-mode-invalid');
    }
    providerMode = config.providerMode;
    servingProviderIds = hostedOrderForProviderMode(providerMode);

    // 6b. The roster must be EXACTLY the canonical providers this mode serves. Not a superset: a
    //     scoped diagnostic adapter or an unrelated local provider sitting in a production roster is
    //     a provider nobody decided to serve with.
    const rosterIds = config.providers.map((one) => one.descriptor.providerId);
    if (new Set(rosterIds).size !== rosterIds.length) {
      return refuse('duplicate-provider-identity');
    }
    const expected = [...servingProviderIds].sort();
    const actual = [...rosterIds].sort();
    if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i])) {
      return refuse('active-roster-mismatch');
    }

    // 6c. EVERY provider that could return customer-facing output needs its own exact production
    //     approval. Under AUTO that is both: a fallback answer is still an answer a customer reads,
    //     so connectivity or shadow-eligibility evidence is insufficient for either provider.
    const approvals = config.productionApprovals ?? [];
    for (const providerId of servingProviderIds) {
      const refusal = verifyServingProvider(
        providerId,
        approvals,
        registryResult.registry.verifier,
      );
      if (refusal !== undefined) {
        return refuse(refusal);
      }
      verifiedApprovalCount += 1;
    }
  }

  // 7. Compose the EXISTING gateway.
  //
  //    NO rollout controller is ever supplied. That is the load-bearing line: a controller takes
  //    precedence over `routingProfile`, so passing one to obtain SHADOW/CANARY labels would silently
  //    disable provider selection and leave the two axes fighting over the same request.
  //
  //    For ACTIVE the routing profile is built from the provider mode through the EXISTING JF-2A
  //    helper and the EXISTING policy validator — Groq first, Nara second, one bounded fallback.
  const routingProfile =
    providerMode === undefined
      ? undefined
      : createHybridRoutingPolicy(
          hybridRoutingPolicyInputForProviderMode(providerMode, {
            // One primary attempt plus at most one DIFFERENT provider. Same-provider retry stays 0.
            maxTotalAttempts: 2,
            localOrder: [],
          }),
        );

  // A caller-supplied `allowFallback` may agree with the derived value; it may never contradict it.
  // `GROQ_ONLY` with `allowFallback: true` is an operator asking for one provider and two at once.
  if (
    routingProfile !== undefined &&
    config.allowFallback !== undefined &&
    config.allowFallback !== routingProfile.fallbackEnabled
  ) {
    return refuse('fallback-not-disabled');
  }

  const inner = createModelGateway({
    mode: config.mode,
    providers: config.providers,
    clock: config.clock,
    budgetPolicy: config.budgetPolicy,
    killSwitch: config.killSwitch,
    concurrency: config.concurrency,
    circuit: config.circuit,
    // Derived from the provider mode, never from a caller flag that could contradict it.
    allowFallback: routingProfile?.fallbackEnabled ?? LOCKED_ALLOW_FALLBACK,
    capabilityRegistry: config.capabilityRegistry,
    ...(routingProfile === undefined ? {} : { routingProfile }),
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
        mode: config.mode,
        // True only for a fully evidence-gated ACTIVE composition. Not a mutation surface: nothing in
        // this package flips it, and changing it means composing again.
        activatable: config.mode === 'ACTIVE',
        retryBudget: LOCKED_RETRY_BUDGET,
        fallbackEnabled: routingProfile?.fallbackEnabled ?? LOCKED_ALLOW_FALLBACK,
        providerIds: Object.freeze(config.providers.map((p) => p.descriptor.providerId)),
        releaseIds: Object.freeze(config.approvedReleases.map((r) => r.releaseId)),
        credentialResolverSupplied: config.credentialResolver !== undefined,
        registeredEvidenceCount: registryResult.registry.size(),
        ...(providerMode === undefined ? {} : { providerMode }),
        ...(providerMode === undefined
          ? {}
          : { servingProviderIds: Object.freeze([...servingProviderIds]) }),
        ...(providerMode === undefined ? {} : { verifiedApprovalCount }),
      }),
    }),
  });
}
