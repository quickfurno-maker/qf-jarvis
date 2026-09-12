/**
 * Groq `json_validate_failed`, made structurally readable (JF-5B-R9). Zero network, zero credentials.
 *
 * ### What run-11 could not say
 *
 * Eight Groq/RIYA rows, all `provider-terminal:malformed-provider-output`, all
 * `diagnostic=RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE httpStatus=400 reasoning=false`. The stage was
 * correct and empty: the body of a 400 IS an error envelope with no `choices`, so the R8 classifier had
 * nothing else to say.
 *
 * But Groq had already said it. HTTP 400 with `error.code = json_validate_failed` means the request was
 * accepted, the model generated, and Groq's own strict validator refused the result — which is why the
 * same provider, model and strict mode passes every Anisha and Aarohi row and some Riya rows too.
 * The refused text is in `error.failed_generation`.
 *
 * ### What these specs protect
 *
 * That the ONE closed code is recognised and nothing else is; that `failed_generation` is measured and
 * never read out; that the four candidate shapes a run-12 repair must choose between — schema-document
 * echo, valid JSON with wrong fields, truncation, other — are distinguishable from booleans alone; and
 * that none of this can touch an outcome.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  GROQ_JSON_VALIDATE_FAILED_CODE,
  groqFactsFrom,
  groqMalformedStage,
  observeGroqTransport,
  renderWireDiagnostic,
  schemaIssueTokens,
} from '../index.js';
import type { GroqTransport } from '@qf-jarvis/model-gateway';

/** Sentinels that must never appear anywhere a human or a file can see. */
const FAILED_SENTINEL = 'ZZFAILEDGENERATIONSENTINEL';
const MESSAGE_SENTINEL = 'ZZGROQMESSAGESENTINEL';
const REQUEST_ID_SENTINEL = 'ZZREQUESTIDSENTINEL';

/** The envelope shape two independently recorded live 400s agree on. */
const errorBody = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    error: {
      message: MESSAGE_SENTINEL,
      type: 'invalid_request_error',
      code: GROQ_JSON_VALIDATE_FAILED_CODE,
      request_id: REQUEST_ID_SENTINEL,
      ...over,
    },
  });

const factsFor = (bodyText: string, status = 400) =>
  groqFactsFrom({ status, retryAfterSeconds: null, bodyText });

const SIGNAL = new AbortController().signal;
const REQUEST: Parameters<GroqTransport['send']>[0] = {
  url: 'https://example.invalid',
  headers: {},
  body: '{}',
};

