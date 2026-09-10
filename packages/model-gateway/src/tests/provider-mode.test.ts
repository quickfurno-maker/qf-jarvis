/**
 * The V1 provider-SELECTION mode specs (JF-2A, ADR-0146).
 *
 * Two things are proved here. First, that the mode maps deterministically onto the EXISTING routing
 * policy — Groq first, Nara second, one bounded fallback — using `buildRoutingPlan` and `decideFallover`
 * themselves rather than a reimplementation. Second, that a mode can only ever NARROW: it cannot
 * override a data class, cannot conjure an absent or unhealthy provider, and cannot turn anything on.
 *
 * No provider is invoked. The roster is built from stub providers that would throw if called.
 */
import { describe, expect, it } from 'vitest';

import { createHybridRoutingPolicy } from '../routing/hybrid-routing-policy.js';
import { buildRoutingPlan } from '../routing/routing-plan.js';
import { decideFallover } from '../routing/failover-policy.js';
import {
  GROQ_PROVIDER_ID,
  NARA_PROVIDER_ID,
  PROVIDER_MODES,
  fallbackPermittedForProviderMode,
  hostedOrderForProviderMode,
  hybridRoutingPolicyInputForProviderMode,
  isProviderMode,
  parseProviderMode,
  providerEligibleUnderMode,
  type ProviderMode,
} from '../routing/provider-mode.js';
import { defineProviderCapabilities } from '../contracts/capabilities.js';
import type { ModelProvider } from '../contracts/provider.js';
import type { ModelRequest } from '../contracts/request.js';
import type { ProviderExecutionClass } from '../contracts/enums.js';

/** A provider that declares an identity and refuses to be invoked. Routing never calls one. */
function stubProvider(providerId: string, executionClass: ProviderExecutionClass): ModelProvider {
  return {
    descriptor: { providerId, executionClass },
    capabilities: () =>
      defineProviderCapabilities({
        providerId,
        modelId: `${providerId}/model`,
        modelVersion: 'v1',
        executionClass,
        supportsStructuredOutput: true,
        supportsStrictJsonSchema: false,
        maxInputTokens: 100_000,
        supportsTimeout: true,
        supportsCancellation: true,
        supportsNonStreaming: true,
        supportsStreaming: false,
      }),
    health: () => Promise.resolve({ available: true }),
    invoke: () => {
      throw new Error('a routing spec must never invoke a provider');
    },
  };
}

const GROQ = stubProvider(GROQ_PROVIDER_ID, 'HOSTED');
const NARA = stubProvider(NARA_PROVIDER_ID, 'HOSTED');
const LOCAL = stubProvider('local-workstation', 'LOCAL');
const ROSTER = [GROQ, NARA, LOCAL];

const ALL_HEALTHY = new Map<string, boolean>([
  [GROQ_PROVIDER_ID, true],
  [NARA_PROVIDER_ID, true],
  ['local-workstation', true],
]);
const NO_CIRCUIT_OPEN = (): boolean => false;

function policyFor(mode: ProviderMode, localOrder: readonly string[] = ['local-workstation']) {
  return createHybridRoutingPolicy(
    hybridRoutingPolicyInputForProviderMode(mode, { maxTotalAttempts: 2, localOrder }),
  );
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    runId: 'run-1',
    dataClass: 'HOSTED_ALLOWED',
    resultMode: 'TEXT',
    requiredCapabilities: {},
    ...overrides,
  } as ModelRequest;
}

describe('JF-2A provider mode is a closed, validated union', () => {
  it('21. accepts exactly the three V1 modes', () => {
    expect([...PROVIDER_MODES]).toStrictEqual(['AUTO', 'GROQ_ONLY', 'NARA_ONLY']);
    for (const mode of PROVIDER_MODES) {
      expect(isProviderMode(mode)).toBe(true);
      expect(parseProviderMode(mode)).toBe(mode);
    }
  });

  it('21b. refuses anything else rather than defaulting', () => {
    for (const bad of ['auto', 'AUTO_MODE', 'GROQ', 'OFF', 'ACTIVE', '', null, undefined, 7, {}]) {
      expect(isProviderMode(bad)).toBe(false);
      // A silent default to AUTO would read a typo as "use both providers" — the one thing an
      // operator asking for GROQ_ONLY was trying to prevent.
      expect(() => parseProviderMode(bad)).toThrow(/unknown provider mode/i);
    }
  });

  it('20b. is a different axis from the activation mode', () => {
    // No activation value is a provider mode, and no provider mode is an activation value.
    for (const gatewayMode of ['OFF', 'SHADOW', 'CANARY', 'ACTIVE', 'FALLBACK']) {
      expect(isProviderMode(gatewayMode)).toBe(false);
    }
    for (const mode of PROVIDER_MODES) {
      expect(['OFF', 'SHADOW', 'CANARY', 'ACTIVE', 'FALLBACK']).not.toContain(mode);
    }
  });
});

