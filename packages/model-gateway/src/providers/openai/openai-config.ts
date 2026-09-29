import { z } from 'zod';

import {
  defineProviderCapabilities,
  type ProviderCapabilities,
} from '../../contracts/capabilities.js';
import { providerModelIdSchema } from '../../contracts/model-id.js';
import {
  OPENAI_CANONICAL_PROVIDER_ID,
  assertCanonicalProviderId,
} from '../../contracts/provider-identity.js';
import { OpenAIApiKey } from './openai-secret.js';
import type { OpenAITransport } from './openai-transport.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export type OpenAIReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface OpenAIProviderConfig {
  readonly providerId: 'openai';
  readonly modelId: string;
  readonly modelVersion: string;
  readonly capabilities: ProviderCapabilities;
  readonly maxCompletionTokens: number;
  readonly reasoningEffort: OpenAIReasoningEffort;
  readonly apiKey: OpenAIApiKey;
  readonly transport: OpenAITransport;
  readonly dataControlsAttested: boolean;
}

export interface OpenAIProviderConfigInput {
  readonly providerId: 'openai';
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass?: 'HOSTED';
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsStrictJsonSchema: true;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly apiKey: OpenAIApiKey;
  readonly transport: OpenAITransport;
  readonly dataControlsAttested: boolean;
}

const configPrimitivesSchema = z
  .object({
    providerId: z.literal('openai'),
    modelId: providerModelIdSchema,
    modelVersion: IDENTIFIER,
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(1_000_000),
    supportsStrictJsonSchema: z.literal(true),
    reasoningEffort: z.enum(['none', 'low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    dataControlsAttested: z.boolean(),
  })
  .strict();

export function createOpenAIProviderConfig(input: OpenAIProviderConfigInput): OpenAIProviderConfig {
  assertCanonicalProviderId(OPENAI_CANONICAL_PROVIDER_ID, input.providerId);
  if (!(input.apiKey instanceof OpenAIApiKey)) {
    throw new Error('An OpenAI provider config requires an injected OpenAIApiKey.');
  }
  const transport: unknown = input.transport;
  if (
    typeof transport !== 'object' ||
    transport === null ||
    typeof (transport as { send?: unknown }).send !== 'function'
  ) {
    throw new Error('An OpenAI provider config requires an injected transport.');
  }

  const parsed = configPrimitivesSchema.safeParse({
    providerId: input.providerId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    maxInputTokens: input.maxInputTokens,
    maxCompletionTokens: input.maxCompletionTokens,
    supportsStrictJsonSchema: input.supportsStrictJsonSchema,
    reasoningEffort: input.reasoningEffort,
    dataControlsAttested: input.dataControlsAttested,
  });
  if (!parsed.success) {
    throw new Error('An OpenAI provider config field is invalid.');
  }
  const p = parsed.data;
  const capabilities = defineProviderCapabilities({
    providerId: p.providerId,
    modelId: p.modelId,
    modelVersion: p.modelVersion,
    executionClass: 'HOSTED',
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: true,
    maxInputTokens: p.maxInputTokens,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
  });

  return Object.freeze({
    providerId: p.providerId,
    modelId: p.modelId,
    modelVersion: p.modelVersion,
    capabilities,
    maxCompletionTokens: p.maxCompletionTokens,
    reasoningEffort: p.reasoningEffort,
    apiKey: input.apiKey,
    transport: input.transport,
    dataControlsAttested: p.dataControlsAttested,
  });
}
