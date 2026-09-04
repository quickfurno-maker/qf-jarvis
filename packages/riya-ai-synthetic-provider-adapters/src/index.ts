/**
 * `@qf-jarvis/riya-ai-synthetic-provider-adapters` — the AS3A real-provider control plane (ADR-0143).
 *
 * ### OFFLINE, and the only place provider network code lives
 *
 * AS2's generation core stays provider-independent and gains no SDK, no key and no URL by this
 * package existing. Nothing here is reachable from an app, a production runtime, the WhatsApp path,
 * model serving or an API composition, and a containment spec proves it. The permitted direction is
 * one-way: an offline CLI reaches these adapters, which reach AS2's port, which reaches AS2's
 * orchestration, which ends in AS1's acceptance.
 *
 * ### What is here
 *
 * Two real adapters behind AS2's invocation port, a provider-neutral versioned prompt layer, a
 * content-free pilot plan, a hard execution budget, a double opt-in execution guard, a spend gate, a
 * traversal-defended artifact writer, preflight, and the pilot executor.
 *
 * ### What is NOT here
 *
 * No credential — the environment holds those, and only the line that constructs a client reads one.
 * No production corpus: pilot artifacts are local evaluation evidence and nothing is released. No
 * training, no base-model selection, and no path by which the protected RWC-P10 exam could reach a
 * model request.
 */

// The closed control-plane taxonomy.
export {
  RIYA_SYNTHETIC_PILOT_ERROR_CODES,
  RiyaSyntheticPilotError,
} from './contracts/pilot-errors.js';
export type { RiyaSyntheticPilotErrorCode } from './contracts/pilot-errors.js';

// The provider-neutral failure taxonomy, and its collapse onto AS2's closed classes.
export {
  RIYA_SYNTHETIC_PROVIDER_FAILURE_KINDS,
  RiyaSyntheticProviderTransportError,
  classifyRiyaSyntheticProviderFailure,
  riyaSyntheticErrorClassFor,
  riyaSyntheticFailureIsRetryable,
  riyaSyntheticFailureStopsRun,
} from './contracts/provider-errors.js';
export type {
  ProviderFailureSignals,
  RiyaSyntheticProviderFailureKind,
} from './contracts/provider-errors.js';

// The hard spend ceilings.
export { createRiyaSyntheticExecutionBudget } from './contracts/execution-budget.js';
export type {
  RiyaSyntheticExecutionBudgetV1,
  RiyaSyntheticExecutionBudgetInput,
} from './contracts/execution-budget.js';

// The content-free plan.
export { createRiyaSyntheticPilotPlan } from './contracts/pilot-plan.js';
export type { RiyaSyntheticPilotPlanV1 } from './contracts/pilot-plan.js';

// The provider-neutral prompt layer.
export {
  RIYA_SYNTHETIC_INSTRUCTION_INVENTORY,
  riyaSyntheticInstructionFor,
} from './prompts/instruction-inventory.js';
export type { RiyaSyntheticInstructionEntryV1 } from './prompts/instruction-inventory.js';
export {
  RIYA_SYNTHETIC_SUPPORTED_OUTPUT_SCHEMA_REFS,
  riyaSyntheticOutputSchemaFor,
  riyaSyntheticOutputSchemaRef,
} from './prompts/output-schemas.js';
export type { RiyaSyntheticJsonSchema } from './prompts/output-schemas.js';
export {
  projectRiyaSyntheticRoleInput,
  renderRiyaSyntheticRequest,
} from './prompts/role-prompts.js';
export type { RiyaSyntheticRenderedRequestV1 } from './prompts/role-prompts.js';

// The adapters, and the transport seams they are tested through.
export {
  buildOpenAiResponsesRequest,
  createOpenAiResponsesInvoker,
} from './adapters/openai-responses-invoker.js';
export type {
  CreateOpenAiResponsesInvokerOptions,
  OpenAiResponsesReply,
  OpenAiResponsesRequestBody,
  OpenAiResponsesTransport,
} from './adapters/openai-responses-invoker.js';
export {
  buildAnthropicMessagesRequest,
  createAnthropicMessagesInvoker,
} from './adapters/anthropic-messages-invoker.js';
export type {
  AnthropicMessagesReply,
  AnthropicMessagesRequestBody,
  AnthropicMessagesTransport,
  CreateAnthropicMessagesInvokerOptions,
} from './adapters/anthropic-messages-invoker.js';
export { riyaSyntheticRequestUtf8Bytes } from './adapters/invocation-runner.js';
export type {
  RiyaSyntheticProviderFailureObserver,
  RiyaSyntheticProviderReply,
} from './adapters/invocation-runner.js';

// The SDK bindings. The only modules that import a provider SDK.
export { createOpenAiSdkTransport } from './adapters/openai-sdk-transport.js';
export { createAnthropicSdkTransport } from './adapters/anthropic-sdk-transport.js';

// The double opt-in, and the credential boundary.
export {
  ANTHROPIC_CREDENTIAL_ENV,
  OPENAI_CREDENTIAL_ENV,
  RIYA_AS3_CLAUDE_MODEL_ENV,
  RIYA_AS3_EXECUTE_ENV,
  RIYA_AS3_OPENAI_MODEL_ENV,
  RIYA_SYNTHETIC_EXECUTION_MODES,
  readRiyaSyntheticProviderCredential,
  resolveRiyaSyntheticExecutionMode,
  riyaSyntheticCredentialPresence,
} from './service/execution-guard.js';
export type {
  ResolveExecutionModeInput,
  RiyaSyntheticCredentialPresenceV1,
  RiyaSyntheticEnvironment,
  RiyaSyntheticExecutionMode,
} from './service/execution-guard.js';

// The spend gate.
export { RIYA_SYNTHETIC_STOP_REASONS, createRiyaSyntheticSpendGate } from './service/spend-gate.js';
export type {
  CreateSpendGateOptions,
  RiyaSyntheticScheduler,
  RiyaSyntheticSpendGate,
  RiyaSyntheticSpendLedgerV1,
  RiyaSyntheticStopReason,
} from './service/spend-gate.js';

// Preflight.
export {
  RIYA_AS3_ANTHROPIC_FAMILY_REF,
  RIYA_AS3_OPENAI_FAMILY_REF,
  preflightRiyaSyntheticPilot,
} from './service/preflight.js';
export type {
  RiyaSyntheticPreflightConfigV1,
  RiyaSyntheticPreflightInput,
  RiyaSyntheticPreflightResultV1,
} from './service/preflight.js';

// The artifact writer.
export { createRiyaSyntheticArtifactWriter } from './service/artifact-writer.js';
export type {
  CreateArtifactWriterOptions,
  RiyaSyntheticArtifactWriteResultV1,
  RiyaSyntheticArtifactWriter,
} from './service/artifact-writer.js';

// The executor.
export { executeRiyaSyntheticPilot } from './service/execute-pilot.js';
export type {
  ExecuteRiyaSyntheticPilotOptions,
  RiyaSyntheticCandidateIndexRowV1,
  RiyaSyntheticPilotResultV1,
  RiyaSyntheticProtectedIndex,
} from './service/execute-pilot.js';
