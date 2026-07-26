/**
 * `@qf-jarvis/groq-staging-smoke/testing` — the deterministic smoke fakes (QFJ-S1A, ADR-0061 §J).
 *
 * Exported from a SEPARATE subpath so a scripted terminal or a sentinel credential can never become a
 * production default. No real credential, no real terminal, no network.
 */
export {
  FAKE_SMOKE_SENTINEL_CREDENTIAL,
  scriptedSecretSource,
  manualSmokeTimer,
  syntheticSmokeConfigInput,
  smokeProbeResponseBody,
  type ScriptedSecretSource,
  type ManualSmokeTimer,
} from './smoke-testing.js';
