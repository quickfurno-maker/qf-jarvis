/**
 * The provider-facing Groq STRICT schema projection (MVP-P2A.2 HF4-R7).
 *
 * ### What RUN S9 established
 *
 * S9 reached the provider. The smoke passed, the clipboard ingress worked, the timer order held, the
 * wire milestones were all present, and the one governed cancellation cancelled exactly as designed.
 * Then all NINE ordinary MODEL_REQUIRED safety requests came back identically:
 *
 *     providerHttpStatus=400  providerHttpClass=BAD_REQUEST_400
 *     providerErrorType=INVALID_REQUEST_ERROR  providerErrorCode=OTHER_OR_ABSENT
 *
 * Nine different fixtures, nine identical rejections, on a path whose only shared novelty against the
 * passing smoke is the full Riya strict JSON Schema. That is a REQUEST CONTRACT failure, not a model
 * one, and no amount of reading the model's output would have found it — there was no output.
 *
 * ### The defect this closes
 *
 * `isStrictCompatibleJsonSchema` checks STRUCTURE: object roots, closed objects, exact `required`
 * sets, array items, scalar types, nullable type arrays, `anyOf`, local `$ref`/`$defs`. It is correct
 * about all of that. But it never constrained the KEYWORD SET, and `buildResponseFormat` then sent the
 * schema verbatim. So a node could carry any number of sibling keywords the checker had never
 * examined, and the function still called the schema "strict compatible".
 *
 * Measured on the real schemas rather than guessed at, `z.toJSONSchema(riyaStructuredOutputSchema)`
 * emits `$schema`, `const` (5×), `minLength` (4×), `maxLength` (4×), `pattern` (2×), `minimum`,
 * `maximum` and `maxItems` (3×) alongside the documented structural keywords. Every one of those rode
 * through to the provider. Groq's Structured Outputs documentation establishes a POSITIVE subset —
 * String, Number, Boolean, Integer, Object, Array, Enum, `anyOf`, and `$defs`/`$ref` recursion — and
 * does not establish any of those eight.
 *
 * ### The rule, stated once
 *
 * Jarvis must not SEND a strict-schema keyword it has not proved to be in the documented subset. That
 * is deliberately narrower than claiming Groq rejects each one: this module does not need to know
 * which keyword caused the 400 in order to stop shipping keywords nobody validated.
 *
 * So every node is REBUILT from a closed policy table rather than filtered in place:
 *
 *   - PRESERVE      the documented structural vocabulary, unchanged.
 *   - CANONICALIZE  `const: X` becomes `enum: [X]`. Zod renders `z.literal(...)` as `const`; the docs
 *                   establish `enum` and never mention `const`, and a singleton enum is the same
 *                   constraint expressed in the form the provider documents.
 *   - DROP          validation-only keywords, from the PROVIDER schema only.
 *   - FAIL CLOSED   structural composition that cannot be expressed in the subset — and, critically,
 *                   ANY keyword this table does not name. An unknown keyword is the exact shape of the
 *                   defect being repaired, so the default must be refusal rather than pass-through.
 *
 * ### Dropping is safe because the local schema never moved
 *
 * The provider-facing schema is a CONSTRAINED-DECODING contract, nothing more. The acceptance
 * authority is still the caller's zod schema, applied to the parsed response after it returns. Dropping
 * `maxLength` here means the model is no longer prevented from emitting a 3000-character reply; it does
 * NOT mean such a reply would be accepted. The gateway still runs `structuredSchema.safeParse(...)` and
 * still rejects it as structured-output-invalid. A spec proves exactly that, because "the projection is
 * broader than local acceptance" is only tolerable while local acceptance is genuinely unchanged.
 *
 * The projection may therefore be BROADER than the local schema. It may never be broader at the
 * gateway's acceptance boundary, and it is not.
 */

import { z, type ZodType } from 'zod';

/**
 * Render a STRUCTURED request's zod schema to the provider-neutral JSON Schema hint.
 *
 * The gateway's own first step, named so a spec can take the REAL production schema and follow the
 * exact pipeline — render, then project — rather than approximating it. On any conversion failure it
 * returns `{}`, which the strict path then refuses, because an empty document is not an object schema.
 */
