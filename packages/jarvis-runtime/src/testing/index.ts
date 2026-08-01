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
  // QFJ-P08-A (ADR-0075): the TEST-ONLY controllable source. Not persistence -- process memory only.
  controllableAuthoritativeState,
  type RecordingAuthoritativeState,
  type MutableAuthoritativeState,
  type ControllableAuthoritativeState,
} from './deterministic-authoritative-state.js';
export {
  syntheticRuntimeConfig,
  syntheticInboundEnvelope,
  scriptedBehaviourInput,
  rejectingBehaviourInput,
  syntheticSignals,
  syntheticPromptRegistry,
  syntheticPromptDefinition,
} from './deterministic-runtime-fixture.js';
