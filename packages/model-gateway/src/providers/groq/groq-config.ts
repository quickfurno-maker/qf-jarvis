/**
 * Validated, frozen Groq provider configuration (QFJ-P04.01B, ADR-0046).
 *
 * Everything is INJECTED — the model id/version/capabilities, the token bounds, the strict-schema
 * support flag, the api key holder, the transport, and the data-controls (ZDR) attestation. There is NO
 * hard-coded production model default and NO environment-variable access. Production readiness fails closed
 * unless the composition supplies a positive data-controls attestation.
 */
import { z } from 'zod';

import {
  defineProviderCapabilities,
  type ProviderCapabilities,
} from '../../contracts/capabilities.js';
import { GroqApiKey } from './groq-secret.js';
import type { GroqTransport } from './groq-transport.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** The immutable Groq provider configuration. */
export interface GroqProviderConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly capabilities: ProviderCapabilities;
  readonly maxCompletionTokens: number;
  readonly apiKey: GroqApiKey;
  readonly transport: GroqTransport;
  /** A positive Groq data-controls / Zero-Data-Retention attestation is REQUIRED for production health. */
  readonly dataControlsAttested: boolean;
}

/** What a caller supplies to build a Groq config. Capabilities/model identity are injected, not defaulted. */
export interface GroqProviderConfigInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass?: 'HOSTED';
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsStrictJsonSchema: boolean;
  readonly apiKey: GroqApiKey;
  readonly transport: GroqTransport;
  readonly dataControlsAttested: boolean;
}

const configPrimitivesSchema = z
  .object({
    providerId: IDENTIFIER,
    modelId: IDENTIFIER,
    modelVersion: IDENTIFIER,
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(1_000_000),
    supportsStrictJsonSchema: z.boolean(),
    dataControlsAttested: z.boolean(),
  })
  .strict();

/**
 * Validate and freeze a Groq provider configuration. The api key and transport are injected objects
 * (not validated by zod); the primitive fields are strictly validated. Groq is always execution class
 * HOSTED. Throws a fixed-message error (never echoing a key) on an invalid field or a missing key/transport.
 */
export function createGroqProviderConfig(input: GroqProviderConfigInput): GroqProviderConfig {
  if (!(input.apiKey instanceof GroqApiKey)) {
    throw new Error('A Groq provider config requires an injected GroqApiKey.');
  }
  const transport: unknown = input.transport;
  if (
    typeof transport !== 'object' ||
    transport === null ||
    typeof (transport as { send?: unknown }).send !== 'function'
  ) {
    throw new Error('A Groq provider config requires an injected transport.');
  }
  const parsed = configPrimitivesSchema.safeParse({
    providerId: input.providerId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    maxInputTokens: input.maxInputTokens,
    maxCompletionTokens: input.maxCompletionTokens,
    supportsStrictJsonSchema: input.supportsStrictJsonSchema,
    dataControlsAttested: input.dataControlsAttested,
  });
  if (!parsed.success) {
    throw new Error('A Groq provider config field is invalid.');
  }
  const primitives = parsed.data;

  const capabilities = defineProviderCapabilities({
    providerId: primitives.providerId,
    modelId: primitives.modelId,
    modelVersion: primitives.modelVersion,
    executionClass: 'HOSTED',
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: primitives.supportsStrictJsonSchema,
    maxInputTokens: primitives.maxInputTokens,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
  });

  return Object.freeze({
    providerId: primitives.providerId,
    modelId: primitives.modelId,
    modelVersion: primitives.modelVersion,
    capabilities,
    maxCompletionTokens: primitives.maxCompletionTokens,
    apiKey: input.apiKey,
    transport: input.transport,
    dataControlsAttested: primitives.dataControlsAttested,
  });
}
