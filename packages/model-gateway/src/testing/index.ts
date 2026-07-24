/**
 * `@qf-jarvis/model-gateway/testing` — the deterministic test double (QFJ-P04.01A, ADR-0045).
 *
 * Exported from a SEPARATE subpath so the `FakeModelProvider` can never become a production default.
 * No real provider, no network, no key.
 */
export {
  FakeModelProvider,
  completedText,
  completedStructured,
  timedOut,
  providerFailed,
  providerUnavailable,
  providerMalformed,
  providerCancelled,
  type FakeModelProviderConfig,
} from './fake-model-provider.js';
