/**
 * QFJ-S2-B — the production composition (ADR-0062 §1, §2, §3).
 *
 * Matrix: it constructs from injected fakes; it is born OFF; it refuses to serve while OFF, BEFORE any
 * provider is consulted; it refuses every non-OFF configuration; it fails closed on an unregistered or
 * inexact release; it exposes no rollout mutation surface; and its source performs no environment,
 * filesystem, network or secret access.
 *
 * Every test is offline. No real provider, no transport, no network, no credential, no database.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isModelGatewayError } from '@qf-jarvis/model-gateway';
import { createModelCapabilityRegistry, createProviderReleaseRef } from '@qf-jarvis/model-gateway';
import { fakeGroqCredentialResolver } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import { createProductionModelGateway } from '../create-production-model-gateway.js';
import * as barrel from '../index.js';
import {
  countingProvider,
  syntheticProfile,
  syntheticProvider,
  syntheticRelease,
  syntheticRequest,
  validCompositionConfig,
} from './composition-test-support.js';

const PKG_DIR = new URL('../../', import.meta.url);

function readPackageSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, PKG_DIR)), 'utf8');
}

/**
 * Strip documentation so a containment scan reads CODE, not prose.
 *
 * These modules describe what they refuse to do ("no secret", "inspect a credential"), and a raw-text
 * scan flags that description as the very thing it forbids. Removing block comments and whole-line `//`
 * comments — never a trailing one, so `https://` inside a string stays scannable — leaves the
 * executable text, which is what the invariant is actually about.
 */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const PRODUCTION_SOURCES = [
  'src/index.ts',
  'src/create-production-model-gateway.ts',
  'src/live-model-gateway-invoker.ts',
  'src/contracts/production-composition-config.ts',
] as const;

