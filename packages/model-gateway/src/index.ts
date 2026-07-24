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

// The gateway.
export {
  createModelGateway,
  type ModelGateway,
  type ModelGatewayConfig,
  type ModelGatewayInvokeOptions,
  type GatewayKillSwitch,
} from './gateway.js';
