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
