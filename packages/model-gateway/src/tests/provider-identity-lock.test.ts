/**
 * Canonical provider-identity locks (JF-2A hardening, ADR-0146).
 *
 * ### The defect these close
 *
 * `providerId` was an injected string that only had to satisfy an identifier grammar, and the adapter
 * published it into `descriptor.providerId` and into its capabilities. Once `ProviderMode` began
 * treating the literals `groq` and `nara` as SEMANTIC identities, that was a spoofing surface in both
 * directions: a Nara adapter claiming `groq` would satisfy `GROQ_ONLY` and rank FIRST under `AUTO`
 * while every request went to NaraRouter, and a Groq adapter claiming `nara` would satisfy `NARA_ONLY`.
 *
 * Fixing one direction only would leave the other open, so both adapters are pinned and both are
 * proved here. The spoof-resistance specs use the REAL configs and the REAL routing plan — there is no
 * second router and no simulation of one.
 *
 * No provider is invoked, no socket is opened, and every key is an obvious sentinel.
 */
import { describe, expect, it } from 'vitest';

import {
  CANONICAL_PROVIDER_IDS,
  GROQ_CANONICAL_PROVIDER_ID,
  NARA_CANONICAL_PROVIDER_ID,
  assertCanonicalProviderId,
  assertNoForeignProviderIdentity,
} from '../contracts/provider-identity.js';
import { createGroqApiKey } from '../providers/groq/groq-secret.js';
import { createGroqProviderConfig } from '../providers/groq/groq-config.js';
import { GroqModelProvider } from '../providers/groq/groq-model-provider.js';
import type { GroqTransport } from '../providers/groq/groq-transport.js';
import { createNaraApiKey } from '../providers/nara/nara-secret.js';
import { createNaraProviderConfig } from '../providers/nara/nara-config.js';
import { NaraModelProvider } from '../providers/nara/nara-model-provider.js';
import type { NaraTransport } from '../providers/nara/nara-transport.js';
import { createHybridRoutingPolicy } from '../routing/hybrid-routing-policy.js';
import { buildRoutingPlan } from '../routing/routing-plan.js';
import {
  GROQ_PROVIDER_ID,
  NARA_PROVIDER_ID,
  hostedOrderForProviderMode,
  hybridRoutingPolicyInputForProviderMode,
  type ProviderMode,
} from '../routing/provider-mode.js';
import type { ModelProvider } from '../contracts/provider.js';
import type { ModelRequest } from '../contracts/request.js';

const SENTINEL = 'sentinel-not-a-real-key-0000';
const CLOCK = { now: (): number => 1_000 };

const NOOP_GROQ_TRANSPORT: GroqTransport = {
  send: () => Promise.reject(new Error('an identity spec must never reach a transport')),
};
const NOOP_NARA_TRANSPORT: NaraTransport = {
  send: () => Promise.reject(new Error('an identity spec must never reach a transport')),
};

/** Ids that are syntactically valid and semantically wrong. */
const IMPOSTOR_IDS: readonly string[] = Object.freeze([
  'groq-typo',
  'nara-typo',
  'groq.staging',
  'groq.test.candidate',
  'nara.staging',
  'Groq',
  'NARA',
  'openai',
  'provider-1',
  'router',
]);

function groqConfigWith(providerId: string): () => unknown {
  return () =>
    createGroqProviderConfig({
      providerId,
      modelId: 'llama-3.1-8b-instant',
      modelVersion: '2025-07',
      maxInputTokens: 4_096,
      maxCompletionTokens: 256,
      supportsStrictJsonSchema: true,
      apiKey: createGroqApiKey(SENTINEL),
      transport: NOOP_GROQ_TRANSPORT,
      dataControlsAttested: true,
    });
}

function naraConfigWith(providerId: string): () => unknown {
  return () =>
    createNaraProviderConfig({
      providerId,
      modelId: 'vendor/test-model-8b',
      modelVersion: '2026-09-01',
      maxInputTokens: 4_096,
      maxCompletionTokens: 256,
      apiKey: createNaraApiKey(SENTINEL),
      transport: NOOP_NARA_TRANSPORT,
      dataControlsAttested: true,
    });
}

describe('the canonical identity assertion itself', () => {
  it('is an exact equality test with no normalization', () => {
    expect(GROQ_CANONICAL_PROVIDER_ID).toBe('groq');
    expect(NARA_CANONICAL_PROVIDER_ID).toBe('nara');
    expect(() => {
      assertCanonicalProviderId('groq', 'groq');
    }).not.toThrow();
    for (const near of [
      'Groq',
      'GROQ',
      'groq ',
      ' groq',
      'groq.',
      'gro q',
      '',
      undefined,
      null,
      7,
    ]) {
      expect(() => {
        assertCanonicalProviderId('groq', near);
      }).toThrow(/may only be configured with providerId/);
    }
  });

  it('names both the expected and the supplied id, and leaks nothing else', () => {
    try {
      assertCanonicalProviderId('nara', 'groq');
      throw new Error('should have thrown');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain("'nara'");
      expect(message).toContain("'groq'");
      expect(message).not.toContain(SENTINEL);
    }
  });
});

