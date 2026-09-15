/**
 * Validated, frozen Nara provider configuration (JF-2A, ADR-0146).
 *
 * Everything is INJECTED — the model id/version/capabilities, the token bounds, the strict-schema
 * support flag, the api key holder, the transport, and the data-controls attestation. There is NO
 * hard-coded production model default and NO environment-variable access. Production readiness fails
 * closed unless the composition supplies a positive data-controls attestation.
 *
 * ### The router alias is refused here, not discouraged in prose
 *
 * NaraRouter offers its own automatic model-selection aliases (`auto`, `bynara`, `auto/bynara`). Those
 * are the provider choosing a model per request. Production V1 requires Jarvis to bind an EXPLICIT
 * approved model, for the same reason the gateway binds an exact provider: a row of evidence that says
 * "the router picked something" cannot answer which model produced a reply, so a regression cannot be
 * attributed and a rollback has nothing to roll back to. Provenance would name an alias and mean
 * nothing.
 *
 * So an alias is a construction-time refusal. It is not a warning, not a lint, and not a comment — a
 * configuration naming one cannot be built, and a spec proves each refusal by name.
 */
import { z } from 'zod';

import {
  defineProviderCapabilities,
  type ProviderCapabilities,
} from '../../contracts/capabilities.js';
import { providerModelIdSchema } from '../../contracts/model-id.js';
import {
  NARA_CANONICAL_PROVIDER_ID,
  assertCanonicalProviderId,
} from '../../contracts/provider-identity.js';
import { NaraApiKey } from './nara-secret.js';
import type { NaraTransport } from './nara-transport.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/**
 * Nara's automatic model-router aliases, refused by name.
 *
 * Listed so each refusal is individually testable rather than asserted in general. The structural rule
 * below catches shapes this list does not enumerate.
 */
export const NARA_REFUSED_ROUTER_ALIASES: readonly string[] = Object.freeze([
  'auto',
  'bynara',
  'auto/bynara',
  'bynara/auto',
  'router',
  'router/auto',
  'default',
  'latest',
]);

/**
 * True when a model id asks the provider to choose. Covers the named aliases and the general shape:
 * any id whose first or last `/` segment is a selection word rather than a model.
 */
export function isNaraRouterAlias(modelId: string): boolean {
  const lowered = modelId.trim().toLowerCase();
  if (NARA_REFUSED_ROUTER_ALIASES.includes(lowered)) {
    return true;
  }
  const segments = lowered.split('/');
  const first = segments[0];
  const last = segments[segments.length - 1];
  const selectionWords = new Set(['auto', 'default', 'latest', 'any', 'router']);
  return (
    (first !== undefined && selectionWords.has(first)) ||
    (last !== undefined && selectionWords.has(last))
  );
}

/** The immutable Nara provider configuration. */
export interface NaraProviderConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly capabilities: ProviderCapabilities;
  readonly maxCompletionTokens: number;
  readonly apiKey: NaraApiKey;
  readonly transport: NaraTransport;
  /** A positive data-controls / retention attestation is REQUIRED for production health. */
  readonly dataControlsAttested: boolean;
}

/**
 * What a caller supplies to build a Nara config. Capabilities/model identity are injected, not defaulted.
 *
 * There is deliberately no `supportsStrictJsonSchema` input — see {@link NARA_SUPPORTS_STRICT_JSON_SCHEMA}.
 */
export interface NaraProviderConfigInput {
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass?: 'HOSTED';
  readonly maxInputTokens: number;
  readonly maxCompletionTokens: number;
  readonly apiKey: NaraApiKey;
  readonly transport: NaraTransport;
  readonly dataControlsAttested: boolean;
}

/**
 * Nara declares NO strict JSON-Schema support in JF-2A, and it is not a caller's choice.
 *
 * Strict mode is not one behaviour. The Groq adapter needed a 437-line projection table because a
 * schema that looked strict-compatible collected nine identical HTTP 400s on live traffic — the exact
 * keyword set a strict endpoint accepts is a property of that endpoint, discovered by hitting it.
 * NaraRouter forwards to upstreams whose strict behaviour has not been observed from this repository,
 * and no authenticated Nara call has ever been made from it.
 *
 * Declaring the capability anyway would be worse than not having it: capability matching would route
 * strict-schema requests to a provider that may reject them, turning an unverified assumption into
 * production 400s. So it is `false`, structured requests go out as `json_object`, and the gateway keeps
 * validating the returned value against the real schema — which it does regardless, because the wire
 * hint was never the authority. A certification lane with a live entitled model can raise this.
 */
