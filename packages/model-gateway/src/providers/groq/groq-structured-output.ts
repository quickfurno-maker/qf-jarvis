/**
 * Groq structured-output mapping (QFJ-P04.01B, ADR-0046; strict subset repaired in MVP-P2A.2 HF4).
 *
 * A STRUCTURED request maps to `response_format`. STRICT `json_schema` is used ONLY when the configured
 * model capability declares strict support AND the JSON Schema meets Groq's strict restrictions;
 * otherwise the request fails BEFORE any transport call rather than sending an invalid strict schema.
 * When strict is not supported, best-effort `json_object` mode is used and the gateway's local zod
 * validation remains the authority. No provider tools, no streaming, and no hidden model-based JSON
 * repair.
 *
 * ### The restriction is RECURSIVE, and the old comment here was wrong
 *
 * This module used to describe Groq's strict requirement as "an object with
 * `additionalProperties:false`", and the check enforced exactly that — on the ROOT node only. That is
 * materially weaker than the real contract. Groq strict mode requires EVERY object in the schema to be
 * closed and EVERY property of every object to appear in that object's `required` array. A schema
 * whose root is closed but whose nested `items` object leaves one property optional is invalid, and
 * the old checker called it compatible.
 *
 * The consequence was not cosmetic. A schema that fails Groq's own validation is rejected by the
 * provider, so a candidate declaring strict support could have every request refused while the local
 * checker reported the schema fine — the failure surfacing as an execution problem rather than as the
 * schema defect it is.
 *
 * ### Optionality has to be expressed, not omitted
 *
 * Under this subset there is no such thing as an absent property. "No value" is expressed as an
 * explicit `null` branch with the property still required — which is why `anyOf` matters below.
 *
 * ### Fail closed on anything not proven supported
 *
 * `anyOf` is accepted because Groq documents it. `oneOf`, `allOf` and `not` are NOT: they may well
 * work, but "probably supported" is not a basis for sending a strict schema, and the failure mode is
 * silent provider-side rejection of every request. A schema needing one should be re-expressed in the
 * supported subset — `z.union(...)` renders to `anyOf` whereas `z.discriminatedUnion(...)` renders to
 * `oneOf`, and the two describe the same branches.
 *
 * ### Local `$ref` / `$defs` ARE supported, because Groq documents recursion through them
 *
 * An earlier draft of this repair failed closed on every `$ref`. That would have been wrong as a
 * general contract: a function named `isStrictCompatibleJsonSchema` must not call a schema Groq
 * documents incompatible, or the next author ends up re-expressing a legitimate recursive schema to
 * satisfy a checker rather than a provider.
 *
 * So LOCAL references resolve: `#` and `#/$defs/<name>`. Everything else fails closed — an external
 * URI, a pointer into anything but `$defs`, a nested pointer, a missing definition. Resolution never
 * fetches, never evaluates and never walks a prototype: `$defs` is read with an own-property check,
 * so `#/$defs/__proto__` resolves to nothing and is refused like any other missing definition.
 *
 * A reference cycle terminates because a pointer already on the stack is treated as satisfied — its
 * validation is still in progress higher up, and re-entering it would only repeat that work.
 */
import type { GroqChatRequestBody } from './groq-contracts.js';

type ResponseFormat = NonNullable<GroqChatRequestBody['response_format']>;

/** The result of building a response format: either the format, or a pre-transport failure. */
export type ResponseFormatBuild =
  { readonly ok: true; readonly responseFormat: ResponseFormat } | { readonly ok: false };

/** Composition keywords deliberately NOT accepted. See the module note. */
const UNSUPPORTED_COMPOSITION = ['oneOf', 'allOf', 'not'] as const;

/** The only reference forms Groq documents, and therefore the only ones resolved. */
const ROOT_POINTER = '#';
const DEFS_KEY = '$defs';
const REF_KEY = '$ref';
const DEFS_PREFIX = '#/' + DEFS_KEY + '/';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every property key of an object schema must appear exactly once in `required`, and vice versa. */
function objectIsStrict(node: Record<string, unknown>): boolean {
  if (node['additionalProperties'] !== false) {
    return false;
  }
  const properties = node['properties'];
  if (!isRecord(properties)) {
    return false;
  }
  const required = node['required'];
  if (!Array.isArray(required) || required.some((one) => typeof one !== 'string')) {
    return false;
  }
  const requiredNames = required as readonly string[];
  // No duplicates — a duplicate is a malformed schema, not a stricter one.
  if (new Set(requiredNames).size !== requiredNames.length) {
    return false;
  }
  const propertyNames = Object.keys(properties);
  // Exact set equality, both directions: every property required, and nothing required that is not a
  // property. The second half catches a `required` naming a key that was renamed or removed.
  if (propertyNames.length !== requiredNames.length) {
    return false;
  }
  const requiredSet = new Set(requiredNames);
  return propertyNames.every((name) => requiredSet.has(name));
}

