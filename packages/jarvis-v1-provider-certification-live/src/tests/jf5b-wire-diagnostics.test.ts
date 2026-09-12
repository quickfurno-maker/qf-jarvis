/**
 * The JF-5B-ONLY wire observer and its diagnostics (JF-5B-R8). Zero network, zero credentials.
 *
 * ### What run-10 could not say
 *
 * Ninety executions completed. Seven Groq/RIYA rows came back
 * `provider-terminal:malformed-provider-output` and three Nara rows came back
 * `structured-output-invalid`. Both tokens are true and neither is a diagnosis: the Groq provider
 * decides "malformed" at three different places and reports the same word for all three, and the gateway
 * throws away every Zod issue the moment a structured reply is refused.
 *
 * These specs pin what the observer may see, what it may keep, and — as firmly — what it may not.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  MAX_SCHEMA_ISSUES,
  SCHEMA_ISSUES_UNAVAILABLE,
  groqFactsFrom,
  groqMalformedStage,
  naraFactsFrom,
  naraMalformedStage,
  observeGroqTransport,
  observeNaraTransport,
  renderSchemaIssues,
  renderWireDiagnostic,
  schemaIssueTokens,
} from '../index.js';
import type { GroqTransport, NaraTransport } from '@qf-jarvis/model-gateway';

/** A sentinel that must never appear in a fact, a diagnostic or an issue token. */
const REASONING_SENTINEL = 'REASONING_TEXT_THAT_MUST_NEVER_ESCAPE';
const CONTENT_SENTINEL = 'CUSTOMER_CONTENT_THAT_MUST_NEVER_ESCAPE';

const chatBody = (opts: {
  content?: unknown;
  omitContent?: boolean;
  finish?: string;
  usage?: unknown;
  reasoning?: string;
  choices?: unknown;
}): string => {
  const message: Record<string, unknown> =
    opts.omitContent === true ? {} : { content: opts.content };
  message['role'] = 'assistant';
  if (opts.reasoning !== undefined) {
    message['reasoning'] = opts.reasoning;
  }
  const body: Record<string, unknown> = {
    choices: opts.choices ?? [{ index: 0, message, finish_reason: opts.finish ?? 'stop' }],
  };
  if (opts.usage !== undefined) {
    body['usage'] = opts.usage;
  }
  return JSON.stringify(body);
};

const groqTransportOf = (bodyText: string, status = 200): GroqTransport => ({
  send: () => Promise.resolve({ status, retryAfterSeconds: null, bodyText }),
});
const naraTransportOf = (bodyText: string, status = 200): NaraTransport => ({
  send: () => Promise.resolve({ status, retryAfterSeconds: null, bodyText }),
});

const SIGNAL = new AbortController().signal;
const GROQ_REQUEST = {
  url: 'https://example.invalid',
  headers: {},
  body: '{}',
};
const NARA_REQUEST: Parameters<NaraTransport['send']>[0] = GROQ_REQUEST;

describe('JF-5B-R8 (1,2) the observer is invisible to the provider', () => {
  it('returns the EXACT response object the inner transport produced', async () => {
    const response = {
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({ content: '{}' }),
    };
    const inner: GroqTransport = { send: () => Promise.resolve(response) };
    const observed = observeGroqTransport(inner);
    const out = await observed.transport.send(GROQ_REQUEST, SIGNAL);
    // Identity, not equality: a wrapper that rebuilt the response could change it in transit.
    expect(out).toBe(response);
  });

  it('delegates EXACTLY once per send, and counts it', async () => {
    let calls = 0;
    const inner: GroqTransport = {
      send: () => {
        calls += 1;
        return Promise.resolve({ status: 200, retryAfterSeconds: null, bodyText: '{}' });
      },
    };
    const observed = observeGroqTransport(inner);
    await observed.transport.send(GROQ_REQUEST, SIGNAL);
    expect(calls).toBe(1);
    expect(observed.observer.exchanges()).toBe(1);
  });

  it('lets a rejection through untouched, and records nothing', async () => {
    const boom = new Error('simulated transport failure');
    const observed = observeGroqTransport({ send: () => Promise.reject(boom) });
    await expect(observed.transport.send(GROQ_REQUEST, SIGNAL)).rejects.toBe(boom);
    expect(observed.observer.facts()).toBeUndefined();
    expect(observed.observer.exchanges()).toBe(0);
  });

  it('forgets on reset, so one case can never describe another case call', async () => {
    const observed = observeGroqTransport(groqTransportOf(chatBody({ content: '{}' })));
    await observed.transport.send(GROQ_REQUEST, SIGNAL);
    expect(observed.observer.facts()).toBeDefined();
    observed.observer.reset();
    expect(observed.observer.facts()).toBeUndefined();
    expect(observed.observer.structuredValueInMemory()).toBeUndefined();
    expect(observed.observer.exchanges()).toBe(0);
  });
});

