/**
 * POST-RBD1 — the DIAGNOSTIC-ONLY best-effort `json_schema` adapter, asserted OFFLINE.
 *
 * RLD1 and RBD1 both met `json_validate_failed` under `json_schema.strict: true`, at 4,096 and at
 * 8,192. The open axis is the CONSTRAINED DECODING posture, and this adapter is what moves it.
 *
 * ### The central assertion is a DIFF of two built bodies
 *
 * The best-effort body is built by DERIVING from the reasoning-effort body and flipping one leaf, so
 * the two are compared here recursively: exactly one changed leaf path,
 * `response_format.json_schema.strict`, and nothing added or removed anywhere.
 *
 * ### And the trap this adapter exists to avoid is asserted directly
 *
 * `buildResponseFormat(schema, false)` — production's non-strict branch — returns
 * `{ type: 'json_object' }`, which drops the schema NAME and the schema BODY along with the flag.
 * Using it would have changed four things at once and answered a different, much weaker question.
 * A spec below asserts what production returns AND that the diagnostic does not send it.
 *
 * Production is untouched: `GroqModelProvider` sends no reasoning field and no `strict: false`, and
 * `buildResponseFormat`'s two branches are unchanged.
 *
 * The transport is a fake and no credential is real.
 */
import { describe, expect, it } from 'vitest';

import { createGroqApiKey } from '../providers/groq/groq-secret.js';
import { createGroqProviderConfig } from '../providers/groq/groq-config.js';
import { createManualClock } from '../reliability/clock.js';
import { GroqModelProvider } from '../providers/groq/groq-model-provider.js';
import {
  buildGroqChatBestEffortDiagnosticBody,
  createGroqChatBestEffortDiagnosticProvider,
  GROQ_BEST_EFFORT_JSON_SCHEMA_STRICT,
} from '../providers/groq/groq-chat-best-effort-diagnostic.js';
import { buildGroqChatReasoningDiagnosticBody } from '../providers/groq/groq-chat-reasoning-diagnostic.js';
import { buildResponseFormat } from '../providers/groq/groq-structured-output.js';
import type { GroqTransport } from '../providers/groq/groq-transport.js';

const KEY = 'FAKE-BEST-EFFORT-SENTINEL-NEVER-REAL-000';

const SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply'],
  additionalProperties: false,
} as const;

const MESSAGES = [
  { role: 'system' as const, content: 'S' },
  { role: 'user' as const, content: 'U' },
];

function recordingTransport(
  status = 200,
  bodyText?: string,
): {
  readonly transport: GroqTransport;
  readonly bodies: () => readonly Record<string, unknown>[];
} {
  const bodies: Record<string, unknown>[] = [];
  return {
    transport: {
      send: (request) => {
        bodies.push(JSON.parse(request.body) as Record<string, unknown>);
        return Promise.resolve({
          status,
          retryAfterSeconds: null,
          bodyText:
            bodyText ??
            JSON.stringify({
              id: 'chatcmpl-be',
              object: 'chat.completion',
              created: 1,
              model: 'openai/gpt-oss-20b',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: '{"reply":"ok"}' },
                  finish_reason: 'stop',
                },
              ],
              usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
            }),
        });
      },
    },
    bodies: () => bodies,
  };
}

function configFor(transport: GroqTransport, strictCapable = true) {
  return createGroqProviderConfig({
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
    modelVersion: 'groq-catalog-snapshot-2026-08-12',
    executionClass: 'HOSTED',
    maxInputTokens: 131072,
    maxCompletionTokens: 65536,
    supportsStrictJsonSchema: strictCapable,
    apiKey: createGroqApiKey(KEY),
    transport,
    dataControlsAttested: true,
  });
}

const INPUT = {
  messages: MESSAGES,
  structuredJsonSchema: SCHEMA,
  maxCompletionTokens: 8192,
  reasoningEffort: 'low' as const,
  signal: new AbortController().signal,
};

/** Every leaf path of a JSON-ish value, so a NESTED change cannot hide behind a top-level key. */
function leafPaths(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (value === null || typeof value !== 'object') {
    out.set(prefix, JSON.stringify(value));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [k, v] of leafPaths(item, `${prefix}[${String(index)}]`)) {
        out.set(k, v);
      }
    });
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    for (const [k, v] of leafPaths(child, prefix === '' ? key : `${prefix}.${key}`)) {
      out.set(k, v);
    }
  }
  return out;
}

