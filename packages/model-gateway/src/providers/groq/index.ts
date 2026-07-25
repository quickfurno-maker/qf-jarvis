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
