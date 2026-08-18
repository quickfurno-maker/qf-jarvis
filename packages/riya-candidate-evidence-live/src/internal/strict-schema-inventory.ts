/**
 * OFFLINE audit of the exact projected schema D5 sent (POST-S11 REQUEST-CONTRACT REPAIR).
 *
 * ### Why this exists rather than another guess
 *
 * S11's D5 carried the real projected Riya schema with tiny synthetic messages at a 512 completion
 * cap — the smallest request the real schema can appear in — and Groq returned HTTP 400
 * `invalid_request_error`. D3 proved the documented `anyOf`/nullable form is accepted and D4 proved a
 * numeric singleton enum is accepted, so neither of those constructs may be blamed without new
 * evidence.
 *
 * The temptation at this point is to guess a keyword, change production and spend the next live
 * authorization finding out. This module does the opposite: it walks the document that actually went
 * on the wire and checks it against every rule of the documented strict subset that can be checked
 * WITHOUT a provider. What it cannot decide, it reports as undecidable rather than as a suspicion.
 *
 * ### Content-free by construction
 *
 * A JSON Schema is structure, not conversation, and nothing here reads a message, a prompt, a client
 * turn or a model answer. What it emits is counts, depths, closed tokens and property PATHS — and a
 * path is a schema key such as `$.reply.citations[]`, never a value. There is no field in
 * {@link StrictSchemaInventory} that a document fragment could occupy.
 */

/** A rule the documented strict subset states and this module can check offline. */
export const STRICT_SCHEMA_VIOLATIONS = [
  /** An object that does not set `additionalProperties: false`. */
  'OBJECT_NOT_CLOSED',
  /** An object whose `required` does not list every declared property. */
  'REQUIRED_MISSING_PROPERTY',
  /** `required` names a property the object does not declare. */
  'REQUIRED_UNKNOWN_PROPERTY',
  /** An array with no `items` schema. */
  'ARRAY_WITHOUT_ITEMS',
  /** A keyword outside the documented subset survived projection. */
  'UNSUPPORTED_KEYWORD',
  /** A `$ref` or `$defs` survived projection. */
  'REFERENCE_SURVIVED',
  /** A composition form the subset does not document (`oneOf`, `allOf`, `not`). */
  'UNSUPPORTED_COMPOSITION',
  /** A declared type outside the documented set. */
  'UNSUPPORTED_TYPE',
  /** An empty `enum`, or one whose members are not all one primitive kind. */
  'MALFORMED_ENUM',
  /** An `anyOf` with fewer than two branches, or a branch that is not a schema object. */
  'MALFORMED_ANYOF',
  /** The root of a strict response format is not an object. */
  'ROOT_NOT_OBJECT',
  /** An object that declares no properties at all. */
  'EMPTY_OBJECT',
] as const;
export type StrictSchemaViolation = (typeof STRICT_SCHEMA_VIOLATIONS)[number];

/** One violation, and the schema PATH it sits at. Never a value from the document. */
export interface StrictSchemaFinding {
  readonly violation: StrictSchemaViolation;
  /** A schema key path such as `$.evolution.observations[]|anyOf0`. Structure only. */
  readonly path: string;
}

/**
 * The structural DIMENSIONS a schema exercises.
 *
 * This is the load-bearing half. Each canary D1-D4 exercised exactly one small dimension and passed;
 * the real schema exercises several the canaries never touched, and naming them is what turns "the
 * whole schema fails" into a bounded list of things to test next.
 */
export const SCHEMA_DIMENSIONS = [
  'CLOSED_OBJECT',
  'STRING_ENUM',
  'NUMERIC_ENUM',
  'BOOLEAN_PROPERTY',
  'NULLABLE_ANYOF_PROPERTY',
  'NESTED_OBJECT',
  'SCALAR_ARRAY',
  'OBJECT_ARRAY',
  'ANYOF_ARRAY_ITEMS',
] as const;
export type SchemaDimension = (typeof SCHEMA_DIMENSIONS)[number];

/** Everything measured. Numbers, closed tokens and schema paths — nothing content-bearing. */
export interface StrictSchemaInventory {
  readonly rootIsObject: boolean;
  readonly objectCount: number;
  readonly arrayCount: number;
  readonly anyOfCount: number;
  readonly enumCount: number;
  readonly numericEnumCount: number;
  readonly stringEnumCount: number;
  readonly propertyCount: number;
  /** Deepest schema node, counting the root as 1. */
  readonly maxDepth: number;
  /** Every keyword the document uses, sorted. A closed set if projection did its job. */
  readonly keywordsUsed: readonly string[];
  /** Every declared `type`, sorted. */
  readonly typesUsed: readonly string[];
  /** The structural dimensions present, in vocabulary order. */
  readonly dimensions: readonly SchemaDimension[];
  /** Violations of the offline-checkable rules. EMPTY means "nothing provable here", not "correct". */
  readonly findings: readonly StrictSchemaFinding[];
}

/** The keywords the documented strict subset establishes. Anything else is a finding. */
const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'enum',
]);

