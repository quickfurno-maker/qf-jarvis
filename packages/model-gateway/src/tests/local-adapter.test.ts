/**
 * QFJ-P04.01C — the local OpenAI-compatible adapter behaviour (ADR-0047).
 *
 * Every test runs through a DETERMINISTIC injected transport — there is NO external/LAN network, NO real
 * token, and NO live local-model call anywhere. A sentinel token proves the token reaches only the
 * transport boundary and never leaks. Covers: the private-IP endpoint policy (SSRF guard); the optional
 * redacting token holder; config validation/freezing; request mapping (non-streaming, n=1, max_tokens,
 * structured response_format); response validation with content-type check; HTTP/network error
 * normalization with bounded retryability; cancellation; fail-closed health; and hybrid gateway routing
 * where Groq (HOSTED) and the local (LOCAL) provider coexist behind the same provider-neutral contract.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  createEstimatedBudgetPolicy,
  createGroqApiKey,
  createGroqProviderConfig,
  createLocalAuthToken,
  createLocalEndpoint,
  createLocalProviderConfig,
  createFetchLocalTransport,
  createManualClock,
  createModelGateway,
  GroqModelProvider,
  LocalAuthToken,
  LocalEndpointDescriptor,
  LocalOpenAICompatibleModelProvider,
  LOCAL_CHAT_COMPLETIONS_PATH,
  type GatewayKillSwitch,
  type GroqTransport,
  type LocalProviderConfig,
  type LocalProviderConfigInput,
  type LocalTransport,
  type ModelGateway,
  type ModelGatewayConfig,
  type ModelProvider,
  type ProviderInvocationInput,
  type RequiredCapabilities,
} from '../index.js';
import { ModelGatewayError } from '../errors/gateway-error.js';

// Fixed non-secret placeholders. NOT real tokens/keys; they grant nothing and exist only to prove
// non-leakage.
const SENTINEL_TOKEN = 'local_SENTINEL_test_token_do_not_use_0000';
const SENTINEL_GROQ_KEY = 'gsk_SENTINEL_test_value_do_not_use_000000';

const OFF_KILL: GatewayKillSwitch = { active: (): boolean => false };
const LOOPBACK = 'http://127.0.0.1:11434';

interface RecordedCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly parsedBody: Record<string, unknown>;
}

interface LocalHarness {
  readonly transport: LocalTransport;
  readonly calls: RecordedCall[];
}

/** A deterministic local transport. `respond` maps the recorded request to a bounded response. No network. */
function makeLocalTransport(
  respond: (call: RecordedCall) => {
    status?: number;
    contentType?: string | null;
    bodyText: string;
  },
): LocalHarness {
  const calls: RecordedCall[] = [];
  const transport: LocalTransport = {
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
        contentType: r.contentType === undefined ? 'application/json' : r.contentType,
        bodyText: r.bodyText,
      };
    },
  };
  return { transport, calls };
}

function firstCall(harness: LocalHarness): RecordedCall {
  const call = harness.calls[0];
  if (call === undefined) {
    throw new Error('expected exactly one transport call, but the transport was never invoked');
  }
  return call;
}

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

function makeLocalConfig(
  transport: LocalTransport,
  overrides: Partial<LocalProviderConfigInput> = {},
): LocalProviderConfig {
  return createLocalProviderConfig({
    providerId: 'local',
    endpoint: createLocalEndpoint(LOOPBACK),
    modelId: 'qwen2.5-coder-7b',
    modelVersion: '1',
    maxInputTokens: 32_000,
    maxCompletionTokens: 512,
    supportsStrictJsonSchema: true,
    supportsJsonObject: true,
    transport,
    endpointAttested: true,
    modelAttested: true,
    authPostureAttested: true,
    ...overrides,
  });
}

