/**
 * QFJ-P04.01D — hybrid routing and failover (ADR-0048).
 *
 * Pure-unit coverage of the policy, plan, failover decision, and attempt ledger, plus end-to-end gateway
 * integration with deterministic FakeModelProviders — NO live Groq/local call, NO real key/token, NO
 * network. Proves: the two closed profiles; execution-class-first deterministic routing; privacy
 * (LOCAL_ONLY never hosted, HUMAN_ONLY no provider); readiness/health/circuit/capability filtering; the
 * bounded failover matrix; the single shared attempt ledger (at most one fallback, at most one accepted
 * response, no reset); and safe, content-free routing observability.
 */
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createHybridRoutingPolicy,
  createManualClock,
  createModelGateway,
  defineProviderCapabilities,
  ModelGatewayError,
  validateModelRequest,
  type GatewayEvent,
  type GatewayKillSwitch,
  type HybridRoutingPolicy,
  type ModelGatewayConfig,
  type ModelProvider,
  type ProviderCapabilities,
  type RequiredCapabilities,
} from '../index.js';
import {
  FakeModelProvider,
  completedStructured,
  completedText,
  providerFailed,
  providerMalformed,
  providerUnavailable,
} from '../testing/index.js';
import { buildRoutingPlan } from '../routing/routing-plan.js';
import { decideFallover } from '../routing/failover-policy.js';
import { AttemptLedger } from '../routing/attempt-ledger.js';

const OFF_KILL: GatewayKillSwitch = { active: (): boolean => false };

function caps(
  overrides: Partial<ProviderCapabilities> & { providerId: string },
): ProviderCapabilities {
  return defineProviderCapabilities({
    modelId: 'fake-model',
    modelVersion: '1',
    executionClass: 'HOSTED',
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: true,
    maxInputTokens: 100000,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
    ...overrides,
  });
}

const NO_REQUIRED: RequiredCapabilities = {
  structuredOutput: false,
  strictJsonSchema: false,
  cancellation: false,
  minContextTokens: 0,
};

function req(overrides: Record<string, unknown> = {}) {
  const validation = validateModelRequest({
    runId: 'run-1',
    purpose: 'qualify',
    agentScope: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    messages: [{ role: 'user', content: 'hello' }],
    requiredCapabilities: NO_REQUIRED,
    resultMode: 'TEXT',
    maxResultChars: 1000,
    promptId: 'p.qualify',
    promptVersion: '1',
    tokenBudget: 1000,
    costBudget: 1,
    timeoutMs: 5000,
    retryBudget: 0,
    metadata: {},
    ...overrides,
  });
  if (!validation.ok) {
    throw new Error('invalid test request');
  }
  return validation.request;
}

const alwaysHealthy = (ids: string[]): Map<string, boolean> => new Map(ids.map((id) => [id, true]));
const noCircuit = (): boolean => false;

