/**
 * QFJ-P04.01A — the governed gateway behaviour (ADR-0045), against the deterministic FakeModelProvider.
 *
 * Covers: default OFF; HUMAN_ONLY; data-class privacy (LOCAL_ONLY never hosted); deterministic routing;
 * capability mismatch; unavailability; single fallback; single accepted response; structured-output
 * validation; timeout/cancel/retry/circuit/kill-switch; token/cost/concurrency/queue budgets; safe
 * redaction; provenance; and the authority boundary (no authorize/execute).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createManualClock,
  createModelGateway,
  defineProviderCapabilities,
  ModelGatewayError,
  type GatewayBudgetPolicy,
  type GatewayEvent,
  type GatewayKillSwitch,
  type ModelGatewayConfig,
  type ProviderCapabilities,
  type RequiredCapabilities,
} from '../index.js';
import {
  FakeModelProvider,
  completedStructured,
  completedText,
  providerFailed,
  timedOut,
} from '../testing/index.js';

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

const OFF_KILL: GatewayKillSwitch = { active: (): boolean => false };
const ACTIVE_KILL: GatewayKillSwitch = { active: (): boolean => true };

function baseConfig(
  overrides: Partial<ModelGatewayConfig> & { providers: ModelGatewayConfig['providers'] },
): ModelGatewayConfig {
  return {
    mode: 'ACTIVE',
    clock: createManualClock(),
    budgetPolicy: createEstimatedBudgetPolicy(),
    killSwitch: OFF_KILL,
    concurrency: { maxConcurrent: 4, maxQueue: 4 },
    circuit: { failureThreshold: 3, cooldownMs: 1000 },
    allowFallback: false,
    ...overrides,
  };
}

function textRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
  };
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

describe('gateway — mode and authority gates', () => {
  it('default OFF refuses before any provider invocation', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'hosted-1' }) });
    const gateway = createModelGateway(baseConfig({ mode: 'OFF', providers: [provider] }));
    await expectCode(gateway.invoke(textRequest()), 'gateway-off');
    expect(provider.invocations).toBe(0);
  });

  it('SHADOW/CANARY/FALLBACK fail closed as not-enabled (only OFF and ACTIVE execute)', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'hosted-1' }) });
    for (const mode of ['SHADOW', 'CANARY', 'FALLBACK'] as const) {
      const gateway = createModelGateway(baseConfig({ mode, providers: [provider] }));
      await expectCode(gateway.invoke(textRequest()), 'gateway-off');
    }
    expect(provider.invocations).toBe(0);
  });

  it('the kill switch refuses immediately, before any provider invocation', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'hosted-1' }) });
    const gateway = createModelGateway(
      baseConfig({ killSwitch: ACTIVE_KILL, providers: [provider] }),
    );
    await expectCode(gateway.invoke(textRequest()), 'kill-switch-active');
    expect(provider.invocations).toBe(0);
  });

  it('HUMAN_ONLY never invokes a provider', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'hosted-1' }) });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(textRequest({ dataClass: 'HUMAN_ONLY' })), 'human-only');
    expect(provider.invocations).toBe(0);
  });
});

describe('gateway — data-class routing (privacy before availability)', () => {
  it('LOCAL_ONLY never selects a hosted provider (fails local-provider-required)', async () => {
    const hosted = new FakeModelProvider({
      capabilities: caps({ providerId: 'hosted-1', executionClass: 'HOSTED' }),
    });
    const gateway = createModelGateway(baseConfig({ providers: [hosted] }));
    await expectCode(
      gateway.invoke(textRequest({ dataClass: 'LOCAL_ONLY' })),
      'local-provider-required',
    );
    expect(hosted.invocations).toBe(0);
  });

  it('LOCAL_ONLY selects an eligible local provider', async () => {
    const local = new FakeModelProvider({
      capabilities: caps({ providerId: 'local-1', executionClass: 'LOCAL' }),
      responses: [completedText('local-ok')],
    });
    const gateway = createModelGateway(baseConfig({ providers: [local] }));
    const response = await gateway.invoke(textRequest({ dataClass: 'LOCAL_ONLY' }));
    expect(response.textResult).toBe('local-ok');
    expect(response.provenance.providerId).toBe('local-1');
  });

  it('HOSTED_ALLOWED can select a hosted OR a local provider', async () => {
    const hosted = new FakeModelProvider({
      capabilities: caps({ providerId: 'hosted-1', executionClass: 'HOSTED' }),
      responses: [completedText('hosted-ok')],
    });
    expect(
      (await createModelGateway(baseConfig({ providers: [hosted] })).invoke(textRequest()))
        .textResult,
    ).toBe('hosted-ok');
    const local = new FakeModelProvider({
      capabilities: caps({ providerId: 'local-1', executionClass: 'LOCAL' }),
      responses: [completedText('local-ok')],
    });
    expect(
      (await createModelGateway(baseConfig({ providers: [local] })).invoke(textRequest()))
        .textResult,
    ).toBe('local-ok');
  });
});

describe('gateway — selection: deterministic order, capability, availability', () => {
  it('selects the first provider in policy order deterministically', async () => {
    const first = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('A')],
    });
    const second = new FakeModelProvider({
      capabilities: caps({ providerId: 'b' }),
      responses: [completedText('B')],
    });
    const gateway = createModelGateway(baseConfig({ providers: [first, second] }));
    expect((await gateway.invoke(textRequest())).provenance.providerId).toBe('a');
    expect(second.invocations).toBe(0);
  });

  it('fails closed on capability mismatch', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'hosted-1', supportsStructuredOutput: false }),
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    const required: RequiredCapabilities = { ...NO_REQUIRED, structuredOutput: true };
    await expectCode(
      gateway.invoke(
        textRequest({
          requiredCapabilities: required,
          resultMode: 'STRUCTURED',
          structuredSchema: z.string(),
        }),
      ),
      'capability-mismatch',
    );
    expect(provider.invocations).toBe(0);
  });

  it('excludes an unavailable provider (no eligible provider)', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'hosted-1' }),
      available: false,
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(textRequest()), 'no-eligible-provider');
    expect(provider.invocations).toBe(0);
  });
});

describe('gateway — fallback and single-response', () => {
  it('uses at most one fallback and accepts at most one response', async () => {
    const primary = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [providerFailed()],
    });
    const fallback = new FakeModelProvider({
      capabilities: caps({ providerId: 'b' }),
      responses: [completedText('fallback-ok')],
    });
    const gateway = createModelGateway(
      baseConfig({ allowFallback: true, providers: [primary, fallback] }),
    );
    const response = await gateway.invoke(textRequest());
    expect(response.textResult).toBe('fallback-ok');
    expect(response.provenance.usedFallback).toBe(true);
    expect(primary.invocations).toBe(1);
    expect(fallback.invocations).toBe(1);
  });

  it('does not fall back when fallback is disabled', async () => {
    const primary = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [providerFailed()],
    });
    const fallback = new FakeModelProvider({
      capabilities: caps({ providerId: 'b' }),
      responses: [completedText('x')],
    });
    const gateway = createModelGateway(
      baseConfig({ allowFallback: false, providers: [primary, fallback] }),
    );
    await expectCode(gateway.invoke(textRequest()), 'provider-failed');
    expect(fallback.invocations).toBe(0);
  });
});

describe('gateway — structured-output validation', () => {
  const schema = z.object({ answer: z.string() }).strict();
  const structuredReq = (
    structuredSchema: z.ZodType,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> =>
    textRequest({
      resultMode: 'STRUCTURED',
      requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true },
      structuredSchema,
      ...overrides,
    });

  it('accepts valid structured output', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedStructured({ answer: 'yes' })],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    const response = await gateway.invoke(structuredReq(schema));
    expect(response.structuredResult).toEqual({ answer: 'yes' });
  });

  it('fails structured output that does not satisfy the schema', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedStructured({ wrong: 1 })],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(structuredReq(schema)), 'structured-output-invalid');
  });

  it('fails when a structured request receives text output (malformed)', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('not structured')],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(structuredReq(schema)), 'malformed-provider-output');
  });

  it('bounds a text result to maxResultChars', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('abcdef')],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(
      gateway.invoke(textRequest({ maxResultChars: 3 })),
      'malformed-provider-output',
    );
  });
});

describe('gateway — reliability: timeout, cancel, retry, circuit', () => {
  it('normalizes a provider timeout', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [timedOut(10)],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(textRequest()), 'timeout');
  });

  it('treats a completed result over the timeout as a timeout', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('slow', { latencyMs: 9999 })],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(textRequest({ timeoutMs: 100 })), 'timeout');
  });

  it('normalizes cancellation via an already-aborted signal', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      honorSignal: true,
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    const controller = new AbortController();
    controller.abort();
    await expectCode(gateway.invoke(textRequest(), { signal: controller.signal }), 'cancelled');
  });

  it('enforces the retry budget (retries then exhausts)', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [providerFailed(), providerFailed()],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke(textRequest({ retryBudget: 1 })), 'retry-budget-exhausted');
    expect(provider.invocations).toBe(2);
  });

  it('opens the circuit deterministically after the failure threshold and refuses further attempts', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [providerFailed()],
    });
    const gateway = createModelGateway(
      baseConfig({ providers: [provider], circuit: { failureThreshold: 2, cooldownMs: 1000 } }),
    );
    await expectCode(gateway.invoke(textRequest({ runId: 'r1' })), 'provider-failed');
    await expectCode(gateway.invoke(textRequest({ runId: 'r2' })), 'provider-failed');
    // Circuit now open — the third request is refused without invoking the provider again.
    const before = provider.invocations;
    await expectCode(gateway.invoke(textRequest({ runId: 'r3' })), 'circuit-open');
    expect(provider.invocations).toBe(before);
  });
});

describe('gateway — budgets and concurrency', () => {
  it('enforces the token budget', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'a' }) });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    // A long message estimated well over a tiny token budget.
    await expectCode(
      gateway.invoke(
        textRequest({ tokenBudget: 1, messages: [{ role: 'user', content: 'x'.repeat(400) }] }),
      ),
      'token-budget-exceeded',
    );
    expect(provider.invocations).toBe(0);
  });

  it('enforces the cost budget via an injected policy', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'a' }) });
    const refusingCost: GatewayBudgetPolicy = {
      admit: () => ({ admitted: false, code: 'cost-budget-exceeded' }),
      settle: () => undefined,
    };
    const gateway = createModelGateway(
      baseConfig({ providers: [provider], budgetPolicy: refusingCost }),
    );
    await expectCode(gateway.invoke(textRequest()), 'cost-budget-exceeded');
    expect(provider.invocations).toBe(0);
  });

  it('enforces the concurrency limit (maxQueue 0)', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('ok')],
      gate: () => gate,
    });
    const gateway = createModelGateway(
      baseConfig({ providers: [provider], concurrency: { maxConcurrent: 1, maxQueue: 0 } }),
    );
    const first = gateway.invoke(textRequest({ runId: 'r1' }));
    await expectCode(gateway.invoke(textRequest({ runId: 'r2' })), 'concurrency-limit');
    release();
    expect((await first).textResult).toBe('ok');
  });

  it('enforces the queue limit (maxConcurrent 1, maxQueue 1)', async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('ok'), completedText('ok'), completedText('ok')],
      gate: () => gate,
    });
    const gateway = createModelGateway(
      baseConfig({ providers: [provider], concurrency: { maxConcurrent: 1, maxQueue: 1 } }),
    );
    const first = gateway.invoke(textRequest({ runId: 'r1' })); // holds the permit
    const second = gateway.invoke(textRequest({ runId: 'r2' })); // waits in the queue
    await expectCode(gateway.invoke(textRequest({ runId: 'r3' })), 'queue-full'); // refused
    release();
    await first;
    await second;
  });
});

describe('gateway — provenance, redaction, and authority boundary', () => {
  it('includes provider/model/prompt/mode/attempt provenance and no content', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a', modelId: 'm', modelVersion: '7' }),
      responses: [completedText('ok', { usage: { totalTokens: 12, cost: 0.001 } })],
    });
    const gateway = createModelGateway(baseConfig({ mode: 'ACTIVE', providers: [provider] }));
    const response = await gateway.invoke(textRequest({ promptId: 'p.x', promptVersion: '3' }));
    expect(response.provenance).toMatchObject({
      runId: 'run-1',
      purpose: 'qualify',
      providerId: 'a',
      modelId: 'm',
      modelVersion: '7',
      promptId: 'p.x',
      promptVersion: '3',
      mode: 'ACTIVE',
      usedFallback: false,
      attempts: 1,
    });
    expect(response.usage.totalTokens).toBe(12);
    // No message content or chain-of-thought anywhere in the response.
    expect(JSON.stringify(response)).not.toContain('hello');
  });

  it('a gateway error carries no request content and no cause', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [providerFailed()],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    let raised: unknown;
    try {
      await gateway.invoke(
        textRequest({ messages: [{ role: 'user', content: 'SECRET-CONTENT' }] }),
      );
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ModelGatewayError);
    expect((raised as Error).message).not.toContain('SECRET-CONTENT');
    expect((raised as { cause?: unknown }).cause).toBeUndefined();
  });

  it('observability events carry only safe codes and identifiers, never content', async () => {
    const events: GatewayEvent[] = [];
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('ok')],
    });
    const gateway = createModelGateway(
      baseConfig({ providers: [provider], observability: { record: (e) => events.push(e) } }),
    );
    await gateway.invoke(textRequest());
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain('hello');
    for (const event of events) {
      expect(typeof event.type).toBe('string');
      expect(event.runId).toBe('run-1');
    }
  });

  it('the gateway response exposes no authorize/execute capability (advisory only)', async () => {
    const provider = new FakeModelProvider({
      capabilities: caps({ providerId: 'a' }),
      responses: [completedText('ok')],
    });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    const response = await gateway.invoke(textRequest());
    // The response is data only — no method to authorize, execute, send, or mutate anything.
    expect(typeof (response as unknown as { authorize?: unknown }).authorize).toBe('undefined');
    expect(typeof (response as unknown as { execute?: unknown }).execute).toBe('undefined');
    expect(response.finishStatus).toBe('completed');
  });

  it('rejects an invalid request without invoking a provider', async () => {
    const provider = new FakeModelProvider({ capabilities: caps({ providerId: 'a' }) });
    const gateway = createModelGateway(baseConfig({ providers: [provider] }));
    await expectCode(gateway.invoke({ nonsense: true }), 'request-invalid');
    await expectCode(gateway.invoke(textRequest({ agentScope: 'HACKER' })), 'request-invalid');
    expect(provider.invocations).toBe(0);
  });
});
