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

// QFJ-S1 Groq staging-binding fakes (ADR-0060) — obvious fake sentinel credential, injected resolver,
// deterministic canned HTTP transport, synthetic approved release. No real key, no network.
export {
  FAKE_GROQ_SENTINEL_KEY,
  SYNTHETIC_GROQ_CREDENTIAL_REFERENCE,
  fakeGroqCredentialResolver,
  missingGroqCredentialResolver,
  fakeGroqTransport,
  groqStructuredResponseBody,
  syntheticGroqStagingRelease,
  type RecordingGroqCredentialResolver,
  type RecordingGroqTransport,
} from './groq-staging-testing.js';
