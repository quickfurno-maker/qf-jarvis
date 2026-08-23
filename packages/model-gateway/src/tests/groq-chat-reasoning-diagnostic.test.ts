/**
 * The DIAGNOSTIC-ONLY Chat Completions reasoning-effort adapter, asserted offline.
 *
 * Two properties carry this file:
 *
 * 1. **Production still sends no reasoning field.** That absence was pinned deliberately, and the
 *    whole authorization for this adapter rests on it staying true.
 * 2. **The diagnostic body is the production body plus exactly one key.** Asserted by comparing the
 *    two key sets, so "one variable" is a property of the code rather than a claim in a comment.
 *
 * The transport is deterministic and no network is touched.
 */
import { describe, expect, it } from 'vitest';

import {
  createGroqApiKey,
  createGroqProviderConfig,
  createManualClock,
  GroqModelProvider,
  GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT,
  createGroqChatReasoningDiagnosticProvider,
  type GroqChatReasoningDiagnosticProvider,
  type GroqProviderConfig,
  type GroqTransport,
} from '../index.js';
import {
  buildGroqChatReasoningDiagnosticBody,
  GROQ_GPT_OSS_REASONING_EFFORTS,
} from '../providers/groq/groq-chat-reasoning-diagnostic.js';

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

function configFor(transport: GroqTransport): GroqProviderConfig {
  return createGroqProviderConfig({
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
    modelVersion: 'groq-catalog-snapshot-2026-08-20',
    executionClass: 'HOSTED',
    maxInputTokens: 131_072,
    maxCompletionTokens: 65_536,
    supportsStrictJsonSchema: true,
    apiKey: createGroqApiKey(SENTINEL_KEY),
    transport,
    dataControlsAttested: true,
  });
}