describe('THE ONE-LEAF PROOF: the best-effort body is the strict body with strict flipped', () => {
  it('changes exactly response_format.json_schema.strict, adding and removing nothing', () => {
    const config = configFor(recordingTransport().transport);
    const strict = buildGroqChatReasoningDiagnosticBody(config, INPUT);
    const bestEffort = buildGroqChatBestEffortDiagnosticBody(config, INPUT);
    if (strict === undefined || bestEffort === undefined) {
      throw new Error('both bodies must build for a strict-compatible schema');
    }

    const a = leafPaths(strict);
    const b = leafPaths(bestEffort);

    // A RECURSIVE leaf diff, not a top-level key comparison. `response_format` is an object, so a
    // top-level check would only ever say "response_format changed" and could not tell a flipped
    // flag from a dropped schema.
    const added = [...b.keys()].filter((k) => !a.has(k)).sort();
    const removed = [...a.keys()].filter((k) => !b.has(k)).sort();
    const changed = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k)).sort();

    expect(added).toStrictEqual([]);
    expect(removed).toStrictEqual([]);
    expect(changed).toStrictEqual(['response_format.json_schema.strict']);
    expect(a.get('response_format.json_schema.strict')).toBe('true');
    expect(b.get('response_format.json_schema.strict')).toBe('false');
  });

  it('keeps json_schema mode, the schema NAME and the schema BODY identical', () => {
    const config = configFor(recordingTransport().transport);
    const strict = buildGroqChatReasoningDiagnosticBody(config, INPUT);
    const bestEffort = buildGroqChatBestEffortDiagnosticBody(config, INPUT);
    if (strict?.response_format === undefined || bestEffort === undefined) {
      throw new Error('both bodies must build');
    }
    if (strict.response_format.type !== 'json_schema') {
      throw new Error('the strict baseline must be json_schema');
    }
    expect(bestEffort.response_format.type).toBe('json_schema');
    expect(bestEffort.response_format.type).toBe(strict.response_format.type);
    // The SAME name and the SAME projected schema — neither is recomputed, so neither can differ.
    expect(bestEffort.response_format.json_schema.name).toBe(
      strict.response_format.json_schema.name,
    );
    expect(JSON.stringify(bestEffort.response_format.json_schema.schema)).toBe(
      JSON.stringify(strict.response_format.json_schema.schema),
    );
    // The schema must NOT disappear.
    expect(bestEffort.response_format.json_schema.schema).toBeDefined();
    expect(bestEffort.response_format.json_schema.strict).toBe(false);
    expect(GROQ_BEST_EFFORT_JSON_SCHEMA_STRICT).toBe(false);
  });

  it('holds the model, messages, budget, effort, stream and n', () => {
    const config = configFor(recordingTransport().transport);
    const bestEffort = buildGroqChatBestEffortDiagnosticBody(config, INPUT);
    if (bestEffort === undefined) {
      throw new Error('body must build');
    }
    expect(bestEffort.model).toBe('openai/gpt-oss-20b');
    expect(JSON.stringify(bestEffort.messages)).toBe(JSON.stringify(MESSAGES));
    expect(bestEffort.max_completion_tokens).toBe(8192);
    expect(bestEffort.reasoning_effort).toBe('low');
    expect(bestEffort.stream).toBe(false);
    expect(bestEffort.n).toBe(1);
    for (const forbidden of [
      'temperature',
      'top_p',
      'seed',
      'tools',
      'tool_choice',
      'reasoning',
      'reasoning_format',
      'include_reasoning',
    ]) {
      expect(Object.keys(bestEffort), forbidden).not.toContain(forbidden);
    }
  });
});

