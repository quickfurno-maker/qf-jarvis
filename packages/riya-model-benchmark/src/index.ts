/**
 * `@qf-jarvis/riya-model-benchmark` — the operational model-benchmark foundation (RMB-A).
 *
 * ### One of three evidence authorities, and the narrowest
 *
 * `@qf-jarvis/model-evaluation` owns generic SAFETY. `@qf-jarvis/riya-quality-evaluation` owns Riya
 * sales QUALITY. This package owns only what a stopwatch and a memory counter can say: latency,
 * decode speed, request success, memory, reproducibility.
 *
 * They are kept apart because the failure mode of merging them is a single number. Once latency,
 * quality and safety share a scale, a fast model with a bad refusal rate outranks a slower correct
 * one, and the arithmetic hides it. So this package cannot evaluate safety, cannot evaluate quality,
 * and exports nothing that looks like a verdict — no winner, no recommendation, no approval, no
 * overall score.
 *
 * ### Evidence only. It measures nothing
 *
 * Numbers arrive pre-supplied from a harness that ran elsewhere. There is no HTTP, no provider SDK,
 * no gateway call, no local inference engine, no model download, no `child_process`, no environment
 * lookup, no filesystem discovery, no database and no training framework. Its one Node capability is
 * `node:crypto`, for SHA-256 artifact identity.
 *
 * ### It carries no content
 *
 * A prompt reaches this package as a digest and a token count. There is no field a customer message,
 * an assistant reply, a system prompt, a Human Gold trajectory or a P10 fixture body would fit in —
 * and no hostname, username, path, serial, MAC, IP or credential either.
 *
 * ### It authorizes nothing
 *
 * Every artifact is `syntheticWorkload: true` with `productionApproval: false`, as literals. Speed is
 * not quality, quality is not safety, and none of the three is permission to ship.
 */

// Errors.
export { RiyaBenchmarkError, RIYA_BENCHMARK_ERROR_CODES } from './contracts/errors.js';
export type { RiyaBenchmarkErrorCode } from './contracts/errors.js';

// Closed vocabularies.
export {
  RIYA_BENCHMARK_ENVIRONMENT_KINDS,
  RIYA_BENCHMARK_ARCHITECTURE_FAMILIES,
  RIYA_BENCHMARK_ACCELERATOR_FAMILIES,
  RIYA_BENCHMARK_PARITY_MISMATCHES,
  RIYA_BENCHMARK_PARETO_RELATIONS,
  RIYA_BENCHMARK_MAX_REQUESTS,
  RIYA_BENCHMARK_MAX_TOKENS,
  RIYA_BENCHMARK_MAX_MICROS,
  RIYA_BENCHMARK_MAX_BYTES,
  RIYA_BENCHMARK_MAX_CONCURRENCY,
  RIYA_BENCHMARK_MAX_CASES,
} from './contracts/vocabularies.js';
export type {
  RiyaBenchmarkEnvironmentKind,
  RiyaBenchmarkArchitectureFamily,
  RiyaBenchmarkAcceleratorFamily,
  RiyaBenchmarkParityMismatch,
  RiyaBenchmarkParetoRelation,
} from './contracts/vocabularies.js';

// Subject — release identity REUSED from the evaluation package, never redefined.
export { createRiyaBenchmarkSubject } from './contracts/subject.js';
export type { RiyaBenchmarkSubjectV1, RiyaBenchmarkSubjectInput } from './contracts/subject.js';

// Environment.
export { createRiyaBenchmarkEnvironment } from './contracts/environment.js';
export type {
  RiyaBenchmarkEnvironmentV1,
  RiyaBenchmarkEnvironmentInput,
} from './contracts/environment.js';

// Workload.
export { createRiyaBenchmarkWorkload, workloadParityKey } from './contracts/workload.js';
export type { RiyaBenchmarkWorkloadV1, RiyaBenchmarkWorkloadInput } from './contracts/workload.js';

// Observation.
export { createRiyaBenchmarkObservation } from './contracts/observation.js';
export type {
  RiyaBenchmarkObservationV1,
  RiyaBenchmarkObservationInput,
} from './contracts/observation.js';

// Evidence.
export {
  createRiyaBenchmarkEvidence,
  riyaBenchmarkEvidenceIntegrityHolds,
  isCanonicalBenchmarkInstant,
} from './contracts/evidence.js';
export type { RiyaBenchmarkEvidenceV1, RiyaBenchmarkEvidenceInput } from './contracts/evidence.js';

// Result set and manifest.
export {
  createRiyaBenchmarkResultSet,
  riyaBenchmarkResultSetIntegrityHolds,
} from './service/result-set.js';
export type {
  RiyaBenchmarkResultSetV1,
  RiyaBenchmarkResultSetInput,
} from './service/result-set.js';

// Derived DISPLAY metrics. Not evidence, not scores.
export {
  successRateBasisPoints,
  approximateDecodeTokensPerSecondP50,
  approximateDecodeTokensPerSecondP95,
  meanOutputTokensPerSuccess,
} from './service/derived.js';

// Comparison. Parity or nothing, and no verdict either way.
export { compareRiyaBenchmarkResultSets } from './service/compare.js';
export type { RiyaBenchmarkComparison, RiyaBenchmarkAxisDelta } from './service/compare.js';