const okBody = JSON.stringify({
  id: 'chatcmpl-1',
  model: 'openai/gpt-oss-20b',
  choices: [
    { index: 0, message: { role: 'assistant', content: '{"kind":"K"}' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 4_211, completion_tokens: 3_998, total_tokens: 8_209 },
});

describe('PRODUCTION still sends no reasoning field', () => {
  it('the production adapter body carries no reasoning key of any spelling', async () => {
    // The absence this whole diagnostic is built around. If production ever started sending one,
    // the "single variable" claim would be false and the future probe would measure nothing.
    const wire = harness(() => ({ bodyText: okBody }));
    const provider = new GroqModelProvider(configFor(wire.transport), createManualClock(0));
    await provider.invoke({
      runId: 'r1',
      messages: MESSAGES,
      resultMode: 'STRUCTURED',
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });
    const body = wire.calls[0]?.parsedBody ?? {};
    for (const forbidden of [
      'reasoning',
      'reasoning_effort',
      'reasoning_format',
      'include_reasoning',
    ]) {
      expect(body, forbidden).not.toHaveProperty(forbidden);
    }
  });
});

describe('the DIAGNOSTIC body is the production body plus exactly one key', () => {
  it('the key sets differ by `reasoning_effort` and nothing else', async () => {
    const productionWire = harness(() => ({ bodyText: okBody }));
    const production = new GroqModelProvider(
      configFor(productionWire.transport),
      createManualClock(0),
    );
    await production.invoke({
      runId: 'r1',
      messages: MESSAGES,
      resultMode: 'STRUCTURED',
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });
    const productionBody = productionWire.calls[0]?.parsedBody ?? {};

    const diagnosticWire = harness(() => ({ bodyText: okBody }));
    const diagnostic = createGroqChatReasoningDiagnosticProvider(
      configFor(diagnosticWire.transport),
      createManualClock(0),
    );
    await diagnostic.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      reasoningEffort: 'low',
      signal: new AbortController().signal,
    });
    const diagnosticBody = diagnosticWire.calls[0]?.parsedBody ?? {};

    // THE assertion. One added key, nothing removed, nothing renamed.
    const added = Object.keys(diagnosticBody).filter((key) => !(key in productionBody));
    const removed = Object.keys(productionBody).filter((key) => !(key in diagnosticBody));
    expect(added).toStrictEqual(['reasoning_effort']);
    expect(removed).toStrictEqual([]);

    // And every shared field is byte-identical, so the variable really is alone.
    for (const key of Object.keys(productionBody)) {
      expect(JSON.stringify(diagnosticBody[key]), key).toBe(JSON.stringify(productionBody[key]));
    }
    expect(diagnosticBody['reasoning_effort']).toBe('low');
    expect(diagnosticWire.calls[0]?.url).toBe(productionWire.calls[0]?.url);
  });

  it('holds the model, budget, strict schema and non-streaming posture', () => {
    const body = buildGroqChatReasoningDiagnosticBody(
      configFor({ send: () => Promise.reject(new Error('x')) }),
      {
        messages: MESSAGES,
        structuredJsonSchema: SCHEMA,
        maxCompletionTokens: 4096,
        reasoningEffort: 'low',
        signal: new AbortController().signal,
      },
    );
    expect(body).toBeDefined();
    if (body === undefined) {
      return;
    }
    expect(body.model).toBe('openai/gpt-oss-20b');
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.stream).toBe(false);
    expect(body.n).toBe(1);
    expect(body.messages).toBe(MESSAGES);
    expect(body.response_format?.type).toBe('json_schema');
  });

  it('carries no sampling, tool or reasoning-CONTENT field', () => {
    // Effort only. This controls how much the model thinks, never what it thought.
    const body = buildGroqChatReasoningDiagnosticBody(
      configFor({ send: () => Promise.reject(new Error('x')) }),
      {
        messages: MESSAGES,
        structuredJsonSchema: SCHEMA,
        maxCompletionTokens: 4096,
        reasoningEffort: 'low',
        signal: new AbortController().signal,
      },
    ) as unknown as Record<string, unknown>;
    for (const forbidden of [
      'temperature',
      'top_p',
      'seed',
      'tools',
      'tool_choice',
      'include_reasoning',
      'reasoning_format',
      'service_tier',
      'stop',
    ]) {
      expect(body, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('the budget can only ever NARROW against the configured ceiling', () => {
    const build = (requested: number): number | undefined =>
      buildGroqChatReasoningDiagnosticBody(
        configFor({ send: () => Promise.reject(new Error('x')) }),
        {
          messages: MESSAGES,
          structuredJsonSchema: SCHEMA,
          maxCompletionTokens: requested,
          reasoningEffort: 'low',
          signal: new AbortController().signal,
        },
      )?.max_completion_tokens;
    expect(build(4096)).toBe(4096);
    expect(build(1_000_000)).toBe(65_536);
    expect(build(0)).toBe(65_536);
  });
});

describe('the reasoning vocabulary and the documented default', () => {
  it('names exactly the three documented efforts', () => {
    expect([...GROQ_GPT_OSS_REASONING_EFFORTS]).toStrictEqual(['low', 'medium', 'high']);
  });

  it('records the OMITTED default as medium, without claiming the wire carried it', () => {
    // The distinction matters for reading historical evidence: NRA1's wire OMITTED the field. It did
    // not carry 'medium'. This constant records what the provider applies to an omitted field today.
    expect(GROQ_GPT_OSS_DOCUMENTED_DEFAULT_REASONING_EFFORT).toBe('medium');
  });
});

describe('provider-reported usage travels onward — the point of this path', () => {
  it('a completed call returns the provider usage rather than discarding it', async () => {
    // The historical diagnostics settled their ledgers with `undefined` and could never say what was
    // generated. This adapter returns the gateway's own provider-neutral usage.
    const wire = harness(() => ({ bodyText: okBody }));
    const provider = createGroqChatReasoningDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      reasoningEffort: 'low',
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      return;
    }
    expect(result.usage?.inputTokens).toBe(4_211);
    expect(result.usage?.outputTokens).toBe(3_998);
  });

  it('a 400 json_validate_failed normalizes exactly as production does, and leaks nothing', async () => {
    const wire = harness(() => ({
      status: 400,
      bodyText: JSON.stringify({
        error: {
          type: 'invalid_request_error',
          code: 'json_validate_failed',
          message: 'MUST-NOT-BE-READ',
          failed_generation: 'MUST-NOT-BE-READ',
        },
      }),
    }));
    const provider = createGroqChatReasoningDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      reasoningEffort: 'low',
      signal: new AbortController().signal,
    });
    // The SAME governed mapping: json_validate_failed is provider-output-invalid, not a rejected
    // request. It carries no usage, which is why the ledger must fall back and SAY it fell back.
    expect(result.status).toBe('malformed');
    expect(JSON.stringify(result)).not.toContain('MUST-NOT-BE-READ');
  });

  it('sends exactly one request and never retries', async () => {
    const wire = harness(() => ({ status: 429, bodyText: '{}' }));
    const provider = createGroqChatReasoningDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      reasoningEffort: 'low',
      signal: new AbortController().signal,
    });
    expect(wire.calls).toHaveLength(1);
  });

  it('an already-aborted signal sends nothing', async () => {
    const wire = harness(() => ({ bodyText: okBody }));
    const provider = createGroqChatReasoningDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(0),
    );
    const controller = new AbortController();
    controller.abort();
    const result = await provider.invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      reasoningEffort: 'low',
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
    expect(wire.calls).toHaveLength(0);
  });
});

