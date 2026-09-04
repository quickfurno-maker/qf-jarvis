/**
 * The sanitized local run manifest (AS4-PREP-A).
 *
 * ### It exists because the evidence deliberately cannot say these things
 *
 * RMB-A evidence records what was measured and under what identity. It has no field for "which prompt
 * profile was bound to which case", "how the output tokens were counted" or "was the endpoint proved
 * to be loopback" -- and it should not: those are properties of the RUN, not of the model, and putting
 * them in evidence would widen a contract three packages depend on for the sake of one adapter.
 *
 * So they live here, in a small artifact written beside the result set, joinable to it by suite id and
 * case ids.
 *
 * ### What it must never carry, and what the shape guarantees
 *
 * No host, no port, no URL, no path, no file path, no hostname, no username, no header, no credential,
 * no prompt text, no generated text and no engine log. Only `hostForm` -- which of the three loopback
 * spellings was used -- crosses over, and it is a closed vocabulary of three values rather than a
 * string somebody could put an address in.
 *
 * ### It authorizes nothing, and says so in the artifact
 *
 * `syntheticWorkload: true` and `productionApproval: false` are literals here for the same reason RMB-A
 * makes them literals: a performance manifest turning up in a review is exactly where somebody reads a
 * fast number as permission to ship.
 */
import type { RiyaBenchmarkResultSetV1 } from '@qf-jarvis/riya-model-benchmark';

import {
  RIYA_LOCAL_BENCHMARK_ADAPTER_ID,
  RIYA_LOCAL_BENCHMARK_ADAPTER_VERSION,
  RIYA_LOCAL_ENGINE_PROTOCOL_REF,
} from '../contracts/adapter-config.js';
import type { RiyaLocalBenchmarkAdapterConfigV1 } from '../contracts/adapter-config.js';
import type { RiyaLocalEndpointHostForm } from '../contracts/endpoint.js';
import {
  RIYA_SYNTHETIC_PROMPT_REGISTRY_REF,
  RIYA_SYNTHETIC_PROMPT_REGISTRY_VERSION,
} from '../prompts/synthetic-profiles.js';

export interface RiyaLocalBenchmarkRunManifestV1 {
  readonly version: 1;
  readonly adapterId: string;
  readonly adapterVersion: number;
  readonly engineProtocolRef: string;
  readonly benchmarkSuiteId: string;
  readonly benchmarkSuiteVersion: number;
  readonly caseIds: readonly string[];
  /** RMB-A's own identity for the result set this manifest accompanies. Never recomputed here. */
  readonly resultSetDigest: string;
  readonly promptRegistryRef: string;
  readonly promptRegistryVersion: number;
  readonly casePromptProfiles: Readonly<Record<string, string>>;
  readonly outputTokenAccounting: string;
  readonly samplingConfigDigest: string;
  readonly runtimeConfigDigest: string;
  /** Which loopback spelling was proved. NOT an address, and there is no field for one. */
  readonly endpointHostForm: RiyaLocalEndpointHostForm;
  readonly loopbackOnly: true;
  readonly acceleratorMemoryMeasured: false;
  readonly syntheticWorkload: true;
  readonly productionApproval: false;
  readonly createdAt: string;
}

export interface BuildRiyaLocalBenchmarkRunManifestOptions {
  readonly config: RiyaLocalBenchmarkAdapterConfigV1;
  readonly resultSet: RiyaBenchmarkResultSetV1;
  readonly benchmarkSuiteId: string;
  readonly benchmarkSuiteVersion: number;
  readonly endpointHostForm: RiyaLocalEndpointHostForm;
  readonly createdAt: string;
}

/** Build the manifest. Pure: it reads what already exists and invents nothing. */
export function buildRiyaLocalBenchmarkRunManifest(
  options: BuildRiyaLocalBenchmarkRunManifestOptions,
): RiyaLocalBenchmarkRunManifestV1 {
  const { config, resultSet } = options;
  return Object.freeze({
    version: 1 as const,
    adapterId: RIYA_LOCAL_BENCHMARK_ADAPTER_ID,
    adapterVersion: RIYA_LOCAL_BENCHMARK_ADAPTER_VERSION,
    engineProtocolRef: RIYA_LOCAL_ENGINE_PROTOCOL_REF,
    benchmarkSuiteId: options.benchmarkSuiteId,
    benchmarkSuiteVersion: options.benchmarkSuiteVersion,
    caseIds: Object.freeze([...resultSet.caseIds]),
    resultSetDigest: resultSet.resultSetDigest,
    promptRegistryRef: RIYA_SYNTHETIC_PROMPT_REGISTRY_REF,
    promptRegistryVersion: RIYA_SYNTHETIC_PROMPT_REGISTRY_VERSION,
    casePromptProfiles: Object.freeze({ ...config.casePromptProfiles }),
    outputTokenAccounting: config.outputTokenAccounting,
    samplingConfigDigest: config.samplingConfigDigest,
    runtimeConfigDigest: config.runtimeConfigDigest,
    endpointHostForm: options.endpointHostForm,
    loopbackOnly: true as const,
    // Stated rather than omitted. An absent memory column in a comparison table invites somebody to
    // assume it was zero; this says it was never measured, which is the true thing.
    acceleratorMemoryMeasured: false as const,
    syntheticWorkload: true as const,
    productionApproval: false as const,
    createdAt: options.createdAt,
  });
}
