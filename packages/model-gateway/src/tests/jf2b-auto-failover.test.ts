/**
 * AUTO reliability: one Groq attempt, at most one Nara fallback (JF-2B, ADR-0147).
 *
 * ### What is being proved
 *
 * The V1 reliability strategy, end to end through the REAL gateway: one primary provider attempt, then
 * at most one attempt against a DIFFERENT provider. Never `Groq → Groq → Nara`, never a third attempt,
 * never a loop.
 *
 * ### The rate-limit distinction
 *
 * A quota refusal is non-retryable against the provider that issued it — retrying deepens the limit —
 * and simultaneously the clearest possible signal that a different provider should answer: the request
 * was well-formed, the credential was good, the model was entitled. Those are two different questions
 * about one code, and reading one flag for both is what made a quota refusal look terminal to the whole
 * gateway. The specs below pin both halves.
 *
 * Every provider is a deterministic fake. No credential, no socket, no sleep.
 */
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createHybridRoutingPolicy,
  createModelGateway,
  defineProviderCapabilities,
  hybridRoutingPolicyInputForProviderMode,
  type ModelProvider,
  type ProviderInvocationInput,
  type ProviderInvocationResult,
  type ProviderMode,
} from '../index.js';
import { createManualClock } from '../reliability/clock.js';
import { decideFallover } from '../routing/failover-policy.js';
import { FALLBACK_TRANSIENT_CODES } from '../routing/routing-reasons.js';

const GROQ = 'groq';
const NARA = 'nara';

interface Counting extends ModelProvider {
  readonly calls: () => number;
}

/** A provider that returns a scripted result and counts every invocation. */
function scripted(providerId: string, results: readonly ProviderInvocationResult[]): Counting {
  let index = 0;
  const capabilities = defineProviderCapabilities({
    providerId,
    modelId: `${providerId}/model-1`,
    modelVersion: '2026-09-01',
    executionClass: 'HOSTED',
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: providerId === GROQ,
    maxInputTokens: 8192,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
  });
  return Object.freeze({
    descriptor: Object.freeze({ providerId, executionClass: 'HOSTED' as const }),
    capabilities: () => capabilities,
    health: () => Promise.resolve({ available: true }),
    invoke: (_input: ProviderInvocationInput): Promise<ProviderInvocationResult> => {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return Promise.resolve(result ?? { status: 'failed', retryable: false });
    },
    calls: () => index,
  });
}

const completed = (text: string): ProviderInvocationResult => ({
  status: 'completed',
  output: { mode: 'TEXT', text },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  latencyMs: 5,
});

function gatewayFor(
  mode: ProviderMode,
  providers: readonly ModelProvider[],
  over: { readonly failureThreshold?: number; readonly cooldownMs?: number } = {},
) {
  const clock = createManualClock();
  const gateway = createModelGateway({
    mode: 'ACTIVE',
    providers,
    clock,
    budgetPolicy: createEstimatedBudgetPolicy(),
    killSwitch: { active: () => false },
    concurrency: { maxConcurrent: 4, maxQueue: 4 },
    circuit: {
      failureThreshold: over.failureThreshold ?? 1,
      cooldownMs: over.cooldownMs ?? 1_000,
    },
    allowFallback: mode === 'AUTO',
    routingProfile: createHybridRoutingPolicy(
      hybridRoutingPolicyInputForProviderMode(mode, { maxTotalAttempts: 2, localOrder: [] }),
    ),
  });
  return { gateway, clock };
}

const request = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  runId: 'run.jf2b.1',
  purpose: 'agent.reply',
  agentScope: 'COORDINATION',
  dataClass: 'HOSTED_ALLOWED',
  messages: [{ role: 'user', content: 'synthetic failover probe' }],
  requiredCapabilities: {
    structuredOutput: false,
    strictJsonSchema: false,
    cancellation: false,
    minContextTokens: 1,
  },
  resultMode: 'TEXT',
  maxResultChars: 1024,
  promptId: 'qfj.jf2b.synthetic',
  promptVersion: '1',
  promptDigest: 'a'.repeat(64),
  tokenBudget: 4096,
  costBudget: 1,
  timeoutMs: 30_000,
  retryBudget: 0,
  metadata: {},
  ...over,
});

