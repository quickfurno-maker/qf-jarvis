/**
 * Phase 1 OpenAI Responses API adapter.
 *
 * Deterministic only: no network and no real credential. This proves the adapter stays inference-only,
 * sends store:false, has no tools/web/file-search surface, and remains behind ModelGateway contracts.
 */
import { describe, expect, it } from 'vitest';

import {
  OpenAIApiKey,
  OpenAIModelProvider,
  OPENAI_RESPONSES_ENDPOINT,
  createFetchOpenAITransport,
  createManualClock,
  createOpenAIApiKey,
  createOpenAIProviderConfig,
  type OpenAIProviderConfigInput,
  type OpenAITransport,
  type ProviderInvocationInput,
} from '../index.js';

const SENTINEL = 'sk-synthetic-openai-phase1-not-real-000000';

interface RecordedCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Record<string, unknown>;
}

function responseBody(text: string, status = 'completed'): string {
  return JSON.stringify({
    id: 'resp_test',
    model: 'gpt-test',
    status,
    output: [
      { type: 'reasoning', id: 'reasoning_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
  });
}

function harness(bodyText = responseBody('hello')): {
  transport: OpenAITransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      send(request) {
        calls.push({
          url: request.url,
          headers: request.headers,
          body: JSON.parse(request.body) as Record<string, unknown>,
        });
        return Promise.resolve({ status: 200, bodyText });
      },
    },
  };
}

function config(transport: OpenAITransport, over: Partial<OpenAIProviderConfigInput> = {}) {
  return createOpenAIProviderConfig({
    providerId: 'openai',
    modelId: 'gpt-6-luna',
    modelVersion: '2026-09',
    maxInputTokens: 1_000_000,
    maxCompletionTokens: 2048,
    supportsStrictJsonSchema: true,
    apiKey: createOpenAIApiKey(SENTINEL),
    transport,
    dataControlsAttested: true,
    ...over,
  });
}

function input(over: Partial<ProviderInvocationInput> = {}): ProviderInvocationInput {
  return {
    runId: 'run-openai-1',
    messages: [{ role: 'user', content: 'hello' }],
    resultMode: 'TEXT',
    timeoutMs: 5000,
    signal: new AbortController().signal,
    ...over,
  };
}

describe('OpenAI API key holder', () => {
  it('redacts and validates the injected key', () => {
    expect(() => createOpenAIApiKey('')).toThrow();
    const key = createOpenAIApiKey(SENTINEL);
    expect(key).toBeInstanceOf(OpenAIApiKey);
    expect(String(key)).toBe('[REDACTED_OPENAI_API_KEY]');
    expect(JSON.stringify({ key })).not.toContain(SENTINEL);
    expect(key.authorizationHeaderValue()).toBe('Bearer ' + SENTINEL);
  });
});

describe('OpenAI provider configuration', () => {
  it('is hosted, frozen, strict-structured and fail-closed on data controls', async () => {
    const h = harness();
    const good = config(h.transport);
    expect(Object.isFrozen(good)).toBe(true);
    expect(good.capabilities.executionClass).toBe('HOSTED');
    expect(good.capabilities.supportsStructuredOutput).toBe(true);
    expect(good.capabilities.supportsStrictJsonSchema).toBe(true);
    expect(await new OpenAIModelProvider(good, createManualClock()).health()).toEqual({
      available: true,
    });

    const closed = config(h.transport, { dataControlsAttested: false });
    expect(await new OpenAIModelProvider(closed, createManualClock()).health()).toEqual({
      available: false,
    });
  });

  it('pins the canonical OpenAI identity and typed key/transport', () => {
    const h = harness();
    expect(() =>
      createOpenAIProviderConfig({
        providerId: 'openai',
        modelId: 'gpt-6-luna',
        modelVersion: '2026-09',
        maxInputTokens: 1_000_000,
        maxCompletionTokens: 2048,
        supportsStrictJsonSchema: true,
        apiKey: SENTINEL as unknown as OpenAIApiKey,
        transport: h.transport,
        dataControlsAttested: true,
      }),
    ).toThrow();
  });
});

