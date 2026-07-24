/**
 * The local-provider composition surface (QFJ-P04.01C, ADR-0047).
 *
 * Re-exports ONLY the minimum stable composition symbols. Raw HTTP request/response types, the response
 * schema, the error-normalization table, the internal IP parsers, and the Authorization builder stay
 * internal and never leave the package. No token accessor and no server-specific (Ollama/vLLM/llama.cpp)
 * type is exported.
 */
export { LocalOpenAICompatibleModelProvider } from './local-model-provider.js';
export {
  createLocalProviderConfig,
  type LocalProviderConfig,
  type LocalProviderConfigInput,
} from './local-provider-config.js';
export {
  createLocalEndpoint,
  LocalEndpointDescriptor,
  LOCAL_CHAT_COMPLETIONS_PATH,
  type LocalAddressCategory,
  type LocalEndpointOptions,
} from './local-endpoint-policy.js';
export { LocalAuthToken, createLocalAuthToken } from './local-secret.js';
export { createFetchLocalTransport, type LocalTransport } from './local-transport.js';
export { type LocalStructuredOutputSupport } from './local-structured-output.js';
