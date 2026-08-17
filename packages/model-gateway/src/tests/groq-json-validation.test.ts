/**
 * QFJ-S2-E-C-R3 — Groq strict JSON Schema output and `json_validate_failed` classification.
 *
 * Two live SHADOW runs each produced a stable HTTP 200 and a candidate HTTP 400 that Groq's dashboard
 * labelled `json_validate_failed`, both after exactly `max_completion_tokens` output tokens, on
 * byte-identical requests. That 400 was reaching the generic client-rejection bucket, which tells an
 * operator to audit a credential that had just worked.
 *
 * Every test is offline: a synthetic transport that performs no I/O, and a synthetic key. **No network,
 * no real credential, no provider SDK.**
 */
import { describe, expect, it } from 'vitest';

import { createGroqApiKey } from '../providers/groq/groq-secret.js';
import { createGroqProviderConfig } from '../providers/groq/groq-config.js';
import { GroqModelProvider } from '../providers/groq/groq-model-provider.js';
import {
  normalizeGroqHttpFailure,
  normalizeGroqHttpStatus,
} from '../providers/groq/groq-error-normalization.js';
import { buildResponseFormat } from '../providers/groq/groq-structured-output.js';
import { createSystemClock } from '../reliability/clock.js';
import type {
  GroqHttpRequest,
  GroqHttpResponse,
  GroqTransport,
} from '../providers/groq/groq-transport.js';

const FAKE_KEY = 'FAKE_QFJ_TEST_KEY_DO_NOT_USE_S2ECR3';

/** The exact tiny schema the controlled SHADOW request carries. */
const TINY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { status: { type: 'string', const: 'ok' } },
  required: ['status'],
  additionalProperties: false,
} as const;

function capturing(response: GroqHttpResponse): {
  transport: GroqTransport;
  sent: () => GroqHttpRequest | undefined;
} {
  let sent: GroqHttpRequest | undefined;
  return {
    transport: {
      send: (request): Promise<GroqHttpResponse> => {
        sent = request;
        return Promise.resolve(response);
      },
    },
    sent: () => sent,
  };
}

function providerWith(transport: GroqTransport, strict = true): GroqModelProvider {
  return new GroqModelProvider(
    createGroqProviderConfig({
      providerId: 'groq.test.candidate',
      modelId: 'synthetic/test-model',
      modelVersion: 'synthetic-catalog-v1',
      maxInputTokens: 4096,
      maxCompletionTokens: 256,
      supportsStrictJsonSchema: strict,
      apiKey: createGroqApiKey(FAKE_KEY),
      transport,
      dataControlsAttested: true,
    }),
    createSystemClock(),
  );
}

const structuredInput = (schema: unknown = TINY_SCHEMA) => ({
  runId: 'run.test.1',
  messages: [{ role: 'user' as const, content: 'synthetic probe' }],
  resultMode: 'STRUCTURED' as const,
  timeoutMs: 30_000,
  signal: new AbortController().signal,
  structuredJsonSchema: schema,
});

