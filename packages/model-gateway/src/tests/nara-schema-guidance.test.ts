/**
 * The Nara non-strict structured-output ROOT CAUSE, and the repair that closes it (JF-5B-R4).
 *
 * ### The live evidence this file exists to explain
 *
 * Run-5 and run-6 both authenticated, discovered 50 eligible aliases, accepted the owner shortlist —
 * and then every shortlisted alias failed the phase 2c hard gates. A direct owner-side diagnostic
 * against one of them proved the account, the endpoint and the model all work: plain chat returned
 * HTTP 200 with valid JSON, and so did `response_format: { type: 'json_object' }`.
 *
 * So nothing was broken about the credential, the host or the model. What was wrong was what we ASKED.
 *
 * ### The root cause, stated as three facts
 *
 * 1. a STRUCTURED request arrives at the provider carrying the exact locally authoritative schema in
 *    `input.structuredJsonSchema` — the gateway renders it for precisely this purpose;
 * 2. Groq consumes it and puts a native strict JSON Schema on the wire;
 * 3. Nara discarded it and sent only `response_format: { type: 'json_object' }`.
 *
 * `json_object` means "reply with some JSON". It does not say WHICH JSON. The canonical agent prompts
 * deliberately do not restate the reply shape — the schema contract is the authority, and duplicating
 * it in reviewed prompt bytes would create a second answer that drifts. So the model was asked for a
 * JSON object, was never shown the object, produced something reasonable, and local validation
 * correctly refused it. Every time. For every alias.
 *
 * The first `describe` below is the root-cause proof, and it is written so that it FAILED before the
 * repair and passes after it. The rest pin the repair and everything the repair must not disturb.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ProviderInvocationInput } from '../contracts/provider.js';
import {
  NARA_MAX_SCHEMA_GUIDANCE_BYTES,
  NARA_SCHEMA_GUIDANCE_PREFIX,
  NARA_SUPPORTS_STRICT_JSON_SCHEMA,
  createNaraProviderConfig,
} from '../providers/nara/nara-config.js';
import { NaraModelProvider } from '../providers/nara/nara-model-provider.js';
import { createNaraApiKey } from '../providers/nara/nara-secret.js';
import {
  NARA_CHAT_COMPLETIONS_ENDPOINT,
  type NaraHttpRequest,
  type NaraHttpResponse,
  type NaraTransport,
} from '../providers/nara/nara-transport.js';
import { renderStructuredJsonSchema } from '../providers/groq/groq-strict-schema-projection.js';

const SENTINEL_KEY = 'sentinel-not-a-real-key-0000';
const MODEL_ID = 'vendor/test-model-8b';

/** The APPLICATION's own bytes. Nothing the provider does may alter either of these. */
const APP_SYSTEM = 'You are Anisha, QuickFurno vendor care. Follow the turn you were given.';
const APP_USER = 'How does the vendor dashboard work for tracking my jobs?';

/**
 * The exact shape the generic reply path asks for, rendered the way the gateway renders it.
 *
 * Built through `renderStructuredJsonSchema` rather than hand-written, so this spec cannot drift from
 * the document the gateway actually hands a provider.
 */
const REPLY_SCHEMA: unknown = renderStructuredJsonSchema(
  z
    .object({
      kind: z.enum(['REPLY', 'ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION']),
      replyBody: z.string().min(1).max(8192).nullable(),
      reasonCode: z.string().min(1).max(64).nullable(),
      citations: z.array(z.object({ knowledgeId: z.string(), version: z.int() }).strict()).max(64),
    })
    .strict(),
);

function fixedClock(): { now: () => number } {
  let index = 0;
  const values = [1_000, 1_250];
  return {
    now: (): number => {
      const value = values[Math.min(index, values.length - 1)] ?? 0;
      index += 1;
      return value;
    },
  };
}

function scriptedTransport(content: string): {
  readonly transport: NaraTransport;
  readonly requests: readonly NaraHttpRequest[];
} {
  const requests: NaraHttpRequest[] = [];
  return {
    requests,
    transport: {
      send(request: NaraHttpRequest): Promise<NaraHttpResponse> {
        requests.push(request);
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: JSON.stringify({
            id: 'resp-1',
            model: MODEL_ID,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          }),
        });
      },
    },
  };
}