describe('1-6. the Nara adapter may only be nara', () => {
  it('1. accepts the canonical id', () => {
    expect(naraConfigWith(NARA_CANONICAL_PROVIDER_ID)).not.toThrow();
  });

  it('2. refuses the Groq identity', () => {
    expect(naraConfigWith('groq')).toThrow(/may only be configured with providerId 'nara'/);
  });

  it('3. refuses a near-miss typo', () => {
    expect(naraConfigWith('nara-typo')).toThrow(/providerId 'nara'/);
  });

  it('4. refuses every other syntactically valid identifier', () => {
    for (const id of IMPOSTOR_IDS) {
      expect(naraConfigWith(id), id).toThrow(/providerId 'nara'/);
    }
  });

  it('5-6. publishes nara in the descriptor and the capabilities', () => {
    const config = createNaraProviderConfig({
      providerId: NARA_CANONICAL_PROVIDER_ID,
      modelId: 'vendor/test-model-8b',
      modelVersion: '2026-09-01',
      maxInputTokens: 4_096,
      maxCompletionTokens: 256,
      apiKey: createNaraApiKey(SENTINEL),
      transport: NOOP_NARA_TRANSPORT,
      dataControlsAttested: true,
    });
    const provider = new NaraModelProvider(config, CLOCK);
    expect(config.providerId).toBe('nara');
    expect(provider.descriptor.providerId).toBe('nara');
    expect(provider.capabilities().providerId).toBe('nara');
    expect(provider.descriptor.executionClass).toBe('HOSTED');
  });
});

