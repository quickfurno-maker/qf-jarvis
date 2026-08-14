/**
 * MVP-P2A.2 HF4 — the Riya schemas as the PROVIDER actually sees them.
 *
 * ### What this file exists to stop happening again
 *
 * Two properties were `.optional()`: `reply.reasonCode` and `observation.value`. Under Zod's JSON
 * Schema conversion an optional property is emitted but omitted from `required`, and Groq strict mode
 * has no concept of an absent property — every key of every object must be required. So the rendered
 * schema was strict-INCOMPATIBLE at exactly two paths, while the gateway's pre-HF4 checker looked only
 * at the root and reported it fine.
 *
 * Worse, `observationSchema` carried its SET/CLEAR rules in a `.superRefine()`, which
 * `z.toJSONSchema` cannot see at all. The provider was shown a laxer contract than the one the answer
 * would be judged against: a generic object where `value` was optional and any operation/provenance
 * pair was permitted.
 *
 * ### These assertions render, they do not assume
 *
 * Everything below goes through the same `z.toJSONSchema` call the gateway uses, against the Zod the
 * workspace actually installs. A structural walker reports the failing PATH rather than diffing a
 * giant snapshot, because the useful output of a regression here is "which object broke".
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  riyaGroundedReplyOutputSchema,
  riyaStructuredOutputSchema,
} from '../internal/output-schema.js';

const SCHEMAS = [
  ['riyaStructuredOutputSchema', riyaStructuredOutputSchema],
  ['riyaGroundedReplyOutputSchema', riyaGroundedReplyOutputSchema],
] as const;

type Node = Record<string, unknown>;

const render = (schema: z.ZodType): Node => z.toJSONSchema(schema);

/** Walk every reachable schema node, reporting PATHS rather than a wall of JSON. */
function findViolations(root: Node): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    const current = node as Node;
    for (const keyword of ['oneOf', 'allOf', 'not']) {
      if (keyword in current) {
        problems.push(`${path}: unsupported composition ${keyword}`);
      }
    }
    if ('$ref' in current) {
      problems.push(`${path}: unexpected $ref`);
    }
    if (Array.isArray(current['anyOf'])) {
      (current['anyOf'] as unknown[]).forEach((branch, index) => {
        walk(branch, `${path}/anyOf/${String(index)}`);
      });
      return;
    }
    if (current['type'] === 'object') {
      const properties = (current['properties'] ?? {}) as Node;
      const required = (current['required'] ?? []) as string[];
      const propertyNames = Object.keys(properties);
      const missing = propertyNames.filter((name) => !required.includes(name));
      if (missing.length > 0) {
        problems.push(`${path}: not required -> ${missing.join(',')}`);
      }
      const extra = required.filter((name) => !propertyNames.includes(name));
      if (extra.length > 0) {
        problems.push(`${path}: required names non-properties -> ${extra.join(',')}`);
      }
      if (current['additionalProperties'] !== false) {
        problems.push(`${path}: additionalProperties is not false`);
      }
      for (const [name, child] of Object.entries(properties)) {
        walk(child, `${path}/properties/${name}`);
      }
      return;
    }
    if (current['type'] === 'array') {
      walk(current['items'], `${path}/items`);
    }
  };
  walk(root, '#');
  return problems;
}

describe('the rendered Riya schemas satisfy the real Groq strict subset', () => {
  it.each(SCHEMAS)('%s has NO structural violation at any path', (_name, schema) => {
    expect(findViolations(render(schema))).toStrictEqual([]);
  });

  // NOTE: the proof that these render past the PRODUCTION Groq checker lives in
  // `riya-candidate-evidence-live`, the one package that already depends on both this one and
  // `model-gateway`. Adding a gateway dependency here purely for a test would couple the Riya
  // contract to a provider package, which is exactly the direction this codebase keeps separate.
  // The walker above enforces the same rules independently, so neither side is trusting the other.

  it.each(SCHEMAS)('%s renders no $defs and no $ref', (_name, schema) => {
    const rendered = render(schema);
    expect(Object.keys(rendered)).not.toContain('$defs');
    expect(JSON.stringify(rendered)).not.toContain('$ref');
  });
});