describe('JF-5B-R8 (3,4,5) the malformed stage, named', () => {
  it('(3) an unparseable HTTP body is HTTP_BODY_JSON_INVALID', () => {
    const facts = groqFactsFrom({ status: 200, retryAfterSeconds: null, bodyText: 'not json' });
    expect(facts.responseBodyJsonValid).toBe(false);
    expect(groqMalformedStage(facts)).toBe('HTTP_BODY_JSON_INVALID');
  });

  it('(4) a valid envelope whose structured content is not JSON is STRUCTURED_CONTENT_JSON_INVALID', () => {
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({ content: `Sure! here is the reply: ${CONTENT_SENTINEL}` }),
    });
    expect(facts.structuredContentJsonValid).toBe(false);
    expect(groqMalformedStage(facts)).toBe('STRUCTURED_CONTENT_JSON_INVALID');
  });

  it('(5) NULL, ABSENT and OTHER contents are classified without reading them', () => {
    const kindOf = (bodyText: string): string | undefined =>
      groqFactsFrom({ status: 200, retryAfterSeconds: null, bodyText }).messageContentKind;
    expect(kindOf(chatBody({ content: null }))).toBe('NULL');
    expect(kindOf(chatBody({ omitContent: true }))).toBe('ABSENT');
    expect(kindOf(chatBody({ content: { nested: CONTENT_SENTINEL } }))).toBe('OTHER');
    // And an OTHER content never carries its text into the facts.
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({ content: { nested: CONTENT_SENTINEL } }),
    });
    expect(JSON.stringify(facts)).not.toContain(CONTENT_SENTINEL);
    expect(groqMalformedStage(facts)).toBe('MESSAGE_CONTENT_NOT_STRING');
  });

  it('an unreadable envelope is RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE', () => {
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: JSON.stringify({ choices: [] }),
    });
    expect(groqMalformedStage(facts)).toBe('RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE');
  });

  it('a well-formed structured reply resolves to UNRESOLVED, never a false accusation', () => {
    // Nothing about this response is malformed. If it is ever asked, the answer must be "I do not know",
    // because a diagnostic that names a stage for a healthy response is worse than silence.
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({ content: '{"reply":"ok"}' }),
    });
    expect(groqMalformedStage(facts)).toBe('MALFORMED_STAGE_UNRESOLVED');
    expect(groqMalformedStage(undefined)).toBe('MALFORMED_STAGE_UNRESOLVED');
  });

  it('Nara is classified by the same rules over its own field names', () => {
    expect(
      naraMalformedStage(naraFactsFrom({ status: 200, retryAfterSeconds: null, bodyText: 'nope' })),
    ).toBe('HTTP_BODY_JSON_INVALID');
    expect(
      naraMalformedStage(
        naraFactsFrom({
          status: 200,
          retryAfterSeconds: null,
          bodyText: chatBody({ content: 'prose, not json' }),
        }),
      ),
    ).toBe('STRUCTURED_CONTENT_JSON_INVALID');
  });
});

