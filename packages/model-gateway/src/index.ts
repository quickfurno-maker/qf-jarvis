/**
 * `@qf-jarvis/model-gateway` — the provider-neutral model gateway foundation (QFJ-P04.01A, ADR-0045).
 *
 * This root barrel exposes ONLY the minimum stable, provider-neutral contracts a future consumer needs
 * to build/route a model call and a real provider adapter to implement. It exposes NO provider SDK type,
 * NO internal router/circuit/semaphore, NO mutable registry, and NOT the `FakeModelProvider` (that is a
 * test double, exported only from the `@qf-jarvis/model-gateway/testing` subpath). No agent, no n8n, no
 * database, no network, no key.
 */

// Closed vocabularies.
export {
  MODEL_DATA_CLASSES,
  MODEL_AGENT_SCOPES,
  PROVIDER_EXECUTION_CLASSES,
  GATEWAY_MODES,
  MODEL_RESULT_MODES,
  isModelDataClass,
  isModelAgentScope,
  isProviderExecutionClass,
  isGatewayMode,
  isModelResultMode,
  type ModelDataClass,
  type ModelAgentScope,
  type ProviderExecutionClass,
  type GatewayMode,
  type ModelResultMode,
} from './contracts/enums.js';

// The provider MODEL ID grammar (QFJ-S1C-A). Exported because `@qf-jarvis/groq-staging-smoke` must
// validate `release.modelId` with the SAME grammar, and this package exposes no deep import path —
// the alternative would be duplicating the regex across packages.
export {
  PROVIDER_MODEL_ID_PATTERN,
  MAX_PROVIDER_MODEL_ID_LENGTH,
  providerModelIdSchema,
  isProviderModelId,
} from './contracts/model-id.js';

// Capabilities.
export {
  providerCapabilitiesSchema,
  requiredCapabilitiesSchema,
  defineProviderCapabilities,
  capabilitiesSatisfy,
  type ProviderCapabilities,
  type RequiredCapabilities,
} from './contracts/capabilities.js';

// Request / response / provenance.
export {
  validateModelRequest,
  type ModelRequest,
  type ModelMessage,
  type ModelRequestMetadata,
  type ModelRequestValidation,
} from './contracts/request.js';
export { type ModelResponse, type ModelUsage } from './contracts/response.js';
export { type ModelRunProvenance } from './contracts/provenance.js';

// Provider interface (the adapter boundary).
export {
  type ModelProvider,
  type ProviderDescriptor,
  type ProviderHealth,
  type ProviderInvocationInput,
  type ProviderInvocationResult,
  type ProviderOutput,
} from './contracts/provider.js';

// Errors.
export {
  ModelGatewayError,
  isModelGatewayError,
  MODEL_GATEWAY_ERROR_CODES,
  type ModelGatewayErrorCode,
} from './errors/gateway-error.js';

// Budgets (injectable policy + deterministic default).
export {
  createEstimatedBudgetPolicy,
  estimateInputTokens,
  type GatewayBudgetPolicy,
  type BudgetDecision,
  type EstimatedBudgetPolicyConfig,
} from './budgets/budget-policy.js';

// Observability hooks.
export {
  NOOP_OBSERVABILITY,
  GATEWAY_EVENT_TYPES,
  type GatewayObservabilityHook,
  type GatewayEvent,
  type GatewayEventType,
} from './observability/events.js';

// Reliability (injected clock + circuit type).
export { createManualClock, createSystemClock, type GatewayClock } from './reliability/clock.js';
export { type CircuitBreakerConfig, type CircuitState } from './reliability/circuit-breaker.js';

// The Groq Cloud provider (QFJ-P04.01B, ADR-0046) — first real HOSTED provider. Composition symbols
// only; no raw HTTP/SDK type, no key accessor. A real key + transport are injected at composition.
export {
  GroqModelProvider,
  GroqApiKey,
  createGroqApiKey,
  createGroqProviderConfig,
  createFetchGroqTransport,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  type GroqProviderConfig,
  type GroqProviderConfigInput,
  type GroqTransport,
} from './providers/groq/index.js';