describe('reply.reasonCode is REQUIRED and nullable, in both schemas', () => {
  it.each(SCHEMAS)('%s requires reasonCode rather than omitting it', (_name, schema) => {
    const reply = (render(schema)['properties'] as Node)['reply'] as Node;
    expect(reply['required']).toContain('reasonCode');
    // The exact pre-HF4 defect, stated as an assertion: the property existed and was not required.
    expect(Object.keys(reply['properties'] as Node).sort()).toStrictEqual(
      [...(reply['required'] as string[])].sort(),
    );
  });

  it.each(SCHEMAS)('%s expresses "no reason code" as an explicit null branch', (_name, schema) => {
    const reply = (render(schema)['properties'] as Node)['reply'] as Node;
    const reasonCode = (reply['properties'] as Node)['reasonCode'] as Node;
    const branches = reasonCode['anyOf'] as Node[];
    expect(Array.isArray(branches)).toBe(true);
    expect(branches.map((one) => one['type']).sort()).toStrictEqual(['null', 'string']);
  });
});

describe('the observation SET/CLEAR rules are now PROVIDER-VISIBLE', () => {
  const observationItems = (): Node => {
    const evolution = (render(riyaStructuredOutputSchema)['properties'] as Node)[
      'evolution'
    ] as Node;
    return ((evolution['properties'] as Node)['observations'] as Node)['items'] as Node;
  };

  it('renders as anyOf — the composition Groq documents, not oneOf', () => {
    // `z.union` renders `anyOf`; `z.discriminatedUnion` renders `oneOf`, which Groq does not document.
    // The choice between them is therefore a provider-compatibility decision, not a style one.
    const items = observationItems();
    expect(Array.isArray(items['anyOf'])).toBe(true);
    expect(items['oneOf']).toBeUndefined();
    expect((items['anyOf'] as Node[]).length).toBe(2);
  });

  it('the SET branch REQUIRES value; the CLEAR branch has NO value property at all', () => {
    const branches = observationItems()['anyOf'] as Node[];
    const byOperation = new Map(
      branches.map((branch) => [
        ((branch['properties'] as Node)['operation'] as Node)['const'],
        branch,
      ]),
    );

    const set = byOperation.get('SET');
    expect(set).toBeDefined();
    expect(set?.['required']).toContain('value');

    const clear = byOperation.get('CLEAR');
    expect(clear).toBeDefined();
    // Absence, not a nullable value. `CLEAR forbids a value` is expressed by there being nowhere to
    // put one, which `additionalProperties:false` then enforces.
    expect(Object.keys((clear?.['properties'] ?? {}) as Node)).not.toContain('value');
    // And CLEAR is pinned to an explicit user statement — an inference may not withdraw a fact.
    expect(((clear?.['properties'] as Node)['provenance'] as Node)['const']).toBe('user_stated');
  });

  it('every branch is independently closed and fully required', () => {
    for (const branch of observationItems()['anyOf'] as Node[]) {
      expect(branch['additionalProperties']).toBe(false);
      expect(Object.keys(branch['properties'] as Node).sort()).toStrictEqual(
        [...(branch['required'] as string[])].sort(),
      );
    }
  });
});