describe('JF-5B-R9 (11) only the ONE closed code is recognised', () => {
  it('the literal matches the provider normalization module, and cannot drift from it', async () => {
    expect(GROQ_JSON_VALIDATE_FAILED_CODE).toBe('json_validate_failed');
    const fs = await import('node:fs');
    const url = await import('node:url');
    const norm = fs.readFileSync(
      url.fileURLToPath(
        new URL(
          '../../../../packages/model-gateway/src/providers/groq/groq-error-normalization.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    // A JF-5B-LOCAL literal, locked to the production one. Exporting the provider's private primitive
    // so a diagnostic could borrow it would widen a production surface; this costs one assertion.
    expect(norm).toContain(
      `const GROQ_JSON_VALIDATE_FAILED = '${GROQ_JSON_VALIDATE_FAILED_CODE}';`,
    );
  });

  it('a 400 with ANY other code keeps the old generic behaviour, and inspects nothing', () => {
    const facts = factsFor(
      errorBody({ code: 'invalid_api_key', failed_generation: FAILED_SENTINEL }),
    );
    expect(facts.closedErrorCode).toBeUndefined();
    expect(facts.failedGeneration).toBeUndefined();
    expect(groqMalformedStage(facts)).toBe('RESPONSE_ENVELOPE_INVALID_OR_UNREADABLE');
    expect(JSON.stringify(facts)).not.toContain(FAILED_SENTINEL);
  });

  it('and a 200 is untouched by any of this', () => {
    const ok = JSON.stringify({
      choices: [{ index: 0, message: { content: '{"kind":"a"}' }, finish_reason: 'stop' }],
    });
    const facts = factsFor(ok, 200);
    expect(facts.closedErrorCode).toBeUndefined();
    expect(facts.failedGeneration).toBeUndefined();
    expect(groqMalformedStage(facts)).toBe('MALFORMED_STAGE_UNRESOLVED');
  });
});

describe('JF-5B-R9 (12-15) the four shapes run-12 must choose between', () => {
  it('(12) the code with NO failed_generation reports present=no', () => {
    const facts = factsFor(errorBody());
    expect(groqMalformedStage(facts)).toBe('GROQ_JSON_VALIDATE_FAILED');
    expect(facts.failedGeneration?.failedGenerationPresent).toBe(false);
    expect(facts.failedGeneration?.failedGenerationKind).toBeUndefined();
    expect(facts.failedGeneration?.schemaDocumentLike).toBe(false);
  });

  it('(13) VALID JSON carrying Riya root keys reports both as present', () => {
    const generation = JSON.stringify({
      reply: { replyBody: FAILED_SENTINEL, citations: [] },
      evolution: { observations: { sets: [], clears: [] }, skipProjectDetails: false },
    });
    const facts = factsFor(errorBody({ failed_generation: generation }));
    const failed = facts.failedGeneration;
    expect(failed?.failedGenerationKind).toBe('STRING');
    expect(failed?.failedGenerationJsonValid).toBe(true);
    expect(failed?.failedGenerationStartsObject).toBe(true);
    expect(failed?.failedGenerationEndsObject).toBe(true);
    expect(failed?.expectedRiyaRootKeysPresent).toEqual({ reply: true, evolution: true });
    expect(failed?.schemaDocumentLike).toBe(false);
    expect(failed?.failedGenerationChars).toBe(generation.length);
    expect(JSON.stringify(facts)).not.toContain(FAILED_SENTINEL);
  });

  it('(14) a SCHEMA-DOCUMENT echo is recognised as one, without naming a key', () => {
    // The model returning the schema instead of an instance. Three of the five marker keys is the bar.
    const generation = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { reply: { type: 'object' }, evolution: { type: 'object' } },
      required: ['reply', 'evolution'],
      additionalProperties: false,
    });
    const failed = factsFor(errorBody({ failed_generation: generation })).failedGeneration;
    expect(failed?.schemaDocumentLike).toBe(true);
    expect(failed?.failedGenerationJsonValid).toBe(true);
    // `reply` and `evolution` appear only as SCHEMA property names here, not as instance keys.
    expect(failed?.expectedRiyaRootKeysPresent).toEqual({ reply: false, evolution: false });
  });

  it('two marker keys are NOT enough: the pattern must be strong', () => {
    const generation = JSON.stringify({ type: 'object', required: ['reply'], reply: {} });
    expect(
      factsFor(errorBody({ failed_generation: generation })).failedGeneration?.schemaDocumentLike,
    ).toBe(false);
  });

  it('(15) TRUNCATION shows as starts=yes ends=no, with no raw output anywhere', () => {
    const generation = `{"reply":{"replyBody":"${FAILED_SENTINEL}`;
    const facts = factsFor(errorBody({ failed_generation: generation }));
    const failed = facts.failedGeneration;
    expect(failed?.failedGenerationJsonValid).toBe(false);
    expect(failed?.failedGenerationStartsObject).toBe(true);
    expect(failed?.failedGenerationEndsObject).toBe(false);
    expect(failed?.failedGenerationChars).toBe(generation.length);
    expect(JSON.stringify(facts)).not.toContain(FAILED_SENTINEL);
  });

  it('prose that never attempted an object shows starts=no', () => {
    const failed = factsFor(
      errorBody({ failed_generation: `Sure! Here is the reply: ${FAILED_SENTINEL}` }),
    ).failedGeneration;
    expect(failed?.failedGenerationStartsObject).toBe(false);
    expect(failed?.failedGenerationJsonValid).toBe(false);
  });

  it('a non-STRING failed_generation reports its kind and no length', () => {
    for (const [value, kind] of [
      [{ reply: FAILED_SENTINEL }, 'OBJECT'],
      [[FAILED_SENTINEL], 'ARRAY'],
      [42, 'OTHER'],
    ] as const) {
      const failed = factsFor(errorBody({ failed_generation: value })).failedGeneration;
      expect([kind, failed?.failedGenerationKind]).toEqual([kind, kind]);
      expect(failed?.failedGenerationChars).toBeUndefined();
      expect(failed?.failedGenerationJsonValid).toBeUndefined();
    }
  });
});

describe('JF-5B-R9 (16,17) the schema question, asked of the refused generation', () => {
  const RIYA_LIKE = z.object({
    reply: z.object({ replyBody: z.string(), citations: z.array(z.string()) }),
    evolution: z.object({ skipProjectDetails: z.boolean() }),
  });

  it('(16) reports path and code only, for the value GROQ refused', async () => {
    const generation = JSON.stringify({ answer: FAILED_SENTINEL, notes: [1, 2] });
    const observed = observeGroqTransport({
      send: () =>
        Promise.resolve({
          status: 400,
          retryAfterSeconds: null,
          bodyText: errorBody({ failed_generation: generation }),
        }),
    });
    await observed.transport.send(REQUEST, SIGNAL);
    const value = observed.observer.structuredValueInMemory();
    expect(value).toEqual({ answer: FAILED_SENTINEL, notes: [1, 2] });
    const tokens = schemaIssueTokens(RIYA_LIKE, value);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect({ token, shaped: /^[A-Za-z0-9_.()]+:[a-z_]+$/u.test(token) }).toEqual({
        token,
        shaped: true,
      });
      expect(token).not.toContain(FAILED_SENTINEL);
    }
    expect(tokens.some((one) => one.startsWith('reply:'))).toBe(true);
    expect(tokens.some((one) => one.startsWith('evolution:'))).toBe(true);
  });

  it('(17) still caps at eight unique issues', () => {
    const wide = z.object(
      Object.fromEntries([...Array(40).keys()].map((i) => [`f${String(i)}`, z.string()])),
    );
    expect(schemaIssueTokens(wide, {}).length).toBe(8);
  });

  it('an UNPARSEABLE generation leaves nothing to ask the schema about', async () => {
    const observed = observeGroqTransport({
      send: () =>
        Promise.resolve({
          status: 400,
          retryAfterSeconds: null,
          bodyText: errorBody({ failed_generation: `{"reply":"${FAILED_SENTINEL}` }),
        }),
    });
    await observed.transport.send(REQUEST, SIGNAL);
    expect(observed.observer.structuredValueInMemory()).toBeUndefined();
  });

  it('and a NON-json_validate_failed 400 never reaches the generation at all', async () => {
    const observed = observeGroqTransport({
      send: () =>
        Promise.resolve({
          status: 400,
          retryAfterSeconds: null,
          bodyText: errorBody({ code: 'invalid_api_key', failed_generation: '{"a":1}' }),
        }),
    });
    await observed.transport.send(REQUEST, SIGNAL);
    expect(observed.observer.structuredValueInMemory()).toBeUndefined();
  });
});

