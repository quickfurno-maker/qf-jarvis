/**
 * QFJ-P04.01B — the Groq Cloud adapter behaviour (ADR-0046).
 *
 * Every test runs through a DETERMINISTIC injected transport — there is NO network, NO real key, and NO
 * live Groq call anywhere. A sentinel key proves the key reaches only the transport boundary and never
 * leaks into a result, an error, a descriptor, provenance, or a serialized config. Covers: the redacting
 * key holder; config validation/freezing; the SSRF-guarded transport; request mapping (non-streaming,
 * n=1, max_completion_tokens, structured response_format); response validation; HTTP/network error
 * normalization with bounded retryability; cancellation; fail-closed health; and full gateway integration
 * (privacy routing, retry-budget respect for retryable vs non-retryable failures, structured validation).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createGroqApiKey,
  createGroqProviderConfig,
  createFetchGroqTransport,
  createManualClock,
  createModelGateway,
  GroqApiKey,
  GroqModelProvider,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  type GatewayKillSwitch,
  type GroqProviderConfig,
  type GroqProviderConfigInput,
  type GroqTransport,
  type ModelGatewayConfig,
  type ProviderInvocationInput,
  type RequiredCapabilities,
} from '../index.js';
import { ModelGatewayError } from '../errors/gateway-error.js';

// A fixed non-secret placeholder. It is NOT a real Groq key and grants nothing; it exists only to prove
// the value never escapes the transport boundary.
const SENTINEL_KEY = 'gsk_SENTINEL_test_value_do_not_use_000000';

const OFF_KILL: GatewayKillSwitch = { active: (): boolean => false };

interface RecordedCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly parsedBody: Record<string, unknown>;
}

interface TransportHarness {
  readonly transport: GroqTransport;
  readonly calls: RecordedCall[];
}

/** A deterministic transport. `respond` maps the recorded request to a bounded response. No network. */
function makeTransport(
  respond: (call: RecordedCall) => {
    status?: number;
    retryAfterSeconds?: number | null;
    bodyText: string;
  },
): TransportHarness {
  const calls: RecordedCall[] = [];
  const transport: GroqTransport = {
    async send(request, _signal) {
      const parsedBody = JSON.parse(request.body) as Record<string, unknown>;
      const call: RecordedCall = {
        url: request.url,
        headers: request.headers,
        body: request.body,
        parsedBody,
      };
      calls.push(call);
      const r = await Promise.resolve(respond(call));
      return {
        status: r.status ?? 200,
        retryAfterSeconds: r.retryAfterSeconds ?? null,
        bodyText: r.bodyText,
      };
    },
  };
  return { transport, calls };
}

/** The single recorded transport call — fails the test if the transport was never invoked. */
function firstCall(harness: TransportHarness): RecordedCall {
  const call = harness.calls[0];
  if (call === undefined) {
    throw new Error('expected exactly one transport call, but the transport was never invoked');
  }
  return call;
}

const throwingTransport: GroqTransport = {
  async send() {
    return Promise.reject(new Error('simulated network/TLS failure'));
  },
};

function chatBody(
  content: string | null,
  opts: { finish?: string | null; usage?: unknown; choices?: unknown } = {},
): string {
  const body: Record<string, unknown> = {
    id: 'chatcmpl-x',
    model: 'test-model',
    choices: opts.choices ?? [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: opts.finish === undefined ? 'stop' : opts.finish,
      },
    ],
  };
  if (opts.usage !== undefined) {
    body['usage'] = opts.usage;
  }
  return JSON.stringify(body);
}

function makeConfig(
  transport: GroqTransport,
  overrides: Partial<GroqProviderConfigInput> = {},
): GroqProviderConfig {
  return createGroqProviderConfig({
    providerId: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    modelVersion: '2025.01',
    maxInputTokens: 128_000,
    maxCompletionTokens: 1024,
    supportsStrictJsonSchema: true,
    apiKey: createGroqApiKey(SENTINEL_KEY),
    transport,
    dataControlsAttested: true,
    ...overrides,
  });
}

