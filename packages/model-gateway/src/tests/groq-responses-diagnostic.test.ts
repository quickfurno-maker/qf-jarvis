/**
 * The DIAGNOSTIC-ONLY Groq Responses API adapter (POST-MD120B3), asserted offline.
 *
 * Three properties matter here and none of them is "it works":
 *
 * 1. The ENVELOPE is the documented Responses one, and it differs from Chat Completions in exactly
 *    the three ways the endpoint requires — `input`, `max_output_tokens`, `text.format` — and in no
 *    other way. Anything else on the body would be a second variable in a one-variable differential.
 * 2. The ENDPOINT is pinned, in both directions. Neither transport can reach the other's URL, so the
 *    guarantee that the serving path only ever speaks Chat Completions survives this addition.
 * 3. It cannot SERVE. No descriptor, no capabilities, no health, no routing identity — it is an
 *    instrument, and the containment spec in the evidence-live package proves nothing composes it.
 *
 * The transport is deterministic and no network is touched.
 */
import { describe, expect, it } from 'vitest';

import {
  createGroqApiKey,
  createGroqProviderConfig,
  createFetchGroqResponsesTransport,
  createFetchGroqTransport,
  createGroqResponsesDiagnosticProvider,
  createManualClock,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  GROQ_RESPONSES_ENDPOINT,
  type GroqProviderConfig,
  type GroqTransport,
} from '../index.js';
import {
  buildGroqResponsesDiagnosticBody,
  decodeGroqResponsesStructuredValue,
} from '../providers/groq/groq-responses-diagnostic.js';

const SENTINEL_KEY = 'gsk_SENTINEL_test_value_do_not_use_000000';

const SCHEMA = {
  type: 'object',
  properties: { kind: { type: 'string' } },
  required: ['kind'],
  additionalProperties: false,
};

const MESSAGES = [
  { role: 'system' as const, content: 'SYSTEM-BYTES' },
  { role: 'user' as const, content: 'USER-BYTES' },
];

interface RecordedCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly parsedBody: Record<string, unknown>;
}

function harness(respond: () => { status?: number; bodyText: string }): {
  readonly transport: GroqTransport;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    transport: {
      send: (request) => {
        calls.push({
          url: request.url,
          headers: request.headers,
          parsedBody: JSON.parse(request.body) as Record<string, unknown>,
        });
        const result = respond();
        return Promise.resolve({
          status: result.status ?? 200,
          retryAfterSeconds: null,
          bodyText: result.bodyText,
        });
      },
    },
  };
}

function configFor(transport: GroqTransport, maxCompletionTokens = 65_536): GroqProviderConfig {
  return createGroqProviderConfig({
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
    modelVersion: 'groq-catalog-snapshot-2026-08-20',
    executionClass: 'HOSTED',
    maxInputTokens: 131_072,
    maxCompletionTokens,
    supportsStrictJsonSchema: true,
    apiKey: createGroqApiKey(SENTINEL_KEY),
    transport,
    dataControlsAttested: true,
  });
}

function okPayload(text: string, withReasoning = true): string {
  return JSON.stringify({
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    output: [
      ...(withReasoning
        ? [
            {
              type: 'reasoning',
              id: 'rs_1',
              content: [{ type: 'reasoning_text', text: 'REASONING-MUST-NOT-BE-READ' }],
            },
          ]
        : []),
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text }],
      },
    ],
    usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 },
  });
}

