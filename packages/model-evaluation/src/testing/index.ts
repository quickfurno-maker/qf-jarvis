/**
 * `@qf-jarvis/model-evaluation/testing` — synthetic fixtures (QFJ-P04.04, ADR-0052).
 *
 * Exported from a SEPARATE subpath so synthetic fixture content can never be mistaken for production
 * data or evidence. Everything here is synthetic; there is no real data, key, or token.
 */
export {
  createSyntheticBinding,
  createSyntheticThresholds,
  buildFoundationScenarios,
  buildFoundationSuite,
  safeObservationFor,
  safeObservations,
  failingObservationFor,
} from './fixtures.js';