function makeInput(overrides: Partial<ProviderInvocationInput> = {}): ProviderInvocationInput {
  return {
    runId: 'run-1',
    messages: [{ role: 'user', content: 'hello' }],
    resultMode: 'TEXT',
    timeoutMs: 5000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------------
// The redacting API-key holder.
// ---------------------------------------------------------------------------------------------------
describe('GroqApiKey — redaction and injection', () => {
  it('rejects an empty, whitespace-only, or oversized value', () => {
    expect(() => createGroqApiKey('')).toThrow();
    expect(() => createGroqApiKey('   ')).toThrow();
    expect(() => createGroqApiKey('x'.repeat(513))).toThrow();
  });

  it('accepts a bounded value and produces a GroqApiKey instance', () => {
    const key = createGroqApiKey(SENTINEL_KEY);
    expect(key).toBeInstanceOf(GroqApiKey);
  });

  it('never reveals the value via toString / toJSON / inspect / JSON.stringify', () => {
    const key = createGroqApiKey(SENTINEL_KEY);
    expect(String(key)).toBe('[REDACTED_GROQ_API_KEY]');
    expect(key.toJSON()).toBe('[REDACTED_GROQ_API_KEY]');
    expect(JSON.stringify({ key })).not.toContain(SENTINEL_KEY);
  });

  it('exposes the value ONLY through the Authorization builder', () => {
    const key = createGroqApiKey(SENTINEL_KEY);
    expect(key.authorizationHeaderValue()).toBe(`Bearer ${SENTINEL_KEY}`);
  });
});

// ---------------------------------------------------------------------------------------------------
// Config validation and freezing.
// ---------------------------------------------------------------------------------------------------
describe('createGroqProviderConfig — validation and immutability', () => {
  it('builds HOSTED capabilities with structured output and non-streaming only', () => {
    const config = makeConfig(makeTransport(() => ({ bodyText: chatBody('ok') })).transport);
    expect(config.capabilities.executionClass).toBe('HOSTED');
    expect(config.capabilities.supportsStructuredOutput).toBe(true);
    expect(config.capabilities.supportsNonStreaming).toBe(true);
    expect(config.capabilities.supportsStreaming).toBe(false);
    expect(config.capabilities.supportsStrictJsonSchema).toBe(true);
  });

  it('reflects an injected supportsStrictJsonSchema=false', () => {
    const config = makeConfig(makeTransport(() => ({ bodyText: chatBody('ok') })).transport, {
      supportsStrictJsonSchema: false,
    });
    expect(config.capabilities.supportsStrictJsonSchema).toBe(false);
  });

  it('rejects an apiKey that is not a GroqApiKey', () => {
    expect(() =>
      createGroqProviderConfig({
        providerId: 'groq',
        modelId: 'm',
        modelVersion: '1',
        maxInputTokens: 1000,
        maxCompletionTokens: 100,
        supportsStrictJsonSchema: false,
        apiKey: SENTINEL_KEY as unknown as GroqApiKey,
        transport: makeTransport(() => ({ bodyText: '{}' })).transport,
        dataControlsAttested: true,
      }),
    ).toThrow();
  });

  it('rejects a missing/invalid transport', () => {
    expect(() =>
      createGroqProviderConfig({
        providerId: 'groq',
        modelId: 'm',
        modelVersion: '1',
        maxInputTokens: 1000,
        maxCompletionTokens: 100,
        supportsStrictJsonSchema: false,
        apiKey: createGroqApiKey(SENTINEL_KEY),
        transport: undefined as unknown as GroqTransport,
        dataControlsAttested: true,
      }),
    ).toThrow();
  });

  it('rejects an invalid identifier or out-of-range token bound', () => {
    const base = {
      providerId: 'groq',
      modelVersion: '1',
      maxInputTokens: 1000,
      maxCompletionTokens: 100,
      supportsStrictJsonSchema: false,
      apiKey: createGroqApiKey(SENTINEL_KEY),
      transport: makeTransport(() => ({ bodyText: '{}' })).transport,
      dataControlsAttested: true,
    };
    expect(() => createGroqProviderConfig({ ...base, modelId: 'bad model!' })).toThrow();
    expect(() =>
      createGroqProviderConfig({ ...base, modelId: 'm', maxCompletionTokens: 0 }),
    ).toThrow();
  });

  it('never echoes the key in a validation error', () => {
    let raised: unknown;
    try {
      createGroqProviderConfig({
        providerId: 'groq',
        modelId: 'bad model!',
        modelVersion: '1',
        maxInputTokens: 1000,
        maxCompletionTokens: 100,
        supportsStrictJsonSchema: false,
        apiKey: createGroqApiKey(SENTINEL_KEY),
        transport: makeTransport(() => ({ bodyText: '{}' })).transport,
        dataControlsAttested: true,
      });
    } catch (error) {
      raised = error;
    }
    expect((raised as Error).message).not.toContain(SENTINEL_KEY);
  });

  it('freezes the config and redacts the key when serialized', () => {
    const config = makeConfig(makeTransport(() => ({ bodyText: chatBody('ok') })).transport);
    expect(Object.isFrozen(config)).toBe(true);
    expect(JSON.stringify(config)).not.toContain(SENTINEL_KEY);
  });
});

// ---------------------------------------------------------------------------------------------------
// The SSRF-guarded production transport (no network reached — the guard rejects first).
// ---------------------------------------------------------------------------------------------------
describe('createFetchGroqTransport — SSRF guard', () => {
  it('refuses any URL other than the official endpoint before touching the network', async () => {
    const transport = createFetchGroqTransport();
    await expect(
      transport.send(
        { url: 'https://evil.example/openai/v1/chat/completions', headers: {}, body: '{}' },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });

  it('exposes the fixed official endpoint constant', () => {
    expect(GROQ_CHAT_COMPLETIONS_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

// ---------------------------------------------------------------------------------------------------
// Provider invoke — request mapping.
// ---------------------------------------------------------------------------------------------------
describe('GroqModelProvider.invoke — request mapping', () => {
  it('sends a minimal non-streaming, single-choice body to the fixed endpoint', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('answer') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await provider.invoke(makeInput({ messages: [{ role: 'user', content: 'ping' }] }));
    expect(harness.calls).toHaveLength(1);
    const call = firstCall(harness);
    expect(call.url).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);
    expect(call.parsedBody).toMatchObject({
      model: 'llama-3.3-70b-versatile',
      stream: false,
      n: 1,
      max_completion_tokens: 1024,
      messages: [{ role: 'user', content: 'ping' }],
    });
    // Never the deprecated field, never streaming, never tools/functions/reasoning.
    expect(call.parsedBody).not.toHaveProperty('max_tokens');
    expect(call.parsedBody).not.toHaveProperty('tools');
    expect(call.parsedBody).not.toHaveProperty('functions');
    expect(call.parsedBody).not.toHaveProperty('reasoning');
    expect(call.parsedBody['stream']).toBe(false);
  });

  it('carries the Authorization and content-type headers to the transport boundary only', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('ok') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await provider.invoke(makeInput());
    const call = firstCall(harness);
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.headers['authorization']).toBe(`Bearer ${SENTINEL_KEY}`);
  });

  it('omits response_format for a TEXT request', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('ok') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await provider.invoke(makeInput());
    expect(firstCall(harness).parsedBody).not.toHaveProperty('response_format');
  });

  it('maps a strict-compatible STRUCTURED request to strict json_schema', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('{"answer":"yes"}') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await provider.invoke(
      makeInput({
        resultMode: 'STRUCTURED',
        structuredJsonSchema: { type: 'object', additionalProperties: false },
      }),
    );
    expect(firstCall(harness).parsedBody['response_format']).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'qf_structured_output', strict: true },
    });
  });

  it('fails a strict request with a non-strict-compatible schema BEFORE any transport call', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('{}') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(
      makeInput({ resultMode: 'STRUCTURED', structuredJsonSchema: { type: 'string' } }),
    );
    expect(result).toEqual({ status: 'failed', retryable: false });
    expect(harness.calls).toHaveLength(0);
  });

  it('uses best-effort json_object when strict json schema is not supported', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('{"answer":"y"}') }));
    const provider = new GroqModelProvider(
      makeConfig(harness.transport, { supportsStrictJsonSchema: false }),
      createManualClock(),
    );
    await provider.invoke(
      makeInput({ resultMode: 'STRUCTURED', structuredJsonSchema: { type: 'string' } }),
    );
    expect(firstCall(harness).parsedBody['response_format']).toEqual({ type: 'json_object' });
  });
});