// POST-MD120B3 — the DIAGNOSTIC-ONLY Groq Responses API surface (endpoint, transport, envelope).
//
// MD120B3 reproduced the strict Chat Completions rejection across BOTH governed GPT-OSS models, so
// the next question is whether the SAME request traverses Groq's OTHER documented output contract.
// These symbols exist so the candidate evidence operator can ask it. They compose no provider into
// the gateway, declare no capability and join no routing table; the serving path is Chat Completions
// and stays so, and the Responses API is currently BETA.
// Exactly THREE runtime symbols, which is what composing the differential costs: an endpoint to name,
// a transport pinned to it, and the adapter that speaks its envelope. The body builder, the decoder
// and the payload schema stay off the root and are asserted by this package's own specs, because a
// caller that never needs to build a Responses body must not be handed the means to.
export {
  createFetchGroqResponsesTransport,
  createGroqResponsesDiagnosticProvider,
  GROQ_RESPONSES_ENDPOINT,
  type GroqResponsesDiagnosticInput,
  type GroqResponsesDiagnosticProvider,
  type GroqResponsesDiagnosticResult,
} from './providers/groq/index.js';

// MVP-P2A.2 HF4-R7 — the provider-facing strict-schema projection, so the real Riya schemas can be
// asserted against the documented Groq subset from the one package that can see both.
export {
  GROQ_STRICT_PROJECTION_REASONS,
  projectGroqStrictJsonSchema,
  renderStructuredJsonSchema,
  type GroqStrictProjection,
  type GroqStrictProjectionReason,
} from './providers/groq/index.js';

// QFJ-S1 Groq staging provider binding (ADR-0060) — a release-driven factory over the existing Groq
// adapter (an injected async credential resolver + fail-closed data-class/execution/attestation gates +
// content-free bind observability). No real key, no live call, no activation/rollout.
// QFJ-S1A (ADR-0061 §D, §E) makes the approval references EXACT and REQUIRED — capability profile,
// evaluation, data-controls (ZDR) attestation, and prompt family + integer version — and emits them as
// identifiers in the content-free bind event. Prompt TEXT never enters the gateway's staging binding.
export {
  bindGroqStagingProvider,
  GROQ_STAGING_BIND_REASONS,
  GROQ_STAGING_EVENT_TYPES,
  NOOP_GROQ_STAGING_OBSERVABILITY,
  type GroqCredentialReference,
  type GroqCredentialResolver,
  type GroqStagingRelease,
  type GroqStagingBindingConfig,
  type GroqStagingBindResult,
  type GroqStagingBindReason,
  type GroqStagingEventType,
  type GroqStagingBindEvent,
  type GroqStagingObservabilityHook,
} from './providers/groq/index.js';

// The local OpenAI-compatible provider (QFJ-P04.01C, ADR-0047) — first LOCAL-execution provider.
// Composition symbols only; no raw HTTP/SDK type, no token accessor, no internal IP parser. A validated
// private endpoint + an optional token + a transport are injected at composition.
export {
  LocalOpenAICompatibleModelProvider,
  createLocalProviderConfig,
  createLocalEndpoint,
  LocalEndpointDescriptor,
  LOCAL_CHAT_COMPLETIONS_PATH,
  createFetchLocalTransport,
  LocalAuthToken,
  createLocalAuthToken,
  type LocalProviderConfig,
  type LocalProviderConfigInput,
  type LocalEndpointOptions,
  type LocalAddressCategory,
  type LocalStructuredOutputSupport,
  type LocalTransport,
} from './providers/local-openai-compatible/index.js';

