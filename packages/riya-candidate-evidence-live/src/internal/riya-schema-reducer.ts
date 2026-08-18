/**
 * The DETERMINISTIC schema-reduction ladder for the next live diagnostic (POST-S11).
 *
 * ### The question S11 could not answer
 *
 * S11 asked "does the whole real Riya schema fail?" and got yes: D5 sent the exact projected schema
 * with tiny messages at a 512 cap and Groq returned HTTP 400. That is one bit of information for one
 * live authorization, and it is not enough to change anything — D3 and D4 had already shown that the
 * `anyOf`/nullable form and a numeric singleton enum are individually accepted, so the cause is
 * somewhere between those two facts and the whole document.
 *
 * The offline audit closes the obvious explanations: the projected schema has NO offline-checkable
 * violation. Every object is closed, every property is required, no unsupported keyword or `$ref`
 * survives projection. So the remaining cause is a dimension the canaries never exercised, and this
 * module names them by INSPECTING the real schema rather than by guessing.
 *
 * ### What D1-D4 never tested
 *
 * The real projected schema contains three arrays, an `anyOf` in ARRAY ITEMS position, objects nested
 * six levels deep, and a numeric enum rendered as `type: number` — while D4 tested `type: integer`.
 * Not one of those appears in D1, D3 or D4. Each is a candidate cause and each is cheap to isolate.
 *
 * ### Every rung carries REAL schema, never a replica
 *
 * A rung is built by locating a subtree inside the real projected document and wrapping it in a
 * minimal closed object. The fragment on the wire is therefore production's own, so a rejection is a
 * fact about the real schema rather than about something this file composed. Rungs are ordered so
 * that consecutive rungs differ by ONE dimension, which is what makes the first rejection name a
 * cause instead of a suspect.
 *
 * This module PLANS. It sends nothing, and nothing here may be executed against a provider without a
 * separate owner authorization.
 */

/** The ordered ladder. Each step adds exactly one structural dimension to the one before it. */
export const RIYA_REDUCTION_STEP_IDS = [
  'R0_MINIMAL_CONTROL',
  'R1_NUMERIC_ENUM_AS_NUMBER',
  'R2_SCALAR_ARRAY',
  'R3_OBJECT_ARRAY',
  'R4_ANYOF_ARRAY_ITEMS',
  'R5_NESTED_OBJECT_GROUP',
  'R6_REPLY_GROUP',
  'R7_EVOLUTION_GROUP',
  'R8_EXACT_PROJECTED_RIYA',
] as const;
export type RiyaReductionStepId = (typeof RIYA_REDUCTION_STEP_IDS)[number];