// ===================================================================================================
// Policy validation.
// ===================================================================================================
describe('createHybridRoutingPolicy — validation', () => {
  const base = {
    hostedOrder: ['groq'],
    localOrder: ['local'],
    fallbackEnabled: true,
    maxTotalAttempts: 3,
  };

  it('builds a valid HOSTED_FIRST policy and freezes it', () => {
    const p = createHybridRoutingPolicy({ profile: 'HOSTED_FIRST', ...base });
    expect(p.profile).toBe('HOSTED_FIRST');
    expect(p.executionClassOrder).toEqual(['HOSTED', 'LOCAL']);
    expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(p.hostedOrder)).toBe(true);
  });

  it('builds a valid LOCAL_FIRST policy', () => {
    const p = createHybridRoutingPolicy({ profile: 'LOCAL_FIRST', ...base });
    expect(p.executionClassOrder).toEqual(['LOCAL', 'HOSTED']);
  });

  it('rejects an unknown profile', () => {
    expect(() => createHybridRoutingPolicy({ profile: 'CHEAPEST' as never, ...base })).toThrow();
  });

  it('rejects a provider id listed twice within a class', () => {
    expect(() =>
      createHybridRoutingPolicy({
        profile: 'HOSTED_FIRST',
        ...base,
        hostedOrder: ['groq', 'groq'],
      }),
    ).toThrow();
  });

  it('rejects a provider id shared across execution classes', () => {
    expect(() =>
      createHybridRoutingPolicy({
        profile: 'HOSTED_FIRST',
        ...base,
        hostedOrder: ['dup'],
        localOrder: ['dup'],
      }),
    ).toThrow();
  });

  it('rejects a malformed provider id', () => {
    expect(() =>
      createHybridRoutingPolicy({ profile: 'HOSTED_FIRST', ...base, hostedOrder: ['bad id!'] }),
    ).toThrow();
  });

  it('rejects an empty primary-class list for the profile', () => {
    expect(() =>
      createHybridRoutingPolicy({
        profile: 'HOSTED_FIRST',
        hostedOrder: [],
        localOrder: ['local'],
        fallbackEnabled: true,
        maxTotalAttempts: 2,
      }),
    ).toThrow();
    expect(() =>
      createHybridRoutingPolicy({
        profile: 'LOCAL_FIRST',
        hostedOrder: ['groq'],
        localOrder: [],
        fallbackEnabled: true,
        maxTotalAttempts: 2,
      }),
    ).toThrow();
  });

  it('rejects an out-of-range or non-integer attempt bound', () => {
    for (const maxTotalAttempts of [0, -1, 13, 2.5]) {
      expect(() =>
        createHybridRoutingPolicy({ profile: 'HOSTED_FIRST', ...base, maxTotalAttempts }),
      ).toThrow();
    }
  });

  it('rejects an unknown transient failure code', () => {
    expect(() =>
      createHybridRoutingPolicy({
        profile: 'HOSTED_FIRST',
        ...base,
        transientFailureCodes: ['provider-failed'],
      }),
    ).toThrow();
  });

  it('carries no secret/message/prompt field and no hard-coded model', () => {
    const p = createHybridRoutingPolicy({ profile: 'HOSTED_FIRST', ...base });
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/token|secret|key|prompt|message|model/i);
    expect(json).not.toMatch(/kimi/i);
  });
});