describe('JF-5B-R8 (6,7) what is captured, and what is refused', () => {
  it('(6) captures the finish reason and the token counts, content-free', () => {
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({
        content: `{"partial": "${CONTENT_SENTINEL}`,
        finish: 'length',
        usage: { prompt_tokens: 1234, completion_tokens: 4096, total_tokens: 5330 },
      }),
    });
    expect(facts.finishReason).toBe('length');
    expect(facts.promptTokens).toBe(1234);
    expect(facts.completionTokens).toBe(4096);
    expect(facts.totalTokens).toBe(5330);
    expect(facts.messageContentChars).toBeGreaterThan(0);
    expect(JSON.stringify(facts)).not.toContain(CONTENT_SENTINEL);
  });

  it('bounds the finish reason, so a provider cannot smuggle prose through it', () => {
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({ content: '{}', finish: 'x'.repeat(500) }),
    });
    expect(facts.finishReason?.length).toBe(64);
  });

  it('(7) reports reasoning as a BOOLEAN and never as text', async () => {
    const bodyText = chatBody({ content: '{"reply":"ok"}', reasoning: REASONING_SENTINEL });
    const facts = groqFactsFrom({ status: 200, retryAfterSeconds: null, bodyText });
    expect(facts.reasoningFieldPresent).toBe(true);
    expect(JSON.stringify(facts)).not.toContain(REASONING_SENTINEL);
    // And nothing the observer renders carries it either.
    const observed = observeGroqTransport(groqTransportOf(bodyText));
    await observed.transport.send(GROQ_REQUEST, SIGNAL);
    const line = renderWireDiagnostic(
      groqMalformedStage(observed.observer.facts()),
      observed.observer.facts(),
    );
    expect(line).not.toContain(REASONING_SENTINEL);
    expect(line).toContain('reasoning=true');
  });

  it('every captured field is a number, a boolean or a closed token — never free text', () => {
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({
        content: CONTENT_SENTINEL,
        finish: 'stop',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        reasoning: REASONING_SENTINEL,
      }),
    });
    const CLOSED_TOKENS = [
      'STRING',
      'NULL',
      'ABSENT',
      'OTHER',
      'stop',
      'length',
      'complete',
      'eos',
    ];
    const entries: readonly (readonly [string, unknown])[] = Object.entries(
      facts as unknown as Record<string, unknown>,
    );
    for (const [key, value] of entries) {
      if (value === undefined || typeof value === 'number' || typeof value === 'boolean') {
        continue;
      }
      // Anything that is not a number, a boolean or one of the closed tokens fails here, INCLUDING an
      // object — which is exactly the leak this test exists to catch, so it must not be stringified.
      const rendered = typeof value === 'string' ? value : JSON.stringify(value);
      expect({ key, rendered, closed: CLOSED_TOKENS.includes(rendered) }).toEqual({
        key,
        rendered,
        closed: true,
      });
    }
  });

  it('the rendered line carries only key=value pairs over those fields', () => {
    const facts = groqFactsFrom({
      status: 200,
      retryAfterSeconds: null,
      bodyText: chatBody({ content: CONTENT_SENTINEL, finish: 'length' }),
    });
    const line = renderWireDiagnostic('STRUCTURED_CONTENT_JSON_INVALID', facts);
    expect(line.startsWith('diagnostic=STRUCTURED_CONTENT_JSON_INVALID')).toBe(true);
    expect(line).not.toContain(CONTENT_SENTINEL);
    for (const pair of line.split(' ')) {
      expect({ pair, shaped: /^[A-Za-z]+=[A-Za-z0-9_.-]+$/u.test(pair) }).toEqual({
        pair,
        shaped: true,
      });
    }
  });
});