export const NARA_SUPPORTS_STRICT_JSON_SCHEMA = false;

/**
 * The ceiling on the serialized schema this provider will put on the wire as guidance (JF-5B-R4).
 *
 * A NARA-INTERNAL bound, and a new one: every existing bound in this package is a RESPONSE ceiling, and
 * reusing one of those would mean a response limit silently deciding what a request may describe. 32 KiB
 * is far above every schema this repository renders -- the generic reply document is well under 2 KiB --
 * and far below anything that could crowd out the turn inside the model's context.
 *
 * A schema past it fails CLOSED, before the network: a structured request we cannot describe is a
 * request we should not spend on.
 */
export const NARA_MAX_SCHEMA_GUIDANCE_BYTES = 32_768;

/**
 * The opening line of the provider-owned guidance message.
 *
 * Exists so a spec -- and a person reading a captured request -- can tell the PROVIDER's message from
 * the application's own system bytes without matching prose. It is a marker, not a policy.
 */
export const NARA_SCHEMA_GUIDANCE_PREFIX = '[provider-encoding-guidance]';

const configPrimitivesSchema = z
  .object({
    providerId: IDENTIFIER,
    // A model id may be namespaced (`vendor/model`), so only this field uses the slash-segment
    // grammar; every neighbouring identifier keeps the generic charset.
    modelId: providerModelIdSchema,
    modelVersion: IDENTIFIER,
    maxInputTokens: z.int().min(1).max(10_000_000),
    maxCompletionTokens: z.int().min(1).max(1_000_000),
    dataControlsAttested: z.boolean(),
  })
  .strict();

/**
 * Validate and freeze a Nara provider configuration.
 *
 * Refuses an alias model id, a missing/invalid key holder, and a missing transport. The execution class
 * is `HOSTED` and cannot be supplied as anything else: NaraRouter is a remote service, and the gateway's
 * `LOCAL_ONLY` privacy gate is enforced against the execution class, so a hosted provider declaring
 * itself `LOCAL` would be a privacy bypass wearing a configuration field.
 */
export function createNaraProviderConfig(input: NaraProviderConfigInput): NaraProviderConfig {
  // The identity lock, checked before anything else is read. A Nara adapter publishing `groq` would
  // satisfy GROQ_ONLY and rank FIRST under AUTO while sending every request to NaraRouter, so provider
  // mode, routing order, fallback evidence and provenance would all be describing a provider that is
  // not the one being called.
  assertCanonicalProviderId(NARA_CANONICAL_PROVIDER_ID, input.providerId);

  // The guards below read through widened locals on purpose. The declared types already forbid these
  // shapes, so a comparison against the narrow type is one the compiler has already decided — and the
  // linter says so. They exist for the callers the types do not reach: a JavaScript composition, a
  // value parsed from configuration, a cast at a boundary. Those must fail closed too.
  const declaredExecutionClass: unknown = input.executionClass;
  if (declaredExecutionClass !== undefined && declaredExecutionClass !== 'HOSTED') {
    throw new Error('The Nara provider is HOSTED and cannot declare another execution class.');
  }
  if (!(input.apiKey instanceof NaraApiKey)) {
    throw new Error('A Nara provider configuration requires an injected NaraApiKey holder.');
  }
  const suppliedTransport: unknown = input.transport;
  if (
    typeof suppliedTransport !== 'object' ||
    suppliedTransport === null ||
    typeof (suppliedTransport as { readonly send?: unknown }).send !== 'function'
  ) {
    throw new Error('A Nara provider configuration requires an injected transport.');
  }

  const primitives = configPrimitivesSchema.parse({
    providerId: input.providerId,
    modelId: input.modelId,
    modelVersion: input.modelVersion,
    maxInputTokens: input.maxInputTokens,
    maxCompletionTokens: input.maxCompletionTokens,
    dataControlsAttested: input.dataControlsAttested,
  });

  if (isNaraRouterAlias(primitives.modelId)) {
    throw new Error(
      'The Nara provider requires an explicit approved model id; a router alias is refused.',
    );
  }

  const capabilities = defineProviderCapabilities({
    providerId: primitives.providerId,
    modelId: primitives.modelId,
    modelVersion: primitives.modelVersion,
    executionClass: 'HOSTED',
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: NARA_SUPPORTS_STRICT_JSON_SCHEMA,
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
