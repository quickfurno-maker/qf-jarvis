/**
 * `@qf-jarvis/jarvis-runtime/testing` — deterministic test support (QFJ-M5, ADR-0059).
 *
 * A SEPARATE subpath so the authoritative-state fakes and full-runtime fixtures can never become
 * production defaults. No real conversation, provider, Core, gateway, database, key, or token.
 */
export {
  clearControlState,
  scriptedAuthoritativeState,
  mutableAuthoritativeState,
  fixedClock,
  type RecordingAuthoritativeState,
  type MutableAuthoritativeState,
} from './deterministic-authoritative-state.js';
export {
  syntheticRuntimeConfig,
  syntheticInboundEnvelope,
} from './deterministic-runtime-fixture.js';
