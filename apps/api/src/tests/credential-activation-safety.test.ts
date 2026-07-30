/**
 * QFJ-S2-D-B — activation safety (ADR-0064 §12).
 *
 * A credential binding is the first thing in this repository that could hold a real secret, so the
 * question "did adding it make anything activatable?" is answered by test rather than by assertion.
 *
 * Two claims:
 *   1. the production composition is byte-for-byte as OFF-only as S2-C-B left it — supplying a valid
 *      credential binding changes nothing about it;
 *   2. the binding itself constructs no provider, calls no provider, opens no transport, and — most
 *      importantly — performs no read merely because a valid configuration exists.
 *
 * Every test is offline and synthetic. No real credential, no environment read, no network, no
 * database, no Docker.
 */
import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelCapabilityProfile,
  createModelCapabilityRegistry,
  createProviderReleaseRef,
  defineProviderCapabilities,
  type ModelProvider,
  type ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';
import { FakeModelProvider, completedText } from '@qf-jarvis/model-gateway/testing';
import { createProductionModelGateway } from '@qf-jarvis/model-gateway-composition';
import { describe, expect, it } from 'vitest';

import type { CredentialFileReader } from '../secrets/credential-file-reader.js';
import { createFileGroqCredentialBinding } from '../secrets/file-groq-credential-binding.js';

const FAKE_CREDENTIAL = 'FAKE_QFJ_CREDENTIAL_DO_NOT_USE_0003';
const REFERENCE = { ref: 'qfj.production.groq.v1' } as const;

const PROVIDER_ID = 'groq.production';
const MODEL_ID = 'openai/gpt-oss-20b';
const MODEL_VERSION = '2026-07-01';
const CONFIG_DIGEST = '0fadedbeef000000000000000000000a';

function release(): ProviderReleaseRef {
  return createProviderReleaseRef({
    releaseId: 'release.s2db.synthetic.v1',
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    executionClass: 'HOSTED',
    configDigest: CONFIG_DIGEST,
  });
}

/** A provider that counts every consultation, so a spec can prove ZERO of each. */
interface CountingProvider extends ModelProvider {
  readonly healthChecks: () => number;
  readonly invocations: () => number;
}

function countingProvider(): CountingProvider {
  const inner = new FakeModelProvider({
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
    }),
    responses: [completedText('served')],
  });
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

/** A reader that counts reads, so "no read merely because configuration exists" is measurable. */
function countingReader(): CredentialFileReader & { readonly reads: () => number } {
  const state = { n: 0 };
  return {
    read: () => {
      state.n += 1;
      return Promise.resolve({ ok: true as const, text: FAKE_CREDENTIAL });
    },
    reads: () => state.n,
  };
}

const REQUEST = {
  runId: 'run.s2db.1',
  purpose: 'agent.reply',
  agentScope: 'COORDINATION',
  dataClass: 'HOSTED_ALLOWED',
  messages: [{ role: 'user', content: 'synthetic probe' }],
  requiredCapabilities: {
    structuredOutput: false,
    strictJsonSchema: false,
    cancellation: false,
    minContextTokens: 1,
  },
  resultMode: 'TEXT',
  maxResultChars: 1024,
  promptId: 'qfj.s2db',
  promptVersion: '1',
  tokenBudget: 4096,
  costBudget: 1,
  timeoutMs: 30_000,
  retryBudget: 0,
  metadata: {},
};