function makeLocalProvider(
  transport: LocalTransport,
  overrides: Partial<LocalProviderConfigInput> = {},
  clock = createManualClock(),
): LocalOpenAICompatibleModelProvider {
  return new LocalOpenAICompatibleModelProvider(makeLocalConfig(transport, overrides), clock);
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

// ===================================================================================================
// Endpoint policy — the SSRF guard.
// ===================================================================================================
describe('createLocalEndpoint — private-IP policy', () => {
  // Loopback may use plain HTTP; a non-loopback private address needs HTTPS or an explicit plain-HTTP
  // attestation. Link-local additionally needs allowLinkLocal.
  const allowed: [string, Parameters<typeof createLocalEndpoint>[1]?][] = [
    ['http://127.0.0.1:11434'],
    ['http://127.5.6.7:8080'],
    ['https://10.0.0.5:8000'],
    ['https://172.16.0.1:8080'],
    ['https://172.31.255.254:8080'],
    ['https://192.168.1.10:1234'],
    ['https://100.64.0.1:8000'],
    ['https://100.127.255.254:8000'],
    ['http://[::1]:11434'],
    ['https://[fc00::1]:8080'],
    ['https://[fd12:3456:789a::1]:8080'],
    ['https://[fe80::1]:8080', { allowLinkLocal: true }],
    ['http://10.0.0.5:8080', { allowPlainHttpNonLoopback: true }],
  ];
  for (const [url, opts] of allowed) {
    it(`allows ${url}`, () => {
      const ep = createLocalEndpoint(url, opts);
      expect(ep).toBeInstanceOf(LocalEndpointDescriptor);
      expect(ep.chatCompletionsUrl.endsWith(LOCAL_CHAT_COMPLETIONS_PATH)).toBe(true);
    });
  }

  const rejected: string[] = [
    'http://8.8.8.8:80', // public IPv4
    'http://1.1.1.1', // public IPv4
    'http://[2606:4700:4700::1111]:80', // public IPv6
    'http://example.com:11434', // hostname
    'http://localhost:11434', // hostname
    'http://user:pass@127.0.0.1:11434', // embedded credentials
    'http://127.0.0.1:11434/?x=1', // query string
    'http://127.0.0.1:11434/#frag', // fragment
    'http://127.0.0.1:11434/v1/chat/completions', // explicit path
    'ftp://127.0.0.1', // scheme
    'ws://127.0.0.1', // scheme
    'http://169.254.1.1:80', // IPv4 link-local
    'http://[fe80::1]:8080', // IPv6 link-local without opt-in
    'http://[::ffff:8.8.8.8]:80', // IPv4-mapped public IPv6
    'http://0.0.0.0:8080', // unspecified
    'http://255.255.255.255:8080', // broadcast
    'http://224.0.0.1:8080', // multicast
    'http://256.1.1.1:8080', // malformed IPv4
    'http://[gggg::1]:8080', // malformed IPv6
    'http://10.0.0.5:8080', // plain HTTP non-loopback without attestation
    'http://127.0.0.1:0', // port 0
  ];
  for (const url of rejected) {
    it(`rejects ${url}`, () => {
      expect(() => createLocalEndpoint(url)).toThrow();
    });
  }

  it('never echoes credentials in the endpoint error', () => {
    let raised: unknown;
    try {
      createLocalEndpoint('http://user:sup3rsecret@127.0.0.1:11434');
    } catch (error) {
      raised = error;
    }
    expect((raised as Error).message).not.toContain('sup3rsecret');
  });

  it('permits plain HTTP to a non-loopback private address only when attested', () => {
    expect(() => createLocalEndpoint('http://192.168.1.5:8080')).toThrow();
    const ep = createLocalEndpoint('http://192.168.1.5:8080', { allowPlainHttpNonLoopback: true });
    expect(ep.scheme).toBe('http');
    expect(ep.isLoopback).toBe(false);
  });
});

// ===================================================================================================
// The SSRF-guarded production transport (no network reached — the guard rejects a mismatched URL).
// ===================================================================================================
describe('createFetchLocalTransport — SSRF guard', () => {
  it('refuses any URL other than the validated endpoint before touching the network', async () => {
    const endpoint = createLocalEndpoint(LOOPBACK);
    const transport = createFetchLocalTransport(endpoint);
    await expect(
      transport.send(
        { url: 'http://10.0.0.9:11434/v1/chat/completions', headers: {}, body: '{}' },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});

// ===================================================================================================
// The optional redacting auth-token holder.
// ===================================================================================================
describe('LocalAuthToken — redaction and injection', () => {
  it('rejects empty/whitespace/oversized values', () => {
    expect(() => createLocalAuthToken('')).toThrow();
    expect(() => createLocalAuthToken('   ')).toThrow();
    expect(() => createLocalAuthToken('x'.repeat(513))).toThrow();
  });

  it('never reveals the value via toString/toJSON/stringify', () => {
    const token = createLocalAuthToken(SENTINEL_TOKEN);
    expect(token).toBeInstanceOf(LocalAuthToken);
    expect(String(token)).toBe('[REDACTED_LOCAL_AUTH_TOKEN]');
    expect(token.toJSON()).toBe('[REDACTED_LOCAL_AUTH_TOKEN]');
    expect(JSON.stringify({ token })).not.toContain(SENTINEL_TOKEN);
  });

  it('exposes the value ONLY through the Authorization builder', () => {
    const token = createLocalAuthToken(SENTINEL_TOKEN);
    expect(token.authorizationHeaderValue()).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });
});

// ===================================================================================================
// Config validation and freezing.
// ===================================================================================================
describe('createLocalProviderConfig — validation and immutability', () => {
  it('builds LOCAL capabilities with non-streaming only', () => {
    const config = makeLocalConfig(
      makeLocalTransport(() => ({ bodyText: chatBody('ok') })).transport,
    );
    expect(config.capabilities.executionClass).toBe('LOCAL');
    expect(config.capabilities.supportsStructuredOutput).toBe(true);
    expect(config.capabilities.supportsNonStreaming).toBe(true);
    expect(config.capabilities.supportsStreaming).toBe(false);
  });

  it('rejects an endpoint that is not a validated LocalEndpointDescriptor', () => {
    const forged = {
      chatCompletionsUrl: 'http://8.8.8.8/v1/chat/completions',
      baseUrl: 'http://8.8.8.8',
      scheme: 'http',
      category: 'ipv4-loopback',
      isLoopback: true,
    } as unknown as LocalEndpointDescriptor;
    expect(() =>
      makeLocalConfig(makeLocalTransport(() => ({ bodyText: '{}' })).transport, {
        endpoint: forged,
      }),
    ).toThrow();
  });

  it('rejects a non-LocalAuthToken token', () => {
    expect(() =>
      makeLocalConfig(makeLocalTransport(() => ({ bodyText: '{}' })).transport, {
        authToken: SENTINEL_TOKEN as unknown as LocalAuthToken,
      }),
    ).toThrow();
  });

  it('rejects a missing transport', () => {
    expect(() =>
      makeLocalConfig(undefined as unknown as LocalTransport, {
        transport: undefined as unknown as LocalTransport,
      }),
    ).toThrow();
  });

  it('accepts no token (loopback dev) and freezes with no secret in serialization', () => {
    const config = makeLocalConfig(
      makeLocalTransport(() => ({ bodyText: chatBody('ok') })).transport,
    );
    expect(config.authToken).toBeUndefined();
    expect(Object.isFrozen(config)).toBe(true);
    expect(JSON.stringify(config)).not.toContain(SENTINEL_TOKEN);
  });

  it('redacts an injected token when the config is serialized', () => {
    const config = makeLocalConfig(
      makeLocalTransport(() => ({ bodyText: chatBody('ok') })).transport,
      { authToken: createLocalAuthToken(SENTINEL_TOKEN) },
    );
    expect(JSON.stringify(config)).not.toContain(SENTINEL_TOKEN);
  });

  it('health fails closed unless endpoint, model, and auth posture are all attested', async () => {
    const t = makeLocalTransport(() => ({ bodyText: chatBody('ok') })).transport;
    const attested = new LocalOpenAICompatibleModelProvider(
      makeLocalConfig(t),
      createManualClock(),
    );
    expect((await attested.health()).available).toBe(true);
    for (const missing of [
      { endpointAttested: false },
      { modelAttested: false },
      { authPostureAttested: false },
    ]) {
      const p = new LocalOpenAICompatibleModelProvider(
        makeLocalConfig(t, missing),
        createManualClock(),
      );
      expect((await p.health()).available).toBe(false);
    }
  });
});

// ===================================================================================================
// Provider invoke — request mapping.
// ===================================================================================================
describe('LocalOpenAICompatibleModelProvider.invoke — request mapping', () => {
  it('sends a minimal non-streaming single-choice body to the fixed private URL', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('answer') }));
    const provider = makeLocalProvider(harness.transport);
    await provider.invoke(makeInput({ messages: [{ role: 'user', content: 'ping' }] }));
    const call = firstCall(harness);
    expect(call.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(call.parsedBody).toMatchObject({
      model: 'qwen2.5-coder-7b',
      stream: false,
      n: 1,
      max_tokens: 512,
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(call.parsedBody).not.toHaveProperty('tools');
    expect(call.parsedBody).not.toHaveProperty('functions');
    expect(call.parsedBody).not.toHaveProperty('tool_choice');
    expect(call.parsedBody).not.toHaveProperty('reasoning');
    expect(call.parsedBody).not.toHaveProperty('user');
  });

  it('omits the Authorization header when no token is configured', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(firstCall(harness).headers).not.toHaveProperty('authorization');
    expect(firstCall(harness).headers['content-type']).toBe('application/json');
  });

  it('carries the Authorization header only when a token is configured', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    await makeLocalProvider(harness.transport, {
      authToken: createLocalAuthToken(SENTINEL_TOKEN),
    }).invoke(makeInput());
    expect(firstCall(harness).headers['authorization']).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });

  it('omits response_format for a TEXT request', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(firstCall(harness).parsedBody).not.toHaveProperty('response_format');
  });

  it('maps a strict-compatible STRUCTURED request to strict json_schema', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('{"answer":"y"}') }));
    await makeLocalProvider(harness.transport).invoke(
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

  it('uses json_object when only that mode is supported', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('{"answer":"y"}') }));
    await makeLocalProvider(harness.transport, {
      supportsStrictJsonSchema: false,
      supportsJsonObject: true,
    }).invoke(makeInput({ resultMode: 'STRUCTURED', structuredJsonSchema: { type: 'string' } }));
    expect(firstCall(harness).parsedBody['response_format']).toEqual({ type: 'json_object' });
  });

  it('fails a strict request with a non-strict-compatible schema BEFORE any transport call', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('{}') }));
    const result = await makeLocalProvider(harness.transport).invoke(
      makeInput({ resultMode: 'STRUCTURED', structuredJsonSchema: { type: 'string' } }),
    );
    expect(result).toEqual({ status: 'failed', retryable: false });
    expect(harness.calls).toHaveLength(0);
  });

  it('fails a STRUCTURED request BEFORE transport when no structured mode is supported', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('{}') }));
    const result = await makeLocalProvider(harness.transport, {
      supportsStrictJsonSchema: false,
      supportsJsonObject: false,
    }).invoke(
      makeInput({
        resultMode: 'STRUCTURED',
        structuredJsonSchema: { type: 'object', additionalProperties: false },
      }),
    );
    expect(result).toEqual({ status: 'failed', retryable: false });
    expect(harness.calls).toHaveLength(0);
  });
});