describe('RESPONSE CLASSIFICATION PARITY — the diagnostic normalizes exactly as production does', () => {
  /** Run one synthetic HTTP-200 body through BOTH adapters and return their normalized results. */
  async function bothAdapters(bodyText: string): Promise<{
    readonly production: Awaited<ReturnType<GroqModelProvider['invoke']>>;
    readonly diagnostic: Awaited<ReturnType<GroqChatReasoningDiagnosticProvider['invoke']>>;
  }> {
    const productionWire = harness(() => ({ bodyText }));
    const production = await new GroqModelProvider(
      configFor(productionWire.transport),
      createManualClock(0),
    ).invoke({
      runId: 'r1',
      messages: MESSAGES,
      resultMode: 'STRUCTURED',
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });
    const diagnosticWire = harness(() => ({ bodyText }));
    const diagnostic = await createGroqChatReasoningDiagnosticProvider(
      configFor(diagnosticWire.transport),
      createManualClock(0),
    ).invoke({
      messages: MESSAGES,
      structuredJsonSchema: SCHEMA,
      maxCompletionTokens: 4096,
      reasoningEffort: 'low',
      signal: new AbortController().signal,
    });
    return { production, diagnostic };
  }

  const choice = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    index: 0,
    message: { role: 'assistant', content: '{"kind":"K"}' },
    finish_reason: 'stop',
    ...over,
  });
  const envelope = (choices: readonly unknown[]): string =>
    JSON.stringify({ id: 'chatcmpl-1', model: 'openai/gpt-oss-20b', choices });

  it('REGRESSION: a parsed 200 with MULTIPLE choices is failed/non-retryable in BOTH', async () => {
    // The defect owner review found. An earlier revision collapsed the schema failure and the
    // choice-count check into one `malformed` return, so this body normalized differently in the
    // two adapters -- a difference `reasoning_effort` had not caused, in the one diagnostic whose
    // entire value is that reasoning effort is the only variable.
    const { production, diagnostic } = await bothAdapters(
      envelope([choice(), choice({ index: 1 })]),
    );
    expect(production.status).toBe('failed');
    expect(diagnostic.status).toBe('failed');
    if (production.status === 'failed' && diagnostic.status === 'failed') {
      expect(production.retryable).toBe(false);
      expect(diagnostic.retryable).toBe(false);
    }
    expect(diagnostic.status).toBe(production.status);
  });

  it('the shared 200-body classifications agree, case for case', async () => {
    const cases: readonly { readonly name: string; readonly bodyText: string }[] = [
      // Not a Groq chat envelope at all.
      { name: 'unparseable envelope', bodyText: JSON.stringify({ nope: true }) },
      // Zero choices: parses, but is not one choice.
      { name: 'zero choices', bodyText: envelope([]) },
      { name: 'two choices', bodyText: envelope([choice(), choice({ index: 1 })]) },
      {
        name: 'non-string content',
        bodyText: envelope([choice({ message: { role: 'assistant', content: 42 } })]),
      },
      {
        name: 'unaccepted finish reason',
        bodyText: envelope([choice({ finish_reason: 'content_filter' })]),
      },
    ];
    for (const one of cases) {
      const { production, diagnostic } = await bothAdapters(one.bodyText);
      expect(diagnostic.status, one.name).toBe(production.status);
      if (production.status === 'failed' && diagnostic.status === 'failed') {
        expect(diagnostic.retryable, one.name).toBe(production.retryable);
      }
    }
  });

  it('a well-formed single-choice 200 completes in both, and only usage differs by design', async () => {
    // The positive control. If the two disagreed here the parity claim would be vacuous.
    const { production, diagnostic } = await bothAdapters(okBody);
    expect(production.status).toBe('completed');
    expect(diagnostic.status).toBe('completed');
  });
});