// ===================================================================================================
// Routing plan — the privacy / eligibility matrix.
// ===================================================================================================
describe('buildRoutingPlan — routing matrix', () => {
  const policy = (overrides: Partial<Parameters<typeof createHybridRoutingPolicy>[0]> = {}) =>
    createHybridRoutingPolicy({
      profile: 'HOSTED_FIRST',
      hostedOrder: ['groq'],
      localOrder: ['local'],
      fallbackEnabled: true,
      maxTotalAttempts: 3,
      ...overrides,
    });

  const hosted = (id = 'groq', over: Partial<ProviderCapabilities> = {}): ModelProvider =>
    new FakeModelProvider({
      capabilities: caps({ providerId: id, executionClass: 'HOSTED', ...over }),
    });
  const local = (id = 'local', over: Partial<ProviderCapabilities> = {}): ModelProvider =>
    new FakeModelProvider({
      capabilities: caps({ providerId: id, executionClass: 'LOCAL', ...over }),
    });

  it('LOCAL_ONLY with a healthy local selects local', () => {
    const result = buildRoutingPlan(
      req({ dataClass: 'LOCAL_ONLY' }),
      [hosted(), local()],
      alwaysHealthy(['groq', 'local']),
      noCircuit,
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('local');
      expect(result.plan.fallback).toBeUndefined(); // no second LOCAL provider
      expect(result.plan.summary.eligibleExecutionClasses).toEqual(['LOCAL']);
    }
  });

  it('LOCAL_ONLY with no local provider fails local-provider-required', () => {
    const result = buildRoutingPlan(
      req({ dataClass: 'LOCAL_ONLY' }),
      [hosted()],
      alwaysHealthy(['groq']),
      noCircuit,
      policy(),
    );
    expect(result).toMatchObject({ ok: false, code: 'local-provider-required' });
  });

  it('LOCAL_ONLY never includes a hosted provider even as fallback', () => {
    const result = buildRoutingPlan(
      req({ dataClass: 'LOCAL_ONLY' }),
      [local('local'), hosted('groq')],
      alwaysHealthy(['groq', 'local']),
      noCircuit,
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('local');
      expect(result.plan.fallback).toBeUndefined();
      // groq is excluded by data class.
      expect(result.plan.summary.exclusions).toContainEqual({
        providerId: 'groq',
        executionClass: 'HOSTED',
        reason: 'data-class-mismatch',
      });
    }
  });

  it('HOSTED_ALLOWED + HOSTED_FIRST selects hosted, local fallback', () => {
    const result = buildRoutingPlan(
      req(),
      [local('local'), hosted('groq')],
      alwaysHealthy(['groq', 'local']),
      noCircuit,
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('groq');
      expect(result.plan.fallback?.descriptor.providerId).toBe('local');
      expect(result.plan.primaryExecutionClass).toBe('HOSTED');
      expect(result.plan.fallbackExecutionClass).toBe('LOCAL');
    }
  });

  it('HOSTED_ALLOWED + LOCAL_FIRST selects local, hosted fallback', () => {
    const result = buildRoutingPlan(
      req(),
      [hosted('groq'), local('local')],
      alwaysHealthy(['groq', 'local']),
      noCircuit,
      policy({ profile: 'LOCAL_FIRST' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('local');
      expect(result.plan.fallback?.descriptor.providerId).toBe('groq');
    }
  });

  it('excludes an unhealthy provider', () => {
    const result = buildRoutingPlan(
      req(),
      [hosted('groq'), local('local')],
      new Map([
        ['groq', false],
        ['local', true],
      ]),
      noCircuit,
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('local');
      expect(result.plan.summary.exclusions).toContainEqual({
        providerId: 'groq',
        executionClass: 'HOSTED',
        reason: 'unhealthy',
      });
    }
  });

  it('excludes a circuit-open provider', () => {
    const result = buildRoutingPlan(
      req(),
      [hosted('groq'), local('local')],
      alwaysHealthy(['groq', 'local']),
      (id) => id === 'groq',
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('local');
      expect(result.plan.summary.exclusions).toContainEqual({
        providerId: 'groq',
        executionClass: 'HOSTED',
        reason: 'circuit-open',
      });
    }
  });

  it('excludes a capability-mismatched provider', () => {
    const result = buildRoutingPlan(
      req({ requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true } }),
      [hosted('groq', { supportsStructuredOutput: false }), local('local')],
      alwaysHealthy(['groq', 'local']),
      noCircuit,
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('local');
      expect(result.plan.summary.exclusions).toContainEqual({
        providerId: 'groq',
        executionClass: 'HOSTED',
        reason: 'capability-mismatch',
      });
    }
  });

  it('excludes a provider not listed in the policy', () => {
    const result = buildRoutingPlan(
      req(),
      [hosted('groq'), hosted('other-hosted')],
      alwaysHealthy(['groq', 'other-hosted']),
      noCircuit,
      policy(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.primary.descriptor.providerId).toBe('groq');
      expect(result.plan.summary.exclusions).toContainEqual({
        providerId: 'other-hosted',
        executionClass: 'HOSTED',
        reason: 'not-in-policy',
      });
    }
  });

  it('is deterministic within a class (configured order), producing the same plan', () => {
    const policyTwoHosted = createHybridRoutingPolicy({
      profile: 'HOSTED_FIRST',
      hostedOrder: ['groq-a', 'groq-b'],
      localOrder: ['local'],
      fallbackEnabled: true,
      maxTotalAttempts: 3,
    });
    const roster = [hosted('groq-b'), hosted('groq-a'), local('local')];
    for (let i = 0; i < 3; i += 1) {
      const result = buildRoutingPlan(
        req(),
        roster,
        alwaysHealthy(['groq-a', 'groq-b', 'local']),
        noCircuit,
        policyTwoHosted,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.primary.descriptor.providerId).toBe('groq-a');
        expect(result.plan.fallback?.descriptor.providerId).toBe('groq-b');
      }
    }
  });

  it('does not include a fallback when the policy disables it', () => {
    const result = buildRoutingPlan(
      req(),
      [hosted('groq'), local('local')],
      alwaysHealthy(['groq', 'local']),
      noCircuit,
      policy({ fallbackEnabled: false }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.fallback).toBeUndefined();
    }
  });
});