export function renderStructuredJsonSchema(schema: ZodType): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return {};
  }
}

/** Why a schema could not be expressed in the documented subset. Closed, and never a schema dump. */
export const GROQ_STRICT_PROJECTION_REASONS = [
  'not-an-object',
  'unsupported-keyword',
  'unsupported-composition',
  'unsupported-type',
  'malformed-object',
  'malformed-array',
] as const;
export type GroqStrictProjectionReason = (typeof GROQ_STRICT_PROJECTION_REASONS)[number];

/** The projection outcome. On failure it carries a closed reason — never the offending schema. */
export type GroqStrictProjection =
  | { readonly ok: true; readonly schema: Record<string, unknown> }
  | { readonly ok: false; readonly reason: GroqStrictProjectionReason };

/**
 * Keywords PRESERVED verbatim: the documented structural vocabulary.
 *
 * Each one is named by Groq's Structured Outputs documentation — the primitive and complex types, the
 * strict-mode object requirements, `enum`, `anyOf`, and the `$defs`/`$ref` recursion form.
 */
const PRESERVED = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'anyOf',
  '$defs',
  '$ref',
]);

/**
 * Keywords DROPPED from the provider schema and kept in the local one.
 *
 * All of these constrain a VALUE that already has a supported shape. None of them is established by
 * the strict documentation, and none of them is load-bearing for constrained decoding — the model
 * emitting a too-long string is a case the local schema already refuses.
 *
 * `$schema` is here rather than in the preserve set for the same reason as the rest: it is a document
 * meta-annotation the strict docs never mention, and forwarding an unproven root keyword is precisely
 * the class of thing that produces a 400 nobody can attribute.
 */
const DROPPED = new Set([
  '$schema',
  '$id',
  '$comment',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minContains',
  'maxContains',
  'minProperties',
  'maxProperties',
]);

/**
 * Composition keywords that FAIL CLOSED.
 *
 * They may well work. "Probably supported" is not a basis for a strict schema whose failure mode is
 * every request being rejected, which is the lesson S9 paid for. A schema needing one of these should
 * be re-expressed in the documented subset — `z.union(...)` renders to `anyOf` where
 * `z.discriminatedUnion(...)` renders to `oneOf`, and both describe the same branches.
 */
const UNSUPPORTED_COMPOSITION = new Set([
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
  'prefixItems',
  'contains',
  'propertyNames',
  'patternProperties',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedProperties',
  'unevaluatedItems',
  '$anchor',
  '$dynamicRef',
  '$dynamicAnchor',
]);

/** The scalar `type` values the documented subset names. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const fail = (reason: GroqStrictProjectionReason): GroqStrictProjection => ({ ok: false, reason });

/**
 * Is this `type` value one the subset can express?
 *
 * A bare scalar, or the documented nullable pair such as `['string','null']` — exactly one non-null
 * scalar plus `null`, in either order. General multi-type arrays are not documented and fail closed.
 */
function typeIsSupported(type: unknown): boolean {
  if (typeof type === 'string') {
    return SCALAR_TYPES.has(type) || type === 'object' || type === 'array';
  }
  if (!Array.isArray(type) || type.length !== 2) {
    return false;
  }
  const [first, second] = type as readonly unknown[];
  if (typeof first !== 'string' || typeof second !== 'string') {
    return false;
  }
  if (!SCALAR_TYPES.has(first) || !SCALAR_TYPES.has(second)) {
    return false;
  }
  return [first, second].filter((one) => one === 'null').length === 1;
}