describe('JF-2A mode → hosted order mapping', () => {
  it('17. AUTO puts Groq first and Nara second', () => {
    expect(hostedOrderForProviderMode('AUTO')).toStrictEqual([GROQ_PROVIDER_ID, NARA_PROVIDER_ID]);
    expect(fallbackPermittedForProviderMode('AUTO')).toBe(true);
  });

  it('18. GROQ_ONLY makes Nara ineligible', () => {
    expect(hostedOrderForProviderMode('GROQ_ONLY')).toStrictEqual([GROQ_PROVIDER_ID]);
    expect(providerEligibleUnderMode('GROQ_ONLY', NARA_PROVIDER_ID)).toBe(false);
    expect(providerEligibleUnderMode('GROQ_ONLY', GROQ_PROVIDER_ID)).toBe(true);
    expect(fallbackPermittedForProviderMode('GROQ_ONLY')).toBe(false);
  });

  it('19. NARA_ONLY makes Groq ineligible', () => {
    expect(hostedOrderForProviderMode('NARA_ONLY')).toStrictEqual([NARA_PROVIDER_ID]);
    expect(providerEligibleUnderMode('NARA_ONLY', GROQ_PROVIDER_ID)).toBe(false);
    expect(providerEligibleUnderMode('NARA_ONLY', NARA_PROVIDER_ID)).toBe(true);
    expect(fallbackPermittedForProviderMode('NARA_ONLY')).toBe(false);
  });

  it('builds a policy the EXISTING validator accepts', () => {
    for (const mode of PROVIDER_MODES) {
      const policy = policyFor(mode);
      expect(policy.profile).toBe('HOSTED_FIRST');
      expect(policy.executionClassOrder).toStrictEqual(['HOSTED', 'LOCAL']);
      expect(policy.hostedOrder).toStrictEqual(hostedOrderForProviderMode(mode));
    }
  });
});