describe('JF-5B-R9 (18-21) nothing raw escapes, and nothing is disturbed', () => {
  const generation = `{"reply":{"replyBody":"${FAILED_SENTINEL}"}}`;

  it('(18) the rendered terminal line carries booleans, numbers and closed tokens only', () => {
    const facts = factsFor(errorBody({ failed_generation: generation }));
    const line = renderWireDiagnostic(groqMalformedStage(facts), facts);
    expect(line).toContain('diagnostic=GROQ_JSON_VALIDATE_FAILED');
    expect(line).toContain('failedGenerationPresent=true');
    expect(line).toContain('failedGenerationKind=STRING');
    expect(line).toContain('failedGenerationJsonValid=true');
    expect(line).toContain('expectedReplyKey=true');
    expect(line).toContain('expectedEvolutionKey=false');
    for (const sentinel of [FAILED_SENTINEL, MESSAGE_SENTINEL, REQUEST_ID_SENTINEL]) {
      expect(line).not.toContain(sentinel);
    }
    for (const pair of line.split(' ')) {
      expect({ pair, shaped: /^[A-Za-z]+=[A-Za-z0-9_.-]+$/u.test(pair) }).toEqual({
        pair,
        shaped: true,
      });
    }
  });

  it('(19) no sentinel survives into the captured facts, by any path', () => {
    const serialised = JSON.stringify(factsFor(errorBody({ failed_generation: generation })));
    for (const sentinel of [FAILED_SENTINEL, MESSAGE_SENTINEL, REQUEST_ID_SENTINEL]) {
      expect(serialised).not.toContain(sentinel);
    }
    // Nor the provider's error message or request id under any key.
    expect(serialised).not.toContain('invalid_request_error');
  });

  it('(20) the response object is still returned unchanged', async () => {
    const response = {
      status: 400,
      retryAfterSeconds: null,
      bodyText: errorBody({ failed_generation: generation }),
    };
    const observed = observeGroqTransport({ send: () => Promise.resolve(response) });
    expect(await observed.transport.send(REQUEST, SIGNAL)).toBe(response);
  });

  it('(21) and it is still exactly one delegation', async () => {
    let calls = 0;
    const observed = observeGroqTransport({
      send: () => {
        calls += 1;
        return Promise.resolve({
          status: 400,
          retryAfterSeconds: null,
          bodyText: errorBody({ failed_generation: generation }),
        });
      },
    });
    await observed.transport.send(REQUEST, SIGNAL);
    expect([calls, observed.observer.exchanges()]).toEqual([1, 1]);
  });

  it('reset forgets the generation as completely as everything else', async () => {
    const observed = observeGroqTransport({
      send: () =>
        Promise.resolve({
          status: 400,
          retryAfterSeconds: null,
          bodyText: errorBody({ failed_generation: generation }),
        }),
    });
    await observed.transport.send(REQUEST, SIGNAL);
    expect(observed.observer.structuredValueInMemory()).toBeDefined();
    observed.observer.reset();
    expect(observed.observer.structuredValueInMemory()).toBeUndefined();
    expect(observed.observer.facts()).toBeUndefined();
  });
});