/** One rung: what it adds, and the real fragment that carries it. */
export interface RiyaReductionStep {
  readonly stepId: RiyaReductionStepId;
  /** The ONE dimension this rung adds relative to the rung before it. A closed token. */
  readonly addsDimension: string;
  /** Where in the real projected schema the fragment was taken from. A path, never a value. */
  readonly derivedFromPath: string;
  /** The schema to send: a minimal closed object wrapping the real fragment. */
  readonly schema: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Wrap a real fragment in the smallest closed object that can legally carry it. */
function wrap(propertyName: string, fragment: unknown): unknown {
  return Object.freeze({
    type: 'object',
    properties: { [propertyName]: fragment },
    required: [propertyName],
    additionalProperties: false,
  });
}

/** One located subtree of the real schema. */
interface Located {
  readonly path: string;
  readonly name: string;
  readonly node: Record<string, unknown>;
}

/**
 * Depth-first search of the REAL document for the first node satisfying a structural predicate.
 *
 * Deterministic: property order in the projected document is stable, so the same schema always yields
 * the same fragment and therefore the same plan. Searching rather than hardcoding is what makes the
 * partition come from the schema — if Riya's schema changes shape, the ladder follows it.
 */
function locate(
  schema: unknown,
  matches: (node: Record<string, unknown>) => boolean,
): Located | undefined {
  const visit = (node: unknown, path: string, name: string): Located | undefined => {
    if (!isRecord(node)) {
      return undefined;
    }
    if (matches(node)) {
      return { path, name, node };
    }
    const properties = isRecord(node['properties']) ? node['properties'] : undefined;
    if (properties !== undefined) {
      for (const key of Object.keys(properties)) {
        const found = visit(properties[key], `${path}.${key}`, key);
        if (found !== undefined) {
          return found;
        }
      }
    }
    if (node['items'] !== undefined) {
      const found = visit(node['items'], `${path}[]`, `${name}Item`);
      if (found !== undefined) {
        return found;
      }
    }
    if (Array.isArray(node['anyOf'])) {
      for (const [index, branch] of node['anyOf'].entries()) {
        const found = visit(
          branch,
          `${path}|anyOf${String(index)}`,
          `${name}Branch${String(index)}`,
        );
        if (found !== undefined) {
          return found;
        }
      }
    }
    return undefined;
  };
  return visit(schema, '$', 'root');
}

const isNumericEnum = (node: Record<string, unknown>): boolean =>
  Array.isArray(node['enum']) &&
  node['enum'].length > 0 &&
  node['enum'].every((one) => typeof one === 'number');

const isArrayOf = (
  node: Record<string, unknown>,
  itemMatches: (items: Record<string, unknown>) => boolean,
): boolean => node['type'] === 'array' && isRecord(node['items']) && itemMatches(node['items']);

/**
 * Locate a required dimension, or fail loudly.
 *
 * A plan with a silently missing rung would send the next authorization after an incomplete
 * partition, which is the failure mode this whole phase exists to stop — so an absent dimension is an
 * error rather than a shorter ladder.
 */
function mustLocate(
  schema: unknown,
  dimension: string,
  matches: (node: Record<string, unknown>) => boolean,
): Located {
  const found = locate(schema, matches);
  if (found === undefined) {
    throw new Error(`QFJ_REDUCER_DIMENSION_NOT_LOCATED_${dimension}`);
  }
  return found;
}

/** Build the ladder from the REAL projected schema. */
export function planRiyaSchemaReduction(projected: unknown): readonly RiyaReductionStep[] {
  if (!isRecord(projected) || projected['type'] !== 'object') {
    throw new Error('QFJ_REDUCER_ROOT_NOT_OBJECT');
  }

  const numericEnum = mustLocate(projected, 'NUMERICENUM', isNumericEnum);
  const scalarArray = mustLocate(projected, 'SCALARARRAY', (node) =>
    isArrayOf(node, (items) => items['type'] !== 'object' && !Array.isArray(items['anyOf'])),
  );
  const objectArray = mustLocate(projected, 'OBJECTARRAY', (node) =>
    isArrayOf(node, (items) => items['type'] === 'object'),
  );
  const anyOfArray = mustLocate(projected, 'ANYOFARRAY', (node) =>
    isArrayOf(node, (items) => Array.isArray(items['anyOf'])),
  );
  // The shallowest nested object that is NOT the root and carries its own properties.
  const nestedObject = mustLocate(projected, 'NESTEDOBJECT', (node) => {
    if (node === projected || node['type'] !== 'object') {
      return false;
    }
    const properties = isRecord(node['properties']) ? node['properties'] : {};
    // A group, not a leaf-bearing array item: it must itself contain a nested structure.
    return Object.values(properties).some(
      (one) => isRecord(one) && (one['type'] === 'object' || one['type'] === 'array'),
    );
  });

  const rootProperties = isRecord(projected['properties']) ? projected['properties'] : {};
  const topLevelNames = Object.keys(rootProperties);
  const [firstGroup, secondGroup] = topLevelNames;
  if (firstGroup === undefined || secondGroup === undefined) {
    throw new Error('QFJ_REDUCER_ROOT_GROUPS_MISSING');
  }

  const step = (
    stepId: RiyaReductionStepId,
    addsDimension: string,
    derivedFromPath: string,
    schema: unknown,
  ): RiyaReductionStep => Object.freeze({ stepId, addsDimension, derivedFromPath, schema });

  return Object.freeze([
    // The control. Identical in shape to the canary that PASSED in S11, so a rejection here would
    // mean the account or the envelope changed rather than the schema.
    step(
      'R0_MINIMAL_CONTROL',
      'CLOSED_OBJECT_STRING_ENUM',
      '$',
      Object.freeze({
        type: 'object',
        properties: { ok: { type: 'string', enum: ['OK'] } },
        required: ['ok'],
        additionalProperties: false,
      }),
    ),
    // D4 tested `type: integer`. The real projection emits `type: number` for the same Zod literal,
    // and that difference has never been on the wire.
    step(
      'R1_NUMERIC_ENUM_AS_NUMBER',
      'NUMERIC_ENUM_AS_NUMBER',
      numericEnum.path,
      wrap(numericEnum.name, numericEnum.node),
    ),
    // No canary has ever sent an array of any kind.
    step(
      'R2_SCALAR_ARRAY',
      'SCALAR_ARRAY',
      scalarArray.path,
      wrap(scalarArray.name, scalarArray.node),
    ),
    step(
      'R3_OBJECT_ARRAY',
      'OBJECT_ARRAY',
      objectArray.path,
      wrap(objectArray.name, objectArray.node),
    ),
    // D3 proved `anyOf` in a PROPERTY position. This is `anyOf` in ITEMS position, which is a
    // different place in the document and has never been tested.
    step(
      'R4_ANYOF_ARRAY_ITEMS',
      'ANYOF_IN_ARRAY_ITEMS',
      anyOfArray.path,
      wrap(anyOfArray.name, anyOfArray.node),
    ),
    step(
      'R5_NESTED_OBJECT_GROUP',
      'NESTED_OBJECT_GROUP',
      nestedObject.path,
      wrap(nestedObject.name, nestedObject.node),
    ),
    // The two real halves, each whole, before the two together.
    step(
      'R6_REPLY_GROUP',
      'FIRST_TOP_LEVEL_GROUP',
      `$.${firstGroup}`,
      wrap(firstGroup, rootProperties[firstGroup]),
    ),
    step(
      'R7_EVOLUTION_GROUP',
      'SECOND_TOP_LEVEL_GROUP',
      `$.${secondGroup}`,
      wrap(secondGroup, rootProperties[secondGroup]),
    ),
    // The exact document D5 sent. Reaching this rung accepted means the rejection is not the schema.
    step('R8_EXACT_PROJECTED_RIYA', 'FULL_DOCUMENT', '$', projected),
  ]);
}