describe('7-12. the Groq adapter may never claim another provider identity', () => {
  /**
   * A FOREIGN-identity refusal rather than an exact pin, and the reason is measured rather than
   * assumed: the controlled SHADOW runner composes TWO Groq providers into ONE gateway roster, and the
   * roster's health map, circuit breaker and routing plan are all keyed by `providerId`. Pinning both
   * legs to `groq` makes them indistinguishable and the gateway returns `internal-invariant` instead
   * of running the comparison.
   *
   * The spoof is still closed, which is what the modes depend on: a Groq adapter can never publish
   * `nara`, and a scoped `groq.*` id is `not-in-policy` for every provider mode, so it can satisfy
   * none of them. What remains open is a Groq-side typo that no mode can select — closing that needs
   * the shadow runner to discriminate its legs by something other than `providerId`, which is an owner
   * decision about a merged A/B path.
   */
  it('7. accepts the canonical id', () => {
    expect(groqConfigWith(GROQ_CANONICAL_PROVIDER_ID)).not.toThrow();
  });

  it('8. refuses the Nara identity — the spoof direction that matters', () => {
    expect(groqConfigWith('nara')).toThrow(/may not publish another provider's identity/);
  });

  it('9. still accepts a scoped Groq identity, because the shadow A/B path needs two', () => {
    // Measured, not assumed: `apps/api/src/shadow/create-controlled-shadow-runner.ts` builds
    // `providers: [stableObserved.provider, candidateObserved.provider]` in one roster.
    for (const scoped of ['groq.staging', 'groq.shadow.stable', 'groq.shadow.candidate']) {
      expect(groqConfigWith(scoped), scoped).not.toThrow();
    }
  });

  it('10. refuses every foreign canonical identity, and only those', () => {
    for (const id of IMPOSTOR_IDS) {
      if (CANONICAL_PROVIDER_IDS.includes(id) && id !== GROQ_CANONICAL_PROVIDER_ID) {
        expect(groqConfigWith(id), id).toThrow(/may not publish another provider's identity/);
      } else {
        // Not a provider mode's id, so it can satisfy no mode. Permitted, and inert.
        expect(groqConfigWith(id), id).not.toThrow();
      }
    }
  });

  it('10b. a scoped Groq id is not-in-policy for every provider mode', () => {
    // The property that makes the weaker rule sufficient.
    for (const mode of ['AUTO', 'GROQ_ONLY', 'NARA_ONLY'] as const) {
      const order = hostedOrderForProviderMode(mode);
      expect(order).not.toContain('groq.shadow.stable');
      expect(order).not.toContain('groq.staging');
    }
  });

  it('11-12. publishes groq in the descriptor and the capabilities', () => {
    const config = createGroqProviderConfig({
      providerId: GROQ_CANONICAL_PROVIDER_ID,
      modelId: 'llama-3.1-8b-instant',
      modelVersion: '2025-07',
      maxInputTokens: 4_096,
      maxCompletionTokens: 256,
      supportsStrictJsonSchema: true,
      apiKey: createGroqApiKey(SENTINEL),
      transport: NOOP_GROQ_TRANSPORT,
      dataControlsAttested: true,
    });
    const provider = new GroqModelProvider(config, CLOCK);
    expect(config.providerId).toBe('groq');
    expect(provider.descriptor.providerId).toBe('groq');
    expect(provider.capabilities().providerId).toBe('groq');
    expect(provider.descriptor.executionClass).toBe('HOSTED');
  });
});

describe('13-17. provider mode cannot be satisfied by a spoofed identity', () => {
  /** The real providers, at their only permitted identities. */
  const realGroq = new GroqModelProvider(
    createGroqProviderConfig({
      providerId: GROQ_CANONICAL_PROVIDER_ID,
      modelId: 'llama-3.1-8b-instant',
      modelVersion: '2025-07',
      maxInputTokens: 4_096,
      maxCompletionTokens: 256,
      supportsStrictJsonSchema: true,
      apiKey: createGroqApiKey(SENTINEL),
      transport: NOOP_GROQ_TRANSPORT,
      dataControlsAttested: true,
    }),
    CLOCK,
  );
  const realNara = new NaraModelProvider(
    createNaraProviderConfig({
      providerId: NARA_CANONICAL_PROVIDER_ID,
      modelId: 'vendor/test-model-8b',
      modelVersion: '2026-09-01',
      maxInputTokens: 4_096,
      maxCompletionTokens: 256,
      apiKey: createNaraApiKey(SENTINEL),
      transport: NOOP_NARA_TRANSPORT,
      dataControlsAttested: true,
    }),
    CLOCK,
  );

  const healthy = new Map<string, boolean>([
    [GROQ_PROVIDER_ID, true],
    [NARA_PROVIDER_ID, true],
  ]);
  const noCircuit = (): boolean => false;
  const request = {
    runId: 'run-1',
    dataClass: 'HOSTED_ALLOWED',
    resultMode: 'TEXT',
    requiredCapabilities: {},
  } as ModelRequest;
  const policyFor = (mode: ProviderMode) =>
    createHybridRoutingPolicy(
      hybridRoutingPolicyInputForProviderMode(mode, { maxTotalAttempts: 2, localOrder: [] }),
    );

  it('13. a Nara provider cannot be constructed under the Groq identity', () => {
    expect(naraConfigWith('groq')).toThrow();
    // And therefore no Nara instance carrying `groq` can exist to be put in a roster.
    const impostors = IMPOSTOR_IDS.filter((id) => id === 'groq');
    for (const id of [...impostors, 'groq']) {
      expect(naraConfigWith(id), id).toThrow();
    }
  });

  it('14. a Groq provider cannot be constructed under the Nara identity', () => {
    expect(groqConfigWith('nara')).toThrow();
    // And the foreign-identity rule is symmetric at the assertion level too.
    expect(() => {
      assertNoForeignProviderIdentity('groq', 'nara');
    }).toThrow();
    expect(() => {
      assertNoForeignProviderIdentity('nara', 'groq');
    }).toThrow();
  });

  it('15. GROQ_ONLY selects the real Groq adapter, and Nara is excluded by policy', () => {
    const result = buildRoutingPlan(
      request,
      [realGroq, realNara],
      healthy,
      noCircuit,
      policyFor('GROQ_ONLY'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.primaryProviderId).toBe('groq');
    // The selected instance IS the Groq adapter, not something that merely claims the name.
    expect(result.plan.primary).toBe(realGroq);
    expect(result.plan.primary).not.toBe(realNara);
    expect(result.plan.summary.fallbackProviderId).toBeUndefined();
  });

  it('16. NARA_ONLY selects the real Nara adapter, and Groq is excluded by policy', () => {
    const result = buildRoutingPlan(
      request,
      [realGroq, realNara],
      healthy,
      noCircuit,
      policyFor('NARA_ONLY'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.primaryProviderId).toBe('nara');
    expect(result.plan.primary).toBe(realNara);
    expect(result.plan.primary).not.toBe(realGroq);
    expect(result.plan.summary.fallbackProviderId).toBeUndefined();
  });

  it('17. AUTO is still Groq primary then Nara fallback, by instance', () => {
    const result = buildRoutingPlan(
      request,
      [realGroq, realNara],
      healthy,
      noCircuit,
      policyFor('AUTO'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.primaryProviderId).toBe('groq');
    expect(result.plan.summary.fallbackProviderId).toBe('nara');
    expect(result.plan.primary).toBe(realGroq);
    expect(result.plan.fallback).toBe(realNara);
  });

  it('the routing layer and the adapters share ONE identity constant', () => {
    // Two literals that happened to agree would be a coincidence maintained by hand.
    expect(GROQ_PROVIDER_ID).toBe(GROQ_CANONICAL_PROVIDER_ID);
    expect(NARA_PROVIDER_ID).toBe(NARA_CANONICAL_PROVIDER_ID);
    const providers: readonly ModelProvider[] = [realGroq, realNara];
    expect(providers.map((one) => one.descriptor.providerId)).toStrictEqual([
      GROQ_PROVIDER_ID,
      NARA_PROVIDER_ID,
    ]);
  });
});