describe('LOCAL accepted language is EXACTLY what it was before HF4', () => {
  // The repair moved the SET/CLEAR rules from a `.superRefine()` into union branches so the provider
  // could see them. That is only safe if the set of accepted values did not move by one element, in
  // either direction — so every branch of the old refinement is pinned here.
  const answer = (observation: unknown, reasonCode: unknown = null): unknown => ({
    reply: { kind: 'REPLY', replyBody: 'hi', reasonCode, citations: [] },
    evolution: {
      version: 1,
      observations: [observation],
      skipProjectDetails: false,
      questionPlan: { phase: 'NEED', questionFields: [] },
    },
  });
  const accepts = (observation: unknown): boolean =>
    riyaStructuredOutputSchema.safeParse(answer(observation)).success;

  it.each([
    [
      'SET + value + user_stated',
      { field: 'budget', operation: 'SET', value: 'x', provenance: 'user_stated' },
      true,
    ],
    [
      'SET + value + model_inferred',
      { field: 'budget', operation: 'SET', value: 'x', provenance: 'model_inferred' },
      true,
    ],
    ['SET without value', { field: 'budget', operation: 'SET', provenance: 'user_stated' }, false],
    [
      'CLEAR without value + user_stated',
      { field: 'budget', operation: 'CLEAR', provenance: 'user_stated' },
      true,
    ],
    [
      'CLEAR with a value',
      { field: 'budget', operation: 'CLEAR', value: 'x', provenance: 'user_stated' },
      false,
    ],
    [
      'CLEAR + model_inferred',
      { field: 'budget', operation: 'CLEAR', provenance: 'model_inferred' },
      false,
    ],
    [
      'an unknown operation',
      { field: 'budget', operation: 'NUKE', value: 'x', provenance: 'user_stated' },
      false,
    ],
    [
      'an extra key',
      { field: 'budget', operation: 'SET', value: 'x', provenance: 'user_stated', extra: 1 },
      false,
    ],
  ])('%s', (_name, observation, expected) => {
    expect(accepts(observation)).toBe(expected);
  });

  it('CLEAR + value:null is STILL REFUSED — null is a value, not the absence of one', () => {
    // The owner decision this pins: representing CLEAR's value as nullable would have ACCEPTED this,
    // expanding the language. The CLEAR branch has no `value` property at all, so `.strict()` refuses
    // the key whatever it holds.
    expect(
      accepts({ field: 'budget', operation: 'CLEAR', value: null, provenance: 'user_stated' }),
    ).toBe(false);
  });

  it('reasonCode: a valid string is accepted, an invalid one refused, and OMISSION is refused', () => {
    const observation = {
      field: 'budget',
      operation: 'SET',
      value: 'x',
      provenance: 'user_stated',
    };
    expect(riyaStructuredOutputSchema.safeParse(answer(observation, 'ok.code')).success).toBe(true);
    expect(riyaStructuredOutputSchema.safeParse(answer(observation, 'not a code!')).success).toBe(
      false,
    );
    // Required now: the model must SAY there is no reason code rather than leaving the key out.
    const omitted = answer(observation) as { reply: Record<string, unknown> };
    delete omitted.reply['reasonCode'];
    expect(riyaStructuredOutputSchema.safeParse(omitted).success).toBe(false);
  });
});

describe('LOCAL strictness is a SEPARATE guarantee from the rendered additionalProperties', () => {
  // A mutation campaign found this, and it is worth stating plainly: in the installed Zod 4.4.3,
  // `z.object({...})` and `z.object({...}).strict()` render the SAME JSON Schema — both carry
  // `additionalProperties: false`. They differ only in how the LOCAL parser behaves, where plain
  // accepts an unknown key and `.strict()` refuses it.
  //
  // So a green provider-schema audit is not evidence that local parsing is closed. Dropping
  // `.strict()` from a nested object left every rendered-shape assertion above passing while quietly
  // widening what this package accepts. Each level therefore gets its own local assertion.
  const valid = {
    reply: { kind: 'REPLY', replyBody: 'hi', reasonCode: null, citations: [] },
    evolution: {
      version: 1,
      observations: [],
      skipProjectDetails: false,
      questionPlan: { phase: 'NEED', questionFields: [] },
    },
  } as const;

  const withExtraAt = (
    path: 'root' | 'reply' | 'evolution' | 'questionPlan' | 'citation',
  ): unknown => {
    const draft = JSON.parse(JSON.stringify(valid)) as Record<string, never>;
    const target = draft as unknown as {
      reply: Record<string, unknown> & { citations: unknown[] };
      evolution: Record<string, unknown> & { questionPlan: Record<string, unknown> };
    };
    if (path === 'root') (draft as Record<string, unknown>)['extra'] = 1;
    if (path === 'reply') target.reply['extra'] = 1;
    if (path === 'evolution') target.evolution['extra'] = 1;
    if (path === 'questionPlan') target.evolution.questionPlan['extra'] = 1;
    if (path === 'citation')
      target.reply.citations.push({ knowledgeId: 'k.1', version: 1, extra: 1 });
    return draft;
  };

  it('the baseline answer is accepted', () => {
    expect(riyaStructuredOutputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([['root'], ['reply'], ['evolution'], ['questionPlan'], ['citation']] as const)(
    'an unknown key at %s is REFUSED locally',
    (path) => {
      expect(riyaStructuredOutputSchema.safeParse(withExtraAt(path)).success).toBe(false);
    },
  );

  it('the reply-only schema is closed at both its levels too', () => {
    expect(riyaGroundedReplyOutputSchema.safeParse({ reply: valid.reply }).success).toBe(true);
    expect(riyaGroundedReplyOutputSchema.safeParse({ reply: valid.reply, extra: 1 }).success).toBe(
      false,
    );
    expect(
      riyaGroundedReplyOutputSchema.safeParse({ reply: { ...valid.reply, extra: 1 } }).success,
    ).toBe(false);
  });
});
