/**
 * MVP-P2A.2 HF4-R7 — the provider-facing Groq strict schema projection.
 *
 * ### What this exists to prevent
 *
 * RUN S9 reached the provider and collected nine identical HTTP 400 / `invalid_request_error`
 * rejections across nine unrelated safety fixtures. The only thing those nine requests shared that the
 * PASSING smoke did not was the full Riya strict JSON Schema. `isStrictCompatibleJsonSchema` checked
 * that schema's STRUCTURE and passed it; `buildResponseFormat` then sent the document verbatim,
 * including every sibling keyword the checker had never looked at.
 *
 * These specs pin the repair: the provider-facing document is REBUILT from a closed policy table, so a
 * keyword nobody classified can never ride through again, and what is checked is exactly what is sent.
 *
 * Every test is offline. No network, no provider, no credential.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createGroqApiKey } from '../providers/groq/groq-secret.js';
import { createGroqProviderConfig } from '../providers/groq/groq-config.js';
import { GroqModelProvider } from '../providers/groq/groq-model-provider.js';
import { buildResponseFormat } from '../providers/groq/groq-structured-output.js';
import { createSystemClock } from '../reliability/clock.js';
import {
  GROQ_STRICT_PROJECTION_REASONS,
  projectGroqStrictJsonSchema,
} from '../providers/groq/groq-strict-schema-projection.js';

/** A closed object node, the shape every documented strict schema is built from. */
function closedObject(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function projected(schema: unknown): Record<string, unknown> {
  const result = projectGroqStrictJsonSchema(schema);
  if (!result.ok) {
    throw new Error(`expected a projection, got ${result.reason}`);
  }
  return result.schema;
}

/** Every keyword appearing anywhere in a document, so a leak cannot hide in a nested node. */
function keywordsOf(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((child) => keywordsOf(child, out));
    return out;
  }
  if (typeof node !== 'object' || node === null) {
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.add(key);
    if (key === 'properties' || key === '$defs') {
      Object.values((value ?? {}) as Record<string, unknown>).forEach((sub) =>
        keywordsOf(sub, out),
      );
    } else if (key === 'items' || key === 'anyOf') {
      keywordsOf(value, out);
    }
  }
  return out;
}

