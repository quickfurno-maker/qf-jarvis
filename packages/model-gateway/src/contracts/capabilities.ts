/**
 * Provider capability declaration (QFJ-P04.01A, ADR-0045).
 *
 * OpenAI-endpoint compatibility alone is NOT sufficient to select a provider/model. Every provider/model
 * DECLARES the launch-critical capabilities below, and the router may select it only when the request's
 * required capabilities are supported. No provider-specific (Groq/local/OpenAI) field appears here.
 */
import { z } from 'zod';

import { PROVIDER_EXECUTION_CLASSES } from './enums.js';

/** A provider/model's declared, immutable capabilities. */
export interface ProviderCapabilities {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass: (typeof PROVIDER_EXECUTION_CLASSES)[number];
  readonly supportsStructuredOutput: boolean;
  readonly supportsStrictJsonSchema: boolean;
  readonly maxInputTokens: number;
  readonly supportsTimeout: boolean;
  readonly supportsCancellation: boolean;
  /** Non-streaming is the only response mode the gateway executes in P04.01A. Always true. */
  readonly supportsNonStreaming: boolean;
  /** A future streaming field; the gateway does not execute streaming yet. */
  readonly supportsStreaming: boolean;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const providerCapabilitiesSchema = z
  .object({
    providerId: IDENTIFIER,
    modelId: IDENTIFIER,
    modelVersion: IDENTIFIER,
    executionClass: z.enum(PROVIDER_EXECUTION_CLASSES),
    supportsStructuredOutput: z.boolean(),
    supportsStrictJsonSchema: z.boolean(),
    maxInputTokens: z.int().min(1).max(10_000_000),
    supportsTimeout: z.boolean(),
    supportsCancellation: z.boolean(),
    supportsNonStreaming: z.literal(true),
    supportsStreaming: z.boolean(),
  })
  .strict();

/** Validate and freeze a capability declaration. */
export function defineProviderCapabilities(input: unknown): ProviderCapabilities {
  return Object.freeze(providerCapabilitiesSchema.parse(input));
}

/** What a request requires of a provider/model. Absent flags default to "not required". */
export interface RequiredCapabilities {
  readonly structuredOutput: boolean;
  readonly strictJsonSchema: boolean;
  readonly cancellation: boolean;
  /** The provider's `maxInputTokens` must be at least this. */
  readonly minContextTokens: number;
}

export const requiredCapabilitiesSchema = z
  .object({
    structuredOutput: z.boolean(),
    strictJsonSchema: z.boolean(),
    cancellation: z.boolean(),
    minContextTokens: z.int().min(0).max(10_000_000),
  })
  .strict();

/** True iff `capabilities` satisfy `required` (capability match only — execution class is separate). */
export function capabilitiesSatisfy(
  capabilities: ProviderCapabilities,
  required: RequiredCapabilities,
): boolean {
  if (required.structuredOutput && !capabilities.supportsStructuredOutput) {
    return false;
  }
  if (required.strictJsonSchema && !capabilities.supportsStrictJsonSchema) {
    return false;
  }
  if (required.cancellation && !capabilities.supportsCancellation) {
    return false;
  }
  if (capabilities.maxInputTokens < required.minContextTokens) {
    return false;
  }
  return capabilities.supportsNonStreaming;
}