describe('the endpoint is pinned in BOTH directions', () => {
  it('the two endpoints are the official, distinct Groq paths', () => {
    expect(GROQ_RESPONSES_ENDPOINT).toBe('https://api.groq.com/openai/v1/responses');
    expect(GROQ_CHAT_COMPLETIONS_ENDPOINT).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(GROQ_RESPONSES_ENDPOINT).not.toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);
  });

  it('the Responses transport refuses any other URL, including the Chat Completions one', async () => {
    // The SSRF guard is the reason this is a second FUNCTION rather than a base-URL parameter on the
    // first: the guarantee comes from each factory naming one constant and refusing everything else.
    const transport = createFetchGroqResponsesTransport();
    const signal = new AbortController().signal;
    for (const url of [
      GROQ_CHAT_COMPLETIONS_ENDPOINT,
      'https://api.groq.com/openai/v1/responses/evil',
      'http://api.groq.com/openai/v1/responses',
      'https://evil.example/openai/v1/responses',
    ]) {
      await expect(transport.send({ url, headers: {}, body: '{}' }, signal)).rejects.toThrow(
        'Refusing a Groq request to a non-official endpoint.',
      );
    }
  });

  it('the PRODUCTION transport refuses the Responses URL', async () => {
    // The serving path cannot be pointed at the diagnostic contract, even by mistake.
    const transport = createFetchGroqTransport();
    await expect(
      transport.send(
        { url: GROQ_RESPONSES_ENDPOINT, headers: {}, body: '{}' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Refusing a Groq request to a non-official endpoint.');
  });

  it('the adapter sends to the Responses endpoint and nowhere else', async () => {
    const wire = harness(() => ({ bodyText: okPayload('{"kind":"K"}') }));
    const provider = createGroqResponsesDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(wire.calls.map((one) => one.url)).toEqual([GROQ_RESPONSES_ENDPOINT]);
  });
});

describe('the envelope differs from Chat Completions in exactly three ways', () => {
  const body = (over: Partial<Parameters<typeof buildGroqResponsesDiagnosticBody>[1]> = {}) =>
    buildGroqResponsesDiagnosticBody(configFor({ send: () => Promise.reject(new Error('x')) }), {
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: new AbortController().signal,
      ...over,
    });

  it('carries `input`, `max_output_tokens` and `text.format` — and their Chat names are absent', () => {
    const built = body() as unknown as Record<string, unknown>;
    expect(built['input']).toEqual(MESSAGES);
    expect(built['max_output_tokens']).toBe(4096);
    expect(built['text']).toEqual({
      format: { type: 'json_schema', name: 'diagnostic_schema', strict: true, schema: SCHEMA },
    });
    for (const chatName of ['messages', 'max_completion_tokens', 'response_format', 'n']) {
      expect(built, chatName).not.toHaveProperty(chatName);
    }
  });

  it('preserves the role sequence and the content bytes exactly', () => {
    const built = body();
    expect(built.input.map((one) => one.role)).toEqual(['system', 'user']);
    expect(built.input.map((one) => one.content)).toEqual(['SYSTEM-BYTES', 'USER-BYTES']);
    // The SAME array, not a rebuilt one: nothing may rewrite, reorder or annotate the turn.
    expect(built.input).toBe(MESSAGES);
  });

  it('sends the schema document VERBATIM and re-derives nothing', () => {
    const built = body();
    expect(built.text.format.schema).toBe(SCHEMA);
    expect(built.text.format.strict).toBe(true);
  });

  it('is stateless and non-streaming, and carries no sampling, tool or state field', () => {
    const built = body() as unknown as Record<string, unknown>;
    expect(built['store']).toBe(false);
    expect(built['stream']).toBe(false);
    for (const forbidden of [
      'temperature',
      'top_p',
      'seed',
      'reasoning',
      'reasoning_effort',
      'service_tier',
      'tools',
      'tool_choice',
      'previous_response_id',
      'background',
      'instructions',
      'metadata',
      'truncation',
    ]) {
      expect(built, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('the output bound can only ever NARROW against the configured ceiling', () => {
    // Same clamp the production adapter applies to its completion cap. A diagnostic cannot ask a
    // model for more than its configuration declares.
    expect(body({ maxOutputTokens: 4096 }).max_output_tokens).toBe(4096);
    expect(body({ maxOutputTokens: 1_000_000 }).max_output_tokens).toBe(65_536);
    expect(body({ maxOutputTokens: 0 }).max_output_tokens).toBe(65_536);
    expect(body({ maxOutputTokens: -1 }).max_output_tokens).toBe(65_536);
  });
});

describe('the decoder reads one document and nothing else', () => {
  it('extracts the assistant `output_text` and SKIPS the reasoning item', () => {
    const decoded = decodeGroqResponsesStructuredValue(okPayload('{"kind":"K"}'));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value).toEqual({ kind: 'K' });
      expect(decoded.usage).toEqual({ inputTokens: 9, outputTokens: 3, totalTokens: 12 });
      // The reasoning trace was present and is not anywhere in what came back.
      expect(JSON.stringify(decoded)).not.toContain('REASONING-MUST-NOT-BE-READ');
    }
  });

  it('concatenates multiple output_text parts of the one message', () => {
    const payload = JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: '{"ki' },
            { type: 'output_text', text: 'nd":"K"}' },
          ],
        },
      ],
    });
    const decoded = decodeGroqResponsesStructuredValue(payload);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value).toEqual({ kind: 'K' });
    }
  });

  it('refuses an incomplete, failed, empty, ambiguous or non-JSON payload', () => {
    const cases = [
      // Truncated by the output bound. `incomplete_details` is never consulted.
      JSON.stringify({ status: 'incomplete', output: [] }),
      JSON.stringify({ status: 'failed', output: [] }),
      // No assistant turn at all — only reasoning.
      JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', content: [] }] }),
      // Two message items: guessing which is the answer is not a thing a diagnostic may do.
      JSON.stringify({
        status: 'completed',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{}' }] },
        ],
      }),
      // A 2xx whose text is not the JSON document the schema demanded. No repair is attempted.
      okPayload('not json at all'),
      'not json at all',
      JSON.stringify(null),
    ];
    for (const payload of cases) {
      expect(decodeGroqResponsesStructuredValue(payload).ok, payload.slice(0, 40)).toBe(false);
    }
  });

  it('tolerates unknown provider keys without calling a real payload malformed', () => {
    const payload = JSON.stringify({
      status: 'completed',
      some_future_key: { nested: true },
      output: [
        {
          type: 'message',
          role: 'assistant',
          another_future_key: 1,
          content: [{ type: 'output_text', text: '{"kind":"K"}', annotations: [] }],
        },
      ],
    });
    expect(decodeGroqResponsesStructuredValue(payload).ok).toBe(true);
  });
});

