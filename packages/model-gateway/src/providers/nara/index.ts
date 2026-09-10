/**
 * The NaraRouter hosted provider (JF-2A, ADR-0146).
 *
 * The barrel exposes the composition symbols and the read-only types. It exposes NO credential
 * accessor and NO way to reach a non-official endpoint: the transport names one constant and refuses
 * everything else, and the key holder redacts itself in every serialization path.
 *
 * Nothing here is activated. Building a provider is not composing one, and composing one is not
 * switching production on — the production composition remains `OFF`-only until JF-2B says otherwise.
 */
export { NaraApiKey, createNaraApiKey } from './nara-secret.js';

export {
  NARA_CHAT_COMPLETIONS_ENDPOINT,
  NARA_MAX_RESPONSE_BYTES,
  createFetchNaraTransport,
} from './nara-transport.js';
export type { NaraHttpRequest, NaraHttpResponse, NaraTransport } from './nara-transport.js';

export {
  NARA_REFUSED_ROUTER_ALIASES,
  NARA_SUPPORTS_STRICT_JSON_SCHEMA,
  createNaraProviderConfig,
  isNaraRouterAlias,
} from './nara-config.js';
export type { NaraProviderConfig, NaraProviderConfigInput } from './nara-config.js';

export { normalizeNaraHttpStatus } from './nara-error-normalization.js';

export { NaraModelProvider } from './nara-model-provider.js';