// ===================================================================================================
// Provider invoke — successful responses.
// ===================================================================================================
describe('LocalOpenAICompatibleModelProvider.invoke — completed responses', () => {
  it('returns completed TEXT with content and injected-clock latency', async () => {
    const clock = createManualClock();
    const harness = makeLocalTransport(() => {
      clock.advance(30);
      return { bodyText: chatBody('the answer') };
    });
    const result = await makeLocalProvider(harness.transport, {}, clock).invoke(makeInput());
    expect(result).toMatchObject({
      status: 'completed',
      output: { mode: 'TEXT', text: 'the answer' },
      latencyMs: 30,
    });
  });

  it('parses structured content locally into a STRUCTURED output', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('{"answer":"yes"}') }));
    const result = await makeLocalProvider(harness.transport).invoke(
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
    const withUsage = makeLocalTransport(() => ({
      bodyText: chatBody('ok', {
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      }),
    }));
    const r1 = await makeLocalProvider(withUsage.transport).invoke(makeInput());
    expect(r1).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    });
    const noUsage = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    const r2 = await makeLocalProvider(noUsage.transport).invoke(makeInput());
    expect(r2).toMatchObject({ status: 'completed', usage: {} });
  });

  it('accepts each recognized finish reason', async () => {
    for (const finish of ['stop', 'length', 'complete', 'eos', null]) {
      const harness = makeLocalTransport(() => ({ bodyText: chatBody('ok', { finish }) }));
      const result = await makeLocalProvider(harness.transport).invoke(makeInput());
      expect(result.status).toBe('completed');
    }
  });
});