describe('JF-5B-R8 (8,9) schema issues are a path and a code, and decide nothing', () => {
  const schema = z.object({
    reply: z.object({ reasonCode: z.enum(['A', 'B']), text: z.string() }),
    observations: z.array(z.object({ field: z.string() })),
  });

  it('(8) reports path and code only, never a message or a value', () => {
    const tokens = schemaIssueTokens(schema, {
      reply: { reasonCode: 'ZZZ', text: 42 },
      observations: [{ field: CONTENT_SENTINEL }, { field: 7 }],
    });
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect({ token, shaped: /^[A-Za-z0-9_.()]+:[a-z_]+$/u.test(token) }).toEqual({
        token,
        shaped: true,
      });
      expect(token).not.toContain(CONTENT_SENTINEL);
    }
    expect(tokens.some((one) => one.startsWith('reply.reasonCode:'))).toBe(true);
    expect(tokens.some((one) => one.startsWith('observations.1.field:'))).toBe(true);
  });

  it('caps the list at eight UNIQUE entries', () => {
    const wide = z.object(
      Object.fromEntries([...Array(40).keys()].map((i) => [`f${String(i)}`, z.string()])),
    );
    const tokens = schemaIssueTokens(wide, {});
    expect(tokens.length).toBe(MAX_SCHEMA_ISSUES);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('answers with an empty list when the value PASSES, rather than inventing an issue', () => {
    const tokens = schemaIssueTokens(schema, {
      reply: { reasonCode: 'A', text: 'ok' },
      observations: [],
    });
    expect(tokens).toEqual([]);
    expect(renderSchemaIssues(tokens)).toBe(`schemaIssues=${SCHEMA_ISSUES_UNAVAILABLE}`);
    expect(renderSchemaIssues(undefined)).toBe(`schemaIssues=${SCHEMA_ISSUES_UNAVAILABLE}`);
  });

  it('(9) is a pure read: the same value parses the same way before and after', () => {
    const value = { reply: { reasonCode: 'A', text: 'ok' }, observations: [] };
    const before = schema.safeParse(value).success;
    schemaIssueTokens(schema, value);
    const after = schema.safeParse(value).success;
    expect([before, after]).toEqual([true, true]);
    // And the input object is not mutated by being diagnosed.
    expect(value).toEqual({ reply: { reasonCode: 'A', text: 'ok' }, observations: [] });
  });
});

describe('JF-5B-R8 the in-memory value is reachable ONLY for the schema question', () => {
  it('holds the parsed structured reply while a case runs, and nothing else', async () => {
    const observed = observeGroqTransport(
      groqTransportOf(chatBody({ content: JSON.stringify({ reply: CONTENT_SENTINEL }) })),
    );
    await observed.transport.send(GROQ_REQUEST, SIGNAL);
    expect(observed.observer.structuredValueInMemory()).toEqual({ reply: CONTENT_SENTINEL });
    // The FACTS beside it carry none of that text. That is the separation the design rests on.
    expect(JSON.stringify(observed.observer.facts())).not.toContain(CONTENT_SENTINEL);
  });

  it('holds nothing when the content is not parseable JSON, because that is a different diagnosis', async () => {
    const observed = observeGroqTransport(groqTransportOf(chatBody({ content: 'prose' })));
    await observed.transport.send(GROQ_REQUEST, SIGNAL);
    expect(observed.observer.structuredValueInMemory()).toBeUndefined();
  });

  it('and the Nara observer behaves identically', async () => {
    const observed = observeNaraTransport(
      naraTransportOf(chatBody({ content: JSON.stringify({ ok: true }) })),
    );
    const out = await observed.transport.send(NARA_REQUEST, SIGNAL);
    expect(out.status).toBe(200);
    expect(observed.observer.structuredValueInMemory()).toEqual({ ok: true });
    observed.observer.reset();
    expect(observed.observer.structuredValueInMemory()).toBeUndefined();
  });
});

describe('JF-5B-R8 (20) this is not, and cannot become, production observability', () => {
  it('is imported by no serving path', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const roots = [
      url.fileURLToPath(new URL('../../../../packages', import.meta.url)),
      url.fileURLToPath(new URL('../../../../apps', import.meta.url)),
    ];
    const walk = (dir: string): string[] =>
      [...fs.readdirSync(dir)].flatMap((entry) => {
        if (['node_modules', 'dist', '.turbo', 'coverage', '.git'].includes(entry)) {
          return [];
        }
        const full = path.join(dir, entry);
        return fs.statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
      });
    const importers: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const normalised = file.replace(/\\/gu, '/');
        if (normalised.includes('/diagnostics/jf5b-')) {
          continue;
        }
        const text = fs.readFileSync(file, 'utf8');
        if (
          text.includes('observeGroqTransport') ||
          text.includes('observeNaraTransport') ||
          text.includes('schemaIssueTokens') ||
          text.includes('renderSchemaIssues') ||
          text.includes('renderWireDiagnostic')
        ) {
          importers.push(normalised.split('/src/')[1] ?? normalised);
        }
      }
    }
    // The harness barrel, the certification runner, and the two specs that drive them. Nothing in
    // `model-gateway`, no provider, no runtime, no ingress, no worker.
    expect(importers.sort()).toEqual([
      'cli/run-jf5b-live-certification.ts',
      'composition/jf5b-certification-runner-impl.ts',
      'index.ts',
      'tests/jf5b-wire-diagnostics.test.ts',
    ]);
  });

  it('the providers themselves know nothing about any of it', async () => {
    const fs = await import('node:fs');
    const url = await import('node:url');
    for (const rel of [
      '../../../../packages/model-gateway/src/providers/groq/groq-model-provider.ts',
      '../../../../packages/model-gateway/src/providers/nara/nara-model-provider.ts',
      '../../../../packages/model-gateway/src/gateway.ts',
    ]) {
      const text = fs.readFileSync(url.fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      for (const forbidden of ['observe', 'WireFacts', 'MalformedStage', 'schemaIssue']) {
        expect({ rel, forbidden, present: text.includes(forbidden) }).toEqual({
          rel,
          forbidden,
          present: false,
        });
      }
    }
  });
});