// ===================================================================================================
// Failover decision — the failover matrix.
// ===================================================================================================
describe('decideFallover — failover matrix', () => {
  const policy = createHybridRoutingPolicy({
    profile: 'HOSTED_FIRST',
    hostedOrder: ['groq'],
    localOrder: ['local'],
    fallbackEnabled: true,
    maxTotalAttempts: 3,
  });
  const base = {
    cancelled: false,
    hasEligibleFallback: true,
    fallbackExecutionClass: 'LOCAL' as const,
    dataClass: 'HOSTED_ALLOWED' as const,
    primaryInvoked: true,
    attemptsRemaining: 2,
  };

  it('allows fallback on a retryable provider-unavailable', () => {
    expect(
      decideFallover(
        { ...base, primaryCode: 'provider-unavailable', primaryRetryable: true },
        policy,
      ),
    ).toEqual({ allow: true, reason: 'fallback-eligible-transient' });
  });

  it('allows fallback on a retryable timeout', () => {
    expect(
      decideFallover({ ...base, primaryCode: 'timeout', primaryRetryable: true }, policy),
    ).toEqual({ allow: true, reason: 'fallback-eligible-transient' });
  });

  it('allows fallback for a circuit-open (pre-invocation) primary', () => {
    expect(
      decideFallover(
        { ...base, primaryInvoked: false, primaryCode: 'circuit-open', primaryRetryable: false },
        policy,
      ),
    ).toEqual({ allow: true, reason: 'primary-circuit-open' });
  });

  it('denies fallback on cancellation', () => {
    expect(
      decideFallover(
        { ...base, cancelled: true, primaryCode: 'provider-unavailable', primaryRetryable: true },
        policy,
      ),
    ).toEqual({ allow: false, reason: 'cancelled' });
  });

  it('denies fallback on a non-retryable provider failure', () => {
    expect(
      decideFallover({ ...base, primaryCode: 'provider-failed', primaryRetryable: false }, policy),
    ).toEqual({ allow: false, reason: 'primary-non-retryable' });
  });

  it('denies fallback on malformed output', () => {
    expect(
      decideFallover(
        { ...base, primaryCode: 'malformed-provider-output', primaryRetryable: false },
        policy,
      ),
    ).toEqual({ allow: false, reason: 'primary-malformed' });
  });

  it('denies fallback on structured-output-invalid', () => {
    expect(
      decideFallover(
        { ...base, primaryCode: 'structured-output-invalid', primaryRetryable: false },
        policy,
      ),
    ).toEqual({ allow: false, reason: 'primary-structured-invalid' });
  });

  it('denies fallback when disabled by policy', () => {
    const noFallback = createHybridRoutingPolicy({
      profile: 'HOSTED_FIRST',
      hostedOrder: ['groq'],
      localOrder: ['local'],
      fallbackEnabled: false,
      maxTotalAttempts: 3,
    });
    expect(
      decideFallover(
        { ...base, primaryCode: 'provider-unavailable', primaryRetryable: true },
        noFallback,
      ),
    ).toEqual({ allow: false, reason: 'fallback-disabled' });
  });

  it('denies fallback with no eligible fallback', () => {
    expect(
      decideFallover(
        {
          ...base,
          hasEligibleFallback: false,
          primaryCode: 'provider-unavailable',
          primaryRetryable: true,
        },
        policy,
      ),
    ).toEqual({ allow: false, reason: 'no-eligible-fallback' });
  });

  it('denies fallback when the attempt budget is exhausted', () => {
    expect(
      decideFallover(
        {
          ...base,
          attemptsRemaining: 0,
          primaryCode: 'provider-unavailable',
          primaryRetryable: true,
        },
        policy,
      ),
    ).toEqual({ allow: false, reason: 'budget-exhausted' });
  });

  it('denies a hosted fallback for a LOCAL_ONLY request (defense in depth)', () => {
    expect(
      decideFallover(
        {
          ...base,
          dataClass: 'LOCAL_ONLY',
          fallbackExecutionClass: 'HOSTED',
          primaryCode: 'provider-unavailable',
          primaryRetryable: true,
        },
        policy,
      ),
    ).toEqual({ allow: false, reason: 'data-class-forbids-fallback' });
  });
});