/** Project one node, rebuilding it from the policy table. Returns the node or a closed reason. */
function projectNode(node: unknown): GroqStrictProjection {
  if (!isRecord(node)) {
    return fail('not-an-object');
  }

  const out: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (UNSUPPORTED_COMPOSITION.has(key)) {
      return fail('unsupported-composition');
    }
    if (DROPPED.has(key)) {
      // Local-validation-only. It stays in the caller's zod schema and never reaches the provider.
      continue;
    }
    if (key === 'const') {
      // CANONICALIZED, not dropped: the constraint is real and must survive, in the documented form.
      // `undefined` is not a JSON value and cannot be expressed as a singleton enum, so it fails.
      const literal = node[key];
      if (literal === undefined) {
        return fail('unsupported-keyword');
      }
      out['enum'] = [literal];
      continue;
    }
    if (!PRESERVED.has(key)) {
      // The DEFAULT, and the whole point of the repair: a keyword nobody classified is a keyword
      // nobody proved, so it is refused rather than forwarded.
      return fail('unsupported-keyword');
    }
    out[key] = node[key];
  }

  // A node carrying BOTH — `z.literal()` inside an enum-shaped position, say — would have the literal
  // silently win. Refuse instead of choosing for the author.
  if ('const' in node && 'enum' in node) {
    return fail('unsupported-keyword');
  }

  if ('$ref' in out) {
    if (typeof out['$ref'] !== 'string') {
      return fail('unsupported-keyword');
    }
    // A reference node carries nothing else in the documented form; siblings were already policed.
    return { ok: true, schema: out };
  }

  if ('anyOf' in out) {
    const branches = out['anyOf'];
    if (!Array.isArray(branches) || branches.length === 0) {
      return fail('unsupported-composition');
    }
    const projected: unknown[] = [];
    for (const branch of branches) {
      const one = projectNode(branch);
      if (!one.ok) {
        return one;
      }
      projected.push(one.schema);
    }
    out['anyOf'] = projected;
    return { ok: true, schema: out };
  }

  if ('$defs' in out) {
    const defs = out['$defs'];
    if (!isRecord(defs)) {
      return fail('malformed-object');
    }
    const projectedDefs: Record<string, unknown> = {};
    for (const name of Object.keys(defs)) {
      const one = projectNode(defs[name]);
      if (!one.ok) {
        return one;
      }
      projectedDefs[name] = one.schema;
    }
    out['$defs'] = projectedDefs;
  }

  const type = out['type'];
  if (type === undefined) {
    // Every node the subset can express names its type, except the `$ref` and `anyOf` forms handled
    // above. An untyped node is not something to guess at.
    return fail('unsupported-type');
  }
  if (!typeIsSupported(type)) {
    return fail('unsupported-type');
  }

  if (type === 'object') {
    const properties = out['properties'];
    if (!isRecord(properties)) {
      return fail('malformed-object');
    }
    const projectedProperties: Record<string, unknown> = {};
    for (const name of Object.keys(properties)) {
      const one = projectNode(properties[name]);
      if (!one.ok) {
        return one;
      }
      projectedProperties[name] = one.schema;
    }
    out['properties'] = projectedProperties;
    // The strict-mode requirements are RESTATED here rather than assumed: every property required,
    // nothing else required, and the object closed. `isStrictCompatibleJsonSchema` re-proves it on the
    // projected document afterwards, so this is belt and braces on the one rule Groq states outright.
    out['additionalProperties'] = false;
    const names = Object.keys(projectedProperties);
    const required = out['required'];
    if (!Array.isArray(required) || required.some((one) => typeof one !== 'string')) {
      return fail('malformed-object');
    }
    const requiredNames = required as readonly string[];
    if (new Set(requiredNames).size !== requiredNames.length) {
      return fail('malformed-object');
    }
    if (requiredNames.length !== names.length || !names.every((n) => requiredNames.includes(n))) {
      return fail('malformed-object');
    }
    return { ok: true, schema: out };
  }

  if (type === 'array') {
    const items = out['items'];
    if (items === undefined || Array.isArray(items)) {
      // The tuple form would need per-position support that is not documented.
      return fail('malformed-array');
    }
    const one = projectNode(items);
    if (!one.ok) {
      return one;
    }
    out['items'] = one.schema;
    return { ok: true, schema: out };
  }

  return { ok: true, schema: out };
}

/**
 * Project a provider-neutral JSON Schema onto the documented Groq strict subset.
 *
 * Returns a NEW document; the input is never mutated, so the caller's schema hint and the local zod
 * schema it came from are untouched. A construct that cannot be expressed fails BEFORE transport with
 * a closed reason rather than being sent and rejected by the provider.
 */
export function projectGroqStrictJsonSchema(jsonSchema: unknown): GroqStrictProjection {
  if (!isRecord(jsonSchema)) {
    return fail('not-an-object');
  }
  return projectNode(jsonSchema);
}
