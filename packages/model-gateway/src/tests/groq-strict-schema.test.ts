/**
 * MVP-P2A.2 HF4 — the recursive Groq strict-schema compatibility checker.
 *
 * The pre-HF4 checker read three things: the root is an object, its `type` is `object`, its
 * `additionalProperties` is `false`. Nothing below the root was examined at all. Groq strict mode
 * requires EVERY object closed and EVERY property named in that object's `required`, so a schema with
 * one optional nested property passed here and was refused by the provider — the failure arriving as
 * an execution problem rather than as the schema defect it was.
 *
 * These are direct production-checker tests. No network, no credential, no provider.
 */
import { describe, expect, it } from 'vitest';

import {
  buildResponseFormat,
  isStrictCompatibleJsonSchema,
} from '../providers/groq/groq-structured-output.js';

/** A closed object whose `required` is exactly its property keys. */
function closed(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const STRING = { type: 'string' } as const;

describe('the strict subset ACCEPTS what Groq documents', () => {
  it('a simple closed object with every property required', () => {
    expect(isStrictCompatibleJsonSchema(closed({ a: STRING }))).toBe(true);
  });

  it('a nested closed object whose nested properties are all required', () => {
    expect(isStrictCompatibleJsonSchema(closed({ a: closed({ b: STRING }) }))).toBe(true);
  });

  it('an array whose items are compatible objects', () => {
    expect(
      isStrictCompatibleJsonSchema(
        closed({ list: { type: 'array', items: closed({ b: STRING }) } }),
      ),
    ).toBe(true);
  });

  it('an anyOf whose every branch is compatible', () => {
    expect(isStrictCompatibleJsonSchema(closed({ a: { anyOf: [STRING, { type: 'null' }] } }))).toBe(
      true,
    );
    expect(
      isStrictCompatibleJsonSchema(
        closed({ a: { anyOf: [closed({ x: STRING }), closed({ y: STRING })] } }),
      ),
    ).toBe(true);
  });

  it('the supported primitive forms, including const and enum', () => {
    expect(
      isStrictCompatibleJsonSchema(
        closed({
          s: STRING,
          n: { type: 'number' },
          i: { type: 'integer' },
          b: { type: 'boolean' },
          k: { type: 'string', const: 'REPLY' },
          e: { type: 'string', enum: ['A', 'B'] },
        }),
      ),
    ).toBe(true);
  });
});

describe('the strict subset REFUSES what Groq does not accept', () => {
  it('a ROOT property missing from required', () => {
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { a: STRING, b: STRING },
        required: ['a'],
        additionalProperties: false,
      }),
    ).toBe(false);
  });

  it('a NESTED property missing from required — the exact pre-HF4 blind spot', () => {
    expect(
      isStrictCompatibleJsonSchema(
        closed({
          reply: {
            type: 'object',
            properties: { kind: STRING, reasonCode: STRING },
            required: ['kind'],
            additionalProperties: false,
          },
        }),
      ),
    ).toBe(false);
  });

  it('a nested object missing additionalProperties:false', () => {
    expect(
      isStrictCompatibleJsonSchema(
        closed({ a: { type: 'object', properties: { b: STRING }, required: ['b'] } }),
      ),
    ).toBe(false);
  });

  it('additionalProperties:true', () => {
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { a: STRING },
        required: ['a'],
        additionalProperties: true,
      }),
    ).toBe(false);
  });

  it('a missing required array', () => {
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { a: STRING },
        additionalProperties: false,
      }),
    ).toBe(false);
  });

  it('required naming a property that does not exist', () => {
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { a: STRING },
        required: ['a', 'ghost'],
        additionalProperties: false,
      }),
    ).toBe(false);
  });

  it('a duplicate required entry', () => {
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { a: STRING, b: STRING },
        required: ['a', 'a', 'b'],
        additionalProperties: false,
      }),
    ).toBe(false);
  });

  it('array items containing an incompatible object', () => {
    expect(
      isStrictCompatibleJsonSchema(
        closed({
          list: {
            type: 'array',
            items: {
              type: 'object',
              properties: { b: STRING },
              required: [],
              additionalProperties: false,
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it('ONE incompatible branch inside an otherwise valid anyOf', () => {
    expect(
      isStrictCompatibleJsonSchema(
        closed({
          a: {
            anyOf: [
              closed({ x: STRING }),
              {
                type: 'object',
                properties: { y: STRING },
                required: [],
                additionalProperties: false,
              },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it.each([['oneOf'], ['allOf'], ['not']])('the undocumented composition keyword %s', (keyword) => {
    expect(isStrictCompatibleJsonSchema(closed({ a: { [keyword]: [STRING] } }))).toBe(false);
  });

  it('an unknown or absent type', () => {
    expect(isStrictCompatibleJsonSchema(closed({ a: { type: 'geometry' } }))).toBe(false);
    expect(isStrictCompatibleJsonSchema(closed({ a: { minLength: 1 } }))).toBe(false);
  });

  it('a NON-OBJECT root, even though the same node is fine as a property', () => {
    // The pre-HF4 checker got this part right and the recursive rewrite must not lose it: a bare
    // scalar is a legitimate property schema but not a legitimate strict `json_schema` root.
    expect(isStrictCompatibleJsonSchema({ type: 'string' })).toBe(false);
    expect(isStrictCompatibleJsonSchema({ anyOf: [closed({ a: STRING })] })).toBe(false);
    expect(isStrictCompatibleJsonSchema(closed({ a: STRING }))).toBe(true);
  });
});

describe('LOCAL $ref / $defs resolve, because Groq documents recursion through them', () => {
  it('a local $defs reference whose target is compatible', () => {
    expect(
      isStrictCompatibleJsonSchema({
        ...closed({ a: { $ref: '#/$defs/Node' } }),
        $defs: { Node: closed({ x: STRING }) },
      }),
    ).toBe(true);
  });

  it('a referenced object still obeys every strict rule', () => {
    expect(
      isStrictCompatibleJsonSchema({
        ...closed({ a: { $ref: '#/$defs/Node' } }),
        $defs: {
          Node: {
            type: 'object',
            properties: { x: STRING },
            required: [],
            additionalProperties: false,
          },
        },
      }),
    ).toBe(false);
  });

  it('root self-recursion terminates instead of hanging', () => {
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { next: { $ref: '#' }, x: STRING },
        required: ['next', 'x'],
        additionalProperties: false,
      }),
    ).toBe(true);
  });

  it('a MUTUAL reference cycle terminates deterministically', () => {
    expect(
      isStrictCompatibleJsonSchema({
        ...closed({ a: { $ref: '#/$defs/A' } }),
        $defs: {
          A: closed({ b: { $ref: '#/$defs/B' } }),
          B: closed({ a: { $ref: '#/$defs/A' } }),
        },
      }),
    ).toBe(true);
  });

  it.each([
    ['a missing local definition', { $ref: '#/$defs/Nope' }],
    ['an external URL reference', { $ref: 'https://example.invalid/s.json' }],
    ['a malformed pointer', { $ref: '#/definitions/Node' }],
    ['a nested pointer beyond $defs', { $ref: '#/$defs/Node/properties/x' }],
    ['a prototype-shaped pointer', { $ref: '#/$defs/__proto__' }],
    ['a non-string $ref', { $ref: 42 }],
  ])('fails closed on %s', (_name, refNode) => {
    expect(
      isStrictCompatibleJsonSchema({
        ...closed({ a: refNode }),
        $defs: { Node: closed({ x: STRING }) },
      }),
    ).toBe(false);
  });

  it('resolution reaches no network and evaluates nothing', () => {
    // The external case above returns false without any fetch being possible: the resolver only ever
    // indexes an own property of `$defs`. This pins that the ONLY accepted prefixes are the two
    // documented local forms.
    expect(isStrictCompatibleJsonSchema({ ...closed({ a: { $ref: 'Node' } }) })).toBe(false);
    expect(isStrictCompatibleJsonSchema({ ...closed({ a: { $ref: '#/$defs/' } }) })).toBe(false);
  });
});

describe('the response format a compatible schema produces', () => {
  it('is strict json_schema, never a downgrade', () => {
    const built = buildResponseFormat(closed({ a: STRING }), true);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.responseFormat.type).toBe('json_schema');
    expect(built.responseFormat).toMatchObject({
      json_schema: { name: 'qf_structured_output', strict: true },
    });
  });

  it('an incompatible schema is refused BEFORE transport, with no json_object fallback', () => {
    const built = buildResponseFormat(
      { type: 'object', properties: { a: STRING }, required: [], additionalProperties: false },
      true,
    );
    expect(built).toStrictEqual({ ok: false });
  });

  it('best-effort json_object is still used when strict is NOT supported', () => {
    // Unchanged behaviour, and deliberately not made stricter: this path is about a model that cannot
    // do strict at all, where local zod validation remains the authority.
    expect(buildResponseFormat({ type: 'string' }, false)).toStrictEqual({
      ok: true,
      responseFormat: { type: 'json_object' },
    });
  });
});

describe('HF4-R1 — the DOCUMENTED nullable scalar type-array form', () => {
  // Owner review caught a false negative: Groq's strict Structured Outputs documentation demonstrates
  // optional-as-nullable via `type: ["string","null"]` with the property still required, and the
  // first HF4 checker knew only `anyOf`. The repaired Riya schemas were never affected — Zod 4.4.3
  // renders their nullable `reasonCode` through `anyOf` — but a checker that rejects a form the
  // provider demonstrates is wrong as a general contract.
  const nullable = (type: unknown): Record<string, unknown> => ({
    type: 'object',
    properties: { nickname: { type } },
    required: ['nickname'],
    additionalProperties: false,
  });

  it.each([
    ['T1 ["string","null"]', ['string', 'null']],
    ['T2 ["null","string"] — order does not matter', ['null', 'string']],
    ['T3 ["number","null"]', ['number', 'null']],
    ['T4 ["integer","null"]', ['integer', 'null']],
    ['T5 ["boolean","null"]', ['boolean', 'null']],
  ])('accepts %s', (_name, type) => {
    expect(isStrictCompatibleJsonSchema(nullable(type))).toBe(true);
  });

  it('T1 also builds a strict json_schema response format', () => {
    const built = buildResponseFormat(nullable(['string', 'null']), true);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.responseFormat.type).toBe('json_schema');
    expect(built.responseFormat).toMatchObject({ json_schema: { strict: true } });
  });

  it.each([
    ['T6  an empty type array', []],
    ['T7  a single-member array', ['string']],
    ['T8  a duplicated member', ['string', 'string']],
    ['T9  two non-null scalars — NOT general multi-type support', ['string', 'number']],
    ['T10 three members', ['string', 'null', 'number']],
    ['T11 an unknown member', ['geometry', 'null']],
    ['T12 a non-string member', ['string', 42]],
    ['    a null-only pair', ['null', 'null']],
    ['    a nested type array', [['string'], 'null']],
  ])('REFUSES %s', (_name, type) => {
    expect(isStrictCompatibleJsonSchema(nullable(type))).toBe(false);
  });

  it('an invalid type array is refused BEFORE transport, with no downgrade', () => {
    expect(buildResponseFormat(nullable(['string', 'number']), true)).toStrictEqual({ ok: false });
  });

  it('sibling scalar constraints on a nullable type are preserved, not stripped', () => {
    // The check decides SHAPE. Dropping `enum`/`pattern`/`minLength` would silently widen what the
    // model may return, which is the opposite of the point.
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: {
          code: { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[a-z.]+$' },
          pick: { type: ['string', 'null'], enum: ['A', 'B'] },
        },
        required: ['code', 'pick'],
        additionalProperties: false,
      }),
    ).toBe(true);
  });

  it('nullable scalars still obey every surrounding rule', () => {
    // Not required -> still refused, nullable or not.
    expect(
      isStrictCompatibleJsonSchema({
        type: 'object',
        properties: { a: { type: ['string', 'null'] } },
        required: [],
        additionalProperties: false,
      }),
    ).toBe(false);
    // And a type array is not a licence for a non-object root.
    expect(isStrictCompatibleJsonSchema({ type: ['string', 'null'] })).toBe(false);
  });
});
