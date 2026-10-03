/**
 * What a local benchmark run is configured to be (AS4-PREP-A).
 *
 * ### Identity is REUSED, and the served model is the release
 *
 * `subject` is built through RMB-A's `createRiyaBenchmarkSubject`, which builds its `release` through
 * the evaluation package's own `createProviderReleaseRef`. This file defines no `modelId`, no
 * `providerId`, no `executionClass` and no release grammar -- benchmark evidence and safety evidence
 * exist to be read together, and a second grammar is how they stop joining.
 *
 * The model the engine is asked to serve is NOT a separate field. It is `release.modelId`, exactly.
 * A separate `servedModelName` would be the field where "we measured the 14B and stamped it as the
 * 32B" lives, and no reviewer would see it -- the two strings would sit six lines apart and both look
 * plausible. Requiring the operator to launch the engine under the exact catalogue id costs one flag
 * and removes the whole class.
 *
 * ### Aliases are refused beyond the release rule
 *
 * The release grammar already refuses `*` and a `latest` segment. A local server adds spellings that
 * a hosted catalogue does not: `default`, `auto`, `any`, `current`, `stable`, `model`. Each names
 * whatever the engine happened to load, which is the same defect one word along, so each is refused
 * here. This is an ADDITION for local serving, not a restatement of the release rule.
 *
 * ### The runtime config digest is DERIVED, not authored
 *
 * RMB-A requires `runtimeConfigDigest` for a `LOCAL_EXPLICIT` environment, and an authored one is a
 * promise somebody has to remember to keep: change the sampling temperature or the token-accounting
 * method, forget to bump the digest, and two incomparable runs compare as equal. So the adapter
 * computes it from the values it actually used.
 *
 * It deliberately excludes the host, the port and the path. Those are machine identity, and RMB-A's
 * environment contract exists precisely so an artifact can be committed without carrying one.
 */
import {
  createRiyaBenchmarkEnvironment,
  createRiyaBenchmarkSubject,
  RIYA_BENCHMARK_ACCELERATOR_FAMILIES,
  RIYA_BENCHMARK_ARCHITECTURE_FAMILIES,
  RIYA_BENCHMARK_MAX_BYTES,
} from '@qf-jarvis/riya-model-benchmark';
import type {
  RiyaBenchmarkEnvironmentV1,
  RiyaBenchmarkSubjectV1,
} from '@qf-jarvis/riya-model-benchmark';
import { z } from 'zod';

import { RiyaLocalBenchmarkError } from './errors.js';
import { sha256OfCanonical } from '../internal/digest.js';
import {
  isRiyaSyntheticPromptProfileId,
  RIYA_SYNTHETIC_PROMPT_REGISTRY_REF,
  RIYA_SYNTHETIC_PROMPT_REGISTRY_VERSION,
} from '../prompts/synthetic-profiles.js';

/** Who this adapter is, in the runtime configuration identity. Bump with any protocol change. */
export const RIYA_LOCAL_BENCHMARK_ADAPTER_ID = 'riya-local-benchmark-adapter';
export const RIYA_LOCAL_BENCHMARK_ADAPTER_VERSION = 1;

/** The engine surface this adapter speaks. One protocol, named, so evidence records which. */
export const RIYA_LOCAL_ENGINE_PROTOCOL_REF = 'openai-compatible-chat-completions.stream.v1';

/** Which sampling contract a digest was computed under. */
export const RIYA_LOCAL_SAMPLING_CONTRACT_REF = 'riya.local.benchmark.sampling.v1';

/**
 * How the output token count is arrived at.
 *
 * `SERVER_REPORTED_USAGE` -- the engine's own `usage.completion_tokens`, strictly validated.
 * `LOCAL_TOKENIZER_COUNT` -- an exact count of the generated text by an injected tokenizer.
 *
 * There is deliberately no third mode. "Estimate from characters" would put a number that is not a
 * token count into a field called `outputTokens`, and it would be the number a throughput figure is
 * divided by.
 */
export const RIYA_LOCAL_OUTPUT_TOKEN_ACCOUNTING = [
  'SERVER_REPORTED_USAGE',
  'LOCAL_TOKENIZER_COUNT',
] as const;
export type RiyaLocalOutputTokenAccounting = (typeof RIYA_LOCAL_OUTPUT_TOKEN_ACCOUNTING)[number];

/** Deterministic decoding settings. Every one of them changes the measurement. */
export interface RiyaLocalBenchmarkSamplingV1 {
  readonly temperature: number;
  readonly topP: number;
  readonly seed: number;
}