const okBody = JSON.stringify({
  choices: [{ message: { content: '{"status":"ok"}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 247, completion_tokens: 12 },
});

/** The regression fixture: exactly what Groq returned on both failed candidate legs. */
const JSON_VALIDATE_FAILED_BODY = JSON.stringify({
  error: {
    message: 'synthetic placeholder — never read by the adapter',
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    failed_generation: 'synthetic placeholder — never read by the adapter',
  },
});

describe('(1-4) the strict structured-output request', () => {
  it('(1, 4) emits response_format.json_schema with strict = true', async () => {
    const cap = capturing({ status: 200, retryAfterSeconds: null, bodyText: okBody });
    const result = await providerWith(cap.transport).invoke(structuredInput());
    expect(result.status).toBe('completed');
    const body = JSON.parse(cap.sent()?.body ?? '{}') as Record<string, unknown>;
    const rf = body['response_format'] as { type: string; json_schema: Record<string, unknown> };
    expect(rf.type).toBe('json_schema');
    expect(rf.json_schema['strict']).toBe(true);
    expect(rf.json_schema['name']).toBe('qf_structured_output');
    // MVP-P2A.2 HF4-R7: the sent document is the PROJECTION of `TINY_SCHEMA`, not the schema itself.
    // This assertion used to require them to be byte-identical, which is exactly the behaviour RUN S9
    // proved wrong: `$schema` and `const` are not in Groq's documented strict subset and were being
    // forwarded because nothing constrained the keyword set. The structural meaning is unchanged —
    // `const: 'ok'` becomes the singleton `enum: ['ok']` the docs establish, and the root meta
    // annotation is dropped.
    expect(rf.json_schema['schema']).toEqual({
      type: 'object',
      properties: { status: { type: 'string', enum: ['ok'] } },
      required: ['status'],
      additionalProperties: false,
    });
    // The caller's document is untouched, so the local schema it came from is unaffected.
    expect(TINY_SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('(2, 3) the schema requires every property and forbids additional ones', () => {
    const properties = Object.keys(TINY_SCHEMA.properties);
    expect([...TINY_SCHEMA.required]).toEqual(properties);
    expect(TINY_SCHEMA.additionalProperties).toBe(false);
    expect(TINY_SCHEMA.type).toBe('object');
    const built = buildResponseFormat(TINY_SCHEMA, true);
    expect(built.ok).toBe(true);
  });

  it('(8, 9) max_completion_tokens and the reasoning settings are unchanged', async () => {
    const cap = capturing({ status: 200, retryAfterSeconds: null, bodyText: okBody });
    await providerWith(cap.transport).invoke(structuredInput());
    const body = JSON.parse(cap.sent()?.body ?? '{}') as Record<string, unknown>;
    expect(body['max_completion_tokens']).toBe(256);
    // This slice deliberately changes NO generation parameter.
    expect(body['reasoning_effort']).toBeUndefined();
    expect(body['reasoning_format']).toBeUndefined();
    expect(body['include_reasoning']).toBeUndefined();
    expect(body['temperature']).toBeUndefined();
    expect(body['stream']).toBe(false);
    expect(body['n']).toBe(1);
  });

  it('(5, 6, 7) text mode, best-effort JSON mode and schema rejection are unchanged', async () => {
    // TEXT mode sends no response_format at all.
    const text = capturing({
      status: 200,
      retryAfterSeconds: null,
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'plain' }, finish_reason: 'stop' }],
        usage: {},
      }),
    });
    await providerWith(text.transport).invoke({
      ...structuredInput(),
      resultMode: 'TEXT',
      structuredJsonSchema: undefined,
    } as unknown as ReturnType<typeof structuredInput>);
    const textBody = JSON.parse(text.sent()?.body ?? '{}') as Record<string, unknown>;
    expect(textBody['response_format']).toBeUndefined();

    // Best-effort: capability says strict is unsupported -> json_object, no schema on the wire.
    const loose = capturing({ status: 200, retryAfterSeconds: null, bodyText: okBody });
    await providerWith(loose.transport, false).invoke(structuredInput());
    const looseBody = JSON.parse(loose.sent()?.body ?? '{}') as Record<string, unknown>;
    expect(looseBody['response_format']).toEqual({ type: 'json_object' });

    // A non-strict-compatible schema still fails BEFORE any transport call.
    const never = capturing({ status: 200, retryAfterSeconds: null, bodyText: okBody });
    const rejected = await providerWith(never.transport).invoke(
      structuredInput({ type: 'object' }),
    );
    expect(rejected.status).toBe('failed');
    expect(never.sent()).toBeUndefined();
  });
});

describe('(10, 11) the json_validate_failed classification', () => {
  it('(10) HTTP 400 with the closed code becomes `malformed`, not `failed`', async () => {
    const cap = capturing({
      status: 400,
      retryAfterSeconds: null,
      bodyText: JSON_VALIDATE_FAILED_BODY,
    });
    const result = await providerWith(cap.transport).invoke(structuredInput());
    expect(result.status).toBe('malformed');
    // `malformed` carries a latency and nothing else — no message, no body, no status.
    expect(Object.keys(result).sort()).toEqual(['latencyMs', 'status']);
  });

  it('(11) HTTP 400 WITHOUT the code keeps the existing client-rejection mapping', async () => {
    for (const bodyText of [
      '',
      'not json at all',
      JSON.stringify({ error: { code: 'something_else', message: 'x' } }),
      JSON.stringify({ error: { message: 'no code field' } }),
      JSON.stringify({ error: 'a string, not an object' }),
      JSON.stringify({ code: 'json_validate_failed_but_nested_wrongly_elsewhere' }),
      JSON.stringify(null),
      JSON.stringify([1, 2, 3]),
    ]) {
      const cap = capturing({ status: 400, retryAfterSeconds: null, bodyText });
      const result = await providerWith(cap.transport).invoke(structuredInput());
      expect(result.status).toBe('failed');
    }
  });

  it('the code is honoured only on 400, and a top-level code is also accepted', () => {
    expect(normalizeGroqHttpFailure(400, JSON_VALIDATE_FAILED_BODY, 7)).toEqual({
      status: 'malformed',
      latencyMs: 7,
    });
    expect(
      normalizeGroqHttpFailure(400, JSON.stringify({ code: 'json_validate_failed' }), 7),
    ).toEqual({ status: 'malformed', latencyMs: 7 });
    // The same code on any other status must NOT hijack that status's meaning.
    for (const status of [401, 403, 404, 422, 429, 500, 503]) {
      expect(normalizeGroqHttpFailure(status, JSON_VALIDATE_FAILED_BODY, 7)).toEqual(
        normalizeGroqHttpStatus(status),
      );
    }
  });

  it('no message, failed_generation, body or status escapes the adapter', async () => {
    const cap = capturing({
      status: 400,
      retryAfterSeconds: null,
      bodyText: JSON.stringify({
        error: {
          message: 'ZZSECRETMESSAGESENTINEL',
          code: 'json_validate_failed',
          failed_generation: 'ZZFAILEDGENERATIONSENTINEL',
          request_id: 'ZZREQUESTIDSENTINEL',
        },
      }),
    });
    const result = await providerWith(cap.transport).invoke(structuredInput());
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('ZZSECRETMESSAGESENTINEL');
    expect(serialised).not.toContain('ZZFAILEDGENERATIONSENTINEL');
    expect(serialised).not.toContain('ZZREQUESTIDSENTINEL');
    expect(serialised).not.toContain('400');
    expect(serialised).not.toContain('json_validate_failed');
    expect(serialised).not.toContain(FAKE_KEY);
  });
});

describe('(12, 13, 14) every other mapping is untouched', () => {
  it('(12, 13) 429 stays rate-limited and 5xx stays unavailable', () => {
    expect(normalizeGroqHttpFailure(429, '', 0)).toEqual({ status: 'rate-limited' });
    for (const status of [500, 502, 503, 504, 498]) {
      expect(normalizeGroqHttpFailure(status, '', 0)).toEqual({
        status: 'unavailable',
        retryable: true,
      });
    }
    expect(normalizeGroqHttpFailure(499, '', 0)).toEqual({ status: 'cancelled' });
  });

  it('401, 403, 404, 413 and 422 stay non-retryable failures', () => {
    for (const status of [400, 401, 403, 404, 408, 409, 413, 422]) {
      expect(normalizeGroqHttpFailure(status, '', 0)).toEqual({
        status: 'failed',
        retryable: false,
      });
    }
  });

  it('(14) a transport rejection is still unavailable, and adds no retry', async () => {
    const transport: GroqTransport = {
      send: () => Promise.reject(new Error('QFJ_TEST_SYNTHETIC_REJECTION')),
    };
    const result = await providerWith(transport).invoke(structuredInput());
    expect(result).toEqual({ status: 'unavailable', retryable: true });
  });

  it('a malformed 200 body still yields malformed', async () => {
    const cap = capturing({
      status: 200,
      retryAfterSeconds: null,
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'not the required json' }, finish_reason: 'stop' }],
        usage: {},
      }),
    });
    const result = await providerWith(cap.transport).invoke(structuredInput());
    expect(result.status).toBe('malformed');
  });

  it('the adapter still performs exactly ONE request and never retries', async () => {
    let calls = 0;
    const transport: GroqTransport = {
      send: () => {
        calls += 1;
        return Promise.resolve({
          status: 400,
          retryAfterSeconds: null,
          bodyText: JSON_VALIDATE_FAILED_BODY,
        });
      },
    };
    await providerWith(transport).invoke(structuredInput());
    expect(calls).toBe(1);
  });
});
