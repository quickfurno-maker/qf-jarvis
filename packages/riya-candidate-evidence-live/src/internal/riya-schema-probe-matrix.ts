/**
 * The ORTHOGONAL schema probe matrix for a future bounded diagnostic (POST-PR-131).
 *
 * ### The question S11 could not answer
 *
 * S11 asked "does the whole real Riya schema fail?" and got yes: D5 sent the exact projected schema
 * with tiny messages at a 512 completion cap and Groq returned HTTP 400. That is one bit of
 * information for one live authorization. D3 and D4 had already shown the `anyOf`/nullable form and a
 * numeric singleton enum are individually accepted, so the cause sits somewhere between those facts
 * and the whole document, and the offline audit found no strict-subset violation to explain it.
 *
 * ### These are INDEPENDENT probes, not a cumulative ladder
 *
 * An earlier revision of this module called the nine steps a "reduction ladder" and its specs claimed
 * consecutive rungs "add exactly ONE dimension each", so that "the FIRST rejection names a cause".
 * **That claim was not true of the implementation and is withdrawn.**
 *
 * Each probe is built by locating one fragment of the real projected document and wrapping it in a
 * minimal closed object. R2 is therefore NOT R1 plus an array — it is a different single fragment,
 * and it does not contain R1's numeric enum at all. The old spec only asserted that the dimension
 * LABELS were distinct, which proves nothing about the schemas, and the complexity spec only checked
 * that the control was shallowest and the exact document deepest.
 *
 * So the honest reading is a MATRIX of independent questions, each of the form:
 *
 *   "Does the provider accept THIS real schema fragment, alone, at the controlled low cap?"
 *
 * and NOT:
 *
 *   "Did this probe add exactly one feature to the previous one?"
 *
 * The consequence for a future run is concrete and is enforced by the runner rather than left to a
 * reader: after the control passes, EVERY feature and group probe runs, and the result is the SET of
 * rejections. Stopping at the first rejection, or reading it as the unique root cause, would be the
 * same precedence mistake the S11 classifier made.
 *
 * ### Every probe carries REAL schema, never a replica
 *
 * A fragment is located inside the real projected document by structural search, so a rejection is a
 * fact about production's own schema rather than about something this file composed. If Riya's schema
 * changes shape, the matrix follows it.
 *
 * This module PLANS. It sends nothing, and nothing here may be executed against a provider without a
 * separate owner authorization.
 */

/**
 * The nine probes.
 *
 * The `R0`-`R8` identifiers are retained from the previous revision deliberately: they already appear
 * in the merged report and in review history, and renaming them would create churn without adding
 * meaning. The ORDER is a reading order for a human, not an execution dependency — every probe after
 * the control is independent of every other.
 */