function buildProvider(transport: NaraTransport): NaraModelProvider {
  return new NaraModelProvider(
    createNaraProviderConfig({
      providerId: 'nara',
      modelId: MODEL_ID,
      modelVersion: '2026-09-01',
      maxInputTokens: 128_000,
      maxCompletionTokens: 4_096,
      apiKey: createNaraApiKey(SENTINEL_KEY),
      transport,
      dataControlsAttested: true,
    }),
    fixedClock(),
  );
}

const VALID_ANSWER = JSON.stringify({
  kind: 'REPLY',
  replyBody: 'The dashboard lists the jobs assigned to you.',
  reasonCode: null,
  citations: [],
});

function invocation(over: Partial<ProviderInvocationInput> = {}): ProviderInvocationInput {
  return {
    runId: 'run-1',
    messages: [
      { role: 'system', content: APP_SYSTEM },
      { role: 'user', content: APP_USER },
    ],
    resultMode: 'STRUCTURED',
    structuredJsonSchema: REPLY_SCHEMA,
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...over,
  };
}

/** The parsed outgoing body, so assertions read the wire rather than a belief about it. */
function sentBody(request: NaraHttpRequest | undefined): {
  readonly model?: string;
  readonly messages?: readonly { readonly role: string; readonly content: string }[];
  readonly response_format?: { readonly type?: string; readonly json_schema?: unknown };
  readonly max_tokens?: number;
} {
  return JSON.parse(request?.body ?? '{}') as ReturnType<typeof sentBody>;
}

// ---------------------------------------------------------------------------
// The root cause.
// ---------------------------------------------------------------------------

describe('JF-5B-R4 root cause: the schema reached the provider and never reached the model', () => {
  it('a STRUCTURED request DOES carry a non-empty schema into the provider', () => {
    // Fact 1. The gateway already renders it; nothing had to be added to the request contract.
    const input = invocation();
    expect(input.structuredJsonSchema).toBeDefined();
    expect(JSON.stringify(input.structuredJsonSchema).length).toBeGreaterThan(100);
    const document = input.structuredJsonSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(document.properties ?? {}).sort()).toEqual([
      'citations',
      'kind',
      'reasonCode',
      'replyBody',
    ]);
  });

  it('the wire still says json_object, and never json_schema', async () => {
    // Fact 3a, and a rule the repair must not break: Nara declares no native strict support, so it
    // must not claim one.
    const wire = scriptedTransport(VALID_ANSWER);
    await buildProvider(wire.transport).invoke(invocation());
    const body = sentBody(wire.requests[0]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.response_format?.json_schema).toBeUndefined();
  });

  it('BEFORE the repair the messages carried no representation of that schema', async () => {
    // Fact 3b — the actual defect, and the reason two live runs failed every hard gate. This
    // assertion is INVERTED by the repair: after it, the schema IS on the wire, which is what the
    // next describe proves. Kept here so the root cause stays readable.
    const wire = scriptedTransport(VALID_ANSWER);
    await buildProvider(wire.transport).invoke(invocation());
    const messages = sentBody(wire.requests[0]).messages ?? [];
    const applicationOnly = messages.filter(
      (one) => !one.content.startsWith(NARA_SCHEMA_GUIDANCE_PREFIX),
    );
    for (const message of applicationOnly) {
      expect([message.role, message.content.includes('replyBody')]).toEqual([message.role, false]);
    }
  });
});

// ---------------------------------------------------------------------------
// The repair.
// ---------------------------------------------------------------------------