describe('the production non-strict helper is NOT what this diagnostic sends', () => {
  it('buildResponseFormat(schema, false) returns json_object and drops the schema', () => {
    // The trap, asserted directly. Production's non-strict branch changes FOUR things at once: the
    // response-format type, the schema name, the strict flag and the schema body.
    const built = buildResponseFormat(SCHEMA, false);
    expect(built.ok).toBe(true);
    if (!built.ok) {
      throw new Error('unreachable');
    }
    expect(built.responseFormat).toStrictEqual({ type: 'json_object' });
    expect(Object.keys(built.responseFormat)).toStrictEqual(['type']);
    expect(built.responseFormat).not.toHaveProperty('json_schema');
  });

  it('production strict behaviour is unchanged: json_schema, strict true, schema retained', () => {
    const built = buildResponseFormat(SCHEMA, true);
    expect(built.ok).toBe(true);
    if (!built.ok || built.responseFormat.type !== 'json_schema') {
      throw new Error('the strict branch must build a json_schema format');
    }
    expect(built.responseFormat.json_schema.strict).toBe(true);
    expect(built.responseFormat.json_schema.name).toBe('qf_structured_output');
    expect(built.responseFormat.json_schema.schema).toBeDefined();
  });

  it('the diagnostic sends json_schema with the SAME name, never json_object', () => {
    const config = configFor(recordingTransport().transport);
    const bestEffort = buildGroqChatBestEffortDiagnosticBody(config, INPUT);
    if (bestEffort === undefined) {
      throw new Error('body must build');
    }
    expect(bestEffort.response_format.type).not.toBe('json_object');
    expect(bestEffort.response_format.json_schema.name).toBe('qf_structured_output');
  });

  it('refuses when the config is not strict-capable, rather than falling back to json_object', () => {
    // There is no strict baseline to flip. Falling back would drop the schema and turn a
    // strict-posture experiment into a no-schema one.
    const config = configFor(recordingTransport().transport, false);
    expect(buildGroqChatBestEffortDiagnosticBody(config, INPUT)).toBeUndefined();
  });
});

describe('production is untouched', () => {
  it('GroqModelProvider sends strict true, no reasoning field and no strict false', async () => {
    const wire = recordingTransport();
    await new GroqModelProvider(configFor(wire.transport), createManualClock()).invoke({
      runId: 'production-unchanged',
      messages: MESSAGES,
      resultMode: 'STRUCTURED',
      structuredJsonSchema: SCHEMA,
      timeoutMs: 30_000,
      maxCompletionTokens: 4096,
      signal: new AbortController().signal,
    });
    const body = wire.bodies()[0];
    if (body === undefined) {
      throw new Error('production must have sent one body');
    }
    const format = body['response_format'] as { type: string; json_schema?: { strict?: boolean } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema?.strict).toBe(true);
    expect(body['max_completion_tokens']).toBe(4096);
    for (const forbidden of [
      'reasoning',
      'reasoning_effort',
      'reasoning_format',
      'include_reasoning',
    ]) {
      expect(Object.keys(body), forbidden).not.toContain(forbidden);
    }
  });
});

describe('the adapter runs through the shared exchange', () => {
  it('sends exactly one request and returns the provider-reported usage', async () => {
    const wire = recordingTransport();
    const provider = createGroqChatBestEffortDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(),
    );
    const result = await provider.invoke(INPUT);
    expect(wire.bodies()).toHaveLength(1);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error('unreachable');
    }
    expect(result.usage).toStrictEqual({ inputTokens: 11, outputTokens: 5, totalTokens: 16 });
    expect(result.output).toStrictEqual({ mode: 'STRUCTURED', value: { reply: 'ok' } });
  });

  it('classifies identically to the reasoning adapter, response for response', async () => {
    // Both adapters run through ONE shared exchange, so a response cannot normalize two ways. Proved
    // by running the SAME synthetic responses through both.
    const cases: readonly { readonly status: number; readonly body?: string }[] = [
      { status: 400 },
      { status: 429 },
      { status: 503 },
      { status: 200, body: 'not json at all' },
      {
        status: 200,
        body: JSON.stringify({
          choices: [
            { index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' },
            { index: 1, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' },
          ],
        }),
      },
    ];
    for (const one of cases) {
      const bestEffortWire = recordingTransport(one.status, one.body);
      const reasoningWire = recordingTransport(one.status, one.body);
      const bestEffort = await createGroqChatBestEffortDiagnosticProvider(
        configFor(bestEffortWire.transport),
        createManualClock(),
      ).invoke(INPUT);
      const { createGroqChatReasoningDiagnosticProvider } =
        await import('../providers/groq/groq-chat-reasoning-diagnostic.js');
      const reasoning = await createGroqChatReasoningDiagnosticProvider(
        configFor(reasoningWire.transport),
        createManualClock(),
      ).invoke(INPUT);
      expect(bestEffort.status, String(one.status)).toBe(reasoning.status);
    }
  });
});