/** The local environment, minus the digest this package derives. */
export interface RiyaLocalBenchmarkEnvironmentInput {
  readonly architectureFamily: (typeof RIYA_BENCHMARK_ARCHITECTURE_FAMILIES)[number];
  readonly acceleratorFamily: (typeof RIYA_BENCHMARK_ACCELERATOR_FAMILIES)[number];
  readonly acceleratorRef: string;
  readonly acceleratorCount: number;
  /** Optional, and only if honestly known. Absent means not known, never zero. */
  readonly acceleratorMemoryBytesPerDevice?: number;
  readonly hostMemoryBytes?: number;
  readonly runtimeEngineId: string;
  readonly runtimeEngineVersion: string;
}

export interface RiyaLocalBenchmarkAdapterConfigInput {
  readonly version: 1;
  /** RMB-A subject input. Its `release.modelId` is the model the engine must be serving. */
  readonly subject: RiyaBenchmarkSubjectV1;
  readonly environment: RiyaLocalBenchmarkEnvironmentInput;
  readonly sampling: RiyaLocalBenchmarkSamplingV1;
  readonly outputTokenAccounting: RiyaLocalOutputTokenAccounting;
  /** `workloadCaseId` -> synthetic prompt profile id. Exhaustive for the plan that will be run. */
  readonly casePromptProfiles: Readonly<Record<string, string>>;
}

export interface RiyaLocalBenchmarkAdapterConfigV1 {
  readonly version: 1;
  readonly subject: RiyaBenchmarkSubjectV1;
  readonly environment: RiyaBenchmarkEnvironmentV1;
  readonly sampling: RiyaLocalBenchmarkSamplingV1;
  readonly samplingConfigDigest: string;
  readonly runtimeConfigDigest: string;
  readonly outputTokenAccounting: RiyaLocalOutputTokenAccounting;
  readonly casePromptProfiles: Readonly<Record<string, string>>;
  /** The exact model the engine must report. Always `subject.release.modelId`. */
  readonly servedModelId: string;
}

/** Spellings that name whatever the engine happened to load. Refused, case-insensitively. */
const ALIAS_SEGMENTS = new Set(['default', 'auto', 'any', 'current', 'stable', 'model', 'local']);

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const samplingSchema = z
  .object({
    // Bounded and finite. A benchmark wants reproducible decoding; the values themselves are the
    // operator's call, and 0 / 1 / a fixed seed is the reproducible choice.
    temperature: z.number().min(0).max(2),
    topP: z.number().min(0).max(1),
    seed: z.int().min(0).max(2_147_483_647),
  })
  .strict();

const environmentSchema = z
  .object({
    architectureFamily: z.enum(RIYA_BENCHMARK_ARCHITECTURE_FAMILIES),
    acceleratorFamily: z.enum(RIYA_BENCHMARK_ACCELERATOR_FAMILIES),
    acceleratorRef: IDENTIFIER,
    acceleratorCount: z.int().min(0).max(1_024),
    acceleratorMemoryBytesPerDevice: z.int().min(1).max(RIYA_BENCHMARK_MAX_BYTES).optional(),
    hostMemoryBytes: z.int().min(1).max(RIYA_BENCHMARK_MAX_BYTES).optional(),
    runtimeEngineId: IDENTIFIER,
    runtimeEngineVersion: IDENTIFIER,
  })
  .strict();

const configSchema = z
  .object({
    version: z.literal(1),
    // Re-proved by RMB-A's own constructor below. A second schema here would be the fork the whole
    // identity-reuse argument exists to avoid.
    subject: z.unknown(),
    environment: environmentSchema,
    sampling: samplingSchema,
    outputTokenAccounting: z.enum(RIYA_LOCAL_OUTPUT_TOKEN_ACCOUNTING),
    casePromptProfiles: z.record(
      z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9._:-]+$/u),
      z.string().min(1).max(128),
    ),
  })
  .strict();

/**
 * The sampling identity a suite plan must declare.
 *
 * Exported so a plan author computes it rather than transcribing it. A plan and an adapter that
 * disagree about sampling are measuring two different models of decoding, and RMB-B refuses the case
 * before warmup -- but only if both sides derived the digest the same way.
 */
export function riyaLocalBenchmarkSamplingDigest(sampling: RiyaLocalBenchmarkSamplingV1): string {
  const parsed = samplingSchema.safeParse(sampling);
  if (!parsed.success) {
    throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
  }
  return sha256OfCanonical({
    samplingContractRef: RIYA_LOCAL_SAMPLING_CONTRACT_REF,
    temperature: parsed.data.temperature,
    topP: parsed.data.topP,
    seed: parsed.data.seed,
  });
}