/** The types the documented subset establishes. */
const SUPPORTED_TYPES = new Set([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

/** Compositions the subset does NOT document. Present in a projected document is a real finding. */
const UNSUPPORTED_COMPOSITIONS = ['oneOf', 'allOf', 'not'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk the projected document and report what it is.
 *
 * Deterministic: the same schema always produces the same inventory, including the ORDER of findings
 * and dimensions, so two runs can be compared byte for byte.
 */
export function inventoryStrictSchema(schema: unknown): StrictSchemaInventory {
  const findings: StrictSchemaFinding[] = [];
  const dimensions = new Set<SchemaDimension>();
  const keywords = new Set<string>();
  const types = new Set<string>();
  let objectCount = 0;
  let arrayCount = 0;
  let anyOfCount = 0;
  let enumCount = 0;
  let numericEnumCount = 0;
  let stringEnumCount = 0;
  let propertyCount = 0;
  let maxDepth = 0;

  const add = (violation: StrictSchemaViolation, path: string): void => {
    findings.push(Object.freeze({ violation, path }));
  };

  const walk = (node: unknown, depth: number, path: string): void => {
    if (!isRecord(node)) {
      return;
    }
    maxDepth = Math.max(maxDepth, depth);
    for (const keyword of Object.keys(node)) {
      keywords.add(keyword);
      if (keyword === '$ref' || keyword === '$defs') {
        add('REFERENCE_SURVIVED', path);
      } else if (UNSUPPORTED_COMPOSITIONS.includes(keyword)) {
        add('UNSUPPORTED_COMPOSITION', path);
      } else if (!SUPPORTED_KEYWORDS.has(keyword)) {
        add('UNSUPPORTED_KEYWORD', path);
      }
    }

    const declaredType = node['type'];
    if (typeof declaredType === 'string') {
      types.add(declaredType);
      if (!SUPPORTED_TYPES.has(declaredType)) {
        add('UNSUPPORTED_TYPE', path);
      }
      if (declaredType === 'boolean') {
        dimensions.add('BOOLEAN_PROPERTY');
      }
    }

    const enumMembers = node['enum'];
    if (Array.isArray(enumMembers)) {
      enumCount += 1;
      if (enumMembers.length === 0) {
        add('MALFORMED_ENUM', path);
      } else if (enumMembers.every((one) => typeof one === 'string')) {
        stringEnumCount += 1;
        dimensions.add('STRING_ENUM');
      } else if (enumMembers.every((one) => typeof one === 'number' && Number.isFinite(one))) {
        numericEnumCount += 1;
        dimensions.add('NUMERIC_ENUM');
      } else {
        // Mixed-kind members. The subset documents Enum as a single-kind vocabulary.
        add('MALFORMED_ENUM', path);
      }
    }

    const branches = node['anyOf'];
    if (Array.isArray(branches)) {
      anyOfCount += 1;
      if (branches.length < 2 || !branches.every(isRecord)) {
        add('MALFORMED_ANYOF', path);
      }
      // A nullable property is `anyOf: [T, null]` — the exact form D3 proved is accepted. Anything
      // wider is a genuine union and is tracked as such by the array-items dimension below.
      const nullable =
        branches.length === 2 && branches.some((one) => isRecord(one) && one['type'] === 'null');
      if (nullable) {
        dimensions.add('NULLABLE_ANYOF_PROPERTY');
      }
      branches.forEach((branch, index) => {
        walk(branch, depth + 1, `${path}|anyOf${String(index)}`);
      });
    }

    if (declaredType === 'object') {
      objectCount += 1;
      dimensions.add('CLOSED_OBJECT');
      if (depth > 1) {
        dimensions.add('NESTED_OBJECT');
      }
      if (node['additionalProperties'] !== false) {
        add('OBJECT_NOT_CLOSED', path);
      }
      const properties = isRecord(node['properties']) ? node['properties'] : {};
      const names = Object.keys(properties);
      propertyCount += names.length;
      if (names.length === 0) {
        add('EMPTY_OBJECT', path);
      }
      const required = Array.isArray(node['required'])
        ? node['required'].filter((one): one is string => typeof one === 'string')
        : [];
      const requiredSet = new Set(required);
      // Strict mode has no concept of an absent property: every declared key must be required.
      for (const name of names) {
        if (!requiredSet.has(name)) {
          add('REQUIRED_MISSING_PROPERTY', `${path}.${name}`);
        }
      }
      for (const name of required) {
        if (!names.includes(name)) {
          add('REQUIRED_UNKNOWN_PROPERTY', `${path}.${name}`);
        }
      }
      for (const name of names) {
        walk(properties[name], depth + 1, `${path}.${name}`);
      }
    }

    if (declaredType === 'array') {
      arrayCount += 1;
      const items = node['items'];
      if (items === undefined) {
        add('ARRAY_WITHOUT_ITEMS', path);
      } else if (isRecord(items)) {
        if (Array.isArray(items['anyOf'])) {
          dimensions.add('ANYOF_ARRAY_ITEMS');
        } else if (items['type'] === 'object') {
          dimensions.add('OBJECT_ARRAY');
        } else {
          dimensions.add('SCALAR_ARRAY');
        }
        walk(items, depth + 1, `${path}[]`);
      }
    }
  };

  walk(schema, 1, '$');
  const rootIsObject = isRecord(schema) && schema['type'] === 'object';
  if (!rootIsObject) {
    findings.unshift(Object.freeze({ violation: 'ROOT_NOT_OBJECT' as const, path: '$' }));
  }

  return Object.freeze({
    rootIsObject,
    objectCount,
    arrayCount,
    anyOfCount,
    enumCount,
    numericEnumCount,
    stringEnumCount,
    propertyCount,
    maxDepth,
    keywordsUsed: Object.freeze([...keywords].sort()),
    typesUsed: Object.freeze([...types].sort()),
    dimensions: Object.freeze(SCHEMA_DIMENSIONS.filter((one) => dimensions.has(one))),
    findings: Object.freeze(findings),
  });
}