describe('JF-2A reuses the existing routing plan', () => {
  it('24-25. AUTO selects Groq primary and exactly one Nara fallback', () => {
    const result = buildRoutingPlan(
      request(),
      ROSTER,
      ALL_HEALTHY,
      NO_CIRCUIT_OPEN,
      policyFor('AUTO'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.primaryProviderId).toBe(GROQ_PROVIDER_ID);
    expect(result.plan.summary.primaryExecutionClass).toBe('HOSTED');
    expect(result.plan.summary.fallbackProviderId).toBe(NARA_PROVIDER_ID);
    expect(result.plan.summary.fallbackExecutionClass).toBe('HOSTED');
    // ONE fallback. The plan has no third slot, so a chain is not representable.
    expect(Object.keys(result.plan)).not.toContain('fallbacks');
  });

  it('18b. GROQ_ONLY plans Groq with no fallback, and excludes Nara by policy', () => {
    const result = buildRoutingPlan(
      request(),
      ROSTER,
      ALL_HEALTHY,
      NO_CIRCUIT_OPEN,
      policyFor('GROQ_ONLY'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.primaryProviderId).toBe(GROQ_PROVIDER_ID);
    expect(result.plan.summary.fallbackProviderId).toBeUndefined();
    expect(
      result.plan.summary.exclusions.find((one) => one.providerId === NARA_PROVIDER_ID)?.reason,
    ).toBe('not-in-policy');
  });

  it('19b. NARA_ONLY plans Nara with no fallback, and excludes Groq by policy', () => {
    const result = buildRoutingPlan(
      request(),
      ROSTER,
      ALL_HEALTHY,
      NO_CIRCUIT_OPEN,
      policyFor('NARA_ONLY'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.summary.primaryProviderId).toBe(NARA_PROVIDER_ID);
    expect(result.plan.summary.fallbackProviderId).toBeUndefined();
    expect(
      result.plan.summary.exclusions.find((one) => one.providerId === GROQ_PROVIDER_ID)?.reason,
    ).toBe('not-in-policy');
  });

  it('22. no mode can override a LOCAL_ONLY data class', () => {
    for (const mode of PROVIDER_MODES) {
      const result = buildRoutingPlan(
        request({ dataClass: 'LOCAL_ONLY' }),
        ROSTER,
        ALL_HEALTHY,
        NO_CIRCUIT_OPEN,
        policyFor(mode),
      );
      expect(result.ok, mode).toBe(true);
      if (!result.ok) continue;
      // A hosted provider never appears for a LOCAL_ONLY request, not even as a fallback.
      expect(result.plan.summary.primaryExecutionClass).toBe('LOCAL');
      expect(result.plan.summary.fallbackExecutionClass).not.toBe('HOSTED');
      expect(result.plan.summary.primaryProviderId).not.toBe(GROQ_PROVIDER_ID);
      expect(result.plan.summary.primaryProviderId).not.toBe(NARA_PROVIDER_ID);
    }
  });

  it('22b. no mode can serve a HUMAN_ONLY request', () => {
    for (const mode of PROVIDER_MODES) {
      const result = buildRoutingPlan(
        request({ dataClass: 'HUMAN_ONLY' }),
        ROSTER,
        ALL_HEALTHY,
        NO_CIRCUIT_OPEN,
        policyFor(mode),
      );
      expect(result.ok, mode).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('internal-invariant');
      expect(result.summary.primaryProviderId).toBeUndefined();
    }
  });

  it('23. an unavailable requested provider fails safely instead of falling through', () => {
    // NARA_ONLY with Nara unhealthy must NOT silently serve Groq.
    const naraDown = new Map(ALL_HEALTHY);
    naraDown.set(NARA_PROVIDER_ID, false);
    const result = buildRoutingPlan(
      request(),
      ROSTER,
      naraDown,
      NO_CIRCUIT_OPEN,
      policyFor('NARA_ONLY', []),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-eligible-provider');
    expect(result.summary.primaryProviderId).toBeUndefined();
  });

  it('23b. a mode cannot conjure a provider that is not in the roster', () => {
    const result = buildRoutingPlan(
      request(),
      [GROQ, LOCAL],
      ALL_HEALTHY,
      NO_CIRCUIT_OPEN,
      policyFor('NARA_ONLY', []),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-eligible-provider');
  });
});

describe('JF-2A leaves the existing failover policy unchanged', () => {
  const autoPolicy = policyFor('AUTO');
  const base = {
    cancelled: false,
    hasEligibleFallback: true,
    fallbackExecutionClass: 'HOSTED' as const,
    dataClass: 'HOSTED_ALLOWED' as const,
    primaryInvoked: true,
    attemptsRemaining: 1,
  };

  it('26. a transient failure still earns the single fallback', () => {
    const decision = decideFallover(
      { ...base, primaryCode: 'provider-unavailable', primaryRetryable: true },
      autoPolicy,
    );
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('fallback-eligible-transient');
  });

  it('27. a circuit-open primary still selects the bounded fallback', () => {
    const decision = decideFallover(
      { ...base, primaryInvoked: false, primaryCode: 'circuit-open', primaryRetryable: false },
      autoPolicy,
    );
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('primary-circuit-open');
  });

  it('28-31. terminal categories still refuse to fail over', () => {
    const cases: readonly {
      readonly label: string;
      readonly input: Parameters<typeof decideFallover>[0];
      readonly reason: string;
    }[] = [
      {
        label: 'structured-output-invalid',
        input: { ...base, primaryCode: 'structured-output-invalid', primaryRetryable: true },
        reason: 'primary-structured-invalid',
      },
      {
        label: 'malformed-provider-output',
        input: { ...base, primaryCode: 'malformed-provider-output', primaryRetryable: true },
        reason: 'primary-malformed',
      },
      {
        label: 'cancellation',
        input: {
          ...base,
          cancelled: true,
          primaryCode: 'provider-unavailable',
          primaryRetryable: true,
        },
        reason: 'cancelled',
      },
      {
        label: 'budget exhausted',
        input: {
          ...base,
          attemptsRemaining: 0,
          primaryCode: 'provider-unavailable',
          primaryRetryable: true,
        },
        reason: 'budget-exhausted',
      },
      {
        label: 'non-retryable',
        input: { ...base, primaryCode: 'provider-failed', primaryRetryable: false },
        reason: 'primary-non-retryable',
      },
    ];
    for (const one of cases) {
      const decision = decideFallover(one.input, autoPolicy);
      expect(decision.allow, one.label).toBe(false);
      expect(decision.reason, one.label).toBe(one.reason);
    }
  });

  it('31b. a single-provider mode disables fallback outright', () => {
    for (const mode of ['GROQ_ONLY', 'NARA_ONLY'] as const) {
      const decision = decideFallover(
        { ...base, primaryCode: 'provider-unavailable', primaryRetryable: true },
        policyFor(mode),
      );
      expect(decision.allow, mode).toBe(false);
      expect(decision.reason, mode).toBe('fallback-disabled');
    }
  });

  it('32. no recursive Nara -> Groq -> Nara loop is representable', () => {
    // The plan holds exactly one primary and at most one fallback, and the attempt budget bounds the
    // whole run. There is no structure in which a third provider attempt could be scheduled.
    const result = buildRoutingPlan(request(), ROSTER, ALL_HEALTHY, NO_CIRCUIT_OPEN, autoPolicy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fallback?.descriptor.providerId).toBe(NARA_PROVIDER_ID);
    expect(autoPolicy.maxTotalAttempts).toBe(2);
    // Once the fallback has run, nothing remains to spend.
    const exhausted = decideFallover(
      {
        ...base,
        attemptsRemaining: 0,
        primaryCode: 'provider-unavailable',
        primaryRetryable: true,
      },
      autoPolicy,
    );
    expect(exhausted.allow).toBe(false);
  });
});
