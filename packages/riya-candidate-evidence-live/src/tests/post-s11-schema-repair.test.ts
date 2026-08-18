/**
 * POST-S11 REQUEST-CONTRACT REPAIR — the offline schema audit and the next differential matrix.
 *
 * S11 spent one live authorization establishing that the real projected Riya schema is rejected (D5,
 * HTTP 400 at a 512 cap, behind controls that passed). It could not say WHICH part. These specs make
 * the next authorization narrower: they audit the exact document that went on the wire against every
 * rule of the documented strict subset that can be checked without a provider, and they build the
 * reduction ladder from the real schema rather than from a hypothesis.
 *
 * Nothing here reaches a network. The schema is obtained through the same production capture path the
 * D7/D8 canaries use, which reaches no provider, no transport and no credential.
 */
import { projectGroqStrictJsonSchema } from '@qf-jarvis/model-gateway';
import { beforeAll, describe, expect, it } from 'vitest';

import { captureProductionRiyaCanaryRequest } from '../diagnostic-canary-materials.js';
import {
  planRiyaSchemaProbeMatrix,
  SCHEMA_PROBE_STEP_IDS,
} from '../internal/riya-schema-probe-matrix.js';
import type { SchemaProbe } from '../internal/riya-schema-probe-matrix.js';
import { inventoryStrictSchema, SCHEMA_DIMENSIONS } from '../internal/strict-schema-inventory.js';
import type { StrictSchemaInventory } from '../internal/strict-schema-inventory.js';

/** The exact document D5 put on the wire: the real Riya schema, through the real HF4-R7 projection. */
let projected: unknown;
let inventory: StrictSchemaInventory;

beforeAll(async () => {
  const captured = await captureProductionRiyaCanaryRequest();
  const result = projectGroqStrictJsonSchema(captured.rawStructuredJsonSchema);
  if (!result.ok) {
    throw new Error(`the real Riya schema must project: ${result.reason}`);
  }
  projected = result.schema;
  inventory = inventoryStrictSchema(projected);
});