// ===================================================================================================
// Provider invoke — response / error normalization.
// ===================================================================================================
describe('LocalOpenAICompatibleModelProvider.invoke — error normalization', () => {
  const cases: { status: number; expected: Record<string, unknown> }[] = [
    { status: 429, expected: { status: 'unavailable', retryable: true } },
    { status: 500, expected: { status: 'unavailable', retryable: true } },
    { status: 502, expected: { status: 'unavailable', retryable: true } },
    { status: 503, expected: { status: 'unavailable', retryable: true } },
    { status: 504, expected: { status: 'unavailable', retryable: true } },
    { status: 499, expected: { status: 'cancelled' } },
    { status: 400, expected: { status: 'failed', retryable: false } },
    { status: 401, expected: { status: 'failed', retryable: false } },
    { status: 403, expected: { status: 'failed', retryable: false } },
    { status: 404, expected: { status: 'failed', retryable: false } },
    { status: 413, expected: { status: 'failed', retryable: false } },
    { status: 422, expected: { status: 'failed', retryable: false } },
  ];
  for (const { status, expected } of cases) {
    it(`normalizes HTTP ${String(status)}`, async () => {
      const harness = makeLocalTransport(() => ({
        status,
        bodyText: 'error body — must not leak',
      }));
      const result = await makeLocalProvider(harness.transport).invoke(makeInput());
      expect(result).toEqual(expected);
      expect(JSON.stringify(result)).not.toContain('must not leak');
    });
  }

  it('treats a 200 with a non-JSON content-type as malformed', async () => {
    const harness = makeLocalTransport(() => ({
      contentType: 'text/html',
      bodyText: '<html>captive portal</html>',
    }));
    const result = await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(result.status).toBe('malformed');
  });

  it('normalizes an unparseable JSON body to malformed', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: 'not json {' }));
    const result = await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(result.status).toBe('malformed');
  });

  it('normalizes a schema-invalid body (no choices) to malformed', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: JSON.stringify({ choices: [] }) }));
    const result = await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(result.status).toBe('malformed');
  });

  it('rejects more than one choice as failed', async () => {
    const harness = makeLocalTransport(() => ({
      bodyText: chatBody(null, {
        choices: [
          { index: 0, message: { role: 'assistant', content: 'a' }, finish_reason: 'stop' },
          { index: 1, message: { role: 'assistant', content: 'b' }, finish_reason: 'stop' },
        ],
      }),
    }));
    const result = await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(result).toEqual({ status: 'failed', retryable: false });
  });

  it('rejects null content as failed', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody(null) }));
    const result = await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(result).toEqual({ status: 'failed', retryable: false });
  });

  it('rejects an unrecognized finish reason as failed', async () => {
    const harness = makeLocalTransport(() => ({
      bodyText: chatBody('x', { finish: 'content_filter' }),
    }));
    const result = await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(result).toEqual({ status: 'failed', retryable: false });
  });

  it('maps STRUCTURED content that is not valid JSON to malformed', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('this is not json') }));
    const result = await makeLocalProvider(harness.transport).invoke(
      makeInput({
        resultMode: 'STRUCTURED',
        structuredJsonSchema: { type: 'object', additionalProperties: false },
      }),
    );
    expect(result.status).toBe('malformed');
  });
});

