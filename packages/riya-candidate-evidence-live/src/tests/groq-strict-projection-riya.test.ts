/**
 * MVP-P2A.2 HF4-R7 — the REAL Riya schemas, projected onto Groq's documented strict subset.
 *
 * ### Why this spec lives here
 *
 * `model-gateway` cannot import `riya-model-interaction` and `riya-model-interaction` cannot import
 * `model-gateway`; the candidate evidence operator is the one package that depends on both. So this is
 * the only place a spec can take the ACTUAL production Riya schema, run it through the ACTUAL
 * projector, and assert on the result. A synthetic replica here would prove a replica.
 *
 * ### What RUN S9 needed and did not have
 *
 * S9's nine ordinary safety requests all reached the transport and all came back HTTP 400 /
 * `invalid_request_error`. The measured keyword inventory of the real schema explains why nothing
 * local caught it: `z.toJSONSchema(riyaStructuredOutputSchema)` emits `$schema`, `const`, `minLength`,
 * `maxLength`, `pattern`, `minimum`, `maximum` and `maxItems`, and Groq's Structured Outputs
 * documentation establishes none of them. The structural checker passed the schema because it only
 * ever checked structure.
 *
 * These specs pin the inventory itself, so a future Zod or schema change that re-introduces an
 * unproven keyword fails HERE rather than in a live run nobody can re-authorize.
 *
 * Every test is offline. No provider, no clipboard, no credential.
 */
import { projectGroqStrictJsonSchema, renderStructuredJsonSchema } from '@qf-jarvis/model-gateway';
import {
  createRiyaConversationModelProfile,
  createRiyaGroundedReplyModelProfile,
} from '@qf-jarvis/riya-model-interaction';
import { describe, expect, it } from 'vitest';

import { SYNTHETIC_AVAILABILITY, syntheticContinuityFor } from '../synthetic-context.js';

/** The two production profiles, built exactly as the candidate turn builds them. */
function profileArgs(): Parameters<typeof createRiyaConversationModelProfile>[0] {
  return {
    current: syntheticContinuityFor('NEED', 'projection-spec'),
    availabilitySnapshot: SYNTHETIC_AVAILABILITY,
  };
}

const STRUCTURED = createRiyaConversationModelProfile(profileArgs()).structuredSchema;
const GROUNDED = createRiyaGroundedReplyModelProfile(profileArgs()).structuredSchema;

/** Every keyword appearing anywhere in a JSON Schema document. */
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
    } else if (key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      keywordsOf(value, out);
    }
  }
  return out;
}

/**
 * The keywords Groq's Structured Outputs documentation establishes for strict mode.
 *
 * `description` is here as of HF4-R7-R1: owner review found it inside property definitions in the
 * strict:true organization-chart and file-system recursion examples. The Riya schemas happen to carry
 * none, so nothing about their projection changes — but the set has to describe the POLICY, not just
 * the two schemas it is currently applied to.
 */