describe('the exact D5 document, audited offline', () => {
  it('projects, and its root is a closed object', () => {
    expect(projected).toBeDefined();
    expect(inventory.rootIsObject).toBe(true);
  });

  it('violates NO offline-checkable rule of the documented strict subset', () => {
    // THE load-bearing result of this phase. Every object is closed, every declared property is
    // required, every array has items, no unsupported keyword or reference survived projection.
    //
    // So the D5 rejection is NOT explained by anything checkable without a provider, and guessing a
    // keyword and changing production would be exactly the move this evidence forbids. The reduction
    // ladder below is the answer instead.
    expect([...inventory.findings]).toEqual([]);
  });

  it('uses only the documented keyword and type vocabulary', () => {
    expect([...inventory.keywordsUsed]).toEqual([
      'additionalProperties',
      'anyOf',
      'enum',
      'items',
      'properties',
      'required',
      'type',
    ]);
    for (const type of inventory.typesUsed) {
      expect(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']).toContain(type);
    }
    // HF4-R7/R1 removed every reference form; a survivor would be a regression in the projection.
    expect(inventory.keywordsUsed).not.toContain('$ref');
    expect(inventory.keywordsUsed).not.toContain('$defs');
  });

  it('records the structure that makes it different from every canary that PASSED', () => {
    // D1, D3 and D4 were flat two-level objects. The real document is not, and these numbers are the
    // gap the next diagnostic has to close.
    expect(inventory.maxDepth).toBeGreaterThan(2);
    expect(inventory.arrayCount).toBeGreaterThan(0);
    expect(inventory.anyOfCount).toBeGreaterThan(0);
    expect(inventory.objectCount).toBeGreaterThan(1);
    expect(inventory.propertyCount).toBeGreaterThan(0);
  });

  it('names the dimensions no S11 canary exercised', () => {
    // S11 tested: a closed object with a string enum (D1), a nullable anyOf PROPERTY (D3), and a
    // numeric singleton enum (D4). It never sent an array of any kind, never sent `anyOf` in ITEMS
    // position, and never nested beyond two levels.
    for (const untested of [
      'SCALAR_ARRAY',
      'OBJECT_ARRAY',
      'ANYOF_ARRAY_ITEMS',
      'NESTED_OBJECT',
    ] as const) {
      expect(inventory.dimensions).toContain(untested);
    }
  });

  it('is deterministic — the same schema inventories identically twice', () => {
    expect(JSON.stringify(inventoryStrictSchema(projected))).toBe(JSON.stringify(inventory));
  });

  it('carries nothing content-bearing', () => {
    const serialized = JSON.stringify(inventory);
    // Paths and counts only: no schema document, no message, no client turn, no model answer.
    expect(serialized).not.toContain('additionalProperties:');
    expect(serialized).not.toContain('replyBody');
    for (const forbidden of ['Bearer', 'sk-', 'authorization']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('the inventory FINDS a violation when one exists', () => {
    // The audit must be capable of failing, or "no findings" means nothing.
    const broken = inventoryStrictSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array' } },
      required: ['a'],
      // additionalProperties deliberately absent
    });
    const violations = broken.findings.map((one) => one.violation);
    expect(violations).toContain('OBJECT_NOT_CLOSED');
    expect(violations).toContain('REQUIRED_MISSING_PROPERTY');
    expect(violations).toContain('ARRAY_WITHOUT_ITEMS');
  });

  it('the inventory rejects surviving references and unsupported compositions', () => {
    const withRef = inventoryStrictSchema({
      type: 'object',
      properties: { a: { $ref: '#/$defs/x' } },
      required: ['a'],
      additionalProperties: false,
      $defs: { x: { type: 'string' } },
    });
    expect(withRef.findings.map((one) => one.violation)).toContain('REFERENCE_SURVIVED');

    const withOneOf = inventoryStrictSchema({
      type: 'object',
      properties: { a: { oneOf: [{ type: 'string' }, { type: 'null' }] } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(withOneOf.findings.map((one) => one.violation)).toContain('UNSUPPORTED_COMPOSITION');
  });
});

describe('the probe matrix is derived from the real schema', () => {
  let probes: readonly SchemaProbe[];
  beforeAll(() => {
    probes = planRiyaSchemaProbeMatrix(projected);
  });

  it('has one probe per governed step id, in order', () => {
    expect(probes.map((one) => one.stepId)).toEqual([...SCHEMA_PROBE_STEP_IDS]);
  });

  it('every probe is a closed object schema with no offline-checkable violation', () => {
    for (const probe of probes) {
      const audit = inventoryStrictSchema(probe.schema);
      expect(audit.rootIsObject, probe.stepId).toBe(true);
      // A probe that was itself malformed would send the next authorization after a defect this
      // module introduced rather than after the one it is hunting.
      expect(
        audit.findings.map((one) => one.violation),
        probe.stepId,
      ).toEqual([]);
    }
  });

  it('each probe carries a REAL fragment, located by path, never a replica', () => {
    const byId = new Map(probes.map((one) => [one.stepId, one]));
    for (const probe of probes) {
      if (probe.stepId === 'R0_MINIMAL_CONTROL') {
        expect(probe.derivedFromPath).toBe('$');
        continue;
      }
      expect(probe.derivedFromPath.startsWith('$'), probe.stepId).toBe(true);
    }
    // The last probe IS the exact document D5 sent — object identity, not a rebuild of it.
    expect(byId.get('R8_EXACT_PROJECTED_RIYA')?.schema).toBe(projected);
  });

  it('POST-PR-131 — the probes are INDEPENDENT, not a cumulative ladder', () => {
    // The retracted claim, asserted false so it cannot quietly return.
    //
    // A previous revision described these as a ladder whose consecutive rungs "add exactly ONE
    // dimension each", so that "the FIRST rejection names a cause". The implementation never did
    // that: each probe wraps ONE located fragment, so R2 is a different single fragment rather than
    // R1 plus an array, and it does not contain R1's numeric enum at all.
    const byId = new Map(probes.map((one) => [one.stepId, one]));
    const dimensionsOf = (stepId: string): readonly string[] =>
      inventoryStrictSchema(byId.get(stepId as never)?.schema).dimensions;

    const numericEnum = dimensionsOf('R1_NUMERIC_ENUM_AS_NUMBER');
    const scalarArray = dimensionsOf('R2_SCALAR_ARRAY');
    expect(numericEnum).toContain('NUMERIC_ENUM');
    // If R2 were R1 plus one dimension it would still carry the numeric enum. It does not.
    expect(scalarArray).not.toContain('NUMERIC_ENUM');

    // The same the other way: R3 does not contain R2's scalar array.
    expect(dimensionsOf('R3_OBJECT_ARRAY')).not.toContain('SCALAR_ARRAY');
  });

  it('POST-PR-131 — no probe except the exact document is a superset of its predecessor', () => {
    // A structural check rather than a label check. For a genuinely cumulative matrix every adjacent
    // pair would satisfy `dimensions(n-1) ⊆ dimensions(n)`. Between the FEATURE probes that fails,
    // which is exactly why the interpretation is a set and not an ordering.
    const featureIds = probes.filter((one) => one.probeKind === 'FEATURE').map((one) => one.stepId);
    const dims = (stepId: string): ReadonlySet<string> =>
      new Set(
        inventoryStrictSchema(probes.find((one) => one.stepId === stepId)?.schema).dimensions,
      );
    let cumulativePairs = 0;
    for (let index = 1; index < featureIds.length; index += 1) {
      const previous = dims(featureIds[index - 1] ?? '');
      const current = dims(featureIds[index] ?? '');
      if ([...previous].every((one) => current.has(one))) {
        cumulativePairs += 1;
      }
    }
    // Not one adjacent FEATURE pair is a superset relationship. The word "ladder" would be a lie.
    expect(cumulativePairs).toBe(0);
  });

  it('POST-PR-131 — distinct dimension LABELS are not treated as proof of anything structural', () => {
    // The old spec asserted only this, then the comments concluded one-axis adjacent deltas from it.
    // The property is kept because it IS true and useful — no two probes claim the same axis — but it
    // is asserted here as a labelling fact and nothing more.
    const labels = probes.map((one) => one.probeDimension);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every probe declares its role, and exactly one is the control', () => {
    const controls = probes.filter((one) => one.probeKind === 'CONTROL');
    expect(controls.map((one) => one.stepId)).toEqual(['R0_MINIMAL_CONTROL']);
    expect(probes.filter((one) => one.probeKind === 'EXACT').map((one) => one.stepId)).toEqual([
      'R8_EXACT_PROJECTED_RIYA',
    ]);
    // Feature and group probes make up the rest; every probe has a role.
    expect(probes.every((one) => one.probeKind.length > 0)).toBe(true);
  });

  it('isolates each dimension the S11 canaries never tested', () => {
    const dimensionsOf = (stepId: string): readonly string[] =>
      inventoryStrictSchema(probes.find((one) => one.stepId === stepId)?.schema).dimensions;

    expect(dimensionsOf('R2_SCALAR_ARRAY')).toContain('SCALAR_ARRAY');
    expect(dimensionsOf('R3_OBJECT_ARRAY')).toContain('OBJECT_ARRAY');
    expect(dimensionsOf('R4_ANYOF_ARRAY_ITEMS')).toContain('ANYOF_ARRAY_ITEMS');
    expect(dimensionsOf('R1_NUMERIC_ENUM_AS_NUMBER')).toContain('NUMERIC_ENUM');
    // And the control carries none of them, so a rejection at R0 means something else changed.
    const control = dimensionsOf('R0_MINIMAL_CONTROL');
    for (const untested of ['SCALAR_ARRAY', 'OBJECT_ARRAY', 'ANYOF_ARRAY_ITEMS'] as const) {
      expect(control).not.toContain(untested);
    }
  });

  it('is deterministic — two matrices over the same schema are byte-identical', () => {
    expect(JSON.stringify(planRiyaSchemaProbeMatrix(projected))).toBe(JSON.stringify(probes));
  });

  it('is bounded — a future run needs a small, reviewable number of calls', () => {
    expect(probes.length).toBe(9);
    expect(SCHEMA_DIMENSIONS.length).toBeGreaterThan(0);
  });

  it('refuses to plan over a document it cannot partition', () => {
    expect(() => planRiyaSchemaProbeMatrix({ type: 'string' })).toThrow(/ROOT_NOT_OBJECT/u);
    // A root object with none of the dimensions present fails loudly rather than producing a matrix
    // with silently missing probes.
    expect(() =>
      planRiyaSchemaProbeMatrix({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      }),
    ).toThrow(/DIMENSION_NOT_LOCATED/u);
  });
});