// Hybrid routing and failover (QFJ-P04.01D, ADR-0048). Composition + safe observability types only;
// the mutable attempt ledger, the plan/provider references, and the failover internals stay private.
export {
  createHybridRoutingPolicy,
  type HybridRoutingPolicy,
  type HybridRoutingPolicyInput,
} from './routing/hybrid-routing-policy.js';
export {
  ROUTING_PROFILES,
  ROUTING_EXCLUSION_REASONS,
  FALLBACK_DECISION_REASONS,
  FALLBACK_TRANSIENT_CODES,
  type RoutingProfile,
  type RoutingExclusionReason,
  type FallbackDecisionReason,
  type FallbackTransientCode,
} from './routing/routing-reasons.js';
export { type RoutingPlanSummary, type RoutingExclusion } from './routing/routing-plan.js';
export { type AttemptLedgerSnapshot } from './routing/attempt-ledger.js';

// Provider operations and rollout governance (QFJ-P04.01E, ADR-0049). Composition + safe observability
// types only; the canary hash, serving-decision helper, transition validator, and mutable internals stay
// private. No provider instance, no secret, no execution helper is exported.
export {
  createProviderReleaseRef,
  createRolloutApprovalAttestation,
  createProviderRolloutPolicy,
  offRolloutPolicy,
  createProviderRolloutController,
  ROLLOUT_MODES,
  ROLLOUT_SERVE_TARGETS,
  ROLLOUT_OPERATOR_REASONS,
  ROLLOUT_REFUSAL_REASONS,
  ROLLOUT_EVENT_TYPES,
  NOOP_ROLLOUT_OBSERVABILITY,
  type ProviderReleaseRef,
  type RolloutApprovalAttestation,
  type ProviderRolloutPolicy,
  type ProviderRolloutPolicyInput,
  type ProviderRolloutController,
  type TransitionResult,
  type RolloutMode,
  type RolloutServeTarget,
  type RolloutOperatorReason,
  type RolloutRefusalReason,
  type RolloutEventType,
  type RolloutEvent,
  type RolloutObservabilityHook,
} from './operations/index.js';

// QFJ-S2-C-B (ADR-0063). The evaluation-evidence verifier seam — TYPE-ONLY, so the root runtime count
// stays at 71. The gateway declares WHAT must be proved before a candidate rollout above OFF; the
// implementation lives in `@qf-jarvis/model-gateway-composition`, which may depend on both this package
// and `@qf-jarvis/model-evaluation`. This package depends on neither and stays locked to `zod`.
export type {
  EvaluationEvidenceVerifier,
  EvidenceVerificationRequest,
  EvidenceVerificationResult,
} from './operations/index.js';

// Model capability registry (QFJ-P04.02, ADR-0050). Composition + safe types only; the internal match
// functions, tuple-key helper, and mutable internals stay private. No provider instance, no secret.
export {
  MODEL_TASK_CLASSES,
  STRUCTURED_OUTPUT_MODES,
  createModelCapabilityProfile,
  createModelCapabilityRequirement,
  deriveCapabilityRequirement,
  createModelCapabilityRegistry,
  CAPABILITY_MATCH_REASONS,
  NOOP_CAPABILITY_OBSERVABILITY,
  type ModelTaskClass,
  type StructuredOutputMode,
  type ModelCapabilityProfile,
  type ModelCapabilityProfileInput,
  type ModelCapabilityRequirement,
  type ModelCapabilityRequirementInput,
  type RequiredStructuredMode,
  type ModelCapabilityRegistry,
  type ModelCapabilityProfileSummary,
  type CapabilityResolution,
  type CapabilityMatchReason,
  type CapabilityEvent,
  type CapabilityObservabilityHook,
} from './capabilities/index.js';

// The gateway.
export {
  createModelGateway,
  type ModelGateway,
  type ModelGatewayConfig,
  type ModelGatewayInvokeOptions,
  type GatewayKillSwitch,
} from './gateway.js';
