/**
 * The production composition contracts (QFJ-S2-B, ADR-0062; JF-2B activation, ADR-0147).
 *
 * TYPE-ONLY, by design: this module exports no runtime value, so the package root stays at exactly two
 * runtime exports. The refusal vocabulary is a closed union derived from a module-private tuple — a
 * caller branches on the literal, and cannot enumerate or mutate the set.
 *
 * Nothing here is secret-bearing. The optional credential-resolver seam is the EXISTING gateway
 * `GroqCredentialResolver` interface, carried as an opaque reference only; no implementation of it
 * ships here and it is never called.
 *
 * ### JF-2B: two modes, and only two
 *
 * The composition now admits `OFF` and `ACTIVE`. It still refuses `SHADOW`, `CANARY` and `FALLBACK`,
 * and that refusal is not an oversight — those are MODEL-RELEASE rollout stages belonging to
 * `ProviderRolloutController`, which governs a stable/candidate release pair. `ProviderMode`
 * (`AUTO` / `GROQ_ONLY` / `NARA_ONLY`) is a PROVIDER-SELECTION axis. Wiring a rollout controller into
 * this hybrid composition to obtain those labels would make the controller take precedence over
 * `routingProfile`, and the two systems would fight: the rollout would be choosing a release while the
 * provider mode believed it was choosing a vendor. They stay separate.
 *
 * ### Fail-closed by default
 *
 * `OFF` is unchanged and inert. `ACTIVE` serves only when a provider mode is named, the roster is
 * exactly that mode canonical providers, and EVERY provider that could return customer-facing output
 * carries its own exact `ACTIVE_MODEL_RELEASE` production approval. Nothing is silently downgraded to
 * `OFF` or upgraded to `ACTIVE`.
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
  ProviderMode,
  ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';

/**
 * Why a production composition was refused. Every member is a CONSTRUCTION-TIME condition decided from
 * injected declarations alone — no provider is invoked, no network is touched, no credential is read.
 */
export type ProductionCompositionRefusal =
  /**
   * The requested gateway mode is not one this composition serves.
   *
   * `SHADOW`, `CANARY` and `FALLBACK` are release-rollout stages, not provider-selection stages, and
   * this composition never repurposes them. Replaces the S2-B `mode-not-off` code, which stopped being
   * true the moment `ACTIVE` became reachable.
   */
  | 'mode-not-supported'
  /** `ACTIVE` was requested without naming a provider mode. There is no default. */
  | 'provider-mode-required'
  /** The named provider mode is not one of `AUTO` / `GROQ_ONLY` / `NARA_ONLY`. */
  | 'provider-mode-invalid'
  /** The provider roster is not exactly the canonical set the provider mode serves. */
  | 'active-roster-mismatch'
  /** Two providers in the roster publish the same identity. */
  | 'duplicate-provider-identity'
  /** A provider that could serve under this mode has no production approval claim. */
  | 'production-approval-missing'
  /** An approval cites an `evaluationRef` that is not registered. */
  | 'production-evidence-missing'
  /** An approval claimed digest does not match the digest derived from the registered evidence. */
  | 'production-evidence-digest-mismatch'
  /** The registered evidence was produced against a different release. */
  | 'production-evidence-release-mismatch'
  /** The registered evidence was produced against a different capability profile. */
  | 'production-evidence-capability-mismatch'
  /** The evidence target does not authorize `ACTIVE` — connectivity, shadow or canary only. */
  | 'production-evidence-target-insufficient'
  /** The evidence is synthetic. Synthetic fixtures never authorize production serving. */
  | 'production-evidence-synthetic'
  /** The evidence is not marked `productionApproval`. */
  | 'production-approval-required'
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
 * One production approval, joining registered evaluation evidence to a release this composition serves.
 *
 * It is a CLAIM. Every field is checked against the registry, and `evidenceDigest` in particular is
 * recomputed from the registered evidence rather than believed — a digest supplied beside the thing it
 * digests is a second source of truth, and the verifier has always treated it that way.
 */
export interface ProductionApprovalClaim {
  readonly evaluationRef: string;
  /** The digest the attestation claims. RECOMPUTED during verification; never trusted. */
  readonly evidenceDigest: string;
  /** Must be `ACTIVE_MODEL_RELEASE`. Lower targets cannot authorize production serving. */
  readonly approvalTarget: string;
  /** The exact release this approval authorizes. No wildcard, no `latest`. */
  readonly release: ProviderReleaseRef;
  readonly capabilityProfileRef: string;
}

/**
 * What a caller injects to build a production composition.
 *
 * Every collaborator is INJECTED — the composition constructs no provider, opens no transport, reads no
 * environment variable, and touches no filesystem. `mode` exists so an unsupported rollout stage is
 * REFUSED explicitly rather than silently downgraded.
 */
export interface ProductionCompositionConfig {
  /**
   * `OFF` or `ACTIVE`. `SHADOW` / `CANARY` / `FALLBACK` are refused with `mode-not-supported` — they
   * are release-rollout stages and this composition does not repurpose them.
   */
  readonly mode: GatewayMode;
  /**
   * The provider-selection mode. REQUIRED for `ACTIVE`; there is no default, because defaulting an
   * unnamed mode to `AUTO` would turn a configuration omission into "use both vendors".
   *
   * Ignored for `OFF`, which serves nothing and selects nothing.
   */
  readonly providerMode?: ProviderMode;
  /**
   * The production approvals — one per canonical provider that could return customer-facing output.
   *
   * Under `AUTO` that is BOTH providers: Nara is the fallback, and a fallback answer is still an answer
   * a customer reads. Connectivity or shadow-eligibility evidence is insufficient for either.
   */
  readonly productionApprovals?: readonly ProductionApprovalClaim[];
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
  /** `OFF` or `ACTIVE` — exactly what was composed, never a downgrade or an upgrade. */
  readonly mode: GatewayMode;
  /**
   * Whether this composition serves. `true` only for a fully evidence-gated `ACTIVE` composition.
   *
   * Still not a mutation surface: no method anywhere in this package flips it. It reports what
   * construction decided from the supplied evidence, and changing it means composing again.
   */
  readonly activatable: boolean;
  /** The provider-selection mode, when one was composed. Absent for `OFF`. */
  readonly providerMode?: ProviderMode;
  /** The canonical providers that may serve under the composed mode, in policy order. */
  readonly servingProviderIds?: readonly string[];
  /** How many production approvals were verified. A COUNT — never an approval, a ref or a digest. */
  readonly verifiedApprovalCount?: number;
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
