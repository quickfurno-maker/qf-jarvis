/**
 * `@qf-jarvis/governed-knowledge/testing` — deterministic test support (QFJ-P04.03, ADR-0051).
 *
 * Exported from a SEPARATE subpath so the test privacy gate can never become a production default.
 * No real gate, no I/O, no Core erasure.
 */
export {
  createDeterministicPrivacyGate,
  type DeterministicPrivacyGateConfig,
} from './deterministic-privacy-gate.js';
