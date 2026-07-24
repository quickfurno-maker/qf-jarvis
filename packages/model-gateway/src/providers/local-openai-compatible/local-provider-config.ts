/**
 * Validated, frozen local-provider configuration (QFJ-P04.01C, ADR-0047).
 *
 * Everything is INJECTED — the validated private endpoint, the model id/version/capabilities, the token
 * bounds, the structured-output support flags, the OPTIONAL auth token, the transport, and the three
 * activation attestations (endpoint / model / auth-TLS posture). There is NO hard-coded production model
 * default and NO environment-variable access. Production readiness fails closed unless ALL THREE
 * attestations are positive. Execution class is always LOCAL.
 */
import { z } from 'zod';

import {
  defineProviderCapabilities,
  type ProviderCapabilities,
} from '../../contracts/capabilities.js';
import { LocalEndpointDescriptor } from './local-endpoint-policy.js';
import { LocalAuthToken } from './local-secret.js';
import type { LocalStructuredOutputSupport } from './local-structured-output.js';
import type { LocalTransport } from './local-transport.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** The immutable local-provider configuration. */
export interface LocalProviderConfig {
  readonly providerId: string;
  readonly endpoint: LocalEndpointDescriptor;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly capabilities: ProviderCapabilities;
  readonly maxCompletionTokens: number;
  readonly structuredOutput: LocalStructuredOutputSupport;
  /** Optional injected bearer token. Absent for a loopback server that needs none. */
  readonly authToken: LocalAuthToken | undefined;
  readonly transport: LocalTransport;
  /** All three attestations are REQUIRED for production health; each fails closed. */
  readonly endpointAttested: boolean;
  readonly modelAttested: boolean;
  readonly authPostureAttested: boolean;
}

/** What a caller supplies to build a local-provider config. Model identity/capabilities are injected. */
export interface LocalProviderConfigInput {
  readonly providerId: string;
  readonly endpoint: LocalEndpointDescriptor;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly supportsStrictJsonSchema: boolean;
  readonly supportsJsonObject: boolean;
  readonly authToken?: LocalAuthToken;
  readonly transport: LocalTransport;
  readonly endpointAttested: boolean;
  readonly modelAttested: boolean;
  readonly authPostureAttested: boolean;
}

const configPrimitivesSchema = z
  .object({
    providerId: IDENTIFIER,
    modelId: IDENTIFIER,
    modelVersion: IDENTIFIER,
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(1_000_000),
    supportsStrictJsonSchema: z.boolean(),
    supportsJsonObject: z.boolean(),
    endpointAttested: z.boolean(),
    modelAttested: z.boolean(),
    authPostureAttested: z.boolean(),
  })
  .strict();

/**
 * Validate and freeze a local-provider configuration. The endpoint (a validated {@link
 * LocalEndpointDescriptor}), the optional token, and the transport are injected objects; the primitive
 * fields are strictly validated. Execution class is always LOCAL. `supportsStructuredOutput` is the OR of
 * the two structured modes. Throws a fixed-message error (never echoing a token) on any violation.
 */
export function createLocalProviderConfig(input: LocalProviderConfigInput): LocalProviderConfig {
  if (!(input.endpoint instanceof LocalEndpointDescriptor)) {
    throw new Error('A local provider config requires a validated LocalEndpointDescriptor.');
  }
  if (input.authToken !== undefined && !(input.authToken instanceof LocalAuthToken)) {
    throw new Error('A local provider auth token must be a LocalAuthToken when supplied.');
  }
  const transport: unknown = input.transport;
  if (
    typeof transport !== 'object' ||
    transport === null ||
    typeof (transport as { send?: unknown }).send !== 'function'
  ) {
    throw new Error('A local provider config requires an injected transport.');
  }
  const parsed = configPrimitivesSchema.safeParse({
    providerId: input.providerId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    maxInputTokens: input.maxInputTokens,
    maxCompletionTokens: input.maxCompletionTokens,
    supportsStrictJsonSchema: input.supportsStrictJsonSchema,
    supportsJsonObject: input.supportsJsonObject,
    endpointAttested: input.endpointAttested,
    modelAttested: input.modelAttested,
    authPostureAttested: input.authPostureAttested,
  });
  if (!parsed.success) {
    throw new Error('A local provider config field is invalid.');
  }
  const primitives = parsed.data;

  const capabilities = defineProviderCapabilities({
    providerId: primitives.providerId,
    modelId: primitives.modelId,
    modelVersion: primitives.modelVersion,
    executionClass: 'LOCAL',
    supportsStructuredOutput: primitives.supportsStrictJsonSchema || primitives.supportsJsonObject,
    supportsStrictJsonSchema: primitives.supportsStrictJsonSchema,
    maxInputTokens: primitives.maxInputTokens,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
  });

  return Object.freeze({
    providerId: primitives.providerId,
    endpoint: input.endpoint,
    modelId: primitives.modelId,
    modelVersion: primitives.modelVersion,
    capabilities,
    maxCompletionTokens: primitives.maxCompletionTokens,
    structuredOutput: Object.freeze({
      strictJsonSchema: primitives.supportsStrictJsonSchema,
      jsonObject: primitives.supportsJsonObject,
    }),
    authToken: input.authToken,
    transport: input.transport,
    endpointAttested: primitives.endpointAttested,
    modelAttested: primitives.modelAttested,
    authPostureAttested: primitives.authPostureAttested,
  });
}