// ---------------------------------------------------------------------------------------------------
// Provider invoke — successful responses.
// ---------------------------------------------------------------------------------------------------
describe('GroqModelProvider.invoke — completed responses', () => {
  it('returns completed TEXT with content and injected-clock latency', async () => {
    const clock = createManualClock();
    const harness = makeTransport(() => {
      clock.advance(25);
      return { bodyText: chatBody('the answer') };
    });
    const provider = new GroqModelProvider(makeConfig(harness.transport), clock);
    const result = await provider.invoke(makeInput());
    expect(result).toMatchObject({
      status: 'completed',
      output: { mode: 'TEXT', text: 'the answer' },
      latencyMs: 25,
    });
  });

  it('parses structured content locally into a STRUCTURED output', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('{"answer":"yes"}') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(
      makeInput({
        resultMode: 'STRUCTURED',
        structuredJsonSchema: { type: 'object', additionalProperties: false },
      }),
    );
    expect(result).toMatchObject({
      status: 'completed',
      output: { mode: 'STRUCTURED', value: { answer: 'yes' } },
    });
  });

  it('maps token usage and tolerates missing usage', async () => {
    const withUsage = makeTransport(() => ({
      bodyText: chatBody('ok', {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    }));
    const p1 = new GroqModelProvider(makeConfig(withUsage.transport), createManualClock());
    const r1 = await p1.invoke(makeInput());
    expect(r1).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    const noUsage = makeTransport(() => ({ bodyText: chatBody('ok') }));
    const p2 = new GroqModelProvider(makeConfig(noUsage.transport), createManualClock());
    const r2 = await p2.invoke(makeInput());
    expect(r2).toMatchObject({ status: 'completed', usage: {} });
  });

  it('accepts each recognized finish reason', async () => {
    for (const finish of ['stop', 'length', 'complete', 'eos', null]) {
      const harness = makeTransport(() => ({ bodyText: chatBody('ok', { finish }) }));
      const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
      const result = await provider.invoke(makeInput());
      expect(result.status).toBe('completed');
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// Provider invoke — HTTP / body error normalization.
// ---------------------------------------------------------------------------------------------------
describe('GroqModelProvider.invoke — error normalization', () => {
  const cases: { status: number; expected: Record<string, unknown> }[] = [
    { status: 429, expected: { status: 'unavailable', retryable: true } },
    { status: 498, expected: { status: 'unavailable', retryable: true } },
    { status: 500, expected: { status: 'unavailable', retryable: true } },
    { status: 503, expected: { status: 'unavailable', retryable: true } },
    { status: 499, expected: { status: 'cancelled' } },
    { status: 400, expected: { status: 'failed', retryable: false } },
    { status: 401, expected: { status: 'failed', retryable: false } },
    { status: 403, expected: { status: 'failed', retryable: false } },
    { status: 404, expected: { status: 'failed', retryable: false } },
    { status: 422, expected: { status: 'failed', retryable: false } },
  ];
  for (const { status, expected } of cases) {
    it(`normalizes HTTP ${String(status)}`, async () => {
      const harness = makeTransport(() => ({ status, bodyText: 'error body — must not leak' }));
      const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
      const result = await provider.invoke(makeInput());
      expect(result).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain('must not leak');
    });
  }

  it('normalizes an unparseable body to malformed', async () => {
    const harness = makeTransport(() => ({ bodyText: 'not json {' }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(result.status).toBe('malformed');
  });

  it('normalizes a schema-invalid body (no choices) to malformed', async () => {
    const harness = makeTransport(() => ({ bodyText: JSON.stringify({ choices: [] }) }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(result.status).toBe('malformed');
  });

  it('rejects more than one choice (non-single response) as failed', async () => {
    const harness = makeTransport(() => ({
      bodyText: chatBody(null, {
        choices: [
          { index: 0, message: { role: 'assistant', content: 'a' }, finish_reason: 'stop' },
          { index: 1, message: { role: 'assistant', content: 'b' }, finish_reason: 'stop' },
        ],
      }),
    }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(result).toEqual({ status: 'failed', retryable: false });
  });

  it('rejects null content as failed', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody(null) }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(result).toEqual({ status: 'failed', retryable: false });
  });

  it('rejects an unrecognized finish reason (e.g. content_filter) as failed', async () => {
    const harness = makeTransport(() => ({
      bodyText: chatBody('partial', { finish: 'content_filter' }),
    }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(result).toEqual({ status: 'failed', retryable: false });
  });

  it('maps STRUCTURED content that is not valid JSON to malformed', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('this is not json') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(
      makeInput({
        resultMode: 'STRUCTURED',
        structuredJsonSchema: { type: 'object', additionalProperties: false },
      }),
    );
    expect(result.status).toBe('malformed');
  });
});

// ---------------------------------------------------------------------------------------------------
// Provider invoke — cancellation, network failure, and health.
// ---------------------------------------------------------------------------------------------------
describe('GroqModelProvider — cancellation, network, health', () => {
  it('returns cancelled for an already-aborted signal without calling the transport', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('ok') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const controller = new AbortController();
    controller.abort();
    const result = await provider.invoke(makeInput({ signal: controller.signal }));
    expect(result).toEqual({ status: 'cancelled' });
    expect(harness.calls).toHaveLength(0);
  });

  it('maps a transport rejection with an aborted signal to cancelled', async () => {
    const controller = new AbortController();
    const transport: GroqTransport = {
      async send() {
        controller.abort();
        return Promise.reject(new Error('aborted'));
      },
    };
    const provider = new GroqModelProvider(makeConfig(transport), createManualClock());
    const result = await provider.invoke(makeInput({ signal: controller.signal }));
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('maps a transport rejection (no abort) to unavailable+retryable', async () => {
    const provider = new GroqModelProvider(makeConfig(throwingTransport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(result).toEqual({ status: 'unavailable', retryable: true });
  });

  it('health fails closed unless a positive data-controls attestation is supplied', async () => {
    const attested = new GroqModelProvider(
      makeConfig(makeTransport(() => ({ bodyText: chatBody('ok') })).transport),
      createManualClock(),
    );
    expect((await attested.health()).available).toBe(true);

    const notAttested = new GroqModelProvider(
      makeConfig(makeTransport(() => ({ bodyText: chatBody('ok') })).transport, {
        dataControlsAttested: false,
      }),
      createManualClock(),
    );
    expect((await notAttested.health()).available).toBe(false);
  });

  it('never leaks the key through the descriptor, capabilities, or a failure result', async () => {
    const harness = makeTransport(() => ({ status: 401, bodyText: 'unauthorized' }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const result = await provider.invoke(makeInput());
    expect(JSON.stringify(provider.descriptor)).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(provider.capabilities())).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(result)).not.toContain(SENTINEL_KEY);
  });
});

// ---------------------------------------------------------------------------------------------------
// Full gateway integration through the real Groq adapter (deterministic transport).
// ---------------------------------------------------------------------------------------------------
describe('gateway integration — Groq behind the governed waist', () => {
  const NO_REQUIRED: RequiredCapabilities = {
    structuredOutput: false,
    strictJsonSchema: false,
    cancellation: false,
    minContextTokens: 0,
  };

  function gatewayWith(
    provider: GroqModelProvider,
    overrides: Partial<ModelGatewayConfig> = {},
  ): ReturnType<typeof createModelGateway> {
    const config: ModelGatewayConfig = {
      mode: 'ACTIVE',
      providers: [provider],
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: OFF_KILL,
      concurrency: { maxConcurrent: 4, maxQueue: 4 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      ...overrides,
    };
    return createModelGateway(config);
  }

  function textRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      runId: 'run-1',
      purpose: 'qualify',
      agentScope: 'CLIENT',
      dataClass: 'HOSTED_ALLOWED',
      messages: [{ role: 'user', content: 'SECRET-PROMPT' }],
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

  it('routes a HOSTED_ALLOWED text request through Groq and returns the result', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('gateway-ok') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    const response = await gatewayWith(provider).invoke(textRequest());
    expect(response.textResult).toBe('gateway-ok');
    expect(response.provenance.providerId).toBe('groq');
    // Neither the prompt nor the key appears anywhere in the response.
    expect(JSON.stringify(response)).not.toContain('SECRET-PROMPT');
    expect(JSON.stringify(response)).not.toContain(SENTINEL_KEY);
  });

  it('never routes a LOCAL_ONLY request to the HOSTED Groq provider', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('ok') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await expectCode(
      gatewayWith(provider).invoke(textRequest({ dataClass: 'LOCAL_ONLY' })),
      'local-provider-required',
    );
    expect(harness.calls).toHaveLength(0);
  });

  it('never routes a HUMAN_ONLY request to any provider', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('ok') }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await expectCode(
      gatewayWith(provider).invoke(textRequest({ dataClass: 'HUMAN_ONLY' })),
      'human-only',
    );
    expect(harness.calls).toHaveLength(0);
  });

  it('respects the retry budget for a RETRYABLE Groq failure (429)', async () => {
    const harness = makeTransport(() => ({ status: 429, bodyText: 'rate limited' }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await expectCode(
      gatewayWith(provider).invoke(textRequest({ retryBudget: 1 })),
      'retry-budget-exhausted',
    );
    // One initial attempt + one retry = two transport calls.
    expect(harness.calls).toHaveLength(2);
  });

  it('does NOT retry a NON-RETRYABLE Groq failure (401), even with retry budget', async () => {
    const harness = makeTransport(() => ({ status: 401, bodyText: 'unauthorized' }));
    const provider = new GroqModelProvider(makeConfig(harness.transport), createManualClock());
    await expectCode(
      gatewayWith(provider).invoke(textRequest({ retryBudget: 3 })),
      'provider-failed',
    );
    expect(harness.calls).toHaveLength(1);
  });

  it('validates Groq structured output against the request schema through the gateway', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('{"answer":"42"}') }));
    // json_object mode keeps the test independent of JSON-Schema rendering details.
    const provider = new GroqModelProvider(
      makeConfig(harness.transport, { supportsStrictJsonSchema: false }),
      createManualClock(),
    );
    const schema = z.object({ answer: z.string() }).strict();
    const response = await gatewayWith(provider).invoke(
      textRequest({
        resultMode: 'STRUCTURED',
        requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true },
        structuredSchema: schema,
      }),
    );
    expect(response.structuredResult).toEqual({ answer: '42' });
    expect(firstCall(harness).parsedBody['response_format']).toEqual({ type: 'json_object' });
  });

  it('rejects Groq structured output that violates the request schema', async () => {
    const harness = makeTransport(() => ({ bodyText: chatBody('{"wrong":1}') }));
    const provider = new GroqModelProvider(
      makeConfig(harness.transport, { supportsStrictJsonSchema: false }),
      createManualClock(),
    );
    const schema = z.object({ answer: z.string() }).strict();
    await expectCode(
      gatewayWith(provider).invoke(
        textRequest({
          resultMode: 'STRUCTURED',
          requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true },
          structuredSchema: schema,
        }),
      ),
      'structured-output-invalid',
    );
  });
});