describe('R7-C3/C4/C5/C6/C7 — the documented subset survives projection', () => {
  it('R7-C3 canonicalizes a `const` literal to a singleton `enum`', () => {
    // Zod renders `z.literal(...)` as `const`. Groq's Structured Outputs documentation establishes
    // `enum` and never mentions `const`, so the constraint is re-expressed rather than forwarded.
    const out = projected(closedObject({ kind: { type: 'string', const: 'REPLY' } }));
    const kind = (out['properties'] as Record<string, unknown>)['kind'] as Record<string, unknown>;
    expect(kind).toEqual({ type: 'string', enum: ['REPLY'] });
    expect('const' in kind).toBe(false);
  });

  it('R7-C4 every literal keeps its exact value and its type', () => {
    // The canonicalization must be lossless. A projection that produced the right SHAPE with the
    // wrong value would constrain decoding to the wrong token and be worse than not projecting.
    for (const literal of ['REPLY', 'SET', 'CLEAR', 'user_stated', 1, true]) {
      const type =
        typeof literal === 'string'
          ? 'string'
          : typeof literal === 'number'
            ? 'integer'
            : 'boolean';
      const out = projected(closedObject({ v: { type, const: literal } }));
      expect((out['properties'] as Record<string, unknown>)['v']).toEqual({
        type,
        enum: [literal],
      });
    }
  });

  it('R7-C5 every object stays closed with every property required', () => {
    const out = projected(
      closedObject({
        nested: closedObject({ a: { type: 'string' }, b: { type: 'integer' } }),
      }),
    );
    const nested = (out['properties'] as Record<string, unknown>)['nested'] as Record<
      string,
      unknown
    >;
    expect(out['additionalProperties']).toBe(false);
    expect(nested['additionalProperties']).toBe(false);
    expect(nested['required']).toEqual(['a', 'b']);
  });

  it('R7-C6 a nullable field stays required, with its null branch intact', () => {
    const out = projected(
      closedObject({
        reasonCode: {
          anyOf: [{ type: 'string', minLength: 1, pattern: '^[A-Z]+$' }, { type: 'null' }],
        },
      }),
    );
    expect(out['required']).toEqual(['reasonCode']);
    const reason = (out['properties'] as Record<string, unknown>)['reasonCode'] as Record<
      string,
      unknown
    >;
    // The union shape and the null branch both survive; only the unproven constraints leave.
    expect(reason).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('the documented nullable TYPE-ARRAY form also survives', () => {
    const out = projected(closedObject({ note: { type: ['string', 'null'] } }));
    expect((out['properties'] as Record<string, unknown>)['note']).toEqual({
      type: ['string', 'null'],
    });
  });

  it('R7-C7 a union stays `anyOf` and is never rewritten to `oneOf`', () => {
    const out = projected(
      closedObject({
        op: {
          anyOf: [
            closedObject({ operation: { type: 'string', const: 'SET' } }),
            closedObject({ operation: { type: 'string', const: 'CLEAR' } }),
          ],
        },
      }),
    );
    const op = (out['properties'] as Record<string, unknown>)['op'] as Record<string, unknown>;
    expect(Array.isArray(op['anyOf'])).toBe(true);
    expect(keywordsOf(out).has('oneOf')).toBe(false);
  });

  it('local `$defs` / `$ref` recursion is preserved — Groq documents it', () => {
    const out = projected({
      type: 'object',
      properties: { child: { $ref: '#' } },
      required: ['child'],
      additionalProperties: false,
      $defs: { leaf: { type: 'string', maxLength: 4 } },
    });
    expect((out['properties'] as Record<string, unknown>)['child']).toEqual({ $ref: '#' });
    // Definitions are projected too, so a dropped keyword cannot survive by hiding in `$defs`.
    expect((out['$defs'] as Record<string, unknown>)['leaf']).toEqual({ type: 'string' });
  });
});

describe('R7-C2/C9 — unproven keywords never reach the provider', () => {
  const VALIDATION_ONLY = {
    minLength: 1,
    maxLength: 2500,
    pattern: '^[A-Za-z]+$',
    format: 'email',
    minimum: 1,
    maximum: 10,
    exclusiveMinimum: 0,
    exclusiveMaximum: 11,
    multipleOf: 1,
    title: 'a title',
    default: 'x',
    examples: ['x'],
  };

  it('R7-C9 drops every validation-only keyword from the provider document', () => {
    // HF4-R7-R1 removed `description` from this list: owner review found Groq's own strict:true
    // examples (the organization-chart and file-system recursion schemas) carry it inside property
    // definitions, so it IS part of the documented subset and dropping it was the wrong call. The
    // rest stay dropped — none of them is demonstrated under strict mode.
    const out = projected(closedObject({ body: { type: 'string', ...VALIDATION_ONLY } }));
    const body = (out['properties'] as Record<string, unknown>)['body'];
    expect(body).toEqual({ type: 'string' });
    for (const keyword of Object.keys(VALIDATION_ONLY)) {
      expect(keywordsOf(out).has(keyword)).toBe(false);
    }
  });

  it('drops array count bounds while keeping the array and its items', () => {
    const out = projected(
      closedObject({
        list: {
          type: 'array',
          items: { type: 'string' },
          minItems: 0,
          maxItems: 3,
          uniqueItems: true,
        },
      }),
    );
    expect((out['properties'] as Record<string, unknown>)['list']).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('R7-C2 does not forward a root `$schema` meta keyword', () => {
    const out = projected({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      ...closedObject({ a: { type: 'string' } }),
    });
    expect('$schema' in out).toBe(false);
    expect(keywordsOf(out).has('$schema')).toBe(false);
  });

  it('an UNCLASSIFIED keyword fails closed rather than riding through', () => {
    // The default that makes this repair hold. A keyword nobody reviewed is a keyword nobody proved.
    const result = projectGroqStrictJsonSchema(
      closedObject({ a: { type: 'string', someFutureKeyword: true } }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe('unsupported-keyword');
  });

  it('the projection never mutates the caller-supplied document', () => {
    const input = closedObject({
      kind: { type: 'string', const: 'REPLY' },
      n: { type: 'integer', minimum: 1 },
    });
    const snapshot = JSON.stringify(input);
    projectGroqStrictJsonSchema(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('R7-C8/C20 — unsupported structure fails BEFORE transport', () => {
  for (const keyword of ['oneOf', 'allOf', 'not', 'if', 'then', 'else'] as const) {
    it(`R7-C8 refuses \`${keyword}\``, () => {
      const result = projectGroqStrictJsonSchema(
        closedObject({ a: { [keyword]: [{ type: 'string' }] } }),
      );
      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : result.reason).toBe('unsupported-composition');
    });
  }

  it('R7-C20 a schema the projector cannot express yields a pre-transport closed failure', () => {
    const build = buildResponseFormat(closedObject({ a: { oneOf: [{ type: 'string' }] } }), true);
    expect(build.ok).toBe(false);
    // No response format was produced at all, so nothing could have been sent.
    expect('responseFormat' in build).toBe(false);
  });

  it('refuses an untyped node, a tuple array, and an undocumented type union', () => {
    expect(projectGroqStrictJsonSchema(closedObject({ a: {} })).ok).toBe(false);
    expect(
      projectGroqStrictJsonSchema(
        closedObject({ a: { type: 'array', items: [{ type: 'string' }] } }),
      ).ok,
    ).toBe(false);
    expect(
      projectGroqStrictJsonSchema(closedObject({ a: { type: ['string', 'integer'] } })).ok,
    ).toBe(false);
  });

  it('refuses an object whose required set does not match its properties', () => {
    const result = projectGroqStrictJsonSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe('malformed-object');
  });

  it('refuses a node carrying both `const` and `enum` rather than picking one', () => {
    const result = projectGroqStrictJsonSchema(
      closedObject({ a: { type: 'string', const: 'X', enum: ['Y'] } }),
    );
    expect(result.ok).toBe(false);
  });

  it('the closed reason vocabulary is exactly the reviewed set', () => {
    expect([...GROQ_STRICT_PROJECTION_REASONS]).toEqual([
      'not-an-object',
      'unsupported-keyword',
      'unsupported-composition',
      'unsupported-type',
      'malformed-object',
      'malformed-array',
    ]);
  });
});

describe('R7-C14/C15/C19 — strict stays strict', () => {
  it('R7-C14/C15 a strict-supported request produces json_schema with strict:true, never a fallback', () => {
    const build = buildResponseFormat(closedObject({ a: { type: 'string', maxLength: 5 } }), true);
    expect(build.ok).toBe(true);
    if (!build.ok) {
      return;
    }
    const format = build.responseFormat as {
      type: string;
      json_schema: { strict: boolean; schema: unknown };
    };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    // And the SENT document is the projected one, not the caller's.
    expect(keywordsOf(format.json_schema.schema).has('maxLength')).toBe(false);
  });

  it('R7-C1 what is checked is what is sent — no unprojected document reaches the wire', () => {
    const build = buildResponseFormat(
      { $schema: 'x', ...closedObject({ k: { type: 'string', const: 'REPLY' } }) },
      true,
    );
    expect(build.ok).toBe(true);
    if (!build.ok) {
      return;
    }
    const sent = (build.responseFormat as { json_schema: { schema: unknown } }).json_schema.schema;
    expect(keywordsOf(sent)).toEqual(
      new Set(['type', 'properties', 'required', 'additionalProperties', 'enum']),
    );
  });
});

describe('R7-C16/C17/C19/C22 — the request contract itself is unchanged', () => {
  /** A sentinel that would only appear if a raw provider body ever reached a result. */
  const BODY_SENTINEL = 'SENTINEL-PROVIDER-400-BODY-MUST-NOT-SURFACE';

  function harness(response: { status: number; bodyText: string }): {
    provider: GroqModelProvider;
    calls: () => number;
    sent: () => string | undefined;
  } {
    let calls = 0;
    let sent: string | undefined;
    const transport = {
      send: (request: { body: string }): Promise<unknown> => {
        calls += 1;
        sent = request.body;
        return Promise.resolve({ ...response, retryAfterSeconds: null });
      },
    };
    const provider = new GroqModelProvider(
      createGroqProviderConfig({
        providerId: 'groq.test.r7',
        modelId: 'synthetic/test-model',
        modelVersion: 'synthetic-catalog-v1',
        maxInputTokens: 4096,
        maxCompletionTokens: 256,
        supportsStrictJsonSchema: true,
        apiKey: createGroqApiKey('FAKE_QFJ_TEST_KEY_DO_NOT_USE_R7_0000'),
        transport: transport as never,
        dataControlsAttested: true,
      }),
      createSystemClock(),
    );
    return { provider, calls: () => calls, sent: () => sent };
  }

  const structuredInput = (schema: unknown): never =>
    ({
      runId: 'run.r7.1',
      messages: [{ role: 'user' as const, content: 'synthetic probe' }],
      resultMode: 'STRUCTURED' as const,
      timeoutMs: 30_000,
      signal: new AbortController().signal,
      structuredJsonSchema: schema,
    }) as never;

  const FAILING_BODY = JSON.stringify({
    error: { message: BODY_SENTINEL, type: 'invalid_request_error' },
  });

  it('R7-C19 a structured request performs exactly ONE HTTP invocation, with no retry', async () => {
    const h = harness({ status: 400, bodyText: FAILING_BODY });
    await h.provider.invoke(structuredInput(closedObject({ a: { type: 'string' } })));
    expect(h.calls()).toBe(1);
  });

  it('R7-C22 a provider 400 body never surfaces in the result', async () => {
    const h = harness({ status: 400, bodyText: FAILING_BODY });
    const result = await h.provider.invoke(
      structuredInput(closedObject({ a: { type: 'string' } })),
    );
    expect(JSON.stringify(result)).not.toContain(BODY_SENTINEL);
    expect(JSON.stringify(result)).not.toContain('invalid_request_error');
  });

  it('R7-C16/C17 the request body carries only the documented fields', async () => {
    const h = harness({ status: 400, bodyText: '{}' });
    await h.provider.invoke(structuredInput(closedObject({ a: { type: 'string' } })));
    const body = JSON.parse(h.sent() ?? '{}') as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'max_completion_tokens',
      'messages',
      'model',
      'n',
      'response_format',
      'stream',
    ]);
    // `n` must be 1 — Groq documents that any other value is itself a 400.
    expect(body['n']).toBe(1);
    expect(body['stream']).toBe(false);
    // No retry knob, no fallback knob, no tools, no sampling parameters were added while here.
    for (const forbidden of [
      'tools',
      'functions',
      'temperature',
      'top_p',
      'stop',
      'reasoning_format',
      'service_tier',
    ]) {
      expect(forbidden in body).toBe(false);
    }
  });

  it('R7-C20 an unprojectable schema fails BEFORE any transport call', async () => {
    const h = harness({ status: 200, bodyText: '{}' });
    const result = (await h.provider.invoke(
      structuredInput(closedObject({ a: { oneOf: [{ type: 'string' }] } })),
    )) as { status: string };
    expect(result.status).toBe('failed');
    expect(h.calls()).toBe(0);
  });
});

describe('R7-C11 — the projection is broader, and local zod is still the authority', () => {
  /** The same shape the Riya reply uses: a bounded string the provider schema will no longer bound. */
  const localSchema = z.object({ replyBody: z.string().min(1).max(10) }).strict();

  it('a value the PROJECTED provider schema allows is still refused by the local schema', () => {
    const raw = z.toJSONSchema(localSchema);
    const out = projected(raw);
    // The provider document no longer carries the length bound...
    expect(keywordsOf(out).has('maxLength')).toBe(false);
    // ...so a model could emit this. The local schema is what stops it.
    const overLong = { replyBody: 'x'.repeat(50) };
    expect(localSchema.safeParse(overLong).success).toBe(false);
    // And the shape it DOES still constrain is unchanged.
    expect(localSchema.safeParse({ replyBody: 'ok' }).success).toBe(true);
  });

  it('R7-C10 projecting does not touch the local zod schema', () => {
    const before = JSON.stringify(z.toJSONSchema(localSchema));
    projectGroqStrictJsonSchema(z.toJSONSchema(localSchema));
    expect(JSON.stringify(z.toJSONSchema(localSchema))).toBe(before);
    // The bound is still in the local rendering, so nothing was mutated in place.
    expect(before).toContain('maxLength');
  });
});

describe('R7-R1 — no schema container survives unprojected', () => {
  /**
   * The owner-review blocker, reproduced.
   *
   * At PR #129 head, `projectNode` copied PRESERVED keys — including `$defs` — into the output RAW,
   * and then returned early on `$ref` before `$defs` was ever recursively projected. So a definition
   * could carry any keyword at all and still ride out on a successful projection. The downstream
   * `isStrictCompatibleJsonSchema` could not catch it: it is a STRUCTURAL checker and knows nothing
   * about the closed keyword policy.
   *
   * That defeated the whole point of rebuilding from a table, and it defeated M2.
   */
  const ROOT_REF_WITH_DEFS = (nameNode: Record<string, unknown>): Record<string, unknown> => ({
    $ref: '#/$defs/root',
    $defs: {
      root: {
        type: 'object',
        properties: { name: nameNode },
        required: ['name'],
        additionalProperties: false,
      },
    },
  });

  it('R7R1-C1 a local-only constraint inside `$defs` is projected away', () => {
    const out = projected(ROOT_REF_WITH_DEFS({ type: 'string', maxLength: 5 }));
    expect(keywordsOf(out).has('maxLength')).toBe(false);
  });

  it('R7R1-C2 an UNKNOWN keyword inside `$defs` fails closed', () => {
    const result = projectGroqStrictJsonSchema(
      ROOT_REF_WITH_DEFS({ type: 'string', someFutureKeyword: true }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe('unsupported-keyword');
  });

  it('R7R1-C3 `buildResponseFormat` cannot be used to bypass it', () => {
    const build = buildResponseFormat(
      ROOT_REF_WITH_DEFS({ type: 'string', someFutureKeyword: true }),
      true,
    );
    expect(build.ok).toBe(false);
    expect('responseFormat' in build).toBe(false);
  });

  it('R7R1-C4 an ordinary object carrying `$defs` projects them too', () => {
    const withDefs = (leaf: Record<string, unknown>): Record<string, unknown> => ({
      ...closedObject({ child: { $ref: '#/$defs/leaf' } }),
      $defs: { leaf },
    });
    expect(keywordsOf(projected(withDefs({ type: 'string', maxLength: 4 }))).has('maxLength')).toBe(
      false,
    );
    const bad = projectGroqStrictJsonSchema(withDefs({ type: 'string', someFutureKeyword: 1 }));
    expect(bad.ok).toBe(false);
    expect(bad.ok ? undefined : bad.reason).toBe('unsupported-keyword');
  });

  it('R7R1-C5 an `anyOf` node cannot smuggle a sibling container past projection', () => {
    const result = projectGroqStrictJsonSchema({
      anyOf: [{ type: 'string' }, { type: 'null' }],
      $defs: { leaf: { type: 'string', someFutureKeyword: true } },
    });
    // Either the defs are projected (and therefore refused) or the sibling combination is refused.
    // What must NEVER happen is ok:true with the unknown keyword still present.
    expect(result.ok).toBe(false);
  });

  it('R7R1-C6 pure root recursion `$ref: "#"` is still supported', () => {
    const out = projected({
      type: 'object',
      properties: {
        name: { type: 'string' },
        reports: { type: 'array', items: { $ref: '#' } },
      },
      required: ['name', 'reports'],
      additionalProperties: false,
    });
    const reports = (out['properties'] as Record<string, unknown>)['reports'] as Record<
      string,
      unknown
    >;
    expect(reports['items']).toEqual({ $ref: '#' });
  });

  it('R7R1-C7 root object + `$defs` + a property/items `$ref` is still supported', () => {
    const out = projected({
      type: 'object',
      properties: {
        children: { type: 'array', items: { $ref: '#/$defs/file_node' } },
      },
      required: ['children'],
      additionalProperties: false,
      $defs: {
        file_node: {
          type: 'object',
          properties: { name: { type: 'string', description: 'File or directory name' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    });
    const children = (out['properties'] as Record<string, unknown>)['children'] as Record<
      string,
      unknown
    >;
    expect(children['items']).toEqual({ $ref: '#/$defs/file_node' });
    expect(out['$defs']).toBeDefined();
  });

  it('R7R1-C8 `description` is PRESERVED — Groq demonstrates it under strict:true', () => {
    // Re-checked against the current Structured Outputs page: the organization-chart and file-system
    // recursion examples both set `strict: true` and both carry `description` inside property
    // definitions. R7 classified it as a local-only drop, which was wrong about the documented subset.
    const out = projected(
      closedObject({ employee_id: { type: 'string', description: 'Unique employee identifier' } }),
    );
    expect((out['properties'] as Record<string, unknown>)['employee_id']).toEqual({
      type: 'string',
      description: 'Unique employee identifier',
    });
  });

  it('R7R1-C9 after ok:true no unknown keyword exists ANYWHERE', () => {
    const DOCUMENTED = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'items',
      'enum',
      'anyOf',
      '$defs',
      '$ref',
      'description',
    ]);
    const out = projected({
      type: 'object',
      properties: {
        a: { type: 'string', maxLength: 3, description: 'kept' },
        b: { type: 'array', items: { $ref: '#/$defs/leaf' }, maxItems: 2 },
        c: { anyOf: [{ type: 'string', pattern: '^x$' }, { type: 'null' }] },
        d: { $ref: '#' },
      },
      required: ['a', 'b', 'c', 'd'],
      additionalProperties: false,
      $defs: { leaf: { type: 'integer', minimum: 1, description: 'also kept' } },
    });
    for (const keyword of keywordsOf(out)) {
      expect(DOCUMENTED.has(keyword), `${keyword} escaped the closed policy`).toBe(true);
    }
  });
});

describe('R7-R1 — the audit instrument and the sibling policies are themselves pinned', () => {
  it('the keyword audit descends into `$defs`, `anyOf`, `items` and `properties`', () => {
    // The recursive audit is the instrument every "no unknown keyword survives" assertion relies on.
    // An audit that quietly stopped descending would make those assertions vacuous — they would pass
    // by not looking. So the instrument is calibrated against markers planted in each container.
    const found = keywordsOf({
      $defs: { a: { markerInDefs: true } },
      properties: { p: { anyOf: [{ markerInAnyOf: true }] } },
      items: { markerInItems: true },
    });
    expect(found.has('markerInDefs')).toBe(true);
    expect(found.has('markerInAnyOf')).toBe(true);
    expect(found.has('markerInItems')).toBe(true);
  });

  it('a `$ref` node carrying an unreviewed sibling fails closed', () => {
    // Groq demonstrates the pure reference form and the root `$ref` + `$defs` pairing. Everything else
    // is undemonstrated, and an undemonstrated combination is exactly what R7-R1 refuses to guess at.
    for (const sibling of [
      { type: 'object' },
      { enum: ['x'] },
      { description: 'a description' },
      { items: { type: 'string' } },
      { properties: {}, required: [] },
    ]) {
      const result = projectGroqStrictJsonSchema({ $ref: '#', ...sibling });
      expect(result.ok, `\`$ref\` + ${Object.keys(sibling).join('/')} must fail closed`).toBe(
        false,
      );
      expect(result.ok ? undefined : result.reason).toBe('unsupported-composition');
    }
    // And the two reviewed forms still project.
    expect(projectGroqStrictJsonSchema({ $ref: '#' }).ok).toBe(true);
    expect(
      projectGroqStrictJsonSchema({
        $ref: '#/$defs/root',
        $defs: { root: closedObject({ a: { type: 'string' } }) },
      }).ok,
    ).toBe(true);
  });

  it('an `anyOf` node carrying an unreviewed sibling fails closed', () => {
    for (const sibling of [{ type: 'string' }, { enum: ['x'] }, { items: { type: 'string' } }]) {
      const result = projectGroqStrictJsonSchema({
        anyOf: [{ type: 'string' }, { type: 'null' }],
        ...sibling,
      });
      expect(result.ok, `anyOf + ${Object.keys(sibling).join('/')} must fail closed`).toBe(false);
      expect(result.ok ? undefined : result.reason).toBe('unsupported-composition');
    }
    // The reviewed forms — bare, and with a documented `description` — still project.
    expect(projectGroqStrictJsonSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] }).ok).toBe(
      true,
    );
    expect(
      projectGroqStrictJsonSchema({
        anyOf: [{ type: 'string' }, { type: 'null' }],
        description: 'an optional value',
      }).ok,
    ).toBe(true);
  });
});
