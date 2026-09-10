/**
 * The NaraRouter hosted provider specs (JF-2A, ADR-0146).
 *
 * Every request goes through an INJECTED deterministic transport. No `fetch` is called, no socket is
 * opened, no credential is read from anywhere, and every key in this file is an obvious sentinel. The
 * production transport is exercised only for its SSRF guard, which throws before it would reach the
 * network.
 */
import { describe, expect, it } from 'vitest';

import {
  NARA_CHAT_COMPLETIONS_ENDPOINT,
  createFetchNaraTransport,
  type NaraHttpRequest,
  type NaraHttpResponse,
  type NaraTransport,
} from '../providers/nara/nara-transport.js';
import { createNaraApiKey } from '../providers/nara/nara-secret.js';
import type { NaraApiKey } from '../providers/nara/nara-secret.js';
import {
  NARA_REFUSED_ROUTER_ALIASES,
  NARA_SUPPORTS_STRICT_JSON_SCHEMA,
  createNaraProviderConfig,
  isNaraRouterAlias,
} from '../providers/nara/nara-config.js';
import { normalizeNaraHttpStatus } from '../providers/nara/nara-error-normalization.js';
import { NaraModelProvider } from '../providers/nara/nara-model-provider.js';
import type { ProviderInvocationInput } from '../contracts/provider.js';

const SENTINEL_KEY = 'sentinel-not-a-real-key-0000';
const MODEL_ID = 'vendor/test-model-8b';

/** A deterministic clock. No wall-clock read anywhere in these specs. */
function fixedClock(values: readonly number[] = [1_000, 1_250]): { now: () => number } {
  let index = 0;
  return {
    now: (): number => {
      const value = values[Math.min(index, values.length - 1)] ?? 0;
      index += 1;
      return value;
    },
  };
}

interface Recorded {
  readonly requests: NaraHttpRequest[];
}

/** A transport that records what it was handed and replies with a scripted response. */
function scriptedTransport(response: NaraHttpResponse): {
  transport: NaraTransport;
  recorded: Recorded;
} {
  const recorded: Recorded = { requests: [] };
  const transport: NaraTransport = {
    send(request: NaraHttpRequest): Promise<NaraHttpResponse> {
      recorded.requests.push(request);
      return Promise.resolve(response);
    },
  };
  return { transport, recorded };
}

function okBody(content: string, usage?: Record<string, number>): string {
  return JSON.stringify({
    id: 'resp-1',
    model: MODEL_ID,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage === undefined ? {} : { usage }),
  });
}

function buildProvider(
  transport: NaraTransport,
  overrides: { readonly dataControlsAttested?: boolean } = {},
): NaraModelProvider {
  const config = createNaraProviderConfig({
    providerId: 'nara',
    modelId: MODEL_ID,
    modelVersion: '2026-09-01',
    maxInputTokens: 128_000,
    maxCompletionTokens: 4_096,
    apiKey: createNaraApiKey(SENTINEL_KEY),
    transport,
    dataControlsAttested: overrides.dataControlsAttested ?? true,
  });
  return new NaraModelProvider(config, fixedClock());
}