describe('CANCELLATION PRECEDENCE — an already-aborted signal outranks a body refusal', () => {
  /**
   * The regression owner review found in the shared-exchange extraction.
   *
   * The merged reasoning adapter checked `signal.aborted` BEFORE building the body. The extraction
   * moved the only abort check into the exchange, which runs AFTER the build — so an already-aborted
   * call whose body ALSO refuses changed from `cancelled` to `failed`.
   *
   * The pre-existing suite could not see it: its already-aborted case uses a VALID schema, so the
   * body builds and the exchange's own check still answers `cancelled`. It takes BOTH conditions.
   */
  const ABORTED = (): AbortSignal => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  };
  // A schema the strict path cannot build: a bare scalar root is not strict-compatible.
  const UNBUILDABLE = { type: 'string' } as const;

  it('reasoning adapter: already-aborted + unbuildable schema is CANCELLED, not FAILED', async () => {
    const wire = recordingTransport();
    const { createGroqChatReasoningDiagnosticProvider } =
      await import('../providers/groq/groq-chat-reasoning-diagnostic.js');
    const result = await createGroqChatReasoningDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(),
    ).invoke({ ...INPUT, structuredJsonSchema: UNBUILDABLE, signal: ABORTED() });
    expect(result.status).toBe('cancelled');
    expect(wire.bodies()).toHaveLength(0);
  });

  it('best-effort adapter: already-aborted + unbuildable schema is CANCELLED', async () => {
    const wire = recordingTransport();
    const result = await createGroqChatBestEffortDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(),
    ).invoke({ ...INPUT, structuredJsonSchema: UNBUILDABLE, signal: ABORTED() });
    expect(result.status).toBe('cancelled');
    expect(wire.bodies()).toHaveLength(0);
  });

  it('best-effort adapter: already-aborted + strict-INCAPABLE config is CANCELLED', async () => {
    // The other way the best-effort builder refuses: no strict baseline to flip.
    const wire = recordingTransport();
    const result = await createGroqChatBestEffortDiagnosticProvider(
      configFor(wire.transport, false),
      createManualClock(),
    ).invoke({ ...INPUT, signal: ABORTED() });
    expect(result.status).toBe('cancelled');
    expect(wire.bodies()).toHaveLength(0);
  });

  it('already-aborted + VALID schema is CANCELLED in both adapters, and sends nothing', async () => {
    const reasoningWire = recordingTransport();
    const { createGroqChatReasoningDiagnosticProvider } =
      await import('../providers/groq/groq-chat-reasoning-diagnostic.js');
    const reasoning = await createGroqChatReasoningDiagnosticProvider(
      configFor(reasoningWire.transport),
      createManualClock(),
    ).invoke({ ...INPUT, signal: ABORTED() });
    expect(reasoning.status).toBe('cancelled');
    expect(reasoningWire.bodies()).toHaveLength(0);

    const bestEffortWire = recordingTransport();
    const bestEffort = await createGroqChatBestEffortDiagnosticProvider(
      configFor(bestEffortWire.transport),
      createManualClock(),
    ).invoke({ ...INPUT, signal: ABORTED() });
    expect(bestEffort.status).toBe('cancelled');
    expect(bestEffortWire.bodies()).toHaveLength(0);
  });

  it('an ACTIVE signal + unbuildable schema is FAILED non-retryable in both adapters', async () => {
    // The other half of the precedence rule: without an abort, a body refusal is still a refusal.
    const reasoningWire = recordingTransport();
    const { createGroqChatReasoningDiagnosticProvider } =
      await import('../providers/groq/groq-chat-reasoning-diagnostic.js');
    const reasoning = await createGroqChatReasoningDiagnosticProvider(
      configFor(reasoningWire.transport),
      createManualClock(),
    ).invoke({ ...INPUT, structuredJsonSchema: UNBUILDABLE });
    expect(reasoning.status).toBe('failed');
    expect(reasoningWire.bodies()).toHaveLength(0);

    const bestEffortWire = recordingTransport();
    const bestEffort = await createGroqChatBestEffortDiagnosticProvider(
      configFor(bestEffortWire.transport),
      createManualClock(),
    ).invoke({ ...INPUT, structuredJsonSchema: UNBUILDABLE });
    expect(bestEffort.status).toBe('failed');
    expect(bestEffortWire.bodies()).toHaveLength(0);
  });

  it('an ACTIVE signal + valid schema still reaches the shared exchange', async () => {
    const wire = recordingTransport();
    const result = await createGroqChatBestEffortDiagnosticProvider(
      configFor(wire.transport),
      createManualClock(),
    ).invoke(INPUT);
    expect(result.status).toBe('completed');
    expect(wire.bodies()).toHaveLength(1);
  });
});
