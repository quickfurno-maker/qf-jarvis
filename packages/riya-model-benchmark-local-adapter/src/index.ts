/**
 * `@qf-jarvis/riya-model-benchmark-local-adapter` — the local engine adapter (AS4-PREP-A).
 *
 * ### It is the implementation RMB-B pointed at, and it changed nothing to exist
 *
 * RMB-B's target port was written so that a real adapter would be an implementation of it rather than
 * a modification of anything — and emphatically not an addition to the production model gateway, which
 * serves customers. This package is that implementation. RMB-A's contracts, RMB-B's ports, the port
 * firewall, the parity rules and the gateway are all byte-for-byte unchanged.
 *
 * ### It benchmarks a process on THIS machine, and cannot reach any other
 *
 * The destination is a value only the endpoint constructor can produce; it accepts three loopback
 * spellings over plain `http` on an explicit port, and nothing else. Requests name a PATH from a
 * closed list, never a URL, so the layer that decides what to send cannot decide where. Redirects are
 * refused rather than followed, at the transport and again at the adapter.
 *
 * There is no `apiKey`, no `authorization` header, no bearer token, no header input and no environment
 * read anywhere in the surface. Not unused — absent.
 *
 * ### It downloads nothing, selects nothing, and trains nothing
 *
 * No model weights, no tokenizer file, no dataset, no checkpoint, no fine-tune, no quantization. It
 * produces operational evidence about a release somebody else has already started serving, and
 * evidence is not a decision: nothing here ranks, scores, recommends or approves.
 *
 * ### Prompts are synthetic and closed
 *
 * Benchmark text comes from a generated registry in this package. No Human Gold trajectory, no P10
 * exam fixture, no live customer message, no CRM record and no production system prompt can reach it —
 * there is no code path that reads one. The materialized bytes are proved to hash to the digest the
 * plan declared BEFORE warmup, so a case whose prompt cannot be reproduced fails before it is measured.
 *
 * ### Counts are exact or absent
 *
 * Input tokens come from the engine's own tokenizer through an injected port, never from a character
 * estimate. Output tokens are either strictly-validated server usage or an exact local count, declared
 * in the configuration and folded into the runtime config digest. Peak memory is not reported at all,
 * because no honest engine-independent probe exists yet and a fabricated zero would sit in a comparison
 * table beside real readings.
 */

// Errors.
export { RiyaLocalBenchmarkError, RIYA_LOCAL_BENCHMARK_ERROR_CODES } from './contracts/errors.js';
export type { RiyaLocalBenchmarkErrorCode } from './contracts/errors.js';

// The loopback endpoint — the containment boundary, as a value.
export {
  createRiyaLocalEngineEndpoint,
  riyaLocalEngineRequestUrl,
  RIYA_LOCAL_ENDPOINT_HOST_FORMS,
  RIYA_LOCAL_ENGINE_PATHS,
} from './contracts/endpoint.js';
export type {
  RiyaLocalEngineEndpointV1,
  RiyaLocalEndpointHostForm,
  RiyaLocalEnginePath,
} from './contracts/endpoint.js';

// The two injected ports.
export type {
  RiyaLocalChatMessage,
  RiyaLocalEngineHttpRequest,
  RiyaLocalEngineHttpResponse,
  RiyaLocalEngineMethod,
  RiyaLocalEngineTransportPort,
  RiyaLocalTokenizerPort,
} from './contracts/engine-ports.js';

// Configuration, and the two digests a suite plan must be authored against.
export {
  createRiyaLocalBenchmarkAdapterConfig,
  riyaLocalBenchmarkSamplingDigest,
  isExactServedModelId,
  RIYA_LOCAL_BENCHMARK_ADAPTER_ID,
  RIYA_LOCAL_BENCHMARK_ADAPTER_VERSION,
  RIYA_LOCAL_ENGINE_PROTOCOL_REF,
  RIYA_LOCAL_OUTPUT_TOKEN_ACCOUNTING,
  RIYA_LOCAL_SAMPLING_CONTRACT_REF,
} from './contracts/adapter-config.js';
export type {
  RiyaLocalBenchmarkAdapterConfigV1,
  RiyaLocalBenchmarkAdapterConfigInput,
  RiyaLocalBenchmarkEnvironmentInput,
  RiyaLocalBenchmarkSamplingV1,
  RiyaLocalOutputTokenAccounting,
} from './contracts/adapter-config.js';

// The closed synthetic prompt registry.
export {
  materializeRiyaSyntheticPromptProfile,
  riyaSyntheticPromptProfileDigest,
  isRiyaSyntheticPromptProfileId,
  RIYA_SYNTHETIC_PROMPT_PROFILE_IDS,
  RIYA_SYNTHETIC_PROMPT_REGISTRY_REF,
  RIYA_SYNTHETIC_PROMPT_REGISTRY_VERSION,
} from './prompts/synthetic-profiles.js';
export type { RiyaSyntheticPromptProfileId } from './prompts/synthetic-profiles.js';

// The target, the transport, the tokenizer and the clock.
export { createRiyaLocalBenchmarkTarget } from './service/local-engine-target.js';
export type {
  RiyaLocalBenchmarkTarget,
  CreateRiyaLocalBenchmarkTargetOptions,
} from './service/local-engine-target.js';
export { createRiyaLoopbackEngineTransport } from './service/loopback-transport.js';
export { createRiyaLocalEngineUsageTokenizer } from './service/engine-usage-tokenizer.js';
export type { CreateRiyaLocalEngineUsageTokenizerOptions } from './service/engine-usage-tokenizer.js';
export { createRiyaLocalMonotonicClock } from './service/monotonic-clock.js';

// Offline plan/config agreement, proved with no engine.
export { preflightRiyaLocalBenchmark } from './service/preflight.js';
export type {
  RiyaLocalBenchmarkPreflight,
  RiyaLocalBenchmarkPreflightCase,
} from './service/preflight.js';

// The sanitized run manifest and the artifact writer.
export { buildRiyaLocalBenchmarkRunManifest } from './service/run-manifest.js';
export type { RiyaLocalBenchmarkRunManifestV1 } from './service/run-manifest.js';
export {
  createRiyaLocalArtifactWriter,
  RIYA_LOCAL_RESULT_SET_FILENAME,
  RIYA_LOCAL_RUN_MANIFEST_FILENAME,
} from './service/artifact-writer.js';
export type { RiyaLocalArtifactWriter } from './service/artifact-writer.js';

// The CLI, exported so its decisions are provable without spawning a process.
export {
  runRiyaLocalBenchmarkCli,
  parseRiyaLocalCliArgs,
  RIYA_LOCAL_CLI_USAGE,
  RIYA_LOCAL_EXIT_OK,
  RIYA_LOCAL_EXIT_RUNNER_FAILURE,
  RIYA_LOCAL_EXIT_USAGE,
} from './cli/local-benchmark.js';
export type { RiyaLocalCliArgs, RunRiyaLocalBenchmarkCliOptions } from './cli/local-benchmark.js';
