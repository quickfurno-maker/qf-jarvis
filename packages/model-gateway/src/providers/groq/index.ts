/**
 * The Groq provider composition surface (QFJ-P04.01B, ADR-0046).
 *
 * Re-exports ONLY the minimum stable composition symbols. Raw HTTP request/response types, the response
 * schema, the error-normalization table, and the Authorization builder stay internal and never leave the
 * package. No API-key accessor and no Groq SDK object is exported.
 */
export { GroqModelProvider } from './groq-model-provider.js';
export {
  createGroqProviderConfig,
  type GroqProviderConfig,
  type GroqProviderConfigInput,
} from './groq-config.js';
export { GroqApiKey, createGroqApiKey } from './groq-secret.js';
export {
  createFetchGroqTransport,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  type GroqTransport,
} from './groq-transport.js';

// POST-MD120B3. The DIAGNOSTIC-ONLY Groq Responses API surface: a second transport pinned to
// `/openai/v1/responses`, and the narrow adapter that speaks its envelope.
//
// Exported because the candidate evidence operator is the only package that can see BOTH this
// gateway and the real Riya request, and the endpoint differential it exists to run cannot be
// composed from outside without these two symbols. It is NOT a production surface: nothing here
// registers a provider, declares a capability, or joins the routing table, and a spec asserts that no
// production composition builds either symbol.
export { createFetchGroqResponsesTransport, GROQ_RESPONSES_ENDPOINT } from './groq-transport.js';
// POST-RSP20B2 FORENSICS. The DIAGNOSTIC-ONLY Chat Completions reasoning-effort adapter.
//
// The production adapter carries no reasoning field and must keep carrying none: adding an optional
// parameter there would put a reasoning control one argument away from every production invocation.
// This is a separate instrument, composed by nobody in production, with no descriptor, capabilities,
// health or routing identity. It controls reasoning EFFORT only and never reasoning content.
export {
  buildGroqChatReasoningDiagnosticBody,
  createGroqChatReasoningDiagnosticProvider,
  GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT,
  GROQ_GPT_OSS_REASONING_EFFORTS,
  type GroqChatReasoningDiagnosticInput,
  type GroqChatReasoningDiagnosticProvider,
  type GroqChatReasoningDiagnosticRequestBody,
  type GroqGptOssReasoningEffort,
} from './groq-chat-reasoning-diagnostic.js';

export {
  buildGroqResponsesDiagnosticBody,
  createGroqResponsesDiagnosticProvider,
  decodeGroqResponsesStructuredValue,
  groqResponsesResponseSchema,
  type GroqResponsesDecode,
  type GroqResponsesDiagnosticInput,
  type GroqResponsesDiagnosticProvider,
  type GroqResponsesDiagnosticRequestBody,
  type GroqResponsesDiagnosticResult,
  type GroqResponsesResponse,
} from './groq-responses-diagnostic.js';

// MVP-P2A.2 HF4-R7. The provider-facing strict-schema projection. Exported because the candidate
// evidence operator is the only package that can see BOTH this gateway and the real Riya schemas, and
// "the production Riya schema projects into the documented Groq subset" is a claim that has to be
// asserted against the real schema rather than a replica. It is a pure function over a JSON Schema
// document: no credential, no transport, no configuration, and it never mutates its input.
export {
  GROQ_STRICT_PROJECTION_REASONS,
  projectGroqStrictJsonSchema,
  renderStructuredJsonSchema,
  type GroqStrictProjection,
  type GroqStrictProjectionReason,
} from './groq-strict-schema-projection.js';

// QFJ-S1 staging binding (ADR-0060) — a release-driven factory over the existing adapter. No live call.
export type {
  GroqCredentialReference,
  GroqCredentialResolver,
} from './groq-credential-resolver.js';
export {
  bindGroqStagingProvider,
  type GroqStagingRelease,
  type GroqStagingBindingConfig,
  type GroqStagingBindResult,
} from './groq-staging-binding.js';
export {
  GROQ_STAGING_BIND_REASONS,
  GROQ_STAGING_EVENT_TYPES,
  NOOP_GROQ_STAGING_OBSERVABILITY,
  type GroqStagingBindReason,
  type GroqStagingEventType,
  type GroqStagingBindEvent,
  type GroqStagingObservabilityHook,
} from './groq-staging-observability.js';