// ===================================================================================================
// Provider — cancellation, network, and non-leakage.
// ===================================================================================================
describe('LocalOpenAICompatibleModelProvider — cancellation, network, non-leakage', () => {
  it('returns cancelled for an already-aborted signal without calling the transport', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    const controller = new AbortController();
    controller.abort();
    const result = await makeLocalProvider(harness.transport).invoke(
      makeInput({ signal: controller.signal }),
    );
    expect(result).toEqual({ status: 'cancelled' });
    expect(harness.calls).toHaveLength(0);
  });

  it('maps a transport rejection with an aborted signal to cancelled', async () => {
    const controller = new AbortController();
    const transport: LocalTransport = {
      async send() {
        controller.abort();
        return Promise.reject(new Error('aborted'));
      },
    };
    const result = await makeLocalProvider(transport).invoke(
      makeInput({ signal: controller.signal }),
    );
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('maps a transport rejection (no abort) to unavailable+retryable', async () => {
    const transport: LocalTransport = {
      async send() {
        return Promise.reject(new Error('ECONNREFUSED'));
      },
    };
    const result = await makeLocalProvider(transport).invoke(makeInput());
    expect(result).toEqual({ status: 'unavailable', retryable: true });
  });

  it('performs exactly one transport call per invoke', async () => {
    const harness = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    await makeLocalProvider(harness.transport).invoke(makeInput());
    expect(harness.calls).toHaveLength(1);
  });

  it('never leaks the token through the descriptor, capabilities, or a failure result', async () => {
    const harness = makeLocalTransport(() => ({ status: 401, bodyText: 'unauthorized' }));
    const provider = makeLocalProvider(harness.transport, {
      authToken: createLocalAuthToken(SENTINEL_TOKEN),
    });
    const result = await provider.invoke(makeInput());
    expect(JSON.stringify(provider.descriptor)).not.toContain(SENTINEL_TOKEN);
    expect(JSON.stringify(provider.capabilities())).not.toContain(SENTINEL_TOKEN);
    expect(JSON.stringify(result)).not.toContain(SENTINEL_TOKEN);
  });
});

// ===================================================================================================
// Hybrid gateway — Groq (HOSTED) and local (LOCAL) behind the governed waist.
// ===================================================================================================
describe('gateway integration — hybrid Groq + local', () => {
  const NO_REQUIRED: RequiredCapabilities = {
    structuredOutput: false,
    strictJsonSchema: false,
    cancellation: false,
    minContextTokens: 0,
  };

  function makeGroqTransport(respond: () => { status?: number; bodyText: string }): {
    transport: GroqTransport;
    calls: number;
  } {
    const state = { calls: 0 };
    const transport: GroqTransport = {
      async send() {
        state.calls += 1;
        const r = await Promise.resolve(respond());
        return { status: r.status ?? 200, retryAfterSeconds: null, bodyText: r.bodyText };
      },
    };
    return {
      transport,
      get calls() {
        return state.calls;
      },
    };
  }

  function groqProvider(transport: GroqTransport): GroqModelProvider {
    return new GroqModelProvider(
      createGroqProviderConfig({
        providerId: 'groq',
        modelId: 'llama-3.3-70b',
        modelVersion: '1',
        maxInputTokens: 128_000,
        maxCompletionTokens: 512,
        supportsStrictJsonSchema: true,
        apiKey: createGroqApiKey(SENTINEL_GROQ_KEY),
        transport,
        dataControlsAttested: true,
      }),
      createManualClock(),
    );
  }

  function gatewayWith(
    providers: readonly ModelProvider[],
    overrides: Partial<ModelGatewayConfig> = {},
  ): ModelGateway {
    return createModelGateway({
      mode: 'ACTIVE',
      providers,
      clock: createManualClock(),
      budgetPolicy: createEstimatedBudgetPolicy(),
      killSwitch: OFF_KILL,
      concurrency: { maxConcurrent: 4, maxQueue: 4 },
      circuit: { failureThreshold: 3, cooldownMs: 1000 },
      allowFallback: false,
      ...overrides,
    });
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

  it('routes LOCAL_ONLY to the local provider and never to Groq', async () => {
    const groq = makeGroqTransport(() => ({ bodyText: chatBody('groq') }));
    const local = makeLocalTransport(() => ({ bodyText: chatBody('local-ok') }));
    const gateway = gatewayWith([groqProvider(groq.transport), makeLocalProvider(local.transport)]);
    const response = await gateway.invoke(textRequest({ dataClass: 'LOCAL_ONLY' }));
    expect(response.textResult).toBe('local-ok');
    expect(response.provenance.providerId).toBe('local');
    expect(response.provenance.modelId).toBe('qwen2.5-coder-7b');
    expect(groq.calls).toBe(0);
    expect(JSON.stringify(response)).not.toContain('SECRET-PROMPT');
    expect(JSON.stringify(response)).not.toContain(SENTINEL_GROQ_KEY);
  });

  it('routes HUMAN_ONLY to no provider', async () => {
    const groq = makeGroqTransport(() => ({ bodyText: chatBody('groq') }));
    const local = makeLocalTransport(() => ({ bodyText: chatBody('local') }));
    const gateway = gatewayWith([groqProvider(groq.transport), makeLocalProvider(local.transport)]);
    await expectCode(gateway.invoke(textRequest({ dataClass: 'HUMAN_ONLY' })), 'human-only');
    expect(groq.calls).toBe(0);
    expect(local.calls).toHaveLength(0);
  });

  it('HOSTED_ALLOWED selects the first provider in policy order (Groq first)', async () => {
    const groq = makeGroqTransport(() => ({ bodyText: chatBody('groq-ok') }));
    const local = makeLocalTransport(() => ({ bodyText: chatBody('local') }));
    const gateway = gatewayWith([groqProvider(groq.transport), makeLocalProvider(local.transport)]);
    const response = await gateway.invoke(textRequest());
    expect(response.textResult).toBe('groq-ok');
    expect(local.calls).toHaveLength(0);
  });

  it('HOSTED_ALLOWED selects the first provider in policy order (local first)', async () => {
    const groq = makeGroqTransport(() => ({ bodyText: chatBody('groq') }));
    const local = makeLocalTransport(() => ({ bodyText: chatBody('local-ok') }));
    const gateway = gatewayWith([makeLocalProvider(local.transport), groqProvider(groq.transport)]);
    const response = await gateway.invoke(textRequest());
    expect(response.textResult).toBe('local-ok');
    expect(response.provenance.providerId).toBe('local');
    expect(groq.calls).toBe(0);
  });

  it('falls back hosted-to-local exactly once when policy permits', async () => {
    const groq = makeGroqTransport(() => ({ status: 500, bodyText: 'groq down' }));
    const local = makeLocalTransport(() => ({ bodyText: chatBody('local-rescue') }));
    const gateway = gatewayWith(
      [groqProvider(groq.transport), makeLocalProvider(local.transport)],
      {
        allowFallback: true,
      },
    );
    const response = await gateway.invoke(textRequest());
    expect(response.textResult).toBe('local-rescue');
    expect(response.provenance.usedFallback).toBe(true);
    expect(groq.calls).toBe(1);
    expect(local.calls).toHaveLength(1);
  });

  it('never falls back from local to Groq for a LOCAL_ONLY request', async () => {
    const groq = makeGroqTransport(() => ({ bodyText: chatBody('groq') }));
    const local = makeLocalTransport(() => ({ status: 400, bodyText: 'local bad request' }));
    const gateway = gatewayWith(
      [makeLocalProvider(local.transport), groqProvider(groq.transport)],
      {
        allowFallback: true,
      },
    );
    await expectCode(gateway.invoke(textRequest({ dataClass: 'LOCAL_ONLY' })), 'provider-failed');
    expect(groq.calls).toBe(0);
  });

  it('OFF and the kill switch prevent both providers', async () => {
    const groq = makeGroqTransport(() => ({ bodyText: chatBody('groq') }));
    const local = makeLocalTransport(() => ({ bodyText: chatBody('local') }));
    const providers = [groqProvider(groq.transport), makeLocalProvider(local.transport)];
    await expectCode(gatewayWith(providers, { mode: 'OFF' }).invoke(textRequest()), 'gateway-off');
    await expectCode(
      gatewayWith(providers, { killSwitch: { active: () => true } }).invoke(textRequest()),
      'kill-switch-active',
    );
    expect(groq.calls).toBe(0);
    expect(local.calls).toHaveLength(0);
  });

  it('respects the retry budget on a retryable local failure (circuit uses normalized failures)', async () => {
    const local = makeLocalTransport(() => ({ status: 503, bodyText: 'busy' }));
    const gateway = gatewayWith([makeLocalProvider(local.transport)]);
    await expectCode(
      gateway.invoke(textRequest({ dataClass: 'LOCAL_ONLY', retryBudget: 1 })),
      'retry-budget-exhausted',
    );
    expect(local.calls).toHaveLength(2);
  });

  it('validates local structured output through the gateway and rejects a schema violation', async () => {
    const ok = makeLocalTransport(() => ({ bodyText: chatBody('{"answer":"42"}') }));
    const schema = z.object({ answer: z.string() }).strict();
    const response = await gatewayWith([
      makeLocalProvider(ok.transport, {
        supportsStrictJsonSchema: false,
        supportsJsonObject: true,
      }),
    ]).invoke(
      textRequest({
        dataClass: 'LOCAL_ONLY',
        resultMode: 'STRUCTURED',
        requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true },
        structuredSchema: schema,
      }),
    );
    expect(response.structuredResult).toEqual({ answer: '42' });

    const bad = makeLocalTransport(() => ({ bodyText: chatBody('{"wrong":1}') }));
    await expectCode(
      gatewayWith([
        makeLocalProvider(bad.transport, {
          supportsStrictJsonSchema: false,
          supportsJsonObject: true,
        }),
      ]).invoke(
        textRequest({
          dataClass: 'LOCAL_ONLY',
          resultMode: 'STRUCTURED',
          requiredCapabilities: { ...NO_REQUIRED, structuredOutput: true },
          structuredSchema: schema,
        }),
      ),
      'structured-output-invalid',
    );
  });

  it('exposes no authorize/execute capability on a local response (advisory only)', async () => {
    const local = makeLocalTransport(() => ({ bodyText: chatBody('ok') }));
    const response = await gatewayWith([makeLocalProvider(local.transport)]).invoke(
      textRequest({ dataClass: 'LOCAL_ONLY' }),
    );
    expect(typeof (response as unknown as { authorize?: unknown }).authorize).toBe('undefined');
    expect(typeof (response as unknown as { execute?: unknown }).execute).toBe('undefined');
    expect(response.finishStatus).toBe('completed');
  });
});