// ===================================================================================================
// Attempt ledger — bounds.
// ===================================================================================================
describe('AttemptLedger — bounds', () => {
  it('bounds total attempts and reports remaining', () => {
    const ledger = new AttemptLedger(2);
    expect(ledger.remaining()).toBe(2);
    ledger.record('a', false);
    expect(ledger.remaining()).toBe(1);
    ledger.record('a', false);
    expect(ledger.canAttempt()).toBe(false);
    expect(() => {
      ledger.record('a', false);
    }).toThrow();
  });

  it('permits at most one fallback provider', () => {
    const ledger = new AttemptLedger(4);
    ledger.record('primary', false);
    ledger.record('fallback-1', true);
    expect(() => {
      ledger.record('fallback-2', true);
    }).toThrow();
  });

  it('permits no attempt after acceptance', () => {
    const ledger = new AttemptLedger(3);
    ledger.record('a', false);
    ledger.markAccepted();
    expect(ledger.canAttempt()).toBe(false);
    expect(() => {
      ledger.record('a', false);
    }).toThrow();
  });

  it('does not reset the budget when a fallback provider is used', () => {
    const ledger = new AttemptLedger(2);
    ledger.record('primary', false);
    ledger.record('fallback', true);
    expect(ledger.remaining()).toBe(0);
    expect(ledger.fallbackUsed).toBe(true);
  });

  it('produces a frozen, content-free snapshot', () => {
    const ledger = new AttemptLedger(3);
    ledger.record('primary', false);
    ledger.record('fallback', true);
    const snap = ledger.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toMatchObject({ totalAttempts: 2, providersUsed: 2, fallbackUsed: true });
    expect(JSON.stringify(snap)).not.toMatch(/token|secret|prompt|message/i);
  });
});

