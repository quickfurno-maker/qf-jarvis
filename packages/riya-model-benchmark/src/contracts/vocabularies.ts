/**
 * The closed vocabularies of operational benchmark evidence (RMB-A).
 *
 * Small on purpose. Every axis here is something a measurement harness can state as a fact; nothing
 * here is a judgement. There is no quality dimension, no severity, no verdict and no approval — those
 * belong to the generic model-evaluation package (safety) and the Riya quality evaluator (P10 sales
 * quality), and a benchmark package that grew its own would be inviting somebody to read a latency
 * number as permission to ship.
 */

/**
 * How much the environment can honestly disclose.
 *
 * `LOCAL_EXPLICIT` — the measurement ran on hardware whose family, accelerator and memory can be
 * stated without identifying a machine.
 *
 * `HOSTED_OPAQUE` — the measurement ran behind a provider API. Nobody knows the hardware, so nothing
 * is claimed about it. This is a first-class case rather than a gap to be filled: a hosted benchmark
 * with invented accelerator details is worse than one that admits what it cannot see, because the
 * invented detail is what somebody will later compare against.
 */
export const RIYA_BENCHMARK_ENVIRONMENT_KINDS = ['LOCAL_EXPLICIT', 'HOSTED_OPAQUE'] as const;
export type RiyaBenchmarkEnvironmentKind = (typeof RIYA_BENCHMARK_ENVIRONMENT_KINDS)[number];

/**
 * Broad hardware families. Deliberately coarse.
 *
 * A family is comparable across runs; a serial number, a SKU or a cloud instance id identifies a
 * machine, and none of those belong in an artifact that gets committed and shared.
 */
export const RIYA_BENCHMARK_ARCHITECTURE_FAMILIES = [
  'X86_64',
  'ARM64',
  'APPLE_SILICON',
  'OTHER',
] as const;
export type RiyaBenchmarkArchitectureFamily = (typeof RIYA_BENCHMARK_ARCHITECTURE_FAMILIES)[number];

/** Broad accelerator families. Same reasoning, same coarseness. */
export const RIYA_BENCHMARK_ACCELERATOR_FAMILIES = [
  'NONE',
  'CPU_ONLY',
  'DISCRETE_GPU',
  'INTEGRATED_GPU',
  'UNIFIED_MEMORY',
  'OTHER',
] as const;
export type RiyaBenchmarkAcceleratorFamily = (typeof RIYA_BENCHMARK_ACCELERATOR_FAMILIES)[number];

/**
 * Why two evidence sets are not comparable.
 *
 * Each code names ONE broken parity condition. A single `NOT_COMPARABLE` would tell an owner to go
 * and diff two artifacts by hand; naming the axis tells them what to re-run.
 */
export const RIYA_BENCHMARK_PARITY_MISMATCHES = [
  'SUITE_MISMATCH',
  'SUITE_VERSION_MISMATCH',
  'IMPLEMENTATION_MISMATCH',
  'IMPLEMENTATION_VERSION_MISMATCH',
  'WORKLOAD_CASE_SET_MISMATCH',
  'PROMPT_PROFILE_MISMATCH',
  'INPUT_TOKEN_COUNT_MISMATCH',
  'MAX_OUTPUT_TOKENS_MISMATCH',
  'CONCURRENCY_MISMATCH',
  'BATCH_SIZE_MISMATCH',
  'WARMUP_COUNT_MISMATCH',
  'MEASURED_COUNT_MISMATCH',
  'STREAMING_MISMATCH',
  'SAMPLING_CONFIG_MISMATCH',
  'MEASUREMENT_POLICY_MISMATCH',
] as const;
export type RiyaBenchmarkParityMismatch = (typeof RIYA_BENCHMARK_PARITY_MISMATCHES)[number];

/**
 * There is deliberately NO relation/verdict vocabulary here.
 *
 * A Pareto relation (`A_DOMINATES` / `TRADEOFF` / `EQUIVALENT` / …) was drafted and removed. Dominance
 * needs every axis present on both sides, and memory is optional — an unmeasured axis silently drops
 * out of the relation, so "equivalent" could quietly mean "equal on the axes we happened to share".
 * That reads as a stronger claim than the data supports, and a summary that overstates is worse than
 * no summary.
 *
 * Comparison returns named parity mismatches and side-by-side deltas. Reading them is the owner's job.
 */

/** Upper bounds, so a malformed harness cannot smuggle an absurd integer into evidence. */
export const RIYA_BENCHMARK_MAX_REQUESTS = 1_000_000;
export const RIYA_BENCHMARK_MAX_TOKENS = 1_000_000_000;
export const RIYA_BENCHMARK_MAX_MICROS = 86_400_000_000;
export const RIYA_BENCHMARK_MAX_BYTES = 1_125_899_906_842_624;
export const RIYA_BENCHMARK_MAX_CONCURRENCY = 4_096;
export const RIYA_BENCHMARK_MAX_CASES = 4_096;
