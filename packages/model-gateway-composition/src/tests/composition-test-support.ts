/**
 * Deterministic offline fixtures for the QFJ-S2-B composition specs.
 *
 * Every collaborator is a fake from `@qf-jarvis/model-gateway/testing` or a local counter. Nothing here
 * touches a terminal, the environment, the filesystem, the network, a provider endpoint, a database, or
 * a real credential. Not a spec file, so vitest does not collect it.
 */
import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createProviderReleaseRef,
  defineProviderCapabilities,
  type ModelCapabilityProfile,
  type ModelProvider,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';
import { FakeModelProvider, completedText } from '@qf-jarvis/model-gateway/testing';

import type { ProductionCompositionConfig } from '../contracts/production-composition-config.js';

export const PROVIDER_ID = 'groq.staging';
export const MODEL_ID = 'openai/gpt-oss-20b';
export const MODEL_VERSION = '2026-07-01';
export const RELEASE_ID = 'release.s2b.synthetic.v1';
/**
 * A synthetic config digest that satisfies BOTH grammars: the gateway's release digest
 * (`/^[A-Za-z0-9._:-]+$/`) and model-evaluation's stricter `/^[0-9a-f]{8,64}$/`. Lowercase hex only, so
 * the same fixture release can appear in a gateway release ref and in an evaluation binding.
 */
export const CONFIG_DIGEST = '0fadedbeef000000000000000000000a';

/** A synthetic approved release. Exact identity only — never a wildcard, never `latest`. */
export function syntheticRelease(over: Record<string, unknown> = {}): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: RELEASE_ID,
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    executionClass: 'HOSTED',
    configDigest: CONFIG_DIGEST,
    ...over,
  });
}

/** The capability profile matching {@link syntheticRelease}. */
export function syntheticProfile(
  release: ProviderReleaseRef = syntheticRelease(),
): ModelCapabilityProfile {
  return createModelCapabilityProfile({
    release,
    taskClasses: ['RESPONSE_GENERATION'],
    resultModes: ['STRUCTURED', 'TEXT'],
    structuredOutputMode: 'strict-json-schema',
    maxInputTokens: 8192,
    maxCompletionTokens: 2048,
    supportsTimeout: true,
    supportsCancellation: true,
  });
}

/** A deterministic provider whose declared identity matches {@link syntheticRelease}. */
export function syntheticProvider(over: Record<string, unknown> = {}): FakeModelProvider {
  return new FakeModelProvider({
    capabilities: defineProviderCapabilities({
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      executionClass: 'HOSTED',
      supportsStructuredOutput: true,
      supportsStrictJsonSchema: true,
      maxInputTokens: 8192,
      supportsTimeout: true,
      supportsCancellation: true,
      supportsNonStreaming: true,
      supportsStreaming: false,
      ...over,
    }),
    responses: [completedText('ok')],
  });
}

/** Counts every `health()` consultation, so a spec can prove construction consulted no provider. */
export interface CountingProvider extends ModelProvider {
  readonly healthChecks: () => number;
  readonly invocations: () => number;
}

export function countingProvider(inner: FakeModelProvider = syntheticProvider()): CountingProvider {
  const counters = { health: 0 };
  return Object.freeze({
    descriptor: inner.descriptor,
    capabilities: () => inner.capabilities(),
    health: async () => {
      counters.health += 1;
      return inner.health();
    },
    invoke: (input: Parameters<ModelProvider['invoke']>[0]) => inner.invoke(input),
    healthChecks: () => counters.health,
    invocations: () => inner.invocations,
  });
}

/** A complete, valid, OFF-mode composition config built entirely from fakes. */
export function validCompositionConfig(
  over: Partial<ProductionCompositionConfig> = {},
): ProductionCompositionConfig {
  const release = syntheticRelease();
  return {
    mode: 'OFF',
    providers: [syntheticProvider()],
    approvedReleases: [release],
    capabilityRegistry: createModelCapabilityRegistry([syntheticProfile(release)]),
    budgetPolicy: createEstimatedBudgetPolicy(),
    killSwitch: { active: () => false },
    clock: createManualClock(),
    concurrency: { maxConcurrent: 1, maxQueue: 1 },
    circuit: { failureThreshold: 3, cooldownMs: 1000 },
    ...over,
  };
}

/** A minimal gateway-valid TEXT request. Carries no secret and no real conversation content. */
export function syntheticRequest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'run.s2b.synthetic.1',
    purpose: 'agent.reply',
    agentScope: 'COORDINATION',
    dataClass: 'HOSTED_ALLOWED',
    messages: [{ role: 'user', content: 'synthetic composition probe' }],
    requiredCapabilities: {
      structuredOutput: false,
      strictJsonSchema: false,
      cancellation: false,
      minContextTokens: 1,
    },
    resultMode: 'TEXT',
    maxResultChars: 1024,
    promptId: 'qfj.s2b.synthetic',
    promptVersion: '1',
    tokenBudget: 4096,
    costBudget: 1,
    timeoutMs: 30_000,
    retryBudget: 0,
    metadata: {},
    ...over,
  };
}