const DOCUMENTED_SUBSET = new Set([
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

describe('R7-C1 — the measured keyword inventory of the real Riya schemas', () => {
  it('the raw Zod rendering carries keywords Groq does not document', () => {
    // The measurement RUN S9 was missing. If this set ever shrinks the projector may be doing less
    // work than it thinks; if it grows, an unproven keyword has appeared and must be classified.
    const raw = keywordsOf(renderStructuredJsonSchema(STRUCTURED));
    expect([...raw].sort()).toEqual([
      '$schema',
      'additionalProperties',
      'anyOf',
      'const',
      'enum',
      'items',
      'maxItems',
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'pattern',
      'properties',
      'required',
      'type',
    ]);
    // Eight of those are outside the documented subset — the R7 defect, measured.
    expect([...raw].filter((k) => !DOCUMENTED_SUBSET.has(k)).sort()).toEqual([
      '$schema',
      'const',
      'maxItems',
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'pattern',
    ]);
  });

  it('the grounded-reply rendering carries the same class of keywords', () => {
    const raw = keywordsOf(renderStructuredJsonSchema(GROUNDED));
    expect([...raw].filter((k) => !DOCUMENTED_SUBSET.has(k)).sort()).toEqual([
      '$schema',
      'const',
      'maxItems',
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'pattern',
    ]);
  });
});

describe('R7-C12/C13 — both real schemas project into the documented subset', () => {
  for (const [label, schema] of [
    ['riyaStructuredOutputSchema', STRUCTURED],
    ['riyaGroundedReplyOutputSchema', GROUNDED],
  ] as const) {
    it(`${label} projects, and every surviving keyword is documented`, () => {
      const result = projectGroqStrictJsonSchema(renderStructuredJsonSchema(schema));
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      for (const keyword of keywordsOf(result.schema)) {
        expect(DOCUMENTED_SUBSET.has(keyword), `${keyword} is not in the documented subset`).toBe(
          true,
        );
      }
    });
  }

  it('R7-C4 the Riya literals survive as singleton enums with their exact values', () => {
    const result = projectGroqStrictJsonSchema(renderStructuredJsonSchema(STRUCTURED));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const document = JSON.stringify(result.schema);
    // `kind: REPLY`, the two observation operations, the provenance and the evolution version all
    // reach the provider as constraints rather than being silently dropped with the `const` keyword.
    for (const literal of ['"REPLY"', '"SET"', '"CLEAR"', '"user_stated"']) {
      expect(document).toContain(literal);
    }
    expect(document).not.toContain('"const"');
    const properties = (result.schema['properties'] as Record<string, Record<string, unknown>>)[
      'evolution'
    ]?.['properties'] as Record<string, unknown>;
    expect((properties['version'] as Record<string, unknown>)['enum']).toEqual([1]);
  });

  it('R7-C6 reasonCode stays a REQUIRED nullable union', () => {
    const result = projectGroqStrictJsonSchema(renderStructuredJsonSchema(STRUCTURED));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const rootProperties = result.schema['properties'] as Record<string, unknown>;
    const reply = rootProperties['reply'] as Record<string, unknown>;
    expect(reply['required']).toContain('reasonCode');
    const reason = (reply['properties'] as Record<string, unknown>)['reasonCode'] as Record<
      string,
      unknown
    >;
    expect(reason['anyOf']).toEqual([{ type: 'string' }, { type: 'null' }]);
  });

  it('R7-C7 the observation union is anyOf, never oneOf', () => {
    const result = projectGroqStrictJsonSchema(renderStructuredJsonSchema(STRUCTURED));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(keywordsOf(result.schema).has('anyOf')).toBe(true);
    expect(keywordsOf(result.schema).has('oneOf')).toBe(false);
  });
});

describe('R7-C11 — local zod remains the acceptance authority', () => {
  it('a reply the projected provider schema permits is still refused locally', () => {
    const result = projectGroqStrictJsonSchema(renderStructuredJsonSchema(GROUNDED));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // The provider document no longer bounds the reply length...
    expect(keywordsOf(result.schema).has('maxLength')).toBe(false);
    // ...so a constrained decode could produce this. The UNCHANGED local schema is what refuses it,
    // which is the only reason dropping the bound from the provider document is safe at all.
    const overLong = {
      reply: {
        kind: 'REPLY',
        replyBody: 'x'.repeat(5000),
        reasonCode: null,
        citations: [],
      },
    };
    expect(GROUNDED.safeParse(overLong).success).toBe(false);
  });

  it('R7-C10 the local schema still carries the bounds the provider document dropped', () => {
    const raw = JSON.stringify(renderStructuredJsonSchema(GROUNDED));
    expect(raw).toContain('maxLength');
    expect(raw).toContain('pattern');
    expect(raw).toContain('minimum');
  });

  it('R7-C12 a well-formed Riya answer still passes local validation', () => {
    const valid = {
      reply: {
        kind: 'REPLY',
        replyBody: 'A short, well-formed synthetic reply.',
        reasonCode: null,
        citations: [],
      },
    };
    expect(GROUNDED.safeParse(valid).success).toBe(true);
  });
});