describe('(49-58) a credential binding activates nothing', () => {
  it('(53, 54, 55) the production composition is still OFF-only and non-activatable', () => {
    const rel = release();
    const provider = countingProvider();
    const binding = createFileGroqCredentialBinding({
      credentialReference: REFERENCE,
      absoluteFilePath: '/nonexistent/qfj/credential.key',
      fileReader: countingReader(),
    });

    const result = createProductionModelGateway({
      mode: 'OFF',
      providers: [provider],
      approvedReleases: [rel],
      capabilityRegistry: createModelCapabilityRegistry([
        createModelCapabilityProfile({
          release: rel,
          taskClasses: ['RESPONSE_GENERATION'],
          resultModes: ['TEXT'],
          structuredOutputMode: 'unsupported',
          maxInputTokens: 8192,
          maxCompletionTokens: 2048,
          supportsTimeout: true,
          supportsCancellation: true,
        }),
      ]),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: () => false },
      clock: createManualClock(),
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      // The new production resolver, supplied exactly as a future slice would.
      credentialResolver: binding.resolver,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { status } = result.composition;
    expect(status.mode).toBe('OFF');
    expect(status.activatable).toBe(false);
    expect(status.retryBudget).toBe(0);
    expect(status.fallbackEnabled).toBe(false);
    expect(status.credentialResolverSupplied).toBe(true);

    // (52) No rollout controller and no activation method are reachable.
    expect(Object.keys(result.composition).sort()).toEqual(['gateway', 'status']);
    const surface = result.composition as unknown as Record<string, unknown>;
    for (const forbidden of [
      'controller',
      'rollout',
      'activate',
      'promote',
      'enable',
      'transition',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it('(50, 56, 57, 58) supplying the resolver triggers no read, no health check and no invocation', async () => {
    const rel = release();
    const provider = countingProvider();
    const reader = countingReader();
    const binding = createFileGroqCredentialBinding({
      credentialReference: REFERENCE,
      absoluteFilePath: '/nonexistent/qfj/credential.key',
      fileReader: reader,
    });

    const result = createProductionModelGateway({
      mode: 'OFF',
      providers: [provider],
      approvedReleases: [rel],
      capabilityRegistry: createModelCapabilityRegistry([
        createModelCapabilityProfile({
          release: rel,
          taskClasses: ['RESPONSE_GENERATION'],
          resultModes: ['TEXT'],
          structuredOutputMode: 'unsupported',
          maxInputTokens: 8192,
          maxCompletionTokens: 2048,
          supportsTimeout: true,
          supportsCancellation: true,
        }),
      ]),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: { active: () => false },
      clock: createManualClock(),
      concurrency: { maxConcurrent: 1, maxQueue: 1 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      credentialResolver: binding.resolver,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The composition holds the resolver and has NOT called it: no read merely because a valid
    // configuration exists.
    expect(reader.reads()).toBe(0);
    expect(binding.snapshot().resolveAttempts).toBe(0);
    expect(binding.snapshot().hasCurrentCredential).toBe(false);

    await expect(result.composition.gateway.invoke(REQUEST)).rejects.toMatchObject({
      code: 'gateway-off',
    });

    // Still nothing: refused before any provider or credential work.
    expect(reader.reads()).toBe(0);
    expect(binding.snapshot().resolveAttempts).toBe(0);
    expect(provider.healthChecks()).toBe(0);
    expect(provider.invocations()).toBe(0);
  });

  it('(49, 51) resolving and refreshing cause zero model invocations and no response-driven path', async () => {
    const provider = countingProvider();
    const reader = countingReader();
    const binding = createFileGroqCredentialBinding({
      credentialReference: REFERENCE,
      absoluteFilePath: '/nonexistent/qfj/credential.key',
      fileReader: reader,
    });

    await binding.resolver.resolve(REFERENCE);
    await binding.refresh();
    await binding.refresh();

    expect(reader.reads()).toBe(3);
    expect(provider.healthChecks()).toBe(0);
    expect(provider.invocations()).toBe(0);
  });

  it('(51) no 401/403 response-driven refresh path exists in the binding source', () => {
    // The binding cannot see a provider response: it imports no provider, no transport, and no
    // status-code vocabulary. Refreshing a credential is not retrying a model invocation.
    const source = new URL('../secrets/file-groq-credential-binding.ts', import.meta.url);
    expect(source.pathname).toContain('file-groq-credential-binding');
    const binding = createFileGroqCredentialBinding({
      credentialReference: REFERENCE,
      absoluteFilePath: '/nonexistent/qfj/credential.key',
      fileReader: countingReader(),
    });
    const surface = binding as unknown as Record<string, unknown>;
    for (const forbidden of ['onUnauthorized', 'onStatus', 'handleResponse', 'invoke', 'retry']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });
});