describe('OpenAI fixed transport', () => {
  it('exposes only the official Responses API endpoint and refuses another URL', async () => {
    expect(OPENAI_RESPONSES_ENDPOINT).toBe('https://api.openai.com/v1/responses');
    await expect(
      createFetchOpenAITransport().send(
        { url: 'https://evil.example/v1/responses', headers: {}, body: '{}' },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  });
});

describe('OpenAIModelProvider request mapping', () => {
  it('uses Responses API, store:false, a bounded output, and no tools/search surface', async () => {
    const h = harness();
    const provider = new OpenAIModelProvider(config(h.transport), createManualClock());
    await provider.invoke(input({ maxCompletionTokens: 512 }));

    expect(h.calls).toHaveLength(1);
    const call = h.calls[0];
    expect(call?.url).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(call?.headers['authorization']).toBe('Bearer ' + SENTINEL);
    expect(call?.body).toMatchObject({
      model: 'gpt-6-luna',
      input: [{ role: 'user', content: 'hello' }],
      max_output_tokens: 512,
      store: false,
    });
    for (const forbidden of [
      'tools',
      'tool_choice',
      'web_search',
      'file_search',
      'functions',
      'previous_response_id',
      'conversation',
    ]) {
      expect(call?.body).not.toHaveProperty(forbidden);
    }
  });

  it('maps structured mode to strict text.format json_schema', async () => {
    const h = harness(responseBody('{"answer":"yes"}'));
    const provider = new OpenAIModelProvider(config(h.transport), createManualClock());
    const schema = {
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    };
    const result = await provider.invoke(
      input({ resultMode: 'STRUCTURED', structuredJsonSchema: schema }),
    );

    expect(h.calls[0]?.body).toMatchObject({
      text: {
        format: {
          type: 'json_schema',
          name: 'qf_jarvis_response',
          strict: true,
          schema,
        },
      },
    });
    expect(result).toMatchObject({
      status: 'completed',
      output: { mode: 'STRUCTURED', value: { answer: 'yes' } },
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
  });

  it('fails before network if structured mode has no schema', async () => {
    const h = harness();
    const provider = new OpenAIModelProvider(config(h.transport), createManualClock());
    expect(await provider.invoke(input({ resultMode: 'STRUCTURED' }))).toEqual({
      status: 'failed',
      retryable: false,
    });
    expect(h.calls).toHaveLength(0);
  });
});

describe('OpenAIModelProvider response safety', () => {
  it('ignores reasoning items and returns output_text only', async () => {
    const h = harness(responseBody('safe answer'));
    const result = await new OpenAIModelProvider(config(h.transport), createManualClock()).invoke(
      input(),
    );
    expect(result).toMatchObject({
      status: 'completed',
      output: { mode: 'TEXT', text: 'safe answer' },
    });
  });

  it('fails closed on refusal, incomplete, malformed JSON, or missing text', async () => {
    const refusal = JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'refusal', refusal: 'cannot comply' }],
        },
      ],
    });
    const incomplete = responseBody('', 'incomplete');
    const missing = JSON.stringify({ status: 'completed', output: [{ type: 'reasoning' }] });

    for (const [body, expected] of [
      [refusal, 'failed'],
      [incomplete, 'malformed'],
      ['not-json', 'malformed'],
      [missing, 'malformed'],
    ] as const) {
      const h = harness(body);
      const result = await new OpenAIModelProvider(config(h.transport), createManualClock()).invoke(
        input(),
      );
      expect(result.status).toBe(expected);
    }
  });

  it('normalizes rate limits, server failure, network failure and cancellation', async () => {
    const transportFor = (status: number): OpenAITransport => ({
      send() {
        return Promise.resolve({ status, bodyText: '{}' });
      },
    });
    const clock = createManualClock();

    expect(await new OpenAIModelProvider(config(transportFor(429)), clock).invoke(input())).toEqual(
      { status: 'rate-limited' },
    );
    expect(await new OpenAIModelProvider(config(transportFor(503)), clock).invoke(input())).toEqual(
      { status: 'unavailable', retryable: true },
    );

    const throwing: OpenAITransport = {
      send() {
        return Promise.reject(new Error('synthetic network failure'));
      },
    };
    expect(await new OpenAIModelProvider(config(throwing), clock).invoke(input())).toEqual({
      status: 'unavailable',
      retryable: true,
    });

    const controller = new AbortController();
    controller.abort();
    expect(
      await new OpenAIModelProvider(config(harness().transport), clock).invoke(
        input({ signal: controller.signal }),
      ),
    ).toEqual({ status: 'cancelled' });
  });
});