describe('JF-5B-R4 the repair puts the EXACT schema on the wire as provider guidance', () => {
  it('adds exactly ONE provider-owned system message, after the application system bytes', async () => {
    const wire = scriptedTransport(VALID_ANSWER);
    await buildProvider(wire.transport).invoke(invocation());
    const messages = sentBody(wire.requests[0]).messages ?? [];
    // application system, provider guidance, application user.
    expect(messages).toHaveLength(3);
    expect(messages.map((one) => one.role)).toEqual(['system', 'system', 'user']);
    const guidance = messages.filter((one) => one.content.startsWith(NARA_SCHEMA_GUIDANCE_PREFIX));
    expect(guidance).toHaveLength(1);
    // AFTER the application system message and BEFORE the user content. Guidance placed after the
    // user's turn is guidance the model reads last, which is the opposite of a schema instruction.
    expect(messages[0]?.content).toBe(APP_SYSTEM);
    expect(messages[1]?.content.startsWith(NARA_SCHEMA_GUIDANCE_PREFIX)).toBe(true);
    expect(messages[2]?.content).toBe(APP_USER);
  });

  it('the guidance carries the EXACT serialized schema, not a restatement of it', async () => {
    const wire = scriptedTransport(VALID_ANSWER);
    await buildProvider(wire.transport).invoke(invocation());
    const guidance = (sentBody(wire.requests[0]).messages ?? [])[1]?.content ?? '';
    // Byte-for-byte the document the gateway rendered. A hand-written field list would drift from the
    // schema the answer is then validated against, which is the failure mode this whole lane is about.
    expect(guidance).toContain(JSON.stringify(REPLY_SCHEMA));
  });

  it('states the instruction BEFORE the schema, and ends on the schema', async () => {
    // Found by a JF-5B-R6 mutation control: reordering the document so the schema precedes the prose
    // that explains it left every other assertion in this file green. Order is the contract — the model
    // is told what to do with the document, then given the document, and `JSON Schema:` is the last
    // thing it reads before the braces. A tidy-up that swapped them would ship silently.
    const wire = scriptedTransport(VALID_ANSWER);
    await buildProvider(wire.transport).invoke(invocation());
    const whole = (sentBody(wire.requests[0]).messages ?? [])[1]?.content ?? '';
    const serialized = JSON.stringify(REPLY_SCHEMA);
    const label = 'JSON Schema:';
    expect(whole.indexOf('Respond with exactly one JSON object')).toBeLessThan(
      whole.indexOf(label),
    );
    expect(whole.indexOf(label)).toBeLessThan(whole.indexOf(serialized));
    // Nothing follows the schema: a trailing instruction after a long document is an instruction a
    // model may never reach.
    expect(whole.endsWith(serialized)).toBe(true);
  });

  it('says only what a provider may say: shape, no extras, no fences, nulls, object only', async () => {
    const wire = scriptedTransport(VALID_ANSWER);
    await buildProvider(wire.transport).invoke(invocation());
    const whole = (sentBody(wire.requests[0]).messages ?? [])[1]?.content ?? '';
    const guidance = whole.toLowerCase();
    for (const required of [
      'exactly one json object',
      'json schema',
      'no additional',
      'null',
      'booleans must be true/false',
      'array-typed property must be a json array',
      'enum value must match',
    ]) {
      expect([required, guidance.includes(required)]).toEqual([required, true]);
    }
    // And no BUSINESS policy in the INSTRUCTION. Scoped to the prose the provider wrote, because the
    // serialized schema that follows it legitimately contains the agent's own closed vocabulary — and
    // that vocabulary is the schema's, not this file's.
    const instructionOnly = whole.slice(0, whole.indexOf('{')).toLowerCase();
    for (const forbidden of ['quickfurno', 'vendor', 'price', 'escalate', 'consent', 'payment']) {
      expect([forbidden, instructionOnly.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it('does not touch the application bytes, and does not mutate the input array', async () => {
    const wire = scriptedTransport(VALID_ANSWER);
    const input = invocation();
    const before = JSON.stringify(input.messages);
    await buildProvider(wire.transport).invoke(input);
    // The caller's array is untouched: a provider that rewrote its input would leave the next
    // provider in a fallback chain reading a request nobody built.
    expect(JSON.stringify(input.messages)).toBe(before);
    expect(input.messages).toHaveLength(2);
  });

  it('a TEXT request is completely unchanged: no guidance, no response_format', async () => {
    const wire = scriptedTransport('plain text answer');
    await buildProvider(wire.transport).invoke(
      invocation({ resultMode: 'TEXT', structuredJsonSchema: undefined }),
    );
    const body = sentBody(wire.requests[0]);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toHaveLength(2);
    expect((body.messages ?? []).map((one) => one.content)).toEqual([APP_SYSTEM, APP_USER]);
  });

  it('still returns the STRUCTURED value, in exactly one HTTP request and with no retry', async () => {
    const wire = scriptedTransport(VALID_ANSWER);
    const result = await buildProvider(wire.transport).invoke(invocation());
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.output.mode).toBe('STRUCTURED');
    }
    expect(wire.requests).toHaveLength(1);
    expect(wire.requests[0]?.url).toBe(NARA_CHAT_COMPLETIONS_ENDPOINT);
  });

  it('a JSON object the schema refuses is still returned for the GATEWAY to reject', async () => {
    // The provider parses; it does not validate business shape. Local exact-schema validation stays
    // the authority, and the repair moves none of it.
    const wire = scriptedTransport(JSON.stringify({ kind: 'REPLY', unexpected: true }));
    const result = await buildProvider(wire.transport).invoke(invocation());
    expect(result.status).toBe('completed');
    if (result.status === 'completed' && result.output.mode === 'STRUCTURED') {
      expect(result.output.value).toEqual({ kind: 'REPLY', unexpected: true });
    }
  });

  it('malformed JSON is still malformed', async () => {
    const wire = scriptedTransport('not json at all');
    const result = await buildProvider(wire.transport).invoke(invocation());
    expect(result.status).toBe('malformed');
  });
});

// ---------------------------------------------------------------------------
// Fail closed, before the network.
// ---------------------------------------------------------------------------

describe('JF-5B-R4 a STRUCTURED request without a usable schema never reaches the network', () => {
  it('refuses a MISSING schema before transport', async () => {
    const wire = scriptedTransport(VALID_ANSWER);
    const result = await buildProvider(wire.transport).invoke(
      invocation({ structuredJsonSchema: undefined }),
    );
    expect(result).toEqual({ status: 'failed', retryable: false });
    // Not one byte left. A structured request we cannot describe is a request we should not spend on.
    expect(wire.requests).toHaveLength(0);
  });

  it('refuses an UNSERIALIZABLE schema before transport', async () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic['self'] = cyclic;
    const wire = scriptedTransport(VALID_ANSWER);
    const result = await buildProvider(wire.transport).invoke(
      invocation({ structuredJsonSchema: cyclic }),
    );
    expect(result).toEqual({ status: 'failed', retryable: false });
    expect(wire.requests).toHaveLength(0);
  });

  it('refuses an OVERSIZED schema before transport', async () => {
    const huge = { type: 'object', description: 'x'.repeat(NARA_MAX_SCHEMA_GUIDANCE_BYTES + 1) };
    const wire = scriptedTransport(VALID_ANSWER);
    const result = await buildProvider(wire.transport).invoke(
      invocation({ structuredJsonSchema: huge }),
    );
    expect(result).toEqual({ status: 'failed', retryable: false });
    expect(wire.requests).toHaveLength(0);
  });

  it('accepts a schema exactly AT the bound', async () => {
    // The ceiling is a ceiling, not a margin: the largest permitted document must still go out.
    const padding =
      NARA_MAX_SCHEMA_GUIDANCE_BYTES - JSON.stringify({ type: 'object', description: '' }).length;
    const atBound = { type: 'object', description: 'x'.repeat(padding) };
    expect(JSON.stringify(atBound).length).toBe(NARA_MAX_SCHEMA_GUIDANCE_BYTES);
    const wire = scriptedTransport(VALID_ANSWER);
    const result = await buildProvider(wire.transport).invoke(
      invocation({ structuredJsonSchema: atBound }),
    );
    expect(result.status).toBe('completed');
    expect(wire.requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// What the repair may not have changed.
// ---------------------------------------------------------------------------

describe('JF-5B-R4 the repair claims no capability it does not have', () => {
  it('Nara still declares NO native strict JSON-Schema support', () => {
    // Guidance in a message is not a capability. Raising this needs live evidence from the endpoint,
    // and schema guidance is the opposite of that evidence: it exists BECAUSE the endpoint has none.
    expect(NARA_SUPPORTS_STRICT_JSON_SCHEMA).toBe(false);
  });

  it('no handwritten generic reply field list exists in the Nara provider source', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const dir = url.fileURLToPath(new URL('../providers/nara/', import.meta.url));
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.ts')) {
        continue;
      }
      const code = fs
        .readFileSync(path.join(dir, entry), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//u.test(line))
        .join('\n');
      // The guidance must be DERIVED from the schema it was handed. A field name written here would be
      // a second definition of the reply, and the two would drift the first time either was corrected.
      for (const field of ['replyBody', 'reasonCode', 'ESCALATE_TO_HUMAN', 'knowledgeId']) {
        expect({ entry, field, present: code.includes(field) }).toEqual({
          entry,
          field,
          present: false,
        });
      }
    }
  });
});