export const SCHEMA_PROBE_STEP_IDS = [
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
export type SchemaProbeStepId = (typeof SCHEMA_PROBE_STEP_IDS)[number];

/**
 * What role a probe plays in the matrix.
 *
 * Load-bearing for the analysis: only `CONTROL` can invalidate the run, only `EXACT` answers the
 * composition question, and `FEATURE`/`GROUP` results are read as a SET rather than in order.
 */
export const SCHEMA_PROBE_KINDS = ['CONTROL', 'FEATURE', 'GROUP', 'EXACT'] as const;
export type SchemaProbeKind = (typeof SCHEMA_PROBE_KINDS)[number];

/** One probe: what it isolates, and the real fragment that carries it. */
export interface SchemaProbe {
  readonly stepId: SchemaProbeStepId;
  readonly probeKind: SchemaProbeKind;
  /**
   * The structure this probe isolates. A closed descriptive token.
   *
   * It says what THIS probe carries. It does NOT assert any relationship to the probe before it —
   * that was the retracted claim.
   */
  readonly probeDimension: string;
  /** Where in the real projected schema the fragment came from. A path, never a value. */
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
 * the same fragment and therefore the same matrix. Searching rather than hardcoding is what makes the
 * partition come from the schema.
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
 * Locate a required structure, or fail loudly.
 *
 * A matrix with a silently missing probe would send the next authorization after an incomplete
 * partition, which is the failure mode this whole phase exists to stop.
 */
function mustLocate(
  schema: unknown,
  dimension: string,
  matches: (node: Record<string, unknown>) => boolean,
): Located {
  const found = locate(schema, matches);
  if (found === undefined) {
    throw new Error(`QFJ_SCHEMA_PROBE_DIMENSION_NOT_LOCATED_${dimension}`);
  }
  return found;
}

/** Build the matrix from the REAL projected schema. */
export function planRiyaSchemaProbeMatrix(projected: unknown): readonly SchemaProbe[] {
  if (!isRecord(projected) || projected['type'] !== 'object') {
    throw new Error('QFJ_SCHEMA_PROBE_ROOT_NOT_OBJECT');
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
  // The shallowest nested object that is NOT the root and carries its own nested structure.
  const nestedObject = mustLocate(projected, 'NESTEDOBJECT', (node) => {
    if (node === projected || node['type'] !== 'object') {
      return false;
    }
    const properties = isRecord(node['properties']) ? node['properties'] : {};
    return Object.values(properties).some(
      (one) => isRecord(one) && (one['type'] === 'object' || one['type'] === 'array'),
    );
  });

  const rootProperties = isRecord(projected['properties']) ? projected['properties'] : {};
  const topLevelNames = Object.keys(rootProperties);
  const [firstGroup, secondGroup] = topLevelNames;
  if (firstGroup === undefined || secondGroup === undefined) {
    throw new Error('QFJ_SCHEMA_PROBE_ROOT_GROUPS_MISSING');
  }

  const probe = (
    stepId: SchemaProbeStepId,
    probeKind: SchemaProbeKind,
    probeDimension: string,
    derivedFromPath: string,
    schema: unknown,
  ): SchemaProbe => Object.freeze({ stepId, probeKind, probeDimension, derivedFromPath, schema });

  return Object.freeze([
    // The CONTROL. Identical in shape to the canary that PASSED in S11, so a rejection here means the
    // account, the model entitlement or the request envelope changed — not the Riya schema. It is the
    // only probe whose failure invalidates the rest.
    probe(
      'R0_MINIMAL_CONTROL',
      'CONTROL',
      'CLOSED_OBJECT_STRING_ENUM',
      '$',
      Object.freeze({
        type: 'object',
        properties: { ok: { type: 'string', enum: ['OK'] } },
        required: ['ok'],
        additionalProperties: false,
      }),
    ),
    // FEATURE probes. Each carries ONE real fragment alone. They are independent of each other and of
    // the reading order: none of them contains any other.
    probe(
      'R1_NUMERIC_ENUM_AS_NUMBER',
      'FEATURE',
      'NUMERIC_ENUM_AS_NUMBER',
      numericEnum.path,
      wrap(numericEnum.name, numericEnum.node),
    ),
    probe(
      'R2_SCALAR_ARRAY',
      'FEATURE',
      'SCALAR_ARRAY',
      scalarArray.path,
      wrap(scalarArray.name, scalarArray.node),
    ),
    probe(
      'R3_OBJECT_ARRAY',
      'FEATURE',
      'OBJECT_ARRAY',
      objectArray.path,
      wrap(objectArray.name, objectArray.node),
    ),
    probe(
      'R4_ANYOF_ARRAY_ITEMS',
      'FEATURE',
      'ANYOF_IN_ARRAY_ITEMS',
      anyOfArray.path,
      wrap(anyOfArray.name, anyOfArray.node),
    ),
    probe(
      'R5_NESTED_OBJECT_GROUP',
      'FEATURE',
      'NESTED_OBJECT_GROUP',
      nestedObject.path,
      wrap(nestedObject.name, nestedObject.node),
    ),
    // GROUP probes: the two real halves, each whole and each on its own.
    probe(
      'R6_REPLY_GROUP',
      'GROUP',
      'FIRST_TOP_LEVEL_GROUP',
      `$.${firstGroup}`,
      wrap(firstGroup, rootProperties[firstGroup]),
    ),
    probe(
      'R7_EVOLUTION_GROUP',
      'GROUP',
      'SECOND_TOP_LEVEL_GROUP',
      `$.${secondGroup}`,
      wrap(secondGroup, rootProperties[secondGroup]),
    ),
    // The EXACT document D5 sent. Accepted here while every other probe also passed means the
    // rejection S11 saw is not reproduced by this matrix at this cap.
    probe('R8_EXACT_PROJECTED_RIYA', 'EXACT', 'FULL_DOCUMENT', '$', projected),
  ]);
}
