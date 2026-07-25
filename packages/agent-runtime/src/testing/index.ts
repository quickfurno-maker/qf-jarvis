/**
 * `@qf-jarvis/agent-runtime/testing` — deterministic test support (QFJ-M1, ADR-0054).
 *
 * A SEPARATE subpath so the test privacy gate and synthetic fixtures can never become production
 * defaults. No real message, subject, key, or token.
 */
export {
  createDeterministicPrivacyGate,
  type DeterministicPrivacyGateConfig,
} from './deterministic-privacy-gate.js';
export {
  syntheticPolicy,
  envelopeInput,
  contextInput,
  throwingModelInterface,
} from './fixtures.js';
export {
  orchestrationEnvelopeFields,
  scriptedContextPort,
  scriptedModelReplyPort,
  scriptedCoreDecisionPort,
  scriptedKnowledgePort,
  syntheticCitation,
  type RecordingContextPort,
  type RecordingModelReplyPort,
  type RecordingCoreDecisionPort,
} from './deterministic-orchestration-ports.js';
