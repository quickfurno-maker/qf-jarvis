/**
 * The immutable model capability profile (QFJ-P04.02, ADR-0050).
 *
 * A profile binds a declared TECHNICAL capability set to an exact {@link ProviderReleaseRef} identity
 * (release/provider/model/version/config-digest + execution class). It carries NO business rule, agent
 * prompt text, secret, provider SDK object, or arbitrary metadata bag, and it must not declare a
 * capability that evidence does not support. Declared capability is NOT evaluation approval — the optional
 * `evaluationApprovalRef` is an opaque forward reference only; QFJ-P04.04 owns evaluation evidence.
 */
import { z } from 'zod';

import { MODEL_RESULT_MODES, type ModelResultMode } from '../contracts/enums.js';
import {
  createProviderReleaseRef,
  type ProviderReleaseRef,
} from '../operations/provider-release.js';
import {
  MODEL_TASK_CLASSES,
  STRUCTURED_OUTPUT_MODES,
  type ModelTaskClass,
  type StructuredOutputMode,
} from './task-classes.js';

const REFERENCE = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/);

/** The immutable capability profile. */
export interface ModelCapabilityProfile {
  readonly release: ProviderReleaseRef;
  readonly taskClasses: readonly ModelTaskClass[];
  readonly resultModes: readonly ModelResultMode[];
  readonly structuredOutputMode: StructuredOutputMode;
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsNonStreaming: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsTimeout: boolean;
  readonly supportsCancellation: boolean;
  readonly promptProfileRef: string | undefined;
  readonly costProfileRef: string | undefined;
  readonly evaluationApprovalRef: string | undefined;
}

/** What a caller supplies to build a profile. `release` is a validated {@link ProviderReleaseRef}. */
export interface ModelCapabilityProfileInput {
  readonly release: ProviderReleaseRef;
  readonly taskClasses: readonly ModelTaskClass[];
  readonly resultModes: readonly ModelResultMode[];
  readonly structuredOutputMode: StructuredOutputMode;
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsStreaming?: boolean;
  readonly supportsTimeout: boolean;
  readonly supportsCancellation: boolean;
  readonly promptProfileRef?: string;
  readonly costProfileRef?: string;
  readonly evaluationApprovalRef?: string;
}

const primitivesSchema = z
  .object({
    taskClasses: z.array(z.enum(MODEL_TASK_CLASSES)).min(1).max(MODEL_TASK_CLASSES.length),
    resultModes: z.array(z.enum(MODEL_RESULT_MODES)).min(1).max(MODEL_RESULT_MODES.length),
    structuredOutputMode: z.enum(STRUCTURED_OUTPUT_MODES),
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(1_000_000),
    supportsStreaming: z.boolean(),
    supportsTimeout: z.boolean(),
    supportsCancellation: z.boolean(),
    promptProfileRef: REFERENCE.optional(),
    costProfileRef: REFERENCE.optional(),
    evaluationApprovalRef: REFERENCE.optional(),
  })
  .strict();

function isReleaseRef(value: unknown): value is ProviderReleaseRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    createProviderReleaseRef(value);
    return true;
  } catch {
    return false;
  }
}

function uniqueArray(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Validate and freeze a capability profile. Rejects: an invalid release identity; a duplicate/unknown task
 * or result mode; a structured/result-mode incoherence (STRUCTURED result requires a non-`unsupported`
 * structured mode, and a non-`unsupported` structured mode requires the STRUCTURED result mode); a
 * completion budget above the input/context budget; and a non-streaming flag of false (current serving is
 * non-streaming). Throws a fixed-message error on any violation.
 */
export function createModelCapabilityProfile(
  input: ModelCapabilityProfileInput,
): ModelCapabilityProfile {
  if (!isReleaseRef(input.release)) {
    throw new Error('A capability profile requires a valid ProviderReleaseRef.');
  }
  const parsed = primitivesSchema.safeParse({
    taskClasses: input.taskClasses,
    resultModes: input.resultModes,
    structuredOutputMode: input.structuredOutputMode,
    maxInputTokens: input.maxInputTokens,
    maxCompletionTokens: input.maxCompletionTokens,
    supportsStreaming: input.supportsStreaming ?? false,
    supportsTimeout: input.supportsTimeout,
    supportsCancellation: input.supportsCancellation,
    ...(input.promptProfileRef === undefined ? {} : { promptProfileRef: input.promptProfileRef }),
    ...(input.costProfileRef === undefined ? {} : { costProfileRef: input.costProfileRef }),
    ...(input.evaluationApprovalRef === undefined
      ? {}
      : { evaluationApprovalRef: input.evaluationApprovalRef }),
  });
  if (!parsed.success) {
    throw new Error('A capability profile field is invalid.');
  }
  const p = parsed.data;

  if (!uniqueArray(p.taskClasses) || !uniqueArray(p.resultModes)) {
    throw new Error('A capability profile lists a task class or result mode more than once.');
  }
  const hasStructured = p.resultModes.includes('STRUCTURED');
  if (hasStructured && p.structuredOutputMode === 'unsupported') {
    throw new Error('A STRUCTURED result mode requires a supported structured-output mode.');
  }
  if (!hasStructured && p.structuredOutputMode !== 'unsupported') {
    throw new Error('A structured-output mode requires the STRUCTURED result mode.');
  }
  if (p.maxCompletionTokens > p.maxInputTokens) {
    throw new Error('A capability profile completion budget exceeds its input/context budget.');
  }

  return Object.freeze({
    release: input.release,
    taskClasses: Object.freeze([...p.taskClasses]),
    resultModes: Object.freeze([...p.resultModes]),
    structuredOutputMode: p.structuredOutputMode,
    maxInputTokens: p.maxInputTokens,
    maxCompletionTokens: p.maxCompletionTokens,
    // Current serving is always non-streaming; the flag is fixed true and streaming is future-only.
    supportsNonStreaming: true,
    supportsStreaming: p.supportsStreaming,
    supportsTimeout: p.supportsTimeout,
    supportsCancellation: p.supportsCancellation,
    promptProfileRef: p.promptProfileRef,
    costProfileRef: p.costProfileRef,
    evaluationApprovalRef: p.evaluationApprovalRef,
  });
}

/** The exact provider/model/version/config tuple key for a profile (deterministic, content-free). */
export function profileTupleKey(release: ProviderReleaseRef): string {
  return [release.providerId, release.modelId, release.modelVersion, release.configDigest].join(
    '|',
  );
}