describe('(1, 2) it constructs from valid injected fakes and is born OFF', () => {
  it('composes and reports a non-activatable OFF status', () => {
    const result = createProductionModelGateway(validCompositionConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { status } = result.composition;
    expect(status.mode).toBe('OFF');
    expect(status.activatable).toBe(false);
    expect(status.retryBudget).toBe(0);
    expect(status.fallbackEnabled).toBe(false);
    expect(status.releaseIds).toEqual(['release.s2b.synthetic.v1']);
    expect(status.providerIds).toEqual(['groq.staging']);
  });

  it('reports only whether a credential-resolver seam was supplied, never the resolver', () => {
    const resolver = fakeGroqCredentialResolver();
    const result = createProductionModelGateway(
      validCompositionConfig({ credentialResolver: resolver }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.composition.status.credentialResolverSupplied).toBe(true);
    // (5) The seam is NEVER invoked: providers arrive already constructed.
    expect(resolver.resolved()).toBe(0);
    const surface = JSON.stringify(result.composition.status);
    expect(surface).not.toContain('resolve');
    expect(surface.toLowerCase()).not.toContain('key');
  });
});

describe('(3, 4, 5, 6) it refuses to serve while OFF, before touching anything', () => {
  it('fails closed with gateway-off and consults no provider, health, or credential', async () => {
    const provider = countingProvider();
    const resolver = fakeGroqCredentialResolver();
    const result = createProductionModelGateway(
      validCompositionConfig({ providers: [provider], credentialResolver: resolver }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(result.composition.gateway.invoke(syntheticRequest())).rejects.toMatchObject({
      code: 'gateway-off',
    });

    // (4) no provider invocation, (6) no transport/health consultation, (5) no credential resolution.
    expect(provider.invocations()).toBe(0);
    expect(provider.healthChecks()).toBe(0);
    expect(resolver.resolved()).toBe(0);
  });

  it('no output can be accepted while OFF, on repeated attempts', async () => {
    const provider = countingProvider();
    const result = createProductionModelGateway(validCompositionConfig({ providers: [provider] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 0; i < 3; i += 1) {
      const thrown = await result.composition.gateway
        .invoke(syntheticRequest({ runId: `run.s2b.synthetic.${String(i)}` }))
        .then(() => undefined)
        .catch((error: unknown) => error);
      expect(isModelGatewayError(thrown)).toBe(true);
    }
    expect(provider.invocations()).toBe(0);
    expect(provider.healthChecks()).toBe(0);
  });

  it('(12) the kill switch is honoured and still reaches no provider', async () => {
    const provider = countingProvider();
    const result = createProductionModelGateway(
      validCompositionConfig({ providers: [provider], killSwitch: { active: () => true } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.composition.gateway.invoke(syntheticRequest())).rejects.toMatchObject({
      code: 'kill-switch-active',
    });
    expect(provider.invocations()).toBe(0);
  });
});

describe('(7, 8) it is structurally incapable of CANARY or ACTIVE', () => {
  for (const mode of ['ACTIVE', 'CANARY', 'SHADOW', 'FALLBACK'] as const) {
    it(`refuses a ${mode} configuration at construction`, () => {
      const result = createProductionModelGateway(validCompositionConfig({ mode }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('mode-not-off');
    });
  }

  it('(15) no activation, promotion or rollout mutation surface is reachable', () => {
    const result = createProductionModelGateway(validCompositionConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The composition exposes exactly the invocation surface and non-secret metadata.
    expect(Object.keys(result.composition).sort()).toEqual(['gateway', 'status']);
    expect(Object.keys(result.composition.gateway)).toEqual(['invoke']);
    const surface = result.composition as unknown as Record<string, unknown>;
    for (const forbidden of [
      'controller',
      'rollout',
      'transition',
      'emergencyDisable',
      'activate',
      'promote',
      'enable',
      'providers',
      'registry',
      'credentialResolver',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
    // No rollout controller is constructed at all, so its methods cannot exist anywhere here.
    for (const source of PRODUCTION_SOURCES) {
      expect(readPackageSource(source)).not.toMatch(/createProviderRolloutController/);
    }
  });
});

describe('(9, 10, 11) release and capability references fail closed', () => {
  it('(9) refuses an approved release that is not in the registry', () => {
    const result = createProductionModelGateway(
      validCompositionConfig({ capabilityRegistry: createModelCapabilityRegistry([]) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unregistered-release');
  });

  it('(10) refuses a registry profile whose identity does not match the approved release', () => {
    const approved = syntheticRelease();
    const divergent = syntheticRelease({ modelVersion: '2026-01-01' });
    const result = createProductionModelGateway(
      validCompositionConfig({
        approvedReleases: [approved],
        capabilityRegistry: createModelCapabilityRegistry([syntheticProfile(divergent)]),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('capability-profile-mismatch');
  });

  it('(11) refuses a wildcard or `latest` identity', () => {
    // `createProviderReleaseRef` already refuses `*` (charset) and a 6-char `latest` digest (length),
    // so those are asserted as the FIRST line of defence, and the composition guard is then proved
    // independently against hand-built refs that bypass the factory entirely.
    for (const over of [{ providerId: '*' }, { configDigest: 'latest' }]) {
      expect(() => createProviderReleaseRef({ ...syntheticRelease(), ...over })).toThrow();
    }

    for (const over of [
      { releaseId: 'latest' },
      { providerId: 'LATEST' },
      { modelVersion: 'Latest' },
      { modelId: 'latest' },
    ]) {
      const release = { ...syntheticRelease(), ...over };
      const result = createProductionModelGateway(
        validCompositionConfig({ approvedReleases: [release] }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The wildcard gate runs BEFORE the registry lookup, so this is never masked by a
      // `unregistered-release` refusal.
      expect(result.reason).toBe('wildcard-identity');
    }
  });

  it('refuses a release with no matching provider instance, and a contradicting provider', () => {
    const empty = createProductionModelGateway(validCompositionConfig({ providers: [] }));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('empty-composition');

    const foreign = createProductionModelGateway(
      validCompositionConfig({
        providers: [syntheticProvider({ providerId: 'some.other.provider' })],
      }),
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toBe('unregistered-provider');

    const contradicting = createProductionModelGateway(
      validCompositionConfig({ providers: [syntheticProvider({ modelVersion: '1999-01-01' })] }),
    );
    expect(contradicting.ok).toBe(false);
    if (!contradicting.ok) expect(contradicting.reason).toBe('provider-release-mismatch');
  });

  it('refuses an empty approved-release set', () => {
    const result = createProductionModelGateway(validCompositionConfig({ approvedReleases: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('empty-composition');
  });
});

describe('(13, 14) the reliability posture is locked', () => {
  it('(13) refuses a non-zero default retry budget and refuses a non-zero request retryBudget', async () => {
    const refused = createProductionModelGateway(validCompositionConfig({ defaultRetryBudget: 2 }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('retry-budget-not-zero');

    // An explicit 0 is accepted, and the admission guard then refuses a non-zero request.
    const built = createProductionModelGateway(validCompositionConfig({ defaultRetryBudget: 0 }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    await expect(
      built.composition.gateway.invoke(syntheticRequest({ retryBudget: 3 })),
    ).rejects.toMatchObject({ code: 'request-invalid' });
  });

  it('(14) refuses a configuration that asks for fallback, and composes allowFallback false', () => {
    const refused = createProductionModelGateway(validCompositionConfig({ allowFallback: true }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe('fallback-not-disabled');

    const source = readPackageSource('src/create-production-model-gateway.ts');
    expect(source).toContain('const LOCKED_ALLOW_FALLBACK = false;');
    expect(source).toContain('allowFallback: LOCKED_ALLOW_FALLBACK,');
    // No routing profile and no rollout controller are ever passed to the gateway.
    expect(source).not.toMatch(/routingProfile:/);
    expect(source).not.toMatch(/rolloutController:/);
  });
});

describe('(16, 17, 18, 19, 20) source containment', () => {
  it('(16, 17, 18) reads no environment, opens no node I/O module, and calls no fetch', () => {
    for (const file of PRODUCTION_SOURCES) {
      const text = readPackageSource(file);
      expect(text).not.toMatch(/process\s*\.\s*env/);
      expect(text).not.toMatch(/from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process)['"]/);
      expect(text).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('(20) declares no concrete secret reader of any kind', () => {
    for (const file of PRODUCTION_SOURCES) {
      const text = codeOnly(readPackageSource(file));
      for (const forbidden of [
        'createNodeMaskedSecretSource',
        'MaskedSecretSource',
        'readFileSync',
        'keychain',
        'SecretsManager',
        'KeyVault',
        'dotenv',
      ]) {
        expect(text).not.toContain(forbidden);
      }
      // The seam is a TYPE-only reference to the existing gateway interface — never an implementation.
      expect(text).not.toMatch(/class\s+\w*CredentialResolver\b/);
      expect(text).not.toMatch(/function\s+create\w*CredentialResolver\b/);
    }
  });

  it('(19) no config, status, refusal or event surface can carry a secret', () => {
    // Scanned as CODE: these contracts document what they exclude, and that prose is not a field.
    const contracts = codeOnly(
      readPackageSource('src/contracts/production-composition-config.ts'),
    ).toLowerCase();
    for (const forbidden of ['apikey', 'secret', 'token', 'password', 'bearer', 'authorization']) {
      expect(contracts).not.toContain(forbidden);
    }
    const result = createProductionModelGateway(
      validCompositionConfig({ credentialResolver: fakeGroqCredentialResolver() }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const surface = JSON.stringify(result.composition.status);
    expect(surface).not.toContain('FAKE');
    expect(surface).not.toContain('Bearer');
    expect(surface.toLowerCase()).not.toContain('authorization');
  });

  it('composes the EXISTING gateway rather than reimplementing it', () => {
    const source = readPackageSource('src/create-production-model-gateway.ts');
    expect(source).toContain('createModelGateway(');
    // No second router, retry loop, circuit, semaphore or output validator lives here.
    expect(source).not.toMatch(/\bfor\s*\(\s*let\s+attempt\b/);
    expect(source).not.toMatch(
      /circuit\.|semaphore\.|selectProviders|buildRoutingPlan|decideFallover/,
    );
  });
});

describe('(42) the package root runtime API is exactly 2', () => {
  it('exports only the two composition factories', () => {
    const runtime = Object.keys(barrel);
    expect(runtime.sort()).toEqual([
      'createLiveModelGatewayInvoker',
      'createProductionModelGateway',
    ]);
    expect(runtime).toHaveLength(2);
    for (const value of Object.values(barrel)) {
      expect(typeof value).toBe('function');
    }
  });
});