/** True iff every `/`-separated segment is an exact served-model name rather than an alias. */
export function isExactServedModelId(modelId: string): boolean {
  if (modelId.length === 0 || modelId.length > 128) {
    return false;
  }
  return modelId
    .split('/')
    .every((segment) => segment.length > 0 && !ALIAS_SEGMENTS.has(segment.toLowerCase()));
}

/**
 * Validate and freeze an adapter configuration. Throws a closed local code.
 *
 * Everything expensive to get wrong is decided here, before a socket exists: the release identity, the
 * served model name, the environment, the sampling identity and the prompt-profile bindings. A run
 * that cannot be configured never reaches an engine.
 */
export function createRiyaLocalBenchmarkAdapterConfig(
  input: RiyaLocalBenchmarkAdapterConfigInput,
): RiyaLocalBenchmarkAdapterConfigV1 {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
  }

  let subject: RiyaBenchmarkSubjectV1;
  try {
    subject = createRiyaBenchmarkSubject(input.subject);
  } catch {
    // RMB-A's refusal, translated. A caller configuring a local benchmark should not have to catch a
    // RiyaBenchmarkError.
    throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
  }

  // A LOCAL adapter measuring something the release says is hosted would stamp a hosted release with
  // local hardware evidence -- an artifact that reads as a measurement of a machine nobody ran.
  if (subject.release.executionClass !== 'LOCAL') {
    throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
  }
  if (!isExactServedModelId(subject.release.modelId)) {
    throw new RiyaLocalBenchmarkError('MODEL_IDENTITY_NOT_EXACT');
  }

  const environmentInput = parsed.data.environment;
  const sampling = parsed.data.sampling;
  const samplingConfigDigest = riyaLocalBenchmarkSamplingDigest(sampling);

  // Every value that changes what was measured, and nothing that identifies a machine.
  const runtimeConfigDigest = sha256OfCanonical({
    adapterId: RIYA_LOCAL_BENCHMARK_ADAPTER_ID,
    adapterVersion: RIYA_LOCAL_BENCHMARK_ADAPTER_VERSION,
    engineProtocolRef: RIYA_LOCAL_ENGINE_PROTOCOL_REF,
    runtimeEngineId: environmentInput.runtimeEngineId,
    runtimeEngineVersion: environmentInput.runtimeEngineVersion,
    servedModelId: subject.release.modelId,
    outputTokenAccounting: parsed.data.outputTokenAccounting,
    promptRegistryRef: RIYA_SYNTHETIC_PROMPT_REGISTRY_REF,
    promptRegistryVersion: RIYA_SYNTHETIC_PROMPT_REGISTRY_VERSION,
    samplingConfigDigest,
    streaming: true,
  });

  let environment: RiyaBenchmarkEnvironmentV1;
  try {
    environment = createRiyaBenchmarkEnvironment({
      version: 1,
      kind: 'LOCAL_EXPLICIT',
      architectureFamily: environmentInput.architectureFamily,
      acceleratorFamily: environmentInput.acceleratorFamily,
      acceleratorRef: environmentInput.acceleratorRef,
      acceleratorCount: environmentInput.acceleratorCount,
      ...(environmentInput.acceleratorMemoryBytesPerDevice === undefined
        ? {}
        : { acceleratorMemoryBytesPerDevice: environmentInput.acceleratorMemoryBytesPerDevice }),
      ...(environmentInput.hostMemoryBytes === undefined
        ? {}
        : { hostMemoryBytes: environmentInput.hostMemoryBytes }),
      runtimeEngineId: environmentInput.runtimeEngineId,
      runtimeEngineVersion: environmentInput.runtimeEngineVersion,
      runtimeConfigDigest,
    });
  } catch {
    throw new RiyaLocalBenchmarkError('ADAPTER_CONFIG_INVALID');
  }

  const casePromptProfiles: Record<string, string> = {};
  for (const [caseId, profileId] of Object.entries(parsed.data.casePromptProfiles)) {
    // A binding to something outside the closed registry is refused HERE, not at prepare time: a
    // configuration that names a prompt nobody can produce should never reach a benchmark run.
    if (!isRiyaSyntheticPromptProfileId(profileId)) {
      throw new RiyaLocalBenchmarkError('PROMPT_PROFILE_UNKNOWN');
    }
    casePromptProfiles[caseId] = profileId;
  }

  return Object.freeze({
    version: 1 as const,
    subject,
    environment,
    sampling: Object.freeze({ ...sampling }),
    samplingConfigDigest,
    runtimeConfigDigest,
    outputTokenAccounting: parsed.data.outputTokenAccounting,
    casePromptProfiles: Object.freeze(casePromptProfiles),
    servedModelId: subject.release.modelId,
  });
}