function invocation(overrides: Partial<ProviderInvocationInput> = {}): ProviderInvocationInput {
  return {
    runId: 'run-1',
    messages: [{ role: 'user', content: 'hello' }],
    resultMode: 'TEXT',
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('JF-2A NaraRouter provider', () => {
  it('1. declares the HOSTED execution class', () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    const provider = buildProvider(transport);
    expect(provider.descriptor.executionClass).toBe('HOSTED');
    expect(provider.descriptor.executionClass).not.toBe('LOCAL');
    expect(provider.capabilities().executionClass).toBe('HOSTED');
  });

  it('1b. cannot be configured as a LOCAL provider', () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: '{}',
    });
    expect(() =>
      createNaraProviderConfig({
        providerId: 'nara',
        modelId: MODEL_ID,
        modelVersion: 'v1',
        // A hosted provider declaring itself LOCAL would bypass the LOCAL_ONLY privacy gate.
        executionClass: 'LOCAL' as unknown as 'HOSTED',
        maxInputTokens: 1_000,
        maxCompletionTokens: 100,
        apiKey: createNaraApiKey(SENTINEL_KEY),
        transport,
        dataControlsAttested: true,
      }),
    ).toThrow(/HOSTED/);
  });

  it('2. targets the canonical NaraRouter endpoint', async () => {
    const { transport, recorded } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    await buildProvider(transport).invoke(invocation());
    expect(recorded.requests).toHaveLength(1);
    expect(recorded.requests[0]?.url).toBe(NARA_CHAT_COMPLETIONS_ENDPOINT);
    expect(NARA_CHAT_COMPLETIONS_ENDPOINT).toBe('https://router.bynara.id/v1/chat/completions');
  });

  it('3. the production transport refuses any other endpoint', async () => {
    const transport = createFetchNaraTransport();
    const signal = new AbortController().signal;
    for (const url of [
      'https://evil.example.com/v1/chat/completions',
      'http://127.0.0.1:11434/v1/chat/completions',
      'https://router.bynara.id.evil.example/v1/chat/completions',
      'https://router.bynara.id/v1/other',
      'http://router.bynara.id/v1/chat/completions',
    ]) {
      await expect(transport.send({ url, headers: {}, body: '{}' }, signal)).rejects.toThrow(
        /non-official endpoint/,
      );
    }
  });

  it('4. injects the sentinel key as a bearer token and never exposes it', async () => {
    const { transport, recorded } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    const provider = buildProvider(transport);
    await provider.invoke(invocation());

    // The transport boundary is the ONLY place the value appears.
    expect(recorded.requests[0]?.headers['authorization']).toBe(`Bearer ${SENTINEL_KEY}`);

    // Everywhere else it redacts itself.
    const key = createNaraApiKey(SENTINEL_KEY);
    expect(String(key)).toBe('[REDACTED_NARA_API_KEY]');
    expect(JSON.stringify({ key })).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(provider.descriptor)).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(provider.capabilities())).not.toContain(SENTINEL_KEY);
    // The config object itself must not serialize the secret.
    expect(JSON.stringify(provider)).not.toContain(SENTINEL_KEY);
  });

  it('5. one bounded request produces one completed result', async () => {
    const { transport, recorded } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('a reply'),
    });
    const result = await buildProvider(transport).invoke(invocation());
    expect(recorded.requests).toHaveLength(1);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.output).toStrictEqual({ mode: 'TEXT', text: 'a reply' });
    expect(result.latencyMs).toBe(250);

    const body = JSON.parse(recorded.requests[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toBe(MODEL_ID);
    expect(body['stream']).toBe(false);
    expect(body['n']).toBe(1);
    expect(body['max_tokens']).toBe(4_096);
    // No tools, no functions, no MCP, no provider-side agent, no reasoning fields.
    for (const forbidden of ['tools', 'functions', 'tool_choice', 'mcp', 'reasoning', 'agent']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('5b. an application budget narrows the completion bound but can never raise it', async () => {
    const { transport, recorded } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    const provider = buildProvider(transport);
    await provider.invoke(invocation({ maxCompletionTokens: 256 }));
    await provider.invoke(invocation({ maxCompletionTokens: 999_999 }));
    const first = JSON.parse(recorded.requests[0]?.body ?? '{}') as Record<string, unknown>;
    const second = JSON.parse(recorded.requests[1]?.body ?? '{}') as Record<string, unknown>;
    expect(first['max_tokens']).toBe(256);
    expect(second['max_tokens']).toBe(4_096);
  });

  it('6. parses usage tokens when the provider supplies them', async () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi', { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 }),
    });
    const result = await buildProvider(transport).invoke(invocation());
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.usage).toStrictEqual({ inputTokens: 11, outputTokens: 5, totalTokens: 16 });
    // Cost is never fabricated: this repository has no versioned pricing registry.
    expect(result.usage).not.toHaveProperty('cost');
  });

  it('7. does not fabricate usage when the provider omits it', async () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    const noUsage = await buildProvider(transport).invoke(invocation());
    expect(noUsage.status).toBe('completed');
    if (noUsage.status !== 'completed') return;
    // ABSENT, not zero. A fabricated zero would read as a free request in later accounting.
    expect(noUsage.usage).toStrictEqual({});

    const partial = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi', { prompt_tokens: 7 }),
    });
    const some = await buildProvider(partial.transport).invoke(invocation());
    if (some.status !== 'completed') return;
    expect(some.usage).toStrictEqual({ inputTokens: 7 });
  });

  it('8. normalizes cancellation, before and during the call', async () => {
    const { transport, recorded } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    const controller = new AbortController();
    controller.abort();
    const before = await buildProvider(transport).invoke(invocation({ signal: controller.signal }));
    expect(before.status).toBe('cancelled');
    // It never reached the transport.
    expect(recorded.requests).toHaveLength(0);

    // A transport that rejects while the signal is aborted is cancellation, not a network failure.
    const aborting = new AbortController();
    const throwing: NaraTransport = {
      send(): Promise<NaraHttpResponse> {
        aborting.abort();
        return Promise.reject(new Error('aborted'));
      },
    };
    const during = await buildProvider(throwing).invoke(invocation({ signal: aborting.signal }));
    expect(during.status).toBe('cancelled');
  });

  it('9. normalizes 429 to rate-limited, carrying no body or header', () => {
    const result = normalizeNaraHttpStatus(429);
    expect(result).toStrictEqual({ status: 'rate-limited' });
  });

  it('10. normalizes 5xx to retryable unavailable', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(normalizeNaraHttpStatus(status)).toStrictEqual({
        status: 'unavailable',
        retryable: true,
      });
    }
    expect(normalizeNaraHttpStatus(498)).toStrictEqual({ status: 'unavailable', retryable: true });
    expect(normalizeNaraHttpStatus(499)).toStrictEqual({ status: 'cancelled' });
  });

  it('11-13. normalizes auth, invalid request and model-entitlement failures as non-retryable', () => {
    // 401/403 auth+entitlement, 400/422 invalid request, 404 unknown/unentitled model.
    for (const status of [400, 401, 403, 404, 413, 422, 418]) {
      expect(normalizeNaraHttpStatus(status)).toStrictEqual({ status: 'failed', retryable: false });
    }
  });

  it('11b. a network failure is retryable unavailable', async () => {
    const throwing: NaraTransport = {
      send(): Promise<NaraHttpResponse> {
        return Promise.reject(new Error('ECONNREFUSED'));
      },
    };
    const result = await buildProvider(throwing).invoke(invocation());
    expect(result).toStrictEqual({ status: 'unavailable', retryable: true });
  });

  it('14. rejects a malformed response body', async () => {
    for (const bodyText of [
      'not json at all',
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: [{ message: {} }], usage: 'nonsense' }),
      JSON.stringify({}),
    ]) {
      const { transport } = scriptedTransport({ status: 200, retryAfterSeconds: null, bodyText });
      const result = await buildProvider(transport).invoke(invocation());
      expect(['malformed', 'failed']).toContain(result.status);
    }
  });

  it('14b. rejects structured content that is not JSON', async () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('this is not json'),
    });
    const result = await buildProvider(transport).invoke(
      invocation({ resultMode: 'STRUCTURED', structuredJsonSchema: { type: 'object' } }),
    );
    expect(result.status).toBe('malformed');
  });

  it('15. rejects an empty or non-string content, and an unrecognised finish reason', async () => {
    const nullContent = JSON.stringify({
      choices: [{ index: 0, message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
    });
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: nullContent,
    });
    expect((await buildProvider(transport).invoke(invocation())).status).toBe('failed');

    const badFinish = JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi' },
          finish_reason: 'content_filter',
        },
      ],
    });
    const other = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: badFinish,
    });
    expect((await buildProvider(other.transport).invoke(invocation())).status).toBe('failed');
  });

  it('16. never surfaces a raw body, header or key in any result', async () => {
    const secretish = JSON.stringify({ error: { message: SENTINEL_KEY, internal: 'stack trace' } });
    const { transport } = scriptedTransport({
      status: 500,
      retryAfterSeconds: 30,
      bodyText: secretish,
    });
    const result = await buildProvider(transport).invoke(invocation());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SENTINEL_KEY);
    expect(serialized).not.toContain('stack trace');
    expect(serialized).not.toContain('retry-after');
    expect(result).toStrictEqual({ status: 'unavailable', retryable: true });
  });

  it('17. exposes no tool, execution or business-authority surface', () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('x'),
    });
    const provider = buildProvider(transport);
    const surface = [
      ...Object.getOwnPropertyNames(provider),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(provider) as object),
    ];
    // The whole provider contract: a descriptor, capabilities, health, invoke.
    for (const forbidden of [
      'executeTool',
      'callTool',
      'dispatch',
      'approve',
      'authorize',
      'write',
      'query',
      'send',
      'n8n',
    ]) {
      expect(surface).not.toContain(forbidden);
    }
    expect(surface).toContain('invoke');
    expect(surface).toContain('health');
  });

  it('fails health closed without a data-controls attestation', async () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('x'),
    });
    const attested = await buildProvider(transport).health();
    expect(attested).toStrictEqual({ available: true });
    const unattested = await buildProvider(transport, { dataControlsAttested: false }).health();
    expect(unattested).toStrictEqual({ available: false });
  });
});

