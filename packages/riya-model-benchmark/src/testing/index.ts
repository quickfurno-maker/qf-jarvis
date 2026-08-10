/**
 * `@qf-jarvis/riya-model-benchmark/testing` — tiny invented fixtures.
 *
 * Separated from the root so nothing here can be mistaken for a shipped benchmark result. Every value
 * is fabricated to exercise a branch; none of it describes any model, engine or configuration.
 */
export {
  SYNTHETIC_BENCHMARK_INSTANT,
  syntheticDigest,
  syntheticSubject,
  syntheticLocalEnvironment,
  syntheticHostedEnvironment,
  syntheticWorkload,
  syntheticObservation,
  syntheticEvidence,
} from './fixtures.js';
export type { SyntheticSubjectOptions, SyntheticEvidenceOptions } from './fixtures.js';