describe('JF-2B 35-45. AUTO reliability', () => {
  it('35. a healthy Groq answers and Nara is never called', async () => {
    const groq = scripted(GROQ, [completed('from groq')]);
    const nara = scripted(NARA, [completed('from nara')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    const response = await gateway.invoke(request());
    expect(response.provenance.providerId).toBe(GROQ);
    expect(response.provenance.usedFallback).toBe(false);
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(0);
  });

  it('36. a retryable Groq failure falls over to Nara exactly once', async () => {
    const groq = scripted(GROQ, [{ status: 'unavailable', retryable: true }]);
    const nara = scripted(NARA, [completed('from nara')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    const response = await gateway.invoke(request());
    expect(response.provenance.providerId).toBe(NARA);
    expect(response.provenance.usedFallback).toBe(true);
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(1);
  });

  it('37. a Groq timeout falls over to Nara exactly once', async () => {
    const groq = scripted(GROQ, [{ status: 'timeout', latencyMs: 10 }]);
    const nara = scripted(NARA, [completed('from nara')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    const response = await gateway.invoke(request());
    expect(response.provenance.providerId).toBe(NARA);
    expect(response.provenance.usedFallback).toBe(true);
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(1);
  });

  it('38. a Groq RATE LIMIT calls Groq once and Nara once — no same-provider retry', async () => {
    const groq = scripted(GROQ, [{ status: 'rate-limited' }]);
    const nara = scripted(NARA, [completed('from nara')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    const response = await gateway.invoke(request());
    expect(response.provenance.providerId).toBe(NARA);
    expect(response.provenance.usedFallback).toBe(true);
    // Exactly one Groq attempt. Retrying the provider that just refused would deepen the limit.
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(1);
  });

  it('42. a failing Nara fallback produces no third attempt', async () => {
    const groq = scripted(GROQ, [{ status: 'unavailable', retryable: true }]);
    const nara = scripted(NARA, [{ status: 'unavailable', retryable: true }]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    await expect(gateway.invoke(request())).rejects.toThrow();
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(1);
  });

  it('43-44. no loop, and at most two provider invocations under AUTO', async () => {
    const groq = scripted(GROQ, [{ status: 'rate-limited' }]);
    const nara = scripted(NARA, [{ status: 'rate-limited' }]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    await expect(gateway.invoke(request())).rejects.toThrow();
    expect(groq.calls() + nara.calls()).toBe(2);
    // Never Nara -> Groq -> Nara.
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(1);
  });

  it('45. a same-provider retry never happens, whatever the failure', async () => {
    for (const failure of [
      { status: 'unavailable', retryable: true } as const,
      { status: 'timeout', latencyMs: 1 } as const,
      { status: 'rate-limited' } as const,
    ]) {
      const groq = scripted(GROQ, [failure]);
      const nara = scripted(NARA, [completed('ok')]);
      const { gateway } = gatewayFor('AUTO', [groq, nara]);
      await gateway.invoke(request());
      expect(groq.calls(), failure.status).toBe(1);
    }
  });
});

describe('JF-2B 39-41. the circuit breaker, reused unchanged', () => {
  it('39. an OPEN Groq circuit sends the next request straight to Nara', async () => {
    const groq = scripted(GROQ, [
      { status: 'unavailable', retryable: true },
      completed('groq back'),
    ]);
    const nara = scripted(NARA, [completed('from nara'), completed('from nara again')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara], { failureThreshold: 1 });

    // First request opens the circuit and falls over.
    await gateway.invoke(request());
    expect(groq.calls()).toBe(1);

    // Second request: the circuit is open, so Groq is not invoked at all.
    const second = await gateway.invoke(request({ runId: 'run.jf2b.2' }));
    expect(second.provenance.providerId).toBe(NARA);
    expect(groq.calls()).toBe(1);
    expect(nara.calls()).toBe(2);

    // PROVENANCE, as the existing gateway reports it and as it should be read.
    //
    // `usedFallback` is FALSE here, and that is truthful rather than a gap. An open circuit excludes
    // Groq during PLANNING, so Nara was this request's PRIMARY — there was no primary attempt on this
    // request to fall back from. Reporting `true` would imply a Groq invocation that never happened,
    // which is exactly what the attempt count must not invent.
    expect(second.provenance.usedFallback).toBe(false);
    expect(second.provenance.attempts).toBe(1);
  });

  it('40. after cooldown the half-open trial restores Groq as primary', async () => {
    const groq = scripted(GROQ, [
      { status: 'unavailable', retryable: true },
      completed('groq back'),
    ]);
    const nara = scripted(NARA, [completed('from nara')]);
    const { gateway, clock } = gatewayFor('AUTO', [groq, nara], {
      failureThreshold: 1,
      cooldownMs: 1_000,
    });

    await gateway.invoke(request());
    expect(groq.calls()).toBe(1);

    clock.advance(1_001);
    const recovered = await gateway.invoke(request({ runId: 'run.jf2b.2' }));
    expect(recovered.provenance.providerId).toBe(GROQ);
    expect(recovered.provenance.usedFallback).toBe(false);
    expect(groq.calls()).toBe(2);
    // Nara was not needed on the recovery request.
    expect(nara.calls()).toBe(1);
  });

  it('41. a failed half-open trial reopens the circuit and still falls back', async () => {
    const groq = scripted(GROQ, [
      { status: 'unavailable', retryable: true },
      { status: 'unavailable', retryable: true },
    ]);
    const nara = scripted(NARA, [completed('a'), completed('b')]);
    const { gateway, clock } = gatewayFor('AUTO', [groq, nara], {
      failureThreshold: 1,
      cooldownMs: 1_000,
    });

    await gateway.invoke(request());
    clock.advance(1_001);
    const second = await gateway.invoke(request({ runId: 'run.jf2b.2' }));
    // The trial ran and failed; the bounded Nara fallback still answered.
    expect(groq.calls()).toBe(2);
    expect(second.provenance.providerId).toBe(NARA);
    expect(second.provenance.usedFallback).toBe(true);
  });
});

describe('JF-2B 46-56. the conditions that must NOT fall over', () => {
  const noFallback: readonly {
    readonly label: string;
    readonly groqResult: ProviderInvocationResult;
  }[] = [
    { label: '46. malformed', groqResult: { status: 'malformed', latencyMs: 1 } },
    { label: '52. auth/config non-retryable', groqResult: { status: 'failed', retryable: false } },
  ];

  for (const one of noFallback) {
    it(`${one.label} does not reach Nara`, async () => {
      const groq = scripted(GROQ, [one.groqResult]);
      const nara = scripted(NARA, [completed('should not be used')]);
      const { gateway } = gatewayFor('AUTO', [groq, nara]);
      await expect(gateway.invoke(request())).rejects.toThrow();
      expect(groq.calls()).toBe(1);
      expect(nara.calls()).toBe(0);
    });
  }

  it('48. a cancelled request reaches no fallback', async () => {
    const groq = scripted(GROQ, [{ status: 'cancelled' }]);
    const nara = scripted(NARA, [completed('should not be used')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    await expect(gateway.invoke(request())).rejects.toThrow();
    expect(nara.calls()).toBe(0);
  });

  it('50. HUMAN_ONLY reaches no provider at all', async () => {
    const groq = scripted(GROQ, [completed('no')]);
    const nara = scripted(NARA, [completed('no')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    await expect(gateway.invoke(request({ dataClass: 'HUMAN_ONLY' }))).rejects.toThrow();
    expect(groq.calls()).toBe(0);
    expect(nara.calls()).toBe(0);
  });

  it('51. LOCAL_ONLY reaches no hosted provider', async () => {
    const groq = scripted(GROQ, [completed('no')]);
    const nara = scripted(NARA, [completed('no')]);
    const { gateway } = gatewayFor('AUTO', [groq, nara]);
    await expect(gateway.invoke(request({ dataClass: 'LOCAL_ONLY' }))).rejects.toThrow();
    expect(groq.calls()).toBe(0);
    expect(nara.calls()).toBe(0);
  });

  it('55. GROQ_ONLY never reaches Nara, whatever Groq does', async () => {
    for (const failure of [
      { status: 'timeout', latencyMs: 1 } as const,
      { status: 'rate-limited' } as const,
      { status: 'unavailable', retryable: true } as const,
    ]) {
      const groq = scripted(GROQ, [failure]);
      const nara = scripted(NARA, [completed('should not be used')]);
      const { gateway } = gatewayFor('GROQ_ONLY', [groq, nara]);
      await expect(gateway.invoke(request())).rejects.toThrow();
      expect(groq.calls(), failure.status).toBe(1);
      expect(nara.calls(), failure.status).toBe(0);
    }
  });

  it('56. NARA_ONLY never reaches Groq, whatever Nara does', async () => {
    for (const failure of [
      { status: 'timeout', latencyMs: 1 } as const,
      { status: 'rate-limited' } as const,
    ]) {
      const groq = scripted(GROQ, [completed('should not be used')]);
      const nara = scripted(NARA, [failure]);
      const { gateway } = gatewayFor('NARA_ONLY', [groq, nara]);
      await expect(gateway.invoke(request())).rejects.toThrow();
      expect(nara.calls(), failure.status).toBe(1);
      expect(groq.calls(), failure.status).toBe(0);
    }
  });
});

describe('JF-2B: the rate-limit taxonomy, at the policy level', () => {
  const autoPolicy = createHybridRoutingPolicy(
    hybridRoutingPolicyInputForProviderMode('AUTO', { maxTotalAttempts: 2, localOrder: [] }),
  );
  const base = {
    cancelled: false,
    hasEligibleFallback: true,
    fallbackExecutionClass: 'HOSTED' as const,
    dataClass: 'HOSTED_ALLOWED' as const,
    primaryInvoked: true,
    attemptsRemaining: 1,
  };

  it('rate-limited is cross-provider eligible even though it is not retryable', () => {
    expect([...FALLBACK_TRANSIENT_CODES]).toContain('rate-limited');
    const decision = decideFallover(
      // The flag the gateway actually sets for a quota refusal: NOT retryable.
      { ...base, primaryCode: 'rate-limited', primaryRetryable: false },
      autoPolicy,
    );
    expect(decision.allow).toBe(true);
    expect(decision.reason).toBe('fallback-eligible-transient');
  });

  it('a policy that drops the code stops the behaviour', () => {
    const narrow = createHybridRoutingPolicy({
      profile: 'HOSTED_FIRST',
      hostedOrder: [GROQ, NARA],
      localOrder: [],
      fallbackEnabled: true,
      maxTotalAttempts: 2,
      transientFailureCodes: ['provider-unavailable', 'timeout'],
    });
    const decision = decideFallover(
      { ...base, primaryCode: 'rate-limited', primaryRetryable: false },
      narrow,
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('primary-non-retryable');
  });

  it('a rate limit still refuses to fall over when the budget is spent or fallback is off', () => {
    expect(
      decideFallover(
        { ...base, attemptsRemaining: 0, primaryCode: 'rate-limited', primaryRetryable: false },
        autoPolicy,
      ).reason,
    ).toBe('budget-exhausted');
    const groqOnly = createHybridRoutingPolicy(
      hybridRoutingPolicyInputForProviderMode('GROQ_ONLY', { maxTotalAttempts: 2, localOrder: [] }),
    );
    expect(
      decideFallover({ ...base, primaryCode: 'rate-limited', primaryRetryable: false }, groqOnly)
        .reason,
    ).toBe('fallback-disabled');
  });

  it('a rate limit that never reached the provider is not a cross-provider signal', () => {
    // `primaryInvoked: false` means the request never got there — there is nothing to conclude about
    // a second provider from a limit the first one never actually reported.
    const decision = decideFallover(
      { ...base, primaryInvoked: false, primaryCode: 'rate-limited', primaryRetryable: false },
      autoPolicy,
    );
    expect(decision.allow).toBe(false);
  });
});