describe('the adapter reports completion honestly and reads no error body', () => {
  it('a 2xx with a decodable document completes and carries the value', async () => {
    const wire = harness(() => ({ bodyText: okPayload('{"kind":"K"}') }));
    const provider = createGroqResponsesDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(result.providerCompleted).toBe(true);
    expect(result.structuredValue).toEqual({ kind: 'K' });
  });

  it('every non-2xx does NOT complete, and the error body is never parsed', async () => {
    for (const status of [400, 401, 403, 404, 413, 422, 429, 500]) {
      const wire = harness(() => ({
        status,
        bodyText: JSON.stringify({
          error: {
            type: 'invalid_request_error',
            code: 'json_validate_failed',
            failed_generation: 'MUST-NOT-BE-READ',
          },
        }),
      }));
      const provider = createGroqResponsesDiagnosticProvider(
        configFor(wire.transport),
        createManualClock(0),
      );
      const result = await provider.invoke({
        messages: MESSAGES,
        structuredJsonSchema: SCHEMA,
        schemaName: 'diagnostic_schema',
        maxOutputTokens: 4096,
        signal: new AbortController().signal,
      });
      expect(result.providerCompleted).toBe(false);
      // The result has no field an error body could occupy.
      expect(result.structuredValue).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('MUST-NOT-BE-READ');
    }
  });

  it('sends EXACTLY ONE request and never retries', async () => {
    const wire = harness(() => ({ status: 429, bodyText: '{}' }));
    const provider = createGroqResponsesDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(wire.calls).toHaveLength(1);
  });

  it('an already-aborted signal sends nothing at all', async () => {
    const wire = harness(() => ({ bodyText: okPayload('{}') }));
    const provider = createGroqResponsesDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    const controller = new AbortController();
    controller.abort();
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: controller.signal,
    });
    expect(result.providerCompleted).toBe(false);
    expect(wire.calls).toHaveLength(0);
  });

  it('a transport throw does not complete and the thrown object is never read', async () => {
    const transport: GroqTransport = {
      send: () => Promise.reject(new Error('TRANSPORT-DETAIL-MUST-NOT-BE-READ')),
    };
    const provider = createGroqResponsesDiagnosticProvider(
      configFor(transport),
      createManualClock(0),
    );
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: new AbortController().signal,
    });
    expect(result.providerCompleted).toBe(false);
    expect(JSON.stringify(result)).not.toContain('TRANSPORT-DETAIL-MUST-NOT-BE-READ');
  });

  it('the credential reaches the header and nothing else', async () => {
    const wire = harness(() => ({ bodyText: okPayload('{"kind":"K"}') }));
    const provider = createGroqResponsesDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      schemaName: 'diagnostic_schema',
      maxOutputTokens: 4096,
      signal: new AbortController().signal,
    });
    const call = wire.calls[0];
    expect(call?.headers['authorization']).toContain(SENTINEL_KEY);
    expect(JSON.stringify(call?.parsedBody)).not.toContain(SENTINEL_KEY);
    expect(JSON.stringify(result)).not.toContain(SENTINEL_KEY);
  });
});
