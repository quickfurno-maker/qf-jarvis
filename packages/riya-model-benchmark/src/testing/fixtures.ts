/**
 * TINY invented fixtures for the RMB-A specs. TESTING SUBPATH ONLY.
 *
 * ### None of this is a benchmark result
 *
 * Every identifier is obviously fake — `model.alpha`, `release.beta`, `engine.gamma` — and every
 * number is a round invention chosen to exercise a branch. No model was run, no configuration was
 * measured, and nothing here may be quoted as a performance characteristic of anything.
 *
 * That is worth being loud about. Plausible-looking benchmark numbers in a repository are quoted; the
 * fastest way for this slice to do harm would be to leave behind a fixture that reads like a result.
 */
import { createRiyaBenchmarkEnvironment } from '../contracts/environment.js';
import type { RiyaBenchmarkEnvironmentV1 } from '../contracts/environment.js';
import { createRiyaBenchmarkEvidence } from '../contracts/evidence.js';
import type { RiyaBenchmarkEvidenceV1 } from '../contracts/evidence.js';
import { createRiyaBenchmarkObservation } from '../contracts/observation.js';
import type { RiyaBenchmarkObservationV1 } from '../contracts/observation.js';
import { createRiyaBenchmarkSubject } from '../contracts/subject.js';
import type { RiyaBenchmarkSubjectV1 } from '../contracts/subject.js';
import { createRiyaBenchmarkWorkload } from '../contracts/workload.js';
import type { RiyaBenchmarkWorkloadV1 } from '../contracts/workload.js';

/** A fixed instant. Deterministic, so two runs of a spec produce identical digests. */
export const SYNTHETIC_BENCHMARK_INSTANT = '2026-01-01T00:00:00Z';

/** A 64-hex digest built from a short label. Obviously synthetic, obviously not a real hash. */
export function syntheticDigest(label: string): string {
  const body = label.replace(/[^a-f0-9]/gu, '');
  return (body.length > 0 ? body : 'a').repeat(64).slice(0, 64);
}

export interface SyntheticSubjectOptions {
  readonly releaseId?: string;
  readonly modelId?: string;
  readonly executionClass?: 'HOSTED' | 'LOCAL';
  readonly promptDigest?: string;
}

/** A minimal, valid subject over invented identities. */
export function syntheticSubject(options: SyntheticSubjectOptions = {}): RiyaBenchmarkSubjectV1 {
  return createRiyaBenchmarkSubject({
    version: 1,
    release: {
      releaseId: options.releaseId ?? 'release.beta',
      providerId: 'provider.alpha',
      modelId: options.modelId ?? 'model.alpha',
      modelVersion: 'v1',
      configDigest: syntheticDigest('cfa'),
      executionClass: options.executionClass ?? 'LOCAL',
    },
    promptFamily: 'prompt.family.alpha',
    promptVersion: 1,
    promptDigest: options.promptDigest ?? syntheticDigest('deadbeef'),
    capabilityProfileRef: 'capability.alpha',
    policyContractRevision: 'policy.r1',
  });
}

/** A local environment on invented hardware. */
export function syntheticLocalEnvironment(
  overrides: Partial<RiyaBenchmarkEnvironmentV1> = {},
): RiyaBenchmarkEnvironmentV1 {
  return createRiyaBenchmarkEnvironment({
    version: 1,
    kind: 'LOCAL_EXPLICIT',
    architectureFamily: 'ARM64',
    acceleratorFamily: 'UNIFIED_MEMORY',
    acceleratorRef: 'accelerator.alpha',
    acceleratorCount: 1,
    acceleratorMemoryBytesPerDevice: 34_359_738_368,
    hostMemoryBytes: 34_359_738_368,
    runtimeEngineId: 'engine.gamma',
    runtimeEngineVersion: 'v1',
    runtimeConfigDigest: syntheticDigest('cafe'),
    ...overrides,
  });
}

/** A hosted environment that claims no hardware, because it cannot see any. */
export function syntheticHostedEnvironment(): RiyaBenchmarkEnvironmentV1 {
  return createRiyaBenchmarkEnvironment({
    version: 1,
    kind: 'HOSTED_OPAQUE',
    runtimeEngineId: 'engine.delta',
    runtimeEngineVersion: 'v2',
    runtimeConfigDigest: syntheticDigest('beef'),
  });
}

/** A workload over an invented case. */
export function syntheticWorkload(
  overrides: Partial<RiyaBenchmarkWorkloadV1> = {},
): RiyaBenchmarkWorkloadV1 {
  return createRiyaBenchmarkWorkload({
    version: 1,
    benchmarkSuiteId: 'suite.alpha',
    benchmarkSuiteVersion: 1,
    benchmarkImplementationId: 'harness.alpha',
    benchmarkImplementationVersion: 1,
    workloadCaseId: 'case.alpha',
    promptProfileDigest: syntheticDigest('face'),
    inputTokenCount: 512,
    maximumOutputTokens: 256,
    concurrency: 1,
    batchSize: 1,
    warmupRequestCount: 2,
    measuredRequestCount: 20,
    streaming: true,
    samplingConfigDigest: syntheticDigest('dad'),
    measurementPolicyRef: 'policy.measure.v1',
    ...overrides,
  });
}

/** A healthy observation: everything succeeded, percentiles ordered, output produced. */
export function syntheticObservation(
  overrides: Partial<RiyaBenchmarkObservationV1> = {},
): RiyaBenchmarkObservationV1 {
  return createRiyaBenchmarkObservation({
    version: 1,
    attemptedRequests: 20,
    successfulRequests: 20,
    failedRequests: 0,
    inputTokensTotal: 10_240,
    outputTokensTotal: 4_096,
    timeToFirstTokenMicrosP50: 120_000,
    timeToFirstTokenMicrosP95: 260_000,
    endToEndLatencyMicrosP50: 900_000,
    endToEndLatencyMicrosP95: 1_500_000,
    decodeMicrosPerOutputTokenP50: 20_000,
    decodeMicrosPerOutputTokenP95: 40_000,
    peakAcceleratorMemoryBytes: 8_589_934_592,
    peakHostMemoryBytes: 4_294_967_296,
    ...overrides,
  });
}

export interface SyntheticEvidenceOptions {
  readonly subject?: RiyaBenchmarkSubjectV1;
  readonly environment?: RiyaBenchmarkEnvironmentV1;
  readonly workload?: RiyaBenchmarkWorkloadV1;
  readonly observation?: RiyaBenchmarkObservationV1;
}

/** A complete, valid, invented evidence artifact. */
export function syntheticEvidence(options: SyntheticEvidenceOptions = {}): RiyaBenchmarkEvidenceV1 {
  return createRiyaBenchmarkEvidence({
    version: 1,
    subject: options.subject ?? syntheticSubject(),
    environment: options.environment ?? syntheticLocalEnvironment(),
    workload: options.workload ?? syntheticWorkload(),
    observation: options.observation ?? syntheticObservation(),
    createdAt: SYNTHETIC_BENCHMARK_INSTANT,
  });
}
