/**
 * The production composition contracts (QFJ-S2-B, ADR-0062).
 *
 * TYPE-ONLY, by design: this module exports no runtime value, so the package root stays at exactly two
 * runtime exports. The refusal vocabulary is a closed union derived from a module-private tuple — a
 * caller branches on the literal, and cannot enumerate or mutate the set.
 *
 * Nothing here is secret-bearing. The optional credential-resolver seam is the EXISTING gateway
 * `GroqCredentialResolver` interface, carried as an opaque reference only; S2-B ships no implementation
 * of it and never calls it.
 */
import type { ApprovalEvidence } from '@qf-jarvis/model-evaluation';
import type {
  CircuitBreakerConfig,
  GatewayBudgetPolicy,
  GatewayClock,
  GatewayKillSwitch,
  GatewayMode,
  GatewayObservabilityHook,
  GroqCredentialResolver,
  ModelCapabilityRegistry,
  ModelGateway,
  ModelProvider,
  ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';

/**
 * Why a production composition was refused. Every member is a CONSTRUCTION-TIME condition decided from
 * injected declarations alone — no provider is invoked, no network is touched, no credential is read.
 */
export type ProductionCompositionRefusal =
  /** The requested gateway mode is not `OFF`. S2-B is structurally incapable of serving. */
  | 'mode-not-off'
  /** No approved release was supplied, or no provider instance was supplied. */
  | 'empty-composition'
  /** A release identity contains a wildcard or a `latest` sentinel. */
  | 'wildcard-identity'
  /** An approved release has no exact profile in the injected capability registry. */
  | 'unregistered-release'
  /** A registry profile exists but its release identity does not match the approved release. */
  | 'capability-profile-mismatch'
  /** No supplied provider instance declares the approved release's provider id. */
  | 'unregistered-provider'
  /** A provider instance's declared identity contradicts the approved release. */
  | 'provider-release-mismatch'
  /** A default retry budget other than 0 was requested. */
  | 'retry-budget-not-zero'
  /** Fallback execution was requested. It is disabled for the whole slice. */
  | 'fallback-not-disabled'
  /** QFJ-S2-C-B: a supplied evaluation-evidence object is not structurally valid. */
  | 'evidence-invalid'
  /** QFJ-S2-C-B: an evidence object's synthetic/productionApproval combination is illegal. */
  | 'evidence-approval-flags-invalid'
  /** QFJ-S2-C-B: the same `evaluationRef` was supplied twice with different content. */
  | 'conflicting-evidence-registration';

/**
 * What a caller injects to build a production composition.
 *
 * Every collaborator is INJECTED — the composition constructs no provider, opens no transport, reads no
 * environment variable, and touches no filesystem. `mode` exists so an `ACTIVE`/`CANARY` request can be
 * REFUSED explicitly rather than silently downgraded.
 */
export interface ProductionCompositionConfig {
  /** Must be `OFF`. Any other mode is refused with `mode-not-off`. */
  readonly mode: GatewayMode;
  /** Already-constructed provider instances. The composition never builds one. */
  readonly providers: readonly ModelProvider[];
  /** The exact approved releases. Each must resolve in `capabilityRegistry`. */
  readonly approvedReleases: readonly ProviderReleaseRef[];
  readonly capabilityRegistry: ModelCapabilityRegistry;
  readonly budgetPolicy: GatewayBudgetPolicy;
  readonly killSwitch: GatewayKillSwitch;
  readonly clock: GatewayClock;
  readonly concurrency: { readonly maxConcurrent: number; readonly maxQueue: number };
  readonly circuit: CircuitBreakerConfig;
  /** Must be `0` when supplied. Any other value is refused with `retry-budget-not-zero`. */
  readonly defaultRetryBudget?: number;
  /** Must be `false` when supplied. `true` is refused with `fallback-not-disabled`. */
  readonly allowFallback?: boolean;
  /** Optional content-free sink. Defaults to the gateway's own no-op hook. */
  readonly observability?: GatewayObservabilityHook;
  /**
   * The OPAQUE production credential-resolver seam (ADR-0062 §4). It is the EXISTING gateway interface,
   * reused rather than re-abstracted. S2-B ships no implementation and NEVER calls it: providers arrive
   * already constructed, so no credential is resolved anywhere in this package.
   */
  readonly credentialResolver?: GroqCredentialResolver;
  /**
   * QFJ-S2-C-B (ADR-0063 §6): the evaluation evidence this composition will honour.
   *
   * Registered ONCE into a deeply frozen in-memory registry at construction; there is no way to add
   * evidence afterwards. Supplying evidence grants NO activation — the composition stays OFF-only and
   * constructs no rollout controller, so the verifier built from this set is unreachable in S2-B/S2-C-B
   * and exists so a later, separately-authorized slice inherits a closed gate rather than an open one.
   */
  readonly evaluationEvidence?: readonly ApprovalEvidence[];
}

/**
 * Non-secret inspection metadata for a built composition. Identifiers, enums and numbers only — no
 * provider instance, no registry, no rollout controller, no resolver, no credential.
 */
export interface ProductionCompositionStatus {
  /** Always `OFF` in S2-B. */
  readonly mode: GatewayMode;
  /** Always `false`. There is no method on this package that could make it true. */
  readonly activatable: boolean;
  readonly retryBudget: number;
  readonly fallbackEnabled: boolean;
  readonly providerIds: readonly string[];
  readonly releaseIds: readonly string[];
  /** Whether a credential-resolver seam was supplied. Never the resolver, never a credential. */
  readonly credentialResolverSupplied: boolean;
  /**
   * QFJ-S2-C-B: how many distinct evaluation references were registered. A COUNT only — never a
   * reference, a digest, a binding, or any evidence content.
   */
  readonly registeredEvidenceCount: number;
}

/**
 * A built composition. It exposes the gateway INVOCATION surface and non-secret metadata — and nothing
 * else. There is deliberately no rollout controller, no provider list, no registry, and no activate /
 * promote / transition method: none is constructed, so none can be reached.
 */
export interface ProductionModelGatewayComposition {
  readonly gateway: ModelGateway;
  readonly status: ProductionCompositionStatus;
}

/** The result of composing. Fail-closed: a refusal carries a closed reason and no partial gateway. */
export type ProductionCompositionResult =
  | { readonly ok: true; readonly composition: ProductionModelGatewayComposition }
  | { readonly ok: false; readonly reason: ProductionCompositionRefusal };
