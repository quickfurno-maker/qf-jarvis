/**
 * The POST-SDH4 schema-repair verification plan (V0-V4).
 *
 * ### Why a NEW plan rather than a reused one
 *
 * RUN SDH4 spent a live authorization on the R0-R8 matrix and produced immutable evidence: the real
 * `anyOf` object union sitting directly under `$.evolution.observations` array items was rejected
 * with HTTP 400, and so were the two probes that contain it, while the minimal control, a numeric
 * enum, a scalar array, an object array, a nested object group and the whole reply group were all
 * accepted.
 *
 * The repair removed that composition. The historical planner therefore CANNOT plan against the
 * repaired schema any more — it looks for a fragment that no longer exists and fails loudly, which is
 * correct and is itself a regression proof. What it must not do is quietly re-point `R4` at a
 * different shape and keep the old identifier, because every SDH4 receipt already says what `R4`
 * meant.
 *
 * So the historical vocabulary stays frozen for history, and verification gets its own: five probes,
 * `V0`-`V4`, describing the repaired representation.
 *
 * ### What each probe asks
 *
 * V0 is the control, identical to the shape SDH4's R0 was accepted at — a rejection here means the
 * account, the model entitlement or the request envelope moved rather than the schema.
 *
 * V1 and V2 isolate the two NEW arrays independently: the repair replaced one array-of-union with two
 * separately typed arrays, and each deserves its own answer rather than being inferred from the
 * group. V3 is the evolution group that previously failed as a whole. V4 is the exact repaired
 * projected document.
 *
 * These are INDEPENDENT probes, exactly as R0-R8 were: V2 is not V1 plus a field. The result is read
 * as a SET, and only V0 and V4 carry precedence.
 *
 * This module PLANS. It sends nothing.
 */

/** The five probes. New identifiers, because they describe a schema SDH4 never saw. */
export const SCHEMA_REPAIR_VERIFICATION_STEP_IDS = [
  'V0_MINIMAL_CONTROL',
  'V1_OBSERVATION_SETS_ARRAY',
  'V2_OBSERVATION_CLEARS_ARRAY',
  'V3_EVOLUTION_GROUP',
  'V4_EXACT_PROJECTED_RIYA',
] as const;
export type SchemaRepairVerificationStepId = (typeof SCHEMA_REPAIR_VERIFICATION_STEP_IDS)[number];

/** The role a probe plays. Only `CONTROL` can invalidate a run; only `EXACT` answers the whole. */
export const SCHEMA_REPAIR_PROBE_KINDS = ['CONTROL', 'REPAIRED_FEATURE', 'GROUP', 'EXACT'] as const;
export type SchemaRepairProbeKind = (typeof SCHEMA_REPAIR_PROBE_KINDS)[number];

/** One verification probe: what it isolates, and the real fragment that carries it. */
export interface SchemaRepairVerificationProbe {
  readonly stepId: SchemaRepairVerificationStepId;
  readonly probeKind: SchemaRepairProbeKind;
  /** The structure this probe isolates. It asserts nothing about any other probe. */
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

/** Read a required child node of the REAL projected document, or fail loudly. */
function child(node: unknown, key: string, path: string): Record<string, unknown> {
  const properties =
    isRecord(node) && isRecord(node['properties']) ? node['properties'] : undefined;
  const found = properties?.[key];
  if (!isRecord(found)) {
    throw new Error(`QFJ_SCHEMA_REPAIR_FRAGMENT_NOT_LOCATED_${path}`);
  }
  return found;
}

/**
 * Build the verification plan from the REAL repaired projected schema.
 *
 * Every fragment is located inside the document rather than written here, so a rejection is a fact
 * about production's own schema. It throws if the repaired shape is not present — a plan that
 * silently verified something else would be worse than no plan.
 */
export function planRiyaSchemaRepairVerification(
  projected: unknown,
): readonly SchemaRepairVerificationProbe[] {
  if (!isRecord(projected) || projected['type'] !== 'object') {
    throw new Error('QFJ_SCHEMA_REPAIR_ROOT_NOT_OBJECT');
  }

  const evolution = child(projected, 'evolution', 'EVOLUTION');
  const observations = child(evolution, 'observations', 'OBSERVATIONS');
  // The repair's own shape. If observations is still an array, the repair is not in this document.
  if (observations['type'] !== 'object') {
    throw new Error('QFJ_SCHEMA_REPAIR_OBSERVATIONS_NOT_A_CONTAINER');
  }
  const sets = child(observations, 'sets', 'OBSERVATION_SETS');
  const clears = child(observations, 'clears', 'OBSERVATION_CLEARS');

  const probe = (
    stepId: SchemaRepairVerificationStepId,
    probeKind: SchemaRepairProbeKind,
    probeDimension: string,
    derivedFromPath: string,
    schema: unknown,
  ): SchemaRepairVerificationProbe =>
    Object.freeze({ stepId, probeKind, probeDimension, derivedFromPath, schema });

  return Object.freeze([
    // The CONTROL, identical to the shape SDH4's R0 was accepted at.
    probe(
      'V0_MINIMAL_CONTROL',
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
    // The two NEW arrays, each alone. Independent of each other.
    probe(
      'V1_OBSERVATION_SETS_ARRAY',
      'REPAIRED_FEATURE',
      'OBSERVATION_SETS_OBJECT_ARRAY',
      '$.evolution.observations.sets',
      wrap('sets', sets),
    ),
    probe(
      'V2_OBSERVATION_CLEARS_ARRAY',
      'REPAIRED_FEATURE',
      'OBSERVATION_CLEARS_OBJECT_ARRAY',
      '$.evolution.observations.clears',
      wrap('clears', clears),
    ),
    // The group that failed as a whole in SDH4 (R7), now carrying the repaired container.
    probe(
      'V3_EVOLUTION_GROUP',
      'GROUP',
      'EVOLUTION_GROUP',
      '$.evolution',
      wrap('evolution', evolution),
    ),
    // The exact repaired document. SDH4's R8 equivalent.
    probe('V4_EXACT_PROJECTED_RIYA', 'EXACT', 'FULL_DOCUMENT', '$', projected),
  ]);
}