describe('JF-2A explicit Nara model identity', () => {
  it('refuses every named router alias', () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: '{}',
    });
    for (const alias of NARA_REFUSED_ROUTER_ALIASES) {
      expect(isNaraRouterAlias(alias), alias).toBe(true);
      expect(
        () =>
          createNaraProviderConfig({
            providerId: 'nara',
            modelId: alias,
            modelVersion: 'v1',
            maxInputTokens: 1_000,
            maxCompletionTokens: 100,
            apiKey: createNaraApiKey(SENTINEL_KEY),
            transport,
            dataControlsAttested: true,
          }),
        alias,
      ).toThrow();
    }
  });

  it('refuses alias SHAPES the named list does not enumerate', () => {
    for (const alias of [
      'auto/anything',
      'vendor/auto',
      'AUTO',
      'Bynara',
      'any',
      'vendor/latest',
    ]) {
      expect(isNaraRouterAlias(alias), alias).toBe(true);
    }
  });

  it('accepts an explicit vendor-qualified model id', () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: '{}',
    });
    for (const modelId of ['vendor/test-model-8b', 'meta-llama-3.1-70b', 'vendor/model-v2']) {
      expect(isNaraRouterAlias(modelId), modelId).toBe(false);
      const config = createNaraProviderConfig({
        providerId: 'nara',
        modelId,
        modelVersion: 'v1',
        maxInputTokens: 1_000,
        maxCompletionTokens: 100,
        apiKey: createNaraApiKey(SENTINEL_KEY),
        transport,
        dataControlsAttested: true,
      });
      expect(config.modelId).toBe(modelId);
    }
  });

  it('puts the exact configured model on the wire, never an alias', async () => {
    const { transport, recorded } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: okBody('hi'),
    });
    await buildProvider(transport).invoke(invocation());
    const body = JSON.parse(recorded.requests[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body['model']).toBe(MODEL_ID);
    expect(String(body['model'])).not.toContain('auto');
    expect(String(body['model'])).not.toContain('bynara');
  });

  it('declares no strict JSON-Schema support until it is certified', () => {
    expect(NARA_SUPPORTS_STRICT_JSON_SCHEMA).toBe(false);
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: '{}',
    });
    expect(buildProvider(transport).capabilities().supportsStrictJsonSchema).toBe(false);
    expect(buildProvider(transport).capabilities().supportsStructuredOutput).toBe(true);
  });

  it('requires an injected key holder and transport', () => {
    const { transport } = scriptedTransport({
      status: 200,
      retryAfterSeconds: null,
      bodyText: '{}',
    });
    const base = {
      providerId: 'nara',
      modelId: MODEL_ID,
      modelVersion: 'v1',
      maxInputTokens: 1_000,
      maxCompletionTokens: 100,
      dataControlsAttested: true,
    };
    expect(() =>
      createNaraProviderConfig({
        ...base,
        apiKey: 'a-raw-string' as unknown as NaraApiKey,
        transport,
      }),
    ).toThrow(/NaraApiKey/);
    expect(() =>
      createNaraProviderConfig({
        ...base,
        apiKey: createNaraApiKey(SENTINEL_KEY),
        transport: undefined as unknown as NaraTransport,
      }),
    ).toThrow(/transport/);
    expect(() => createNaraApiKey('')).toThrow();
  });
});
