/**
 * The validated, frozen capability requirement (QFJ-P04.02, ADR-0050).
 *
 * A requirement is the TECHNICAL demand a run places on a release's profile. It is derived from a
 * validated {@link ModelRequest} without copying any raw message/prompt content — only scalar capability
 * demands cross into it. The task class is optional (the base request carries none); when present it must
 * be one of the closed {@link ModelTaskClass} values.
 */
import { z } from 'zod';

import { MODEL_RESULT_MODES, type ModelResultMode } from '../contracts/enums.js';
import type { ModelRequest } from '../contracts/request.js';
import { MODEL_TASK_CLASSES, type ModelTaskClass } from './task-classes.js';

const REFERENCE = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/);

/** The strictness a STRUCTURED requirement demands. Absent for a TEXT requirement. */
export type RequiredStructuredMode = 'strict-json-schema' | 'json-object';

/** The immutable capability requirement. */
export interface ModelCapabilityRequirement {
  readonly taskClass: ModelTaskClass | undefined;
  readonly resultMode: ModelResultMode;
  readonly structuredMode: RequiredStructuredMode | undefined;
  readonly minInputTokens: number;
  readonly minCompletionTokens: number | undefined;
  readonly requiresTimeout: boolean;
  readonly requiresCancellation: boolean;
  readonly requiresNonStreaming: boolean;
  readonly promptProfileRef: string | undefined;
  readonly costProfileRef: string | undefined;
}

/** What a caller supplies to build a requirement directly. */
export interface ModelCapabilityRequirementInput {
  readonly taskClass?: ModelTaskClass;
  readonly resultMode: ModelResultMode;
  readonly structuredMode?: RequiredStructuredMode;
  readonly minInputTokens: number;
  readonly minCompletionTokens?: number;
  readonly requiresTimeout: boolean;
  readonly requiresCancellation: boolean;
  readonly requiresNonStreaming?: boolean;
  readonly promptProfileRef?: string;
  readonly costProfileRef?: string;
}

const schema = z
  .object({
    taskClass: z.enum(MODEL_TASK_CLASSES).optional(),
    resultMode: z.enum(MODEL_RESULT_MODES),
    structuredMode: z.enum(['strict-json-schema', 'json-object']).optional(),
    minInputTokens: z.int().min(0).max(10_000_000),
    minCompletionTokens: z.int().min(1).max(1_000_000).optional(),
    requiresTimeout: z.boolean(),
    requiresCancellation: z.boolean(),
    requiresNonStreaming: z.boolean(),
    promptProfileRef: REFERENCE.optional(),
    costProfileRef: REFERENCE.optional(),
  })
  .strict();

/** Validate and freeze a capability requirement. A STRUCTURED requirement must carry a structured mode. */
export function createModelCapabilityRequirement(
  input: ModelCapabilityRequirementInput,
): ModelCapabilityRequirement {
  const parsed = schema.safeParse({
    ...(input.taskClass === undefined ? {} : { taskClass: input.taskClass }),
    resultMode: input.resultMode,
    ...(input.structuredMode === undefined ? {} : { structuredMode: input.structuredMode }),
    minInputTokens: input.minInputTokens,
    ...(input.minCompletionTokens === undefined
      ? {}
      : { minCompletionTokens: input.minCompletionTokens }),
    requiresTimeout: input.requiresTimeout,
    requiresCancellation: input.requiresCancellation,
    requiresNonStreaming: input.requiresNonStreaming ?? true,
    ...(input.promptProfileRef === undefined ? {} : { promptProfileRef: input.promptProfileRef }),
    ...(input.costProfileRef === undefined ? {} : { costProfileRef: input.costProfileRef }),
  });
  if (!parsed.success) {
    throw new Error('A capability requirement field is invalid.');
  }
  const r = parsed.data;
  if (r.resultMode === 'STRUCTURED' && r.structuredMode === undefined) {
    throw new Error('A STRUCTURED capability requirement must declare a structured mode.');
  }
  if (r.resultMode === 'TEXT' && r.structuredMode !== undefined) {
    throw new Error('A TEXT capability requirement must not declare a structured mode.');
  }
  return Object.freeze({
    taskClass: r.taskClass,
    resultMode: r.resultMode,
    structuredMode: r.structuredMode,
    minInputTokens: r.minInputTokens,
    minCompletionTokens: r.minCompletionTokens,
    requiresTimeout: r.requiresTimeout,
    requiresCancellation: r.requiresCancellation,
    requiresNonStreaming: r.requiresNonStreaming,
    promptProfileRef: r.promptProfileRef,
    costProfileRef: r.costProfileRef,
  });
}

/**
 * Derive a capability requirement from a validated {@link ModelRequest}. No raw message/prompt content is
 * copied — only the scalar capability demands. The task class and optional profile references are supplied
 * by the caller (the base request carries no task class).
 */
export function deriveCapabilityRequirement(
  request: ModelRequest,
  options: {
    readonly taskClass?: ModelTaskClass;
    readonly promptProfileRef?: string;
    readonly costProfileRef?: string;
  } = {},
): ModelCapabilityRequirement {
  const structuredMode: RequiredStructuredMode | undefined =
    request.resultMode === 'STRUCTURED'
      ? request.requiredCapabilities.strictJsonSchema
        ? 'strict-json-schema'
        : 'json-object'
      : undefined;
  return createModelCapabilityRequirement({
    ...(options.taskClass === undefined ? {} : { taskClass: options.taskClass }),
    resultMode: request.resultMode,
    ...(structuredMode === undefined ? {} : { structuredMode }),
    minInputTokens: request.requiredCapabilities.minContextTokens,
    requiresTimeout: request.timeoutMs > 0,
    requiresCancellation: request.requiredCapabilities.cancellation,
    requiresNonStreaming: true,
    ...(options.promptProfileRef === undefined
      ? {}
      : { promptProfileRef: options.promptProfileRef }),
    ...(options.costProfileRef === undefined ? {} : { costProfileRef: options.costProfileRef }),
  });
}