/**
 * Resolve a LOCAL JSON pointer against the root document, or `undefined` if not resolvable.
 *
 * Own-property lookup only, so no prototype key can be reached. No network, no evaluation.
 */
function resolveLocalRef(root: Record<string, unknown>, ref: string): unknown {
  if (ref === ROOT_POINTER) {
    return root;
  }
  if (!ref.startsWith(DEFS_PREFIX)) {
    return undefined;
  }
  const name = ref.slice(DEFS_PREFIX.length);
  // An empty name or a nested pointer is outside the documented form.
  if (name.length === 0 || name.includes('/')) {
    return undefined;
  }
  const defs = root[DEFS_KEY];
  if (!isRecord(defs) || !Object.prototype.hasOwnProperty.call(defs, name)) {
    return undefined;
  }
  return defs[name];
}

function checkNode(
  jsonSchema: unknown,
  root: Record<string, unknown>,
  visiting: ReadonlySet<string>,
): boolean {
  if (!isRecord(jsonSchema)) {
    return false;
  }

  const node = jsonSchema;

  if (UNSUPPORTED_COMPOSITION.some((keyword) => keyword in node)) {
    return false;
  }

  if (REF_KEY in node) {
    const ref = node[REF_KEY];
    if (typeof ref !== 'string') {
      return false;
    }
    // Already on the stack: the cycle is what makes the schema recursive, and re-entering it would
    // not establish anything the in-progress validation is not already establishing.
    if (visiting.has(ref)) {
      return true;
    }
    const resolved = resolveLocalRef(root, ref);
    if (resolved === undefined) {
      return false;
    }
    return checkNode(resolved, root, new Set([...visiting, ref]));
  }

  // A union: every branch must independently satisfy the subset. This is how an explicit null branch
  // (the only way to express "no value") is admitted.
  if ('anyOf' in node) {
    const branches = node['anyOf'];
    if (!Array.isArray(branches) || branches.length === 0) {
      return false;
    }
    return branches.every((branch) => checkNode(branch, root, visiting));
  }

  const type = node['type'];

  if (type === 'object') {
    if (!objectIsStrict(node)) {
      return false;
    }
    const properties = node['properties'] as Record<string, unknown>;
    return Object.values(properties).every((property) => checkNode(property, root, visiting));
  }

  if (type === 'array') {
    // A tuple form would need per-position validation; only the homogeneous form is sent today, so
    // anything else fails closed.
    const items = node['items'];
    if (items === undefined || Array.isArray(items)) {
      return false;
    }
    return checkNode(items, root, visiting);
  }

  // Scalars. `const` and `enum` ride along on these — they constrain a value, they do not change its
  // shape. Anything whose `type` is absent or unrecognised is refused.
  return (
    type === 'string' ||
    type === 'number' ||
    type === 'integer' ||
    type === 'boolean' ||
    type === 'null'
  );
}

/**
 * True iff a JSON Schema satisfies Groq's strict-mode restrictions, checked RECURSIVELY.
 *
 * Fail-closed: an unrecognised or unsupported construct returns false rather than being assumed
 * harmless. Local `$ref` / `$defs` resolve against the document passed in; nothing else does.
 */
export function isStrictCompatibleJsonSchema(jsonSchema: unknown): boolean {
  if (!isRecord(jsonSchema)) {
    return false;
  }
  // The ROOT must be an object. A bare scalar or a root-level union is not a valid strict
  // `json_schema` root even though either is fine as a property schema, and the recursive walk below
  // would happily accept one — the pre-HF4 checker got this part right and it must not be lost while
  // fixing the part it got wrong. A root `$ref` is followed first, so a schema that names its root
  // object in `$defs` is still admitted.
  let root: Record<string, unknown> = jsonSchema;
  const followed = new Set<string>();
  while (REF_KEY in root) {
    const ref = root[REF_KEY];
    if (typeof ref !== 'string' || followed.has(ref)) {
      return false;
    }
    followed.add(ref);
    const resolved = resolveLocalRef(jsonSchema, ref);
    if (!isRecord(resolved)) {
      return false;
    }
    root = resolved;
  }
  if (root['type'] !== 'object') {
    return false;
  }
  return checkNode(jsonSchema, jsonSchema, new Set<string>());
}

/**
 * Build the `response_format` for a STRUCTURED request. In strict mode a non-strict-compatible schema is
 * rejected (`{ ok: false }`) before any transport call.
 */
export function buildResponseFormat(
  jsonSchema: unknown,
  strictSupported: boolean,
): ResponseFormatBuild {
  if (strictSupported) {
    if (!isStrictCompatibleJsonSchema(jsonSchema)) {
      return { ok: false };
    }
    return {
      ok: true,
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'qf_structured_output', strict: true, schema: jsonSchema },
      },
    };
  }
  return { ok: true, responseFormat: { type: 'json_object' } };
}