// ===================================================================================================
// End-to-end gateway integration with a hybrid policy.
// ===================================================================================================
describe('gateway — hybrid routing integration', () => {
  const hostedProvider = (
    id = 'groq',
    cfg: Partial<ConstructorParameters<typeof FakeModelProvider>[0]> = {},
  ): FakeModelProvider =>
    new FakeModelProvider({
      capabilities: caps({ providerId: id, executionClass: 'HOSTED' }),
      ...cfg,
    });
  const localProvider = (
    id = 'local',
    cfg: Partial<ConstructorParameters<typeof FakeModelProvider>[0]> = {},
  ): FakeModelProvider =>
    new FakeModelProvider({
      capabilities: caps({ providerId: id, executionClass: 'LOCAL' }),
      ...cfg,
    });

  const hybridPolicy = (
    overrides: Partial<Parameters<typeof createHybridRoutingPolicy>[0]> = {},
  ): HybridRoutingPolicy =>
    createHybridRoutingPolicy({
      profile: 'HOSTED_FIRST',
      hostedOrder: ['groq'],
      localOrder: ['local'],
      fallbackEnabled: true,
      maxTotalAttempts: 3,
      ...overrides,
    });

  function gateway(
    providers: readonly ModelProvider[],
    routingProfile: HybridRoutingPolicy,
    overrides: Partial<ModelGatewayConfig> = {},
  ): ReturnType<typeof createModelGateway> {
    return createModelGateway({
      mode: 'ACTIVE',
      providers,
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: OFF_KILL,
      concurrency: { maxConcurrent: 4, maxQueue: 4 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      routingProfile,
      ...overrides,
    });
  }

  async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
    let raised: unknown;
    try {
      await promise;
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ModelGatewayError);
    expect((raised as ModelGatewayError).code).toBe(code);
  }

  it('HOSTED_FIRST selects Groq for a HOSTED_ALLOWED request', async () => {
    const groq = hostedProvider('groq', { responses: [completedText('groq-ok')] });
    const local = localProvider('local', { responses: [completedText('local')] });
    const response = await gateway([groq, local], hybridPolicy()).invoke(reqInput());
    expect(response.textResult).toBe('groq-ok');
    expect(response.provenance.providerId).toBe('groq');
    expect(local.invocations).toBe(0);
  });

  it('LOCAL_FIRST selects local for a HOSTED_ALLOWED request', async () => {
    const groq = hostedProvider('groq', { responses: [completedText('groq')] });
    const local = localProvider('local', { responses: [completedText('local-ok')] });
    const response = await gateway([groq, local], hybridPolicy({ profile: 'LOCAL_FIRST' })).invoke(
      reqInput(),
    );
    expect(response.textResult).toBe('local-ok');
    expect(groq.invocations).toBe(0);
  });

  it('LOCAL_ONLY routes to local and never to Groq', async () => {
    const groq = hostedProvider('groq', { responses: [completedText('groq')] });
    const local = localProvider('local', { responses: [completedText('local-ok')] });
    const response = await gateway([groq, local], hybridPolicy()).invoke(
      reqInput({ dataClass: 'LOCAL_ONLY' }),
    );
    expect(response.textResult).toBe('local-ok');
    expect(groq.invocations).toBe(0);
  });

  it('HUMAN_ONLY reaches no provider', async () => {
    const groq = hostedProvider('groq');
    const local = localProvider('local');
    await expectCode(
      gateway([groq, local], hybridPolicy()).invoke(reqInput({ dataClass: 'HUMAN_ONLY' })),
      'human-only',
    );
    expect(groq.invocations).toBe(0);
    expect(local.invocations).toBe(0);
  });

  it('falls over from a retryable hosted failure to local (one fallback, one accepted)', async () => {
    const groq = hostedProvider('groq', { responses: [providerUnavailable()] });
    const local = localProvider('local', { responses: [completedText('local-rescue')] });
    const response = await gateway([groq, local], hybridPolicy()).invoke(reqInput());
    expect(response.textResult).toBe('local-rescue');
    expect(response.provenance.usedFallback).toBe(true);
    expect(groq.invocations).toBe(1);
    expect(local.invocations).toBe(1);
  });

  it('does NOT fall over on a non-retryable hosted failure', async () => {
    const groq = hostedProvider('groq', { responses: [providerMalformed()] });
    const local = localProvider('local', { responses: [completedText('local')] });
    await expectCode(
      gateway([groq, local], hybridPolicy()).invoke(reqInput()),
      'malformed-provider-output',
    );
    expect(local.invocations).toBe(0);
  });

  it('LOCAL_ONLY never falls over to Groq even on a retryable local failure', async () => {
    const local = localProvider('local', { responses: [providerUnavailable()] });
    const groq = hostedProvider('groq', { responses: [completedText('groq')] });
    await expectCode(
      gateway([local, groq], hybridPolicy()).invoke(reqInput({ dataClass: 'LOCAL_ONLY' })),
      'provider-unavailable',
    );
    expect(groq.invocations).toBe(0);
  });

  it('the kill switch and OFF prevent both providers', async () => {
    const groq = hostedProvider('groq', { responses: [completedText('groq')] });
    const local = localProvider('local', { responses: [completedText('local')] });
    await expectCode(
      gateway([groq, local], hybridPolicy(), { mode: 'OFF' }).invoke(reqInput()),
      'gateway-off',
    );
    await expectCode(
      gateway([groq, local], hybridPolicy(), { killSwitch: { active: () => true } }).invoke(
        reqInput(),
      ),
      'kill-switch-active',
    );
    expect(groq.invocations).toBe(0);
    expect(local.invocations).toBe(0);
  });

  it('bounds total attempts across primary retries and the single fallback', async () => {
    // Primary retryable twice (retryBudget 1 → 2 tries) then one fallback = 3 total; policy caps at 3.
    const groq = hostedProvider('groq', {
      responses: [providerUnavailable(), providerUnavailable()],
    });
    const local = localProvider('local', { responses: [completedText('rescue')] });
    const response = await gateway([groq, local], hybridPolicy({ maxTotalAttempts: 3 })).invoke(
      reqInput({ retryBudget: 1 }),
    );
    expect(response.textResult).toBe('rescue');
    expect(groq.invocations).toBe(2); // primary tried twice
    expect(local.invocations).toBe(1); // single fallback
    expect(response.provenance.attempts).toBe(3);
  });

  it('respects a strict maxTotalAttempts that forbids the fallback', async () => {
    // maxTotalAttempts 1: the primary consumes the only attempt; no fallback is possible.
    const groq = hostedProvider('groq', { responses: [providerUnavailable()] });
    const local = localProvider('local', { responses: [completedText('rescue')] });
    await expectCode(
      gateway([groq, local], hybridPolicy({ maxTotalAttempts: 1 })).invoke(reqInput()),
      'provider-unavailable',
    );
    expect(local.invocations).toBe(0);
  });

  it('emits safe routing observability with no content', async () => {
    const events: GatewayEvent[] = [];
    const groq = hostedProvider('groq', { responses: [providerUnavailable()] });
    const local = localProvider('local', { responses: [completedText('ok')] });
    const response = await gateway([groq, local], hybridPolicy(), {
      observability: {
        record: (e) => {
          events.push(e);
        },
      },
    }).invoke(reqInput({ messages: [{ role: 'user', content: 'SECRET-PROMPT' }] }));
    expect(response.provenance.usedFallback).toBe(true);
    const decided = events.filter((e) => e.type === 'routing-decided');
    expect(decided.length).toBeGreaterThan(0);
    expect(
      decided.some((e) => e.profile === 'HOSTED_FIRST' && e.dataClass === 'HOSTED_ALLOWED'),
    ).toBe(true);
    expect(decided.some((e) => e.fallbackReason === 'fallback-eligible-transient')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('SECRET-PROMPT');
    for (const e of events) {
      expect(e.runId).toBe('run-1');
    }
  });

  it('validates structured output through the hybrid path', async () => {
    const groq = hostedProvider('groq', { responses: [completedStructured({ answer: 'yes' })] });
    const response = await gateway([groq], hybridPolicy()).invoke(
      reqInput({
        resultMode: 'STRUCTURED',
        requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true },
        structuredSchema: undefined,
        structuredSchemaMarker: true,
      }),
    );
    expect(response.structuredResult).toEqual({ answer: 'yes' });
  });

  it('does not fall over on a timeout when the request is already cancelled', async () => {
    const groq = hostedProvider('groq', { responses: [providerFailed()], honorSignal: true });
    const local = localProvider('local', { responses: [completedText('local')] });
    const controller = new AbortController();
    controller.abort();
    await expectCode(
      gateway([groq, local], hybridPolicy()).invoke(reqInput(), { signal: controller.signal }),
      'cancelled',
    );
    expect(local.invocations).toBe(0);
  });
});

// A structured request needs a real zod schema; build it inline to avoid importing zod at top level here.
function reqInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { structuredSchemaMarker, structuredSchema, ...rest } = overrides;
  const base: Record<string, unknown> = {
    runId: 'run-1',
    purpose: 'qualify',
    agentScope: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    messages: [{ role: 'user', content: 'hello' }],
    requiredCapabilities: NO_REQUIRED,
    resultMode: 'TEXT',
    maxResultChars: 1000,
    promptId: 'p.qualify',
    promptVersion: '1',
    tokenBudget: 1000,
    costBudget: 1,
    timeoutMs: 5000,
    retryBudget: 0,
    metadata: {},
    ...rest,
  };
  if (structuredSchemaMarker === true) {
    base['structuredSchema'] = makeSchema();
  } else if (structuredSchema !== undefined) {
    base['structuredSchema'] = structuredSchema;
  }
  return base;
}

// Minimal zod-like schema factory kept local; the gateway only needs `safeParse`.
function makeSchema(): { safeParse: (v: unknown) => { success: boolean; data?: unknown } } {
  return {
    safeParse(v: unknown) {
      if (
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { answer?: unknown }).answer === 'string'
      ) {
        return { success: true, data: v };
      }
      return { success: false };
    },
  };
}
